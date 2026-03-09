/**
 * BBG Terminal — Local Proxy Server
 *
 * Required:
 *   ANTHROPIC_API_KEY   — console.anthropic.com/settings/keys
 *
 * Optional (all free):
 *   FRED_API_KEY        — fred.stlouisfed.org/docs/api/api_key.html
 *   NEWS_API_KEY        — newsapi.org/register (100 req/day)
 *   ALPHA_VANTAGE_KEY   — alphavantage.co/support/#api-key (25 req/day)
 *
 * Windows:   set ANTHROPIC_API_KEY=sk-ant-... && node server.js
 * Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-... && node server.js
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const ANT_KEY  = process.env.ANTHROPIC_API_KEY  || "";
const FRED_KEY = process.env.FRED_API_KEY        || "";
const NEWS_KEY = process.env.NEWS_API_KEY        || "";
const AV_KEY   = process.env.ALPHA_VANTAGE_KEY   || "";
const PORT     = 3001;

// ── Yahoo Finance crumb/cookie cache ─────────────────────────────────────────
let yahooCookie = "";
let yahooCrumb  = "";
let crumbExpiry = 0;

function refreshYahooCrumb(cb) {
  // Step 1: hit the consent/crumb endpoint to get a session cookie
  const req = https.request({
    hostname: "query1.finance.yahoo.com",
    port: 443,
    path: "/v1/test/getcrumb",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  }, (res) => {
    // Save all cookies from this response
    const cookies = res.headers["set-cookie"] || [];
    yahooCookie = cookies.map(c => c.split(";")[0]).join("; ");
    let crumb = "";
    res.on("data", c => crumb += c);
    res.on("end", () => {
      yahooCrumb  = crumb.trim();
      crumbExpiry = Date.now() + 29 * 60 * 1000; // 29 min TTL
      console.log(`  Yahoo crumb refreshed: ${yahooCrumb.slice(0,12)}... cookie: ${yahooCookie.slice(0,30)}...`);
      cb(null);
    });
  });
  req.on("error", cb);
  req.setTimeout(8000, () => { req.destroy(); cb(new Error("crumb timeout")); });
  req.end();
}

function ensureCrumb(cb) {
  if (yahooCrumb && Date.now() < crumbExpiry) return cb(null);
  refreshYahooCrumb(cb);
}

// ── Core HTTP helpers ─────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonOk(res, data) {
  setCORS(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function jsonErr(res, code, msg) {
  setCORS(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
}

function httpsGet(options, cb) {
  const req = https.request(options, (r) => {
    let data = "";
    r.on("data", c => data += c);
    r.on("end", () => {
      try { cb(null, JSON.parse(data), r.statusCode); }
      catch(e) { cb(new Error(`JSON parse failed [${r.statusCode}]: ${data.slice(0,200)}`)); }
    });
  });
  req.on("error", cb);
  req.setTimeout(12000, () => { req.destroy(); cb(new Error("Request timeout")); });
  req.end();
}

// Yahoo Finance GET with crumb + cookie
function yahooGet(path, cb) {
  ensureCrumb((err) => {
    if (err) console.warn("Crumb refresh failed:", err.message);
    // Append crumb to query string if we have one
    const sep   = path.includes("?") ? "&" : "?";
    const fullPath = yahooCrumb ? `${path}${sep}crumb=${encodeURIComponent(yahooCrumb)}` : path;
    httpsGet({
      hostname: "query2.finance.yahoo.com",   // query2 is often less rate-limited
      port: 443,
      path: fullPath,
      method: "GET",
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept":          "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie":          yahooCookie || "",
        "Referer":         "https://finance.yahoo.com/",
        "Origin":          "https://finance.yahoo.com",
      },
    }, cb);
  });
}

// FRED GET
function fredGet(seriesId, cb) {
  if (!FRED_KEY) return cb(null, null);
  httpsGet({
    hostname: "api.stlouisfed.org",
    port: 443,
    path: `/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&limit=5&sort_order=desc&file_type=json`,
    method: "GET",
    headers: { "Accept": "application/json" },
  }, (err, data) => {
    if (err) return cb(null, null);
    const obs = data?.observations?.find(o => o.value !== ".");
    cb(null, obs ? parseFloat(obs.value) : null);
  });
}

// ── Route: POST / → Anthropic proxy ──────────────────────────────────────────
function handleAnthropic(req, res) {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const opts = {
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANT_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length":    Buffer.byteLength(body),
      },
    };
    console.log(`→ Claude  ${new Date().toISOString().slice(11,19)}`);
    const proxy = https.request(opts, (apiRes) => {
      console.log(`← Claude  ${apiRes.statusCode}`);
      setCORS(res);
      res.writeHead(apiRes.statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      apiRes.pipe(res);
    });
    proxy.on("error", e => jsonErr(res, 502, e.message));
    proxy.write(body);
    proxy.end();
  });
}

// ── Route: GET /prices?symbols=GLD,XOM ───────────────────────────────────────
function handlePrices(req, res) {
  const q       = url.parse(req.url, true).query;
  const symbols = (q.symbols || "").toUpperCase().trim();
  if (!symbols) return jsonErr(res, 400, "symbols required");

  const fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap,regularMarketPreviousClose";
  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=${fields}`, (err, data, status) => {
    if (err) return jsonErr(res, 502, `Yahoo Finance: ${err.message}`);
    if (status !== 200) return jsonErr(res, 502, `Yahoo returned ${status}`);
    const quotes  = data?.quoteResponse?.result || [];
    const prices  = {}, details = {};
    quotes.forEach(q => {
      prices[q.symbol] = q.regularMarketPrice;
      details[q.symbol] = {
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        volume:    q.regularMarketVolume,
        marketCap: q.marketCap,
        prevClose: q.regularMarketPreviousClose,
      };
    });
    jsonOk(res, { prices, details, timestamp: new Date().toISOString() });
  });
}

// ── Route: GET /quote?symbol=AAPL ─────────────────────────────────────────────
function handleQuote(req, res) {
  const q   = url.parse(req.url, true).query;
  const sym = (q.symbol || "").toUpperCase().trim();
  if (!sym) return jsonErr(res, 400, "symbol required");

  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend,majorHoldersBreakdown";
  yahooGet(`/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`, (err, data, status) => {
    if (err) return jsonErr(res, 502, `Yahoo Finance: ${err.message}`);
    jsonOk(res, data);
  });
}

// ── Route: GET /financials?symbol=AAPL ───────────────────────────────────────
function handleFinancials(req, res) {
  const q   = url.parse(req.url, true).query;
  const sym = (q.symbol || "").toUpperCase().trim();
  if (!sym) return jsonErr(res, 400, "symbol required");

  const modules = "incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory";
  yahooGet(`/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`, (err, data) => {
    if (err) return jsonErr(res, 502, `Yahoo Finance: ${err.message}`);
    jsonOk(res, data);
  });
}

// ── Route: GET /macro ──────────────────────────────────────────────────────────
function handleMacro(req, res) {
  const macroSymbols = [
    "^GSPC","^NDX","^DJI","^RUT","^VIX",
    "CL=F","BZ=F","GC=F","SI=F","NG=F","HG=F",
    "EURUSD=X","GBPUSD=X","USDJPY=X","USDCNH=X","DX-Y.NYB",
    "^TNX","^FVX","^TYX","^IRX",
  ].join(",");

  const fredSeries = FRED_KEY ? ["DFF","DGS2","DGS10","DGS30","SOFR","T10Y2Y"] : [];
  let yahooData = null, fredData = {}, pending = 1 + fredSeries.length;
  let responded = false;

  function respond() {
    if (responded) return;
    responded = true;
    const quotes = yahooData?.quoteResponse?.result || [];
    const by = {};
    quotes.forEach(q => { by[q.symbol] = q; });

    const price = s => by[s]?.regularMarketPrice ?? null;
    const pct   = s => by[s]?.regularMarketChangePercent ?? null;

    const fv = id => fredData[id] ?? null;
    const spread = fv("T10Y2Y");

    jsonOk(res, {
      timestamp: new Date().toISOString(),
      fredAvailable: fredSeries.length > 0,
      indices: [
        { name: "S&P 500",      sym: "SPX",  value: price("^GSPC"), changePct: pct("^GSPC") },
        { name: "NASDAQ 100",   sym: "NDX",  value: price("^NDX"),  changePct: pct("^NDX")  },
        { name: "DJIA",         sym: "DJIA", value: price("^DJI"),  changePct: pct("^DJI")  },
        { name: "Russell 2000", sym: "RUT",  value: price("^RUT"),  changePct: pct("^RUT")  },
        { name: "VIX",          sym: "VIX",  value: price("^VIX"),  changePct: pct("^VIX")  },
      ],
      rates: {
        fedFunds:    fv("DFF"),
        t2y:         fv("DGS2"),
        t10y:        fv("DGS10") ?? price("^TNX"),
        t30y:        fv("DGS30") ?? price("^TYX"),
        sofr:        fv("SOFR"),
        spread2s10s: spread != null ? spread / 100 : null,  // AV returns in %, convert to decimal
        tnx:         price("^TNX"),
        tyx:         price("^TYX"),
      },
      commodities: [
        { name: "WTI Crude Oil", sym: "CL=F", price: price("CL=F"), changePct: pct("CL=F") },
        { name: "Brent Crude",   sym: "BZ=F", price: price("BZ=F"), changePct: pct("BZ=F") },
        { name: "Gold",          sym: "GC=F", price: price("GC=F"), changePct: pct("GC=F") },
        { name: "Silver",        sym: "SI=F", price: price("SI=F"), changePct: pct("SI=F") },
        { name: "Natural Gas",   sym: "NG=F", price: price("NG=F"), changePct: pct("NG=F") },
        { name: "Copper",        sym: "HG=F", price: price("HG=F"), changePct: pct("HG=F") },
      ],
      fx: [
        { pair: "DXY Index", rate: price("DX-Y.NYB"), changePct: pct("DX-Y.NYB") },
        { pair: "EUR/USD",   rate: price("EURUSD=X"), changePct: pct("EURUSD=X") },
        { pair: "GBP/USD",   rate: price("GBPUSD=X"), changePct: pct("GBPUSD=X") },
        { pair: "USD/JPY",   rate: price("USDJPY=X"), changePct: pct("USDJPY=X") },
        { pair: "USD/CNH",   rate: price("USDCNH=X"), changePct: pct("USDCNH=X") },
      ],
    });
  }

  function tick() { pending--; if (pending <= 0) respond(); }

  // Yahoo fetch
  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(macroSymbols)}&fields=regularMarketPrice,regularMarketChangePercent`, (err, data) => {
    if (!err) yahooData = data;
    else console.error("Macro Yahoo error:", err.message);
    tick();
  });

  // FRED fetches (parallel, optional)
  fredSeries.forEach(id => {
    fredGet(id, (err, val) => {
      fredData[id] = val;
      tick();
    });
  });
}

// ── Route: GET /news?q=QUERY&pageSize=8 ──────────────────────────────────────
function handleNews(req, res) {
  if (!NEWS_KEY) return jsonErr(res, 503, "NEWS_API_KEY not set. Free key at newsapi.org/register");
  const q        = url.parse(req.url, true).query;
  const query    = q.q || "";
  const pageSize = Math.min(parseInt(q.pageSize || "8"), 10);
  if (!query) return jsonErr(res, 400, "q required");

  httpsGet({
    hostname: "newsapi.org",
    port: 443,
    path: `/v2/everything?q=${encodeURIComponent(query)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${NEWS_KEY}`,
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "BBGTerminal/1.0" },
  }, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    if (data.status === "error") return jsonErr(res, 400, data.message);
    jsonOk(res, {
      query,
      articles: (data.articles || []).map(a => ({
        headline: a.title,
        source:   a.source?.name || "Unknown",
        date:     a.publishedAt ? new Date(a.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
        url:      a.url,
        summary:  a.description || "",
      })),
    });
  });
}

// ── Route: GET /calendar ───────────────────────────────────────────────────────
function handleCalendar(req, res) {
  if (!AV_KEY) return jsonErr(res, 503, "ALPHA_VANTAGE_KEY not set. Free key at alphavantage.co/support/#api-key");
  httpsGet({
    hostname: "www.alphavantage.co",
    port: 443,
    path: `/query?function=ECONOMIC_CALENDAR&horizon=3month&apikey=${AV_KEY}`,
    method: "GET",
    headers: { "Accept": "application/json" },
  }, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    jsonOk(res, data);
  });
}

// ── Route: GET /worldindices ───────────────────────────────────────────────────
function handleWorldIndices(req, res) {
  const symbols = [
    "^GSPC","^NDX","^DJI","^RUT","^GSPTSE",
    "^STOXX50E","^FTSE","^GDAXI","^FCHI","^IBEX",
    "^N225","^HSI","000300.SS","^AXJO","^KS11",
    "EEM","^BVSP","^NSEI",
  ].join(",");

  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange`, (err, data) => {
    if (err) return jsonErr(res, 502, `Yahoo Finance: ${err.message}`);
    const quotes = data?.quoteResponse?.result || [];
    const by = {};
    quotes.forEach(q => { by[q.symbol] = q; });

    const idx = (sym, name, country) => ({
      sym, name, country,
      value:     by[sym]?.regularMarketPrice ?? null,
      changePct: by[sym]?.regularMarketChangePercent ?? null,
    });

    jsonOk(res, {
      timestamp: new Date().toISOString(),
      regions: [
        { region: "NORTH AMERICA", indices: [
          idx("^GSPC","S&P 500","US"), idx("^NDX","NASDAQ 100","US"),
          idx("^DJI","DJIA","US"), idx("^RUT","Russell 2000","US"), idx("^GSPTSE","TSX Composite","CA"),
        ]},
        { region: "EUROPE", indices: [
          idx("^STOXX50E","Euro Stoxx 50","EU"), idx("^FTSE","FTSE 100","UK"),
          idx("^GDAXI","DAX","DE"), idx("^FCHI","CAC 40","FR"), idx("^IBEX","IBEX 35","ES"),
        ]},
        { region: "ASIA PACIFIC", indices: [
          idx("^N225","Nikkei 225","JP"), idx("^HSI","Hang Seng","HK"),
          idx("000300.SS","CSI 300","CN"), idx("^AXJO","ASX 200","AU"), idx("^KS11","KOSPI","KR"),
        ]},
        { region: "EMERGING MARKETS", indices: [
          idx("EEM","MSCI EM ETF","EM"), idx("^BVSP","Bovespa","BR"), idx("^NSEI","Nifty 50","IN"),
        ]},
      ],
    });
  });
}

// ── Health check: GET /health ─────────────────────────────────────────────────
function handleHealth(req, res) {
  jsonOk(res, {
    status: "ok",
    keys: {
      anthropic:    !!ANT_KEY,
      fred:         !!FRED_KEY,
      news:         !!NEWS_KEY,
      alphaVantage: !!AV_KEY,
    },
    crumb: yahooCrumb ? `${yahooCrumb.slice(0,8)}... (expires ${new Date(crumbExpiry).toISOString().slice(11,19)})` : "not fetched yet",
  });
}

// ── Main server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const pathname = url.parse(req.url).pathname;
  console.log(`${req.method.padEnd(4)} ${pathname.padEnd(14)} ${new Date().toISOString().slice(11,19)}`);

  if (req.method === "GET"  && pathname === "/health")       return handleHealth(req, res);
  if (req.method === "GET"  && pathname === "/prices")       return handlePrices(req, res);
  if (req.method === "GET"  && pathname === "/quote")        return handleQuote(req, res);
  if (req.method === "GET"  && pathname === "/financials")   return handleFinancials(req, res);
  if (req.method === "GET"  && pathname === "/macro")        return handleMacro(req, res);
  if (req.method === "GET"  && pathname === "/news")         return handleNews(req, res);
  if (req.method === "GET"  && pathname === "/calendar")     return handleCalendar(req, res);
  if (req.method === "GET"  && pathname === "/worldindices") return handleWorldIndices(req, res);
  if (req.method === "POST" && pathname === "/")             return handleAnthropic(req, res);

  res.writeHead(404); res.end("Not found");
});

// Pre-warm the Yahoo crumb on startup
server.listen(PORT, () => {
  console.log(`\n✅  BBG Terminal proxy — http://localhost:${PORT}`);
  console.log(`    Anthropic:    ${ANT_KEY  ? "✅ " + ANT_KEY.slice(0,18)+"..."  : "❌ ANTHROPIC_API_KEY not set"}`);
  console.log(`    FRED:         ${FRED_KEY ? "✅ " + FRED_KEY.slice(0,8)+"..."  : "⚠️  not set (rates = Yahoo yields only)"}`);
  console.log(`    NewsAPI:      ${NEWS_KEY ? "✅ " + NEWS_KEY.slice(0,8)+"..."  : "⚠️  not set (NEWS panel disabled)"}`);
  console.log(`    Alpha Vantage:${AV_KEY   ? "✅ " + AV_KEY.slice(0,8)+"..."   : "⚠️  not set (ECO panel disabled)"}`);
  console.log(`\n    Warming up Yahoo Finance crumb...`);
  refreshYahooCrumb((err) => {
    if (err) console.log(`    ⚠️  Crumb pre-warm failed: ${err.message} (will retry on first request)`);
    else     console.log(`    ✅  Yahoo Finance ready`);
    console.log(`\n    Health check: http://localhost:${PORT}/health`);
    console.log(`    Test prices:  http://localhost:${PORT}/prices?symbols=AAPL,GLD`);
    console.log(`\n    Start UI: npm run dev  →  http://localhost:5173\n`);
  });
});

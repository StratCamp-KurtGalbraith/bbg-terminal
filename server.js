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

// ── Yahoo Finance — no crumb needed for v8 chart API ─────────────────────────
// We use v8/finance/chart for prices (no auth) and v11/finance/quoteSummary
// with a simple Accept header for fundamentals. No cookie/crumb required.

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

// Yahoo Finance GET — simple, no auth required for quoteSummary/v11
function yahooGet(path, cb) {
  httpsGet({
    hostname: "query1.finance.yahoo.com",
    port: 443,
    path,
    method: "GET",
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept":          "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer":         "https://finance.yahoo.com/",
    },
  }, cb);
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

// ── Yahoo Finance v8 chart API price fetcher (no auth required) ──────────────
function fetchPricesFallback(symbols) {
  return new Promise((resolve) => {
    const results = {};
    let pending = symbols.length;
    if (pending === 0) return resolve(results);
    symbols.forEach(sym => {
      httpsGet({
        hostname: "query1.finance.yahoo.com",
        port: 443,
        path: `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d&includePrePost=false`,
        method: "GET",
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
          "Accept":          "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer":         "https://finance.yahoo.com/",
        },
      }, (err, data) => {
        if (!err) {
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice != null) {
            const prev = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
            results[sym] = {
              price:     meta.regularMarketPrice,
              change:    meta.regularMarketPrice - prev,
              changePct: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : 0,
              prevClose: prev,
              volume:    meta.regularMarketVolume || null,
              marketCap: meta.marketCap || null,
            };
          }
        }
        pending--;
        if (pending === 0) resolve(results);
      });
    });
  });
}

// ── Route: GET /prices?symbols=GLD,XOM ───────────────────────────────────────
// Uses v8/finance/chart — one request per symbol, no auth required, very reliable
function handlePrices(req, res) {
  const q       = url.parse(req.url, true).query;
  const symbols = (q.symbols || "").toUpperCase().trim();
  if (!symbols) return jsonErr(res, 400, "symbols required");

  const symsArr = symbols.split(",").map(s => s.trim()).filter(Boolean);
  fetchPricesFallback(symsArr).then(data => {
    const prices = {}, details = {};
    Object.entries(data).forEach(([sym, d]) => {
      prices[sym] = d.price;
      details[sym] = d;
    });
    if (Object.keys(prices).length === 0) {
      return jsonErr(res, 502, "Yahoo Finance returned no data");
    }
    console.log(`  /prices OK: ${Object.keys(prices).map(s => s + "=$" + prices[s]?.toFixed(2)).join(" ")}`);
    jsonOk(res, { prices, details, timestamp: new Date().toISOString() });
  }).catch(e => jsonErr(res, 502, e.message));
}

// ── Route: GET /quote?symbol=AAPL ─────────────────────────────────────────────
// Hybrid: v8/chart (always works, no auth) + v11/quoteSummary (best-effort fundamentals)
function handleQuote(req, res) {
  const q   = url.parse(req.url, true).query;
  const sym = (q.symbol || "").toUpperCase().trim();
  if (!sym) return jsonErr(res, 400, "symbol required");

  let v8Data = null, v11Data = null, pending = 2;

  function finish() {
    pending--;
    if (pending > 0) return;

    const v8Meta  = v8Data?.chart?.result?.[0]?.meta || {};
    const v11Res  = v11Data?.quoteSummary?.result?.[0] || null;

    // If v11 worked AND has price module, return it with v8 price merged in
    if (v11Res) {
      // Inject live v8 price in case v11 price is stale
      if (v8Meta.regularMarketPrice && v11Res.price) {
        v11Res.price.regularMarketPrice     = { raw: v8Meta.regularMarketPrice,     fmt: `$${v8Meta.regularMarketPrice.toFixed(2)}` };
        v11Res.price.regularMarketChange    = { raw: v8Meta.regularMarketPrice - (v8Meta.previousClose||v8Meta.regularMarketPrice) };
        v11Res.price.regularMarketChangePercent = { raw: v8Meta.regularMarketChangePercent || 0 };
      }
      return jsonOk(res, v11Data);
    }

    // v11 failed — synthesize a minimal quoteSummary from v8 chart data
    if (!v8Meta.regularMarketPrice) {
      return jsonErr(res, 404, `No data found for ${sym}. Check the ticker symbol.`);
    }

    const prev = v8Meta.previousClose || v8Meta.chartPreviousClose || v8Meta.regularMarketPrice;
    const chg  = v8Meta.regularMarketPrice - prev;
    const chgPct = prev ? (chg / prev) * 100 : 0;

    // Return a minimal structure that EQ/DES can work with
    jsonOk(res, {
      quoteSummary: {
        result: [{
          price: {
            regularMarketPrice:        { raw: v8Meta.regularMarketPrice },
            regularMarketChange:       { raw: chg },
            regularMarketChangePercent:{ raw: chgPct },
            regularMarketVolume:       { raw: v8Meta.regularMarketVolume || null },
            marketCap:                 { raw: v8Meta.marketCap || null },
            previousClose:             { raw: prev },
            longName:                  v8Meta.longName || v8Meta.shortName || sym,
            shortName:                 v8Meta.shortName || sym,
            exchangeName:              v8Meta.exchangeName || v8Meta.fullExchangeName || "N/A",
            currency:                  v8Meta.currency || "USD",
          },
          summaryDetail:        {},
          defaultKeyStatistics: {},
          financialData:        {},
          assetProfile:         { longBusinessSummary: "", sector: "N/A", industry: "N/A", companyOfficers: [] },
          recommendationTrend:  { trend: [] },
        }],
        error: null,
      },
      _source: "v8-chart-only",
    });
  }

  // Fetch v8 chart (no auth, always works)
  httpsGet({
    hostname: "query1.finance.yahoo.com", port: 443,
    path: `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d&includePrePost=false`,
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept":          "application/json",
      "Referer":         "https://finance.yahoo.com/",
    },
  }, (err, data) => {
    if (!err) v8Data = data;
    finish();
  });

  // Fetch v11 quoteSummary (best-effort fundamentals)
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend";
  yahooGet(`/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`, (err, data) => {
    const hasResult = !err && data?.quoteSummary?.result?.[0]?.price;
    if (hasResult) v11Data = data;
    finish();
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
  // All symbols via v8/chart — no auth required
  const yahooSymbols = [
    "^GSPC","^NDX","^DJI","^RUT","^VIX",
    "CL=F","BZ=F","GC=F","SI=F","NG=F","HG=F","RB=F",
    "EURUSD=X","GBPUSD=X","USDJPY=X","USDCNH=X","USDBRL=X","USDKRW=X","DX-Y.NYB",
    "^TNX","^FVX","^TYX","^IRX","^MOVE",
    "LQD","HYG","TLT","AGG",
  ];

  // Expanded FRED series
  const fredSeries = FRED_KEY ? [
    "DFF",      // Fed Funds Rate (actual)
    "DGS2",     // 2Y Treasury
    "DGS5",     // 5Y Treasury
    "DGS10",    // 10Y Treasury
    "DGS30",    // 30Y Treasury
    "DFII10",   // 10Y Real (TIPS) yield
    "T10YIE",   // 10Y Breakeven inflation
    "SOFR",     // SOFR rate
    "T10Y2Y",   // 2s10s spread
    "BAMLC0A0CMEY",   // Investment grade OAS
    "BAMLH0A0HYM2EY", // High yield OAS
    "TEDRATE",  // TED spread (credit stress)
  ] : [];

  let yahooData = {}, fredData = {};
  let pending = 1 + fredSeries.length;
  let responded = false;

  function respond() {
    if (responded) return;
    responded = true;
    const by = yahooData; // already keyed by symbol from fetchPricesFallback
    const p  = s => by[s]?.price ?? null;
    const pc = s => by[s]?.changePct ?? null;

    const fv = id => fredData[id] ?? null;
    const spread = fv("T10Y2Y");

    jsonOk(res, {
      timestamp: new Date().toISOString(),
      fredAvailable: fredSeries.length > 0,
      indices: [
        { name: "S&P 500",      sym: "SPX",  value: p("^GSPC"), changePct: pc("^GSPC") },
        { name: "NASDAQ 100",   sym: "NDX",  value: p("^NDX"),  changePct: pc("^NDX")  },
        { name: "DJIA",         sym: "DJIA", value: p("^DJI"),  changePct: pc("^DJI")  },
        { name: "Russell 2000", sym: "RUT",  value: p("^RUT"),  changePct: pc("^RUT")  },
        { name: "VIX",          sym: "VIX",  value: p("^VIX"),  changePct: pc("^VIX")  },
        { name: "MOVE Index",   sym: "MOVE", value: p("^MOVE"), changePct: pc("^MOVE") },
      ],
      rates: {
        fedFunds:    fv("DFF"),
        t2y:         fv("DGS2")  ?? p("^IRX"),
        t5y:         fv("DGS5"),
        t10y:        fv("DGS10") ?? p("^TNX"),
        t30y:        fv("DGS30") ?? p("^TYX"),
        realYield10: fv("DFII10"),
        breakeven10: fv("T10YIE"),
        sofr:        fv("SOFR"),
        spread2s10s: spread != null ? spread / 100 : null,
        tnx:         p("^TNX"),
        tyx:         p("^TYX"),
        igOas:       fv("BAMLC0A0CMEY"),
        hyOas:       fv("BAMLH0A0HYM2EY"),
        tedSpread:   fv("TEDRATE"),
      },
      commodities: [
        { name: "WTI Crude Oil", sym: "CL=F", price: p("CL=F"), changePct: pc("CL=F") },
        { name: "Brent Crude",   sym: "BZ=F", price: p("BZ=F"), changePct: pc("BZ=F") },
        { name: "Gold",          sym: "GC=F", price: p("GC=F"), changePct: pc("GC=F") },
        { name: "Silver",        sym: "SI=F", price: p("SI=F"), changePct: pc("SI=F") },
        { name: "Natural Gas",   sym: "NG=F", price: p("NG=F"), changePct: pc("NG=F") },
        { name: "Copper",        sym: "HG=F", price: p("HG=F"), changePct: pc("HG=F") },
        { name: "RBOB Gasoline", sym: "RB=F", price: p("RB=F"), changePct: pc("RB=F") },
      ],
      fx: [
        { pair: "DXY Index", rate: p("DX-Y.NYB"), changePct: pc("DX-Y.NYB") },
        { pair: "EUR/USD",   rate: p("EURUSD=X"), changePct: pc("EURUSD=X") },
        { pair: "GBP/USD",   rate: p("GBPUSD=X"), changePct: pc("GBPUSD=X") },
        { pair: "USD/JPY",   rate: p("USDJPY=X"), changePct: pc("USDJPY=X") },
        { pair: "USD/CNH",   rate: p("USDCNH=X"), changePct: pc("USDCNH=X") },
        { pair: "USD/BRL",   rate: p("USDBRL=X"), changePct: pc("USDBRL=X") },
        { pair: "USD/KRW",   rate: p("USDKRW=X"), changePct: pc("USDKRW=X") },
      ],
      bonds: {
        lqdPrice:  p("LQD"),  lqdChg: pc("LQD"),
        hygPrice:  p("HYG"),  hygChg: pc("HYG"),
        tltPrice:  p("TLT"),  tltChg: pc("TLT"),
        aggPrice:  p("AGG"),  aggChg: pc("AGG"),
      },
    });
  }

  function tick() { pending--; if (pending <= 0) respond(); }

  // Use v8 chart API — no auth, always works
  fetchPricesFallback(yahooSymbols).then(data => {
    yahooData = data;
    tick();
  }).catch(() => tick());

  // FRED fetches — parallel
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
  if (!query) query = "global financial markets stocks bonds economy";  // default: top market news

  httpsGet({
    hostname: "newsapi.org",
    port: 443,
    path: q.q
      ? `/v2/everything?q=${encodeURIComponent(query)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${NEWS_KEY}`
      : `/v2/top-headlines?category=business&language=en&pageSize=${pageSize}&apiKey=${NEWS_KEY}`,
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
    yahoo: "v8 chart API (no auth required)",
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

// Start server
server.listen(PORT, () => {
  console.log(`\n✅  BBG Terminal proxy — http://localhost:${PORT}`);
  console.log(`    Anthropic:    ${ANT_KEY  ? "✅ " + ANT_KEY.slice(0,18)+"..."  : "❌ ANTHROPIC_API_KEY not set"}`);
  console.log(`    FRED:         ${FRED_KEY ? "✅ " + FRED_KEY.slice(0,8)+"..."  : "⚠️  not set (rates = Yahoo yields only)"}`);
  console.log(`    NewsAPI:      ${NEWS_KEY ? "✅ " + NEWS_KEY.slice(0,8)+"..."  : "⚠️  not set (NEWS panel disabled)"}`);
  console.log(`    Alpha Vantage:${AV_KEY   ? "✅ " + AV_KEY.slice(0,8)+"..."   : "⚠️  not set (ECO panel disabled)"}`);
  console.log(`\n    Health check: http://localhost:${PORT}/health`);
  console.log(`    Test prices:  http://localhost:${PORT}/prices?symbols=AAPL,GLD`);
  console.log(`\n    Start UI: npm run dev  →  http://localhost:5173\n`);
});


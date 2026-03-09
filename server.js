/**
 * BBG Terminal — Local Proxy Server
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   — console.anthropic.com/settings/keys
 *   FRED_API_KEY        — fred.stlouisfed.org/docs/api/api_key.html  (free)
 *   NEWS_API_KEY        — newsapi.org/register                        (free, 100/day)
 *   ALPHA_VANTAGE_KEY   — alphavantage.co/support/#api-key            (free, 25/day)
 *
 * Windows:
 *   set ANTHROPIC_API_KEY=sk-ant-...
 *   set FRED_API_KEY=...
 *   set NEWS_API_KEY=...
 *   set ALPHA_VANTAGE_KEY=...
 *   node server.js
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const ANT_KEY  = process.env.ANTHROPIC_API_KEY  || "";
const FRED_KEY = process.env.FRED_API_KEY        || "";
const NEWS_KEY = process.env.NEWS_API_KEY        || "";
const AV_KEY   = process.env.ALPHA_VANTAGE_KEY   || "";
const PORT     = 3001;

if (!ANT_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY not set — Claude AI calls will fail.");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
      catch(e) { cb(new Error("JSON parse failed: " + data.slice(0,200))); }
    });
  });
  req.on("error", cb);
  req.setTimeout(10000, () => { req.destroy(); cb(new Error("Timeout")); });
  req.end();
}

function yahooGet(path, cb) {
  httpsGet({
    hostname: "query1.finance.yahoo.com",
    port: 443,
    path,
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
  }, cb);
}

// ── Route: POST / → Anthropic ─────────────────────────────────────────────────
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
        "Content-Type": "application/json",
        "x-api-key": ANT_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
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
    proxy.write(body); proxy.end();
  });
}

// ── Route: GET /prices?symbols=GLD,XOM ───────────────────────────────────────
function handlePrices(req, res) {
  const q = url.parse(req.url, true).query;
  const symbols = (q.symbols || "").toUpperCase().trim();
  if (!symbols) return jsonErr(res, 400, "symbols required");

  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap,regularMarketPreviousClose`, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    const quotes = data?.quoteResponse?.result || [];
    const prices = {}, details = {};
    quotes.forEach(q => {
      prices[q.symbol] = q.regularMarketPrice;
      details[q.symbol] = {
        price:      q.regularMarketPrice,
        change:     q.regularMarketChange,
        changePct:  q.regularMarketChangePercent,
        volume:     q.regularMarketVolume,
        marketCap:  q.marketCap,
        prevClose:  q.regularMarketPreviousClose,
      };
    });
    jsonOk(res, { prices, details, timestamp: new Date().toISOString() });
  });
}

// ── Route: GET /quote?symbol=AAPL ─────────────────────────────────────────────
// Returns full fundamental data from Yahoo quoteSummary
function handleQuote(req, res) {
  const q = url.parse(req.url, true).query;
  const sym = (q.symbol || "").toUpperCase().trim();
  if (!sym) return jsonErr(res, 400, "symbol required");

  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend,majorHoldersBreakdown";
  yahooGet(`/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    jsonOk(res, data);
  });
}

// ── Route: GET /financials?symbol=AAPL ───────────────────────────────────────
// Returns financial statements (income, balance sheet, cash flow)
function handleFinancials(req, res) {
  const q = url.parse(req.url, true).query;
  const sym = (q.symbol || "").toUpperCase().trim();
  if (!sym) return jsonErr(res, 400, "symbol required");

  const modules = "incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,incomeStatementHistoryQuarterly";
  yahooGet(`/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    jsonOk(res, data);
  });
}

// ── Route: GET /macro ──────────────────────────────────────────────────────────
// Returns indices, commodities, FX from Yahoo + rates from FRED
function handleMacro(req, res) {
  const macroSymbols = [
    "^GSPC","^NDX","^DJI","^RUT","^VIX",          // indices
    "CL=F","BZ=F","GC=F","SI=F","NG=F","HG=F",    // commodities
    "EURUSD=X","GBPUSD=X","USDJPY=X","USDCNH=X",  // FX
    "DX-Y.NYB",                                     // DXY
    "^TNX","^FVX","^TYX","^IRX",                   // treasury yields
  ].join(",");

  const fredSeries = ["DFF","DGS2","DGS10","DGS30","SOFR","T10Y2Y"];

  // Fetch Yahoo and FRED in parallel
  let yahooResult = null, fredResult = {}, yahooErr = null;
  let completed = 0;
  const total = 1 + fredSeries.length;

  function checkDone() {
    completed++;
    if (completed < total) return;

    if (yahooErr) return jsonErr(res, 502, yahooErr.message);
    const quotes = yahooResult?.quoteResponse?.result || [];

    const bySymbol = {};
    quotes.forEach(q => { bySymbol[q.symbol] = q; });

    const pct = s => bySymbol[s]?.regularMarketChangePercent;
    const price = s => bySymbol[s]?.regularMarketPrice;
    const chg = s => bySymbol[s]?.regularMarketChange;

    const fredVal = (id) => {
      const obs = fredResult[id];
      if (!obs || obs === "N/A") return null;
      return parseFloat(obs);
    };

    jsonOk(res, {
      timestamp: new Date().toISOString(),
      indices: [
        { name: "S&P 500",     sym: "SPX",  value: price("^GSPC"), changePct: pct("^GSPC") },
        { name: "NASDAQ 100",  sym: "NDX",  value: price("^NDX"),  changePct: pct("^NDX")  },
        { name: "DJIA",        sym: "DJIA", value: price("^DJI"),  changePct: pct("^DJI")  },
        { name: "Russell 2000",sym: "RUT",  value: price("^RUT"),  changePct: pct("^RUT")  },
        { name: "VIX",         sym: "VIX",  value: price("^VIX"),  changePct: pct("^VIX")  },
      ],
      rates: {
        fedFunds:  fredVal("DFF"),
        t2y:       fredVal("DGS2"),
        t10y:      fredVal("DGS10"),
        t30y:      fredVal("DGS30"),
        sofr:      fredVal("SOFR"),
        spread2s10s: fredVal("T10Y2Y"),
        // Also from Yahoo treasury tickers as fallback
        tnx: price("^TNX"),
        tyx: price("^TYX"),
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

  // Yahoo fetch
  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(macroSymbols)}`, (err, data) => {
    if (err) yahooErr = err;
    else yahooResult = data;
    checkDone();
  });

  // FRED fetches (parallel)
  if (!FRED_KEY) {
    fredSeries.forEach(() => { fredResult[fredSeries[fredSeries.length-1]] = "N/A"; completed++; });
    // Still need to decrement properly
    fredSeries.forEach(id => { fredResult[id] = null; completed++; });
    // Reset and recount
    completed = 1; // pretend yahoo already done for counting
    // Actually just skip — set all null
    fredSeries.forEach(id => { fredResult[id] = null; });
    // don't call checkDone here, yahoo callback will
  } else {
    fredSeries.forEach(id => {
      httpsGet({
        hostname: "api.stlouisfed.org",
        port: 443,
        path: `/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&limit=5&sort_order=desc&file_type=json`,
        method: "GET",
        headers: { "Accept": "application/json" },
      }, (err, data) => {
        if (!err && data?.observations?.length > 0) {
          // Get most recent non-"." value
          const val = data.observations.find(o => o.value !== ".");
          fredResult[id] = val ? val.value : null;
        } else {
          fredResult[id] = null;
        }
        checkDone();
      });
    });
  }

  // If no FRED key, only wait for Yahoo
  if (!FRED_KEY) {
    yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(macroSymbols)}`, (err, data) => {
      if (err) { return jsonErr(res, 502, err.message); }
      yahooResult = data;
      const quotes = yahooResult?.quoteResponse?.result || [];
      const bySymbol = {};
      quotes.forEach(q => { bySymbol[q.symbol] = q; });
      const pct = s => bySymbol[s]?.regularMarketChangePercent;
      const price = s => bySymbol[s]?.regularMarketPrice;
      jsonOk(res, {
        timestamp: new Date().toISOString(),
        fredMissing: true,
        indices: [
          { name: "S&P 500",     sym: "SPX",  value: price("^GSPC"), changePct: pct("^GSPC") },
          { name: "NASDAQ 100",  sym: "NDX",  value: price("^NDX"),  changePct: pct("^NDX")  },
          { name: "DJIA",        sym: "DJIA", value: price("^DJI"),  changePct: pct("^DJI")  },
          { name: "Russell 2000",sym: "RUT",  value: price("^RUT"),  changePct: pct("^RUT")  },
          { name: "VIX",         sym: "VIX",  value: price("^VIX"),  changePct: pct("^VIX")  },
        ],
        rates: {
          fedFunds: null, t2y: null, t10y: price("^TNX"), t30y: price("^TYX"),
          sofr: null, spread2s10s: null, tnx: price("^TNX"), tyx: price("^TYX"),
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
    });
    return; // exit handleMacro early for no-FRED path
  }
}

// ── Route: GET /news?q=QUERY&pageSize=8 ──────────────────────────────────────
function handleNews(req, res) {
  if (!NEWS_KEY) return jsonErr(res, 503, "NEWS_API_KEY not configured. Get a free key at newsapi.org/register");
  const q = url.parse(req.url, true).query;
  const query = q.q || "";
  const pageSize = Math.min(parseInt(q.pageSize || "8"), 10);
  if (!query) return jsonErr(res, 400, "q required");

  const path = `/v2/everything?q=${encodeURIComponent(query)}&pageSize=${pageSize}&language=en&sortBy=publishedAt&apiKey=${NEWS_KEY}`;
  httpsGet({
    hostname: "newsapi.org",
    port: 443,
    path,
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "BBGTerminal/1.0" },
  }, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    if (data.status === "error") return jsonErr(res, 400, data.message);
    const articles = (data.articles || []).map(a => ({
      headline: a.title,
      source:   a.source?.name || "Unknown",
      date:     a.publishedAt ? new Date(a.publishedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "",
      url:      a.url,
      summary:  a.description || "",
    }));
    jsonOk(res, { query, articles, totalResults: data.totalResults });
  });
}

// ── Route: GET /calendar ───────────────────────────────────────────────────────
function handleCalendar(req, res) {
  if (!AV_KEY) return jsonErr(res, 503, "ALPHA_VANTAGE_KEY not configured. Get a free key at alphavantage.co/support/#api-key");

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
    "^GSPC","^NDX","^DJI","^RUT","^GSPTSE",          // N. America
    "^STOXX50E","^FTSE","^GDAXI","^FCHI","^IBEX",    // Europe
    "^N225","^HSI","000300.SS","^AXJO","^KS11",       // Asia Pacific
    "EEM","^BVSP","^NSEI","^CASE30",                  // EM
  ].join(",");

  yahooGet(`/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,ytdReturn`, (err, data) => {
    if (err) return jsonErr(res, 502, err.message);
    const quotes = data?.quoteResponse?.result || [];
    const bySymbol = {};
    quotes.forEach(q => { bySymbol[q.symbol] = q; });

    const idx = (sym, name, country) => {
      const q = bySymbol[sym];
      if (!q) return { sym, name, country, value: null, changePct: null };
      return {
        sym, name, country,
        value:     q.regularMarketPrice,
        changePct: q.regularMarketChangePercent,
        change:    q.regularMarketChange,
      };
    };

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

// ── Main server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const pathname = url.parse(req.url).pathname;
  console.log(`${req.method} ${pathname} ${new Date().toISOString().slice(11,19)}`);

  if (req.method === "POST" && pathname === "/")             return handleAnthropic(req, res);
  if (req.method === "GET"  && pathname === "/prices")       return handlePrices(req, res);
  if (req.method === "GET"  && pathname === "/quote")        return handleQuote(req, res);
  if (req.method === "GET"  && pathname === "/financials")   return handleFinancials(req, res);
  if (req.method === "GET"  && pathname === "/macro")        return handleMacro(req, res);
  if (req.method === "GET"  && pathname === "/news")         return handleNews(req, res);
  if (req.method === "GET"  && pathname === "/calendar")     return handleCalendar(req, res);
  if (req.method === "GET"  && pathname === "/worldindices") return handleWorldIndices(req, res);

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n✅  BBG Terminal proxy — http://localhost:${PORT}`);
  console.log(`    Anthropic:    ${ANT_KEY  ? "✅ " + ANT_KEY.slice(0,18)+"..." : "❌ ANTHROPIC_API_KEY not set"}`);
  console.log(`    FRED:         ${FRED_KEY ? "✅ " + FRED_KEY.slice(0,8)+"..."  : "⚠️  not set — rates will use Yahoo yields only"}`);
  console.log(`    NewsAPI:      ${NEWS_KEY ? "✅ " + NEWS_KEY.slice(0,8)+"..."  : "⚠️  not set — NEWS panel disabled"}`);
  console.log(`    Alpha Vantage:${AV_KEY   ? "✅ " + AV_KEY.slice(0,8)+"..."   : "⚠️  not set — ECO panel disabled"}`);
  console.log(`\n    Endpoints:`);
  console.log(`      POST /             → Claude AI`);
  console.log(`      GET  /prices       → Yahoo Finance batch prices`);
  console.log(`      GET  /quote        → Yahoo Finance full quote data`);
  console.log(`      GET  /financials   → Yahoo Finance financial statements`);
  console.log(`      GET  /macro        → Yahoo + FRED macro dashboard`);
  console.log(`      GET  /news         → NewsAPI headlines`);
  console.log(`      GET  /calendar     → Alpha Vantage economic calendar`);
  console.log(`      GET  /worldindices → Yahoo Finance global indices`);
  console.log(`\n    Start UI: npm run dev  →  http://localhost:5173\n`);
});

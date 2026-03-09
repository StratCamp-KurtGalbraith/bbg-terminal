/**
 * BBG Terminal — Local Proxy Server
 *
 * Endpoints:
 *   POST /          → Anthropic API proxy (Claude AI)
 *   GET  /prices?symbols=GLD,XOM,RTX  → Yahoo Finance live prices
 *   GET  /quote?symbol=AAPL           → Yahoo Finance single quote (full data)
 *
 * Usage:
 *   Windows:   set ANTHROPIC_API_KEY=sk-ant-... && node server.js
 *   Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-... && node server.js
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY    = process.env.ANTHROPIC_API_KEY || "";
const PROXY_PORT = 3001;

if (!API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY not set.");
  console.error("    Windows:   set ANTHROPIC_API_KEY=sk-ant-...");
  console.error("    Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-...\n");
  process.exit(1);
}

// ── CORS headers ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────
function yahooFetch(path, cb) {
  const options = {
    hostname: "query1.finance.yahoo.com",
    port: 443,
    path,
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  };
  const req = https.request(options, (r) => {
    let data = "";
    r.on("data", c => data += c);
    r.on("end", () => {
      try { cb(null, JSON.parse(data)); }
      catch(e) { cb(e); }
    });
  });
  req.on("error", cb);
  req.end();
}

// ── Route: GET /prices?symbols=GLD,XOM ───────────────────────────────────────
function handlePrices(req, res) {
  const parsed  = url.parse(req.url, true);
  const symbols = (parsed.query.symbols || "").toUpperCase();
  if (!symbols) { res.writeHead(400); res.end(JSON.stringify({error:"symbols required"})); return; }

  const symsArr = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const ySyms   = symsArr.join(",");

  yahooFetch(`/v7/finance/quote?symbols=${encodeURIComponent(ySyms)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap`, (err, data) => {
    if (err) { res.writeHead(502); res.end(JSON.stringify({error:err.message})); return; }
    try {
      const quotes  = data?.quoteResponse?.result || [];
      const prices  = {};
      const details = {};
      quotes.forEach(q => {
        prices[q.symbol] = q.regularMarketPrice;
        details[q.symbol] = {
          price:      q.regularMarketPrice,
          change:     q.regularMarketChange,
          changePct:  q.regularMarketChangePercent,
          volume:     q.regularMarketVolume,
          marketCap:  q.marketCap,
        };
      });
      const ts = new Date().toISOString();
      setCORS(res);
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({ prices, details, timestamp: ts }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({error:e.message}));
    }
  });
}

// ── Route: GET /quote?symbol=AAPL ─────────────────────────────────────────────
function handleQuote(req, res) {
  const parsed = url.parse(req.url, true);
  const symbol = (parsed.query.symbol || "").toUpperCase();
  if (!symbol) { res.writeHead(400); res.end(JSON.stringify({error:"symbol required"})); return; }

  yahooFetch(`/v11/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData,defaultKeyStatistics,assetProfile,recommendationTrend,earnings,price`, (err, data) => {
    if (err) { res.writeHead(502); res.end(JSON.stringify({error:err.message})); return; }
    setCORS(res);
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify(data));
  });
}

// ── Route: POST / → Anthropic proxy ──────────────────────────────────────────
function handleAnthropic(req, res) {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const options = {
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length":    Buffer.byteLength(body),
      },
    };
    console.log(`→ Claude  ${new Date().toISOString()} (${body.length} bytes)`);
    const proxy = https.request(options, (apiRes) => {
      console.log(`← Claude  ${apiRes.statusCode}`);
      setCORS(res);
      res.writeHead(apiRes.statusCode, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
      apiRes.pipe(res);
    });
    proxy.on("error", (err) => {
      console.error("Anthropic proxy error:", err.message);
      res.writeHead(502); res.end(JSON.stringify({error:err.message}));
    });
    proxy.write(body); proxy.end();
  });
}

// ── Main server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const path = url.parse(req.url).pathname;

  if (req.method === "GET"  && path === "/prices") return handlePrices(req, res);
  if (req.method === "GET"  && path === "/quote")  return handleQuote(req, res);
  if (req.method === "POST" && path === "/")       return handleAnthropic(req, res);

  res.writeHead(404); res.end("Not found");
});

server.listen(PROXY_PORT, () => {
  console.log(`\n✅  BBG Terminal proxy running`);
  console.log(`    http://localhost:${PROXY_PORT}`);
  console.log(`    API Key: ${API_KEY.slice(0,18)}...`);
  console.log(`\n    Endpoints:`);
  console.log(`      POST /          → Claude AI`);
  console.log(`      GET  /prices    → Yahoo Finance (live prices)`);
  console.log(`      GET  /quote     → Yahoo Finance (full quote data)`);
  console.log(`\n    Run in second terminal: npm run dev`);
  console.log(`    Then open: http://localhost:5173\n`);
});

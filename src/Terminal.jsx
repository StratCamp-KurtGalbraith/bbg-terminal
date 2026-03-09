import { useState, useEffect, useRef } from "react";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// When running locally via `node server.js`, requests route through the local proxy.
// When embedded in Claude.ai, requests go directly to the Anthropic API.
const IS_LOCAL = typeof window !== "undefined" && window.location.hostname === "localhost";
const API = IS_LOCAL ? "http://localhost:3001" : "https://api.anthropic.com/v1/messages";
const MDL = IS_LOCAL ? "claude-sonnet-4-6" : "claude-sonnet-4-20250514";

// Default portfolio — loaded from localStorage if available
const DEFAULT_PORTFOLIO = [
  { sym: "GLD", qty: 20,  cost: 488.770, name: "SPDR Gold Shares ETF",  sector: "Commodity"   },
  { sym: "XOM", qty: 62,  cost: 155.255, name: "Exxon Mobil Corp",      sector: "Energy"       },
  { sym: "RTX", qty: 58,  cost: 209.870, name: "RTX Corporation",       sector: "Defense"      },
  { sym: "LMT", qty: 5,   cost: 680.990, name: "Lockheed Martin Corp",  sector: "Defense"      },
  { sym: "FRO", qty: 62,  cost: 38.127,  name: "Frontline PLC",         sector: "Shipping"     },
  { sym: "FLR", qty: 50,  cost: 51.597,  name: "Fluor Corporation",     sector: "Engineering"  },
];
const DEFAULT_CASH = 10000;
const DEFAULT_WATCHLIST = ["SPY","QQQ","NVDA","AAPL","MSFT","META","TSLA","BTC-USD"];

function loadFromStorage(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e) { return fallback; }
}
function saveToStorage(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}

// ─── THEME ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#030303", panel: "#0C0C0C", border: "#1C1C1C", borderBright: "#2A2A2A",
  amber: "#E8960C", amberDim: "#6B450A", amberBright: "#FFB020",
  cyan: "#00CED1", green: "#00E676", red: "#FF1744",
  blue: "#448AFF", purple: "#CE93D8", teal: "#1DE9B6",
  text: "#C0C0C0", textDim: "#707070", white: "#F0F0F0", muted: "#444",
};

const FUNCS = [
  { key: "EQ",   label: "EQ",   desc: "EQUITY ANALYSIS",   color: C.cyan,   f: "F1" },
  { key: "PORT", label: "PORT", desc: "PORTFOLIO",          color: C.amber,  f: "F2" },
  { key: "NEWS", label: "NEWS", desc: "MARKET INTEL",       color: C.red,    f: "F3" },
  { key: "MACRO",label: "MACRO",desc: "MACRO / RATES",      color: C.purple, f: "F4" },
  { key: "LEARN",label: "LEARN",desc: "FINANCE ACADEMY",    color: C.green,  f: "F5" },
  { key: "DES",  label: "DES",  desc: "DESCRIPTION",        color: C.teal,   f: "F6" },
  { key: "BI",   label: "BI",   desc: "BLOOMBERG INTEL",    color: C.blue,   f: "F7" },
  { key: "ECO",  label: "ECO",  desc: "ECONOMIC CALENDAR",  color: C.amber,  f: "F8" },
  { key: "FS",   label: "FS",   desc: "FINANCIAL SUMMARY",  color: C.green,  f: "F9" },
  { key: "WEI",  label: "WEI",  desc: "WORLD EQUITY IDX",   color: C.purple, f: "F10"},
];

// ─── API HELPER ──────────────────────────────────────────────────────────────
// Web search tool is only available inside Claude.ai — stripped for local API calls
async function fetchAI(prompt, sys = "", maxTokens = 2000) {
  const body = {
    model: MDL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  // web_search_20250305 is a Claude.ai-only tool; omit when calling API directly
  if (!IS_LOCAL) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  if (sys) body.system = sys;
  const headers = { "Content-Type": "application/json" };
  if (!IS_LOCAL) headers["anthropic-version"] = "2023-06-01";
  const r = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`HTTP ${r.status}: ${errText}`);
  }
  const d = await r.json();
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseJSON(txt) {
  if (!txt) return null;

  // Strategy 1: strip code fences, try direct parse
  let s = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(s); } catch {}

  // Strategy 2: extract outermost {...} block and parse
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(e) {
    // Strategy 3: sanitize common AI JSON mistakes inside the block
    let fixed = m[0]
      .replace(/,\s*([}\]])/g, "$1")           // trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":') // unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"');       // single-quoted values
    try { return JSON.parse(fixed); } catch {}
  }}

  return null;
}

// Robust lecture parser — handles large multi-section JSON that may have
// unescaped newlines in content fields by extracting sections individually
function parseLectureJSON(txt) {
  // First try normal parse
  const quick = parseJSON(txt);
  if (quick?.sections) return quick;

  // If that fails, build a synthetic lecture object from raw text
  // so the panel always renders something useful
  const clean = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Try to extract title
  const titleM = clean.match(/"title"\s*:\s*"([^"]+)"/);
  const subtitleM = clean.match(/"subtitle"\s*:\s*"([^"]+)"/);
  const levelM = clean.match(/"level"\s*:\s*"([^"]+)"/);
  const readTimeM = clean.match(/"readTime"\s*:\s*"([^"]+)"/);

  // Extract takeaways array
  const takeawaysM = clean.match(/"keyTakeaways"\s*:\s*\[([^\]]+)\]/s);
  let keyTakeaways = [];
  if (takeawaysM) {
    keyTakeaways = [...takeawaysM[1].matchAll(/"([^"]{10,})"/g)].map(m => m[1]);
  }

  // Extract related topics
  const relatedM = clean.match(/"relatedTopics"\s*:\s*\[([^\]]+)\]/s);
  let relatedTopics = [];
  if (relatedM) {
    relatedTopics = [...relatedM[1].matchAll(/"([^"]{5,})"/g)].map(m => m[1]);
  }

  // Extract sections — look for "type": "..." patterns and grab content after
  const sectionMatches = [...clean.matchAll(/"type"\s*:\s*"(concept|formula|example|institutional|pitfalls|advanced)"/g)];
  let sections = [];

  if (sectionMatches.length > 0) {
    sectionMatches.forEach((match, i) => {
      const start = match.index;
      const end = sectionMatches[i+1]?.index ?? clean.length;
      const chunk = clean.slice(start, end);

      const typeM    = chunk.match(/"type"\s*:\s*"([^"]+)"/);
      const secTitleM = chunk.match(/"title"\s*:\s*"([^"]+)"/);
      // Content may span many lines — grab everything between "content": " and next top-level key
      const contentM = chunk.match(/"content"\s*:\s*"([\s\S]+?)(?="\s*[},]|$)/);
      const rawContent = contentM ? contentM[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "  ")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'") : "Content unavailable.";

      sections.push({
        type:    typeM?.[1]    || "concept",
        title:   secTitleM?.[1] || "SECTION",
        content: rawContent,
      });
    });
  }

  // If we couldn't extract sections, create one big raw text section
  if (sections.length === 0) {
    sections = [{ type: "concept", title: "LECTURE CONTENT", content: clean.slice(0, 3000) }];
  }

  return {
    title:         titleM?.[1]    || "Lecture",
    subtitle:      subtitleM?.[1] || "",
    level:         levelM?.[1]    || "ADVANCED",
    readTime:      readTimeM?.[1] || "—",
    sections,
    keyTakeaways,
    relatedTopics,
    prereqs: [],
  };
}

// ─── LOCAL DATA API HELPERS ──────────────────────────────────────────────────
const PROXY = "http://localhost:3001";

async function apiGet(path) {
  const r = await fetch(`${PROXY}${path}`);
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

async function fetchLivePrices(symbols) {
  return apiGet(`/prices?symbols=${symbols.join(",")}`);
}

async function fetchYahooQuote(symbol) {
  return apiGet(`/quote?symbol=${encodeURIComponent(symbol)}`);
}

async function fetchYahooFinancials(symbol) {
  return apiGet(`/financials?symbol=${encodeURIComponent(symbol)}`);
}

async function fetchMacroData() {
  return apiGet("/macro");
}

async function fetchWorldIndices() {
  return apiGet("/worldindices");
}

async function fetchNews(query, pageSize = 8) {
  return apiGet(`/news?q=${encodeURIComponent(query)}&pageSize=${pageSize}`);
}

async function fetchEcoCalendar() {
  return apiGet("/calendar");
}

// Format large numbers
function fmtNum(n, decimals = 2) {
  if (n == null) return null;
  if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(decimals)}`;
}

function fmtPct(n) { return n != null ? `${(n*100).toFixed(1)}%` : null; }
function fmtVol(n) { if (!n) return null; return n > 1e6 ? `${(n/1e6).toFixed(1)}M` : `${(n/1e3).toFixed(0)}K`; }

// Classify news headline sentiment by keyword
function classifyHeadline(text) {
  if (!text) return "NEUTRAL";
  const t = text.toLowerCase();
  const bull = /surge|soar|jump|rise|gain|beat|record|upgrade|rally|strong|growth|profit|win|expan|positive|boost|accelerat/;
  const bear = /fall|drop|plunge|decline|miss|loss|cut|downgrade|concern|risk|weak|slow|crisis|crash|warn|disappoint|reduc/;
  if (bull.test(t)) return "BULLISH";
  if (bear.test(t)) return "BEARISH";
  return "NEUTRAL";
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
const Mono = ({ children, color, size = 11, weight = 400, spacing = 0, style = {} }) => (
  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: color || C.text, fontSize: size, fontWeight: weight, letterSpacing: spacing, ...style }}>
    {children}
  </span>
);

const Loader = ({ msg = "FETCHING LIVE DATA" }) => (
  <div style={{ padding: "24px 0", display: "flex", alignItems: "center", gap: 12 }}>
    <div style={{ width: 8, height: 8, background: C.amber, animation: "blink 0.8s step-end infinite" }} />
    <Mono color={C.amber} size={11} spacing={2}>{msg}...</Mono>
  </div>
);

function StatRow({ label, value, color, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
      <Mono color={C.textDim} size={10} spacing={0.5}>{label}</Mono>
      <Mono color={color || C.white} size={11} weight={bold ? 700 : 500}>{value ?? "—"}</Mono>
    </div>
  );
}

function PanelBox({ title, titleColor, children, style = {} }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, ...style }}>
      {title && (
        <div style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, background: "#0A0A0A" }}>
          <Mono color={titleColor || C.amber} size={9} weight={700} spacing={2}>{title}</Mono>
        </div>
      )}
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function Btn({ onClick, disabled, children, variant = "primary", color }) {
  const base = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, padding: "7px 18px", cursor: disabled ? "not-allowed" : "pointer", border: "none", letterSpacing: 1, transition: "opacity 0.15s" };
  const styles = {
    primary: { background: disabled ? C.muted : C.amber, color: "#000" },
    outline: { background: "transparent", color: color || C.cyan, border: `1px solid ${color || C.cyan}` },
    ghost:   { background: "transparent", color: C.textDim, border: `1px solid ${C.border}` },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...styles[variant], opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}

function SearchInput({ value, onChange, onSubmit, placeholder }) {
  return (
    <div style={{ display: "flex" }}>
      <input value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
        style={{ background: "#000", border: `1px solid ${C.amber}`, borderRight: "none", color: C.amber, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 14px", outline: "none", flex: 1, letterSpacing: 1 }}
      />
      <button onClick={onSubmit} style={{ background: C.amber, color: "#000", border: "none", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, padding: "8px 18px", cursor: "pointer", letterSpacing: 1 }}>GO</button>
    </div>
  );
}

// ─── F1: EQ — EQUITY ANALYSIS ────────────────────────────────────────────────
function EQPanel() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const analyze = async () => {
    if (!input.trim()) return;
    setLoading(true); setErr(""); setData(null);
    const sym = input.toUpperCase().trim();
    try {
      if (IS_LOCAL) {
        // ── LOCAL: Real data from Yahoo Finance + short Claude call for analysis text only
        const [quoteRes, newsRes] = await Promise.all([
          fetchYahooQuote(sym),
          fetchNews(sym + " stock", 6).catch(() => ({ articles: [] })),
        ]);

        const r = quoteRes?.quoteSummary?.result?.[0];
        // Check if we have at least a price — v8-only fallback has minimal data
        const v8Only  = quoteRes?._source === "v8-chart-only";
        if (!r?.price?.regularMarketPrice && !r?.price?.regularMarketPrice?.raw) {
          throw new Error(`No data found for ${sym} — verify the ticker symbol is correct`);
        }

        const price   = r.price || {};
        const summary = r.summaryDetail || {};
        const stats   = r.defaultKeyStatistics || {};
        const fin     = r.financialData || {};
        const profile = r.assetProfile || {};
        const recTrend= r.recommendationTrend?.trend?.[0] || {};

        // Helper to unwrap Yahoo raw/fmt objects OR plain numbers
        const rv = (obj, key) => { const v = obj?.[key]; return v?.raw ?? v ?? null; };

        // Build rating from recommendation counts
        const buy = (recTrend.strongBuy||0) + (recTrend.buy||0);
        const hold= recTrend.hold || 0;
        const sell= (recTrend.sell||0) + (recTrend.strongSell||0);
        const total = buy + hold + sell;
        const rating = total === 0 ? "N/A" : buy/total > 0.6 ? "BUY" : sell/total > 0.4 ? "SELL" : "HOLD";

        // Map news articles
        const news = (newsRes.articles || []).map(a => ({
          headline: a.headline,
          source:   a.source,
          date:     a.date,
          impact:   classifyHeadline(a.headline),
          summary:  a.summary?.slice(0,120) || "",
        }));

        // Unwrap price fields FIRST (Yahoo returns {raw, fmt} objects OR plain numbers)
        const livePrice     = rv(price, "regularMarketPrice");
        const liveChange    = rv(price, "regularMarketChange");
        const liveChangePct = rv(price, "regularMarketChangePercent");

        // Ask Claude ONLY for analysis text + catalysts + risks (cheap: ~400 tokens out)
        const briefData = `Ticker: ${sym}, Company: ${price.longName||sym}, Sector: ${profile.sector||"N/A"}, Industry: ${profile.industry||"N/A"}, Price: $${livePrice?.toFixed(2)||"N/A"}, Market Cap: ${fmtNum(rv(price,"marketCap"))}, P/E: ${rv(summary,"trailingPE")?.toFixed?.(1)||"N/A"}, Revenue: ${fmtNum(rv(fin,"totalRevenue"))}, Net Margin: ${fmtPct(rv(fin,"profitMargins"))}, FCF: ${fmtNum(rv(fin,"freeCashflow"))}, Debt/Equity: ${rv(fin,"debtToEquity")?.toFixed?.(1)||"N/A"}`;
        const aiPrompt = `Write a 5-sentence institutional analysis for ${sym} (${price.longName||sym}), then list exactly 3 bull catalysts and 3 risk factors. Data: ${briefData}. Return ONLY JSON: {"analysis":"5 sentences","catalysts":["c1","c2","c3"],"risks":["r1","r2","r3"]}`;
        const aiTxt = await fetchAI(aiPrompt, "Return ONLY valid JSON, no markdown.", 600);
        const ai = parseJSON(aiTxt) || { analysis: "Analysis unavailable.", catalysts: [], risks: [] };

        setData({
          ticker:   sym,
          company:  price.longName || price.shortName || sym,
          exchange: price.exchangeName || price.fullExchangeName || "N/A",
          sector:   profile.sector || "N/A",
          industry: profile.industry || "N/A",
          price:    livePrice,
          change:   liveChange,
          changePct:liveChangePct,
          volume:   fmtVol(rv(price, "regularMarketVolume")),
          avgVolume:fmtVol(rv(summary, "averageVolume") || rv(summary, "averageDailyVolume10Day")),
          marketCap:fmtNum(rv(price, "marketCap")),
          pe:       rv(summary, "trailingPE"),
          forwardPe:rv(summary, "forwardPE"),
          eps:      rv(stats, "trailingEps"),
          pb:       rv(stats, "priceToBook"),
          evEbitda: rv(stats, "enterpriseToEbitda"),
          grossMargin:     fmtPct(rv(fin, "grossMargins")),
          operatingMargin: fmtPct(rv(fin, "operatingMargins")),
          netMargin:       fmtPct(rv(fin, "profitMargins")),
          revenue:   fmtNum(rv(fin, "totalRevenue")),
          ebitda:    fmtNum(rv(fin, "ebitda")),
          freeCashFlow: fmtNum(rv(fin, "freeCashflow")),
          debtEquity:   rv(fin, "debtToEquity"),
          currentRatio: rv(fin, "currentRatio"),
          beta:     rv(summary, "beta"),
          week52High:   rv(summary, "fiftyTwoWeekHigh"),
          week52Low:    rv(summary, "fiftyTwoWeekLow"),
          dividendYield:fmtPct(rv(summary, "dividendYield")) || "N/A",
          shortInterest:stats.shortPercentOfFloat ? `${(rv(stats,"shortPercentOfFloat")*100).toFixed(1)}%` : "N/A",
          analystRating: rating,
          analystCount: total,
          priceTarget:  rv(fin, "targetMeanPrice"),
          analysis: ai.analysis,
          catalysts: ai.catalysts,
          risks:     ai.risks,
          news,
          v8Only,
        });
      } else {
        // ── CLAUDE.AI: Full AI web search path
        const prompt = `Use web search for CURRENT data for ${sym}. Return ONLY JSON: {"ticker":"${sym}","company":"full name","exchange":"exchange","price":number,"change":number,"changePct":number,"volume":"formatted","avgVolume":"formatted","marketCap":"formatted","pe":number_or_null,"forwardPe":number_or_null,"eps":number,"pb":number_or_null,"evEbitda":number_or_null,"grossMargin":"pct%","operatingMargin":"pct%","netMargin":"pct%","revenue":"TTM","ebitda":"formatted","freeCashFlow":"formatted","debtEquity":number_or_null,"currentRatio":number_or_null,"beta":number_or_null,"week52High":number,"week52Low":number,"dividendYield":"pct% or null","shortInterest":"pct%","analystRating":"BUY/HOLD/SELL","analystCount":number,"priceTarget":number_or_null,"sector":"sector","industry":"industry","analysis":"5 sentence analysis","catalysts":["c1","c2","c3"],"risks":["r1","r2","r3"],"news":[{"headline":"text","source":"name","date":"date","impact":"BULLISH/BEARISH/NEUTRAL","summary":"1 sentence"}]}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed); else setErr("Parse error.");
      }
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const chgPos = (data?.changePct || 0) >= 0;
  const chgColor = data ? (chgPos ? C.green : C.red) : C.text;
  const w52Pct = data ? Math.min(100, Math.max(0, ((data.price - data.week52Low) / Math.max(1, data.week52High - data.week52Low)) * 100)) : 0;
  const rC = { BUY: C.green, OVERWEIGHT: C.green, HOLD: C.amber, UNDERWEIGHT: C.red, SELL: C.red };
  const quickTix = ["AAPL","NVDA","CRMD","MSFT","XOM","RTX","LMT","FRO","GLD","SPY","QQQ","META"];

  return (
    <div>
      <div style={{ marginBottom: 10 }}><SearchInput value={input} onChange={setInput} onSubmit={analyze} placeholder="ENTER TICKER SYMBOL (e.g. AAPL, NVDA, CRMD)" /></div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {quickTix.map(t => <button key={t} onClick={() => setInput(t)} style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"3px 10px", cursor:"pointer", letterSpacing:1 }}>{t}</button>)}
      </div>
      {loading && <Loader msg={`ANALYZING ${input.toUpperCase()}`} />}
      {err && <Mono color={C.red} size={11} style={{display:"block",padding:"8px 0"}}>{err}</Mono>}
      {data && (
        <div>
          {data.v8Only && (
            <div style={{ background:"#0A0600", border:`1px solid ${C.amber}44`, padding:"6px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
              <Mono color={C.amber} size={9} spacing={1}>⚠ PRICE DATA ONLY</Mono>
              <Mono color={C.textDim} size={9}>Yahoo Finance fundamentals unavailable — live price confirmed, other metrics from AI knowledge</Mono>
            </div>
          )}
          <div style={{ background:"#080808", border:`1px solid ${C.border}`, padding:"14px 16px", marginBottom:12, display:"flex", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div style={{ marginRight:20 }}>
              <Mono color={C.amber} size={14} weight={700} spacing={3}>{data.ticker}</Mono>
              <span style={{ margin:"0 8px", color:C.border }}>|</span>
              <Mono color={C.textDim} size={10}>{data.company}</Mono>
              <Mono color={C.muted} size={9} style={{ marginLeft:8 }}>{data.exchange} · {data.sector}</Mono>
            </div>
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"baseline", gap:16 }}>
              <Mono color={C.white} size={26} weight={700}>${data.price?.toFixed(2)}</Mono>
              <div>
                <Mono color={chgColor} size={14} weight={600}>{chgPos?"+":""}{data.change?.toFixed(2)}</Mono>
                <span style={{ margin:"0 4px", color:C.muted }}>/</span>
                <Mono color={chgColor} size={14} weight={600}>{chgPos?"+":""}{data.changePct?.toFixed(2)}%</Mono>
              </div>
              <div style={{ borderLeft:`1px solid ${C.border}`, paddingLeft:16, textAlign:"center" }}>
                <Mono color={rC[data.analystRating]||C.text} size={13} weight={700}>{data.analystRating}</Mono>
                <div><Mono color={C.textDim} size={9}>PT: {data.priceTarget?`$${data.priceTarget}`:"N/A"} ({data.analystCount} analysts)</Mono></div>
              </div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
            <PanelBox title="VALUATION MULTIPLES">
              <StatRow label="MARKET CAP" value={data.marketCap} />
              <StatRow label="P/E (TTM)" value={data.pe} color={C.cyan} />
              <StatRow label="P/E (FWD)" value={data.forwardPe} color={C.cyan} />
              <StatRow label="EV/EBITDA" value={data.evEbitda} color={C.cyan} />
              <StatRow label="PRICE/BOOK" value={data.pb} />
              <StatRow label="BETA" value={data.beta} />
            </PanelBox>
            <PanelBox title="FINANCIALS (TTM)">
              <StatRow label="REVENUE" value={data.revenue} />
              <StatRow label="EBITDA" value={data.ebitda} />
              <StatRow label="FREE CASH FLOW" value={data.freeCashFlow} />
              <StatRow label="GROSS MARGIN" value={data.grossMargin} color={C.green} />
              <StatRow label="OP MARGIN" value={data.operatingMargin} color={C.green} />
              <StatRow label="NET MARGIN" value={data.netMargin} color={C.green} />
            </PanelBox>
            <PanelBox title="MARKET / RISK">
              <StatRow label="VOLUME" value={data.volume} />
              <StatRow label="AVG VOLUME" value={data.avgVolume} />
              <StatRow label="SHORT INTEREST" value={data.shortInterest} />
              <StatRow label="DIVIDEND YIELD" value={data.dividendYield||"N/A"} />
              <StatRow label="DEBT/EQUITY" value={data.debtEquity} color={data.debtEquity>2?C.red:C.text} />
              <StatRow label="CURRENT RATIO" value={data.currentRatio} />
            </PanelBox>
          </div>
          <PanelBox title="52-WEEK RANGE" style={{ marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <Mono color={C.red} size={11}>${data.week52Low?.toFixed(2)}</Mono>
              <div style={{ flex:1, height:6, background:"#1A1A1A", position:"relative", borderRadius:2 }}>
                <div style={{ position:"absolute", left:0, width:`${w52Pct}%`, height:"100%", background:`linear-gradient(90deg,${C.red},${C.amber},${C.green})`, borderRadius:2 }} />
                <div style={{ position:"absolute", left:`calc(${w52Pct}% - 1px)`, top:-4, width:2, height:14, background:C.white }} />
              </div>
              <Mono color={C.green} size={11}>${data.week52High?.toFixed(2)}</Mono>
              <div style={{ borderLeft:`1px solid ${C.border}`, paddingLeft:12 }}>
                <Mono color={C.textDim} size={9}>CURRENT </Mono>
                <Mono color={C.white} size={11} weight={600}>${data.price?.toFixed(2)}</Mono>
                <Mono color={C.textDim} size={9}> ({w52Pct.toFixed(0)}th pct)</Mono>
              </div>
            </div>
          </PanelBox>
          <PanelBox title="AI FUNDAMENTAL ANALYSIS" style={{ marginBottom:10 }}>
            <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:0 }}>{data.analysis}</p>
          </PanelBox>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <PanelBox title="▲ BULL CATALYSTS" titleColor={C.green}>
              {(data.catalysts||[]).map((c,i) => <div key={i} style={{ padding:"5px 0", borderBottom:`1px solid ${C.border}`, display:"flex", gap:8 }}><Mono color={C.green} size={10}>+</Mono><Mono color={C.text} size={11}>{c}</Mono></div>)}
            </PanelBox>
            <PanelBox title="▼ RISK FACTORS" titleColor={C.red}>
              {(data.risks||[]).map((r,i) => <div key={i} style={{ padding:"5px 0", borderBottom:`1px solid ${C.border}`, display:"flex", gap:8 }}><Mono color={C.red} size={10}>−</Mono><Mono color={C.text} size={11}>{r}</Mono></div>)}
            </PanelBox>
          </div>
          {(data.news||[]).length>0 && (
            <PanelBox title="RECENT NEWS FLOW">
              {data.news.map((n,i) => {
                const ic = n.impact==="BULLISH"?C.green:n.impact==="BEARISH"?C.red:C.textDim;
                return (
                  <div key={i} style={{ padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", gap:10, marginBottom:3, alignItems:"flex-start" }}>
                      <span style={{ background:ic+"22", color:ic, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"2px 6px", letterSpacing:1, whiteSpace:"nowrap" }}>{n.impact}</span>
                      <Mono color={C.white} size={11}>{n.headline}</Mono>
                      <div style={{ marginLeft:"auto", textAlign:"right", whiteSpace:"nowrap" }}>
                        <div><Mono color={C.textDim} size={9}>{n.source}</Mono></div>
                        <div><Mono color={C.muted} size={9}>{n.date}</Mono></div>
                      </div>
                    </div>
                    <Mono color={C.textDim} size={10} style={{ lineHeight:1.6, display:"block", paddingLeft:60 }}>{n.summary}</Mono>
                  </div>
                );
              })}
            </PanelBox>
          )}
        </div>
      )}
    </div>
  );
}

// ─── F2: PORT — PORTFOLIO ────────────────────────────────────────────────────
function PORTPanel() {
  const [portfolio, setPortfolio] = useState(() => loadFromStorage("bbg_portfolio", DEFAULT_PORTFOLIO));
  const [cash, setCash]           = useState(() => loadFromStorage("bbg_cash", DEFAULT_CASH));
  const [watchlist, setWatchlist] = useState(() => loadFromStorage("bbg_watchlist", DEFAULT_WATCHLIST));
  const [prices, setPrices]       = useState({});
  const [analysis, setAnalysis]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [aLoading, setALoading]   = useState(false);
  const [ts, setTs]               = useState("");
  const [tab, setTab]             = useState("portfolio"); // "portfolio" | "watchlist"
  const [showAdd, setShowAdd]     = useState(false);
  const [editIdx, setEditIdx]     = useState(null);
  const [form, setForm]           = useState({ sym:"", qty:"", cost:"", name:"", sector:"" });
  const [formErr, setFormErr]     = useState("");

  // Persist on every change
  useEffect(() => { saveToStorage("bbg_portfolio", portfolio); }, [portfolio]);
  useEffect(() => { saveToStorage("bbg_cash", cash); }, [cash]);
  useEffect(() => { saveToStorage("bbg_watchlist", watchlist); }, [watchlist]);

  const totalCost   = portfolio.reduce((s,p) => s + p.qty * p.cost, 0);
  const hasPrices   = Object.keys(prices).length > 0;
  const totalMktVal = hasPrices ? portfolio.reduce((s,p) => s + p.qty * (prices[p.sym]??p.cost), 0) : null;
  const totalPnL    = totalMktVal != null ? totalMktVal - totalCost : null;
  const pnlPct      = totalPnL != null ? (totalPnL / totalCost) * 100 : null;
  const pnlColor    = pnlPct > 0 ? C.green : pnlPct < 0 ? C.red : C.text;
  const portTotal   = (totalMktVal ?? totalCost) + cash;
  const today       = new Date();
  const daysLeft    = Math.ceil((new Date("2026-04-02") - today) / 86400000);

  const allSyms = [...new Set([...portfolio.map(p => p.sym), ...watchlist])];

  const refresh = async () => {
    setLoading(true);
    try {
      if (IS_LOCAL) {
        const data = await fetchLivePrices(allSyms);
        if (data?.prices) { setPrices(data.prices); setTs(data.timestamp || ""); }
      } else {
        const syms = portfolio.map(p => p.sym).join(",");
        const prompt = `Search TODAY's prices for: ${syms}. Return ONLY JSON: {"prices":{${portfolio.map(p=>`"${p.sym}":number`).join(",")}},"timestamp":"now"}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 800);
        const parsed = parseJSON(txt);
        if (parsed?.prices) { setPrices(parsed.prices); setTs(parsed.timestamp||""); }
      }
    } catch(e) { console.error("Refresh error:", e); }
    setLoading(false);
  };

  const getAnalysis = async () => {
    setALoading(true);
    try {
      const pos = portfolio.map(p => ({ sym:p.sym, name:p.name, qty:p.qty, cost:p.cost, price:prices[p.sym]||null }));
      const prompt = `Senior portfolio manager review. Positions: ${JSON.stringify(pos)}. Cash: $${cash.toLocaleString()}. Today: ${new Date().toLocaleDateString()}.
Write a structured institutional review covering: thesis validation, top performer, weakest position, key risks, monitoring points, overall recommendation. Be specific.`;
      const txt = await fetchAI(prompt, "", 2000);
      setAnalysis(txt);
    } catch(e) { setAnalysis(`Error: ${e.message}`); }
    setALoading(false);
  };

  // ── Add / Edit position ───────────────────────────────────────────────────
  const openAdd = () => {
    setForm({ sym:"", qty:"", cost:"", name:"", sector:"" });
    setFormErr(""); setEditIdx(null); setShowAdd(true);
  };
  const openEdit = (idx) => {
    const p = portfolio[idx];
    setForm({ sym:p.sym, qty:String(p.qty), cost:String(p.cost), name:p.name, sector:p.sector||"" });
    setFormErr(""); setEditIdx(idx); setShowAdd(true);
  };
  const closeForm = () => { setShowAdd(false); setEditIdx(null); };

  const savePosition = async () => {
    const sym = form.sym.toUpperCase().trim();
    const qty = parseFloat(form.qty);
    const cost = parseFloat(form.cost);
    if (!sym) return setFormErr("Ticker required");
    if (isNaN(qty) || qty <= 0) return setFormErr("Valid quantity required");
    if (isNaN(cost) || cost <= 0) return setFormErr("Valid cost basis required");
    if (editIdx === null && portfolio.find(p => p.sym === sym)) return setFormErr(`${sym} already in portfolio`);

    let name = form.name.trim();
    let sector = form.sector.trim() || "Equity";

    // Auto-fetch name from Yahoo if blank
    if (!name && IS_LOCAL) {
      try {
        const d = await fetchLivePrices([sym]);
        name = d?.details?.[sym] ? sym : sym; // fallback to sym
      } catch(e) { name = sym; }
    }
    if (!name) name = sym;

    const newPos = { sym, qty, cost, name, sector };
    if (editIdx !== null) {
      setPortfolio(prev => prev.map((p,i) => i === editIdx ? newPos : p));
    } else {
      setPortfolio(prev => [...prev, newPos]);
    }
    closeForm();
  };

  const removePosition = (idx) => {
    setPortfolio(prev => prev.filter((_,i) => i !== idx));
  };

  // ── Watchlist management ─────────────────────────────────────────────────
  const [wInput, setWInput] = useState("");
  const addToWatchlist = () => {
    const sym = wInput.toUpperCase().trim();
    if (!sym) return;
    if (!watchlist.includes(sym)) setWatchlist(prev => [...prev, sym]);
    setWInput("");
  };
  const removeFromWatchlist = (sym) => setWatchlist(prev => prev.filter(s => s !== sym));

  // ── Input style helper ─────────────────────────────────────────────────
  const inputStyle = {
    background: "#111", border: `1px solid ${C.border}`, color: C.white,
    fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, padding: "5px 8px", outline: "none",
  };

  return (
    <div>
      {/* ── Summary stats ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:12 }}>
        {[
          { label:"PORTFOLIO VALUE",  value:`$${portTotal.toLocaleString("en",{maximumFractionDigits:0})}`,       color:C.white   },
          { label:"TOTAL COST BASIS", value:`$${(totalCost+cash).toLocaleString("en",{maximumFractionDigits:0})}`, color:C.text    },
          { label:"UNREALIZED P&L",   value:totalPnL!=null?`${totalPnL>0?"+":""}$${Math.abs(totalPnL).toLocaleString("en",{maximumFractionDigits:0})}`:"—", color:pnlColor },
          { label:"TOTAL RETURN",     value:pnlPct!=null?`${pnlPct>0?"+":""}${pnlPct.toFixed(2)}%`:"—",           color:pnlColor  },
          { label:"POSITIONS",        value:`${portfolio.length} + $${(cash/1000).toFixed(0)}K cash`,              color:C.amber   },
        ].map(({label,value,color}) => (
          <div key={label} style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
            <Mono color={C.textDim} size={8} spacing={0.5} style={{display:"block",marginBottom:5}}>{label}</Mono>
            <Mono color={color} size={13} weight={700}>{value}</Mono>
          </div>
        ))}
      </div>

      {/* ── Tab bar + action buttons ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", gap:6 }}>
          {[["portfolio","PORTFOLIO"],["watchlist","WATCHLIST"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ background:tab===k?C.amber+"22":"transparent", color:tab===k?C.amber:C.muted, border:`1px solid ${tab===k?C.amber:C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, padding:"5px 16px", cursor:"pointer", letterSpacing:1 }}>{l}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <Btn onClick={refresh} disabled={loading} variant="outline">{loading?"FETCHING...":"↺ REFRESH ALL"}</Btn>
          <Btn onClick={openAdd}>+ ADD POSITION</Btn>
          <Btn onClick={getAnalysis} disabled={aLoading} variant="outline" color={C.purple}>{aLoading?"ANALYZING...":"AI REVIEW"}</Btn>
        </div>
      </div>

      {/* ── Add/Edit form modal ── */}
      {showAdd && (
        <div style={{ background:"#0A0A0A", border:`1px solid ${C.amber}`, padding:16, marginBottom:12 }}>
          <Mono color={C.amber} size={10} spacing={1} style={{display:"block",marginBottom:12}}>{editIdx!==null?"EDIT POSITION":"ADD NEW POSITION"}</Mono>
          <div style={{ display:"grid", gridTemplateColumns:"100px 80px 100px 1fr 120px", gap:8, marginBottom:10 }}>
            {[
              { key:"sym", label:"TICKER", placeholder:"AAPL" },
              { key:"qty", label:"QTY",    placeholder:"100" },
              { key:"cost",label:"COST BASIS",placeholder:"182.50" },
              { key:"name",label:"NAME (optional)",placeholder:"Apple Inc." },
              { key:"sector",label:"SECTOR (optional)",placeholder:"Technology" },
            ].map(({key,label,placeholder}) => (
              <div key={key}>
                <Mono color={C.textDim} size={8} spacing={0.5} style={{display:"block",marginBottom:3}}>{label}</Mono>
                <input
                  value={form[key]}
                  onChange={e => setForm(prev => ({...prev, [key]: e.target.value}))}
                  onKeyDown={e => e.key==="Enter" && savePosition()}
                  placeholder={placeholder}
                  style={{...inputStyle, width:"100%", boxSizing:"border-box"}}
                  disabled={key==="sym" && editIdx!==null}
                />
              </div>
            ))}
          </div>
          {formErr && <Mono color={C.red} size={10} style={{display:"block",marginBottom:8}}>{formErr}</Mono>}
          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={savePosition}>{editIdx!==null?"SAVE CHANGES":"ADD TO PORTFOLIO"}</Btn>
            <Btn onClick={closeForm} variant="outline">CANCEL</Btn>
          </div>
        </div>
      )}

      {/* ── Portfolio tab ── */}
      {tab === "portfolio" && (
        <div style={{ background:C.panel, border:`1px solid ${C.border}`, marginBottom:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"65px 150px 70px 50px 70px 80px 85px 75px 65px 60px", background:"#0A0A0A", padding:"7px 12px", borderBottom:`1px solid ${C.border}` }}>
            {["TICKER","NAME","SECTOR","QTY","COST","PRICE","MKT VALUE","P&L $","P&L %",""].map((h,i) => <Mono key={i} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
          </div>
          {portfolio.length === 0 && (
            <div style={{ padding:"24px 12px", textAlign:"center" }}>
              <Mono color={C.muted} size={11}>No positions. Click + ADD POSITION to get started.</Mono>
            </div>
          )}
          {portfolio.map((p,idx) => {
            const price = prices[p.sym];
            const val   = price != null ? price * p.qty : null;
            const pnl   = price != null ? (price - p.cost) * p.qty : null;
            const pct   = price != null ? ((price - p.cost)/p.cost)*100 : null;
            const pc    = pnl > 0 ? C.green : pnl < 0 ? C.red : C.text;
            return (
              <div key={p.sym} style={{ display:"grid", gridTemplateColumns:"65px 150px 70px 50px 70px 80px 85px 75px 65px 60px", padding:"7px 12px", borderBottom:`1px solid ${C.border}`, alignItems:"center" }}>
                <Mono color={C.amber} size={12} weight={700}>{p.sym}</Mono>
                <Mono color={C.textDim} size={10}>{p.name}</Mono>
                <Mono color={C.muted} size={9}>{p.sector}</Mono>
                <Mono color={C.text} size={11}>{p.qty}</Mono>
                <Mono color={C.text} size={11}>${p.cost.toFixed(2)}</Mono>
                <Mono color={price!=null?C.cyan:C.muted} size={11} weight={price!=null?600:400}>{price!=null?`$${price.toFixed(2)}`:"—"}</Mono>
                <Mono color={C.text} size={11}>{val!=null?`$${val.toLocaleString("en",{maximumFractionDigits:0})}`:"—"}</Mono>
                <Mono color={pc} size={11} weight={600}>{pnl!=null?`${pnl>0?"+":""}$${Math.abs(pnl).toFixed(0)}`:"—"}</Mono>
                <Mono color={pc} size={11} weight={600}>{pct!=null?`${pct>0?"+":""}${pct.toFixed(1)}%`:"—"}</Mono>
                <div style={{ display:"flex", gap:4 }}>
                  <button onClick={() => openEdit(idx)} style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 6px", cursor:"pointer" }}>EDIT</button>
                  <button onClick={() => removePosition(idx)} style={{ background:"transparent", color:C.red+"99", border:`1px solid ${C.red}33`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 6px", cursor:"pointer" }}>✕</button>
                </div>
              </div>
            );
          })}
          <div style={{ display:"grid", gridTemplateColumns:"65px 150px 70px 50px 70px 80px 85px 75px 65px 60px", padding:"7px 12px", background:"#0A0A0A" }}>
            <Mono color={C.textDim} size={11}>CASH</Mono>
            <Mono color={C.textDim} size={10}>Reserve</Mono>
            <span/><span/><span/><span/>
            <Mono color={C.text} size={11}>${cash.toLocaleString()}</Mono>
          </div>
        </div>
      )}

      {/* ── Watchlist tab ── */}
      {tab === "watchlist" && (
        <div style={{ marginBottom:12 }}>
          {/* Add to watchlist */}
          <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
            <input
              value={wInput}
              onChange={e => setWInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key==="Enter" && addToWatchlist()}
              placeholder="ADD TICKER TO WATCHLIST (e.g. NVDA)"
              style={{...inputStyle, flex:1}}
            />
            <Btn onClick={addToWatchlist}>+ ADD</Btn>
          </div>
          <div style={{ background:C.panel, border:`1px solid ${C.border}` }}>
            <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px 100px 50px", background:"#0A0A0A", padding:"7px 12px", borderBottom:`1px solid ${C.border}` }}>
              {["TICKER","","PRICE","CHG","CHG %",""].map((h,i) => <Mono key={i} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
            </div>
            {watchlist.length === 0 && (
              <div style={{ padding:"24px 12px", textAlign:"center" }}>
                <Mono color={C.muted} size={11}>Watchlist empty. Type a ticker above and press Enter.</Mono>
              </div>
            )}
            {watchlist.map(sym => {
              const d   = prices[sym];
              const chgColor = d?.changePct > 0 ? C.green : d?.changePct < 0 ? C.red : C.text;
              return (
                <div key={sym} style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px 100px 50px", padding:"8px 12px", borderBottom:`1px solid ${C.border}`, alignItems:"center" }}>
                  <Mono color={C.cyan} size={12} weight={700}>{sym}</Mono>
                  <span/>
                  <Mono color={d?C.white:C.muted} size={11} weight={600}>{d?.price!=null?`$${d.price.toFixed(2)}`:"—"}</Mono>
                  <Mono color={chgColor} size={11}>{d?.change!=null?`${d.change>0?"+":""}${d.change.toFixed(2)}`:"—"}</Mono>
                  <Mono color={chgColor} size={11} weight={600}>{d?.changePct!=null?`${d.changePct>0?"+":""}${d.changePct.toFixed(2)}%`:"—"}</Mono>
                  <button onClick={() => removeFromWatchlist(sym)} style={{ background:"transparent", color:C.red+"99", border:`1px solid ${C.red}33`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 6px", cursor:"pointer" }}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ts && <div style={{ marginBottom:8 }}><Mono color={C.muted} size={9}>Prices as of: {new Date(ts).toLocaleString()}</Mono></div>}

      {/* ── AI analysis ── */}
      {analysis && (
        <PanelBox title="PORTFOLIO MANAGER REVIEW">
          <div style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:11, lineHeight:2, whiteSpace:"pre-wrap" }}>{analysis}</div>
        </PanelBox>
      )}
    </div>
  );
}
// ─── F3: NEWS — MARKET INTELLIGENCE ─────────────────────────────────────────
function NEWSPanel() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Auto-load top business headlines on mount (empty query → top-headlines route)
  useEffect(() => { search(""); }, []);

  const search = async (q) => {
    const query = q !== undefined ? q : input;
    setLoading(true); setData(null);
    try {
      if (IS_LOCAL) {
        // Fetch real headlines from NewsAPI
        const newsRes = await fetchNews(query, 10);
        const articles = newsRes.articles || [];
        if (articles.length === 0) {
          setData({ topic: query || "MARKET NEWS", marketImpact: "NEUTRAL", execSummary: "No recent news found.", tradingTake: "Try a different query.", items: [] });
          setLoading(false); return;
        }
        // Use Claude ONLY for exec brief + trading take (cheap: ~150 tokens out)
        const topicLabel = query || "global financial markets";
        const headlines = articles.map((a,i) => `${i+1}. ${a.headline}`).join("\n");
        const aiTxt = await fetchAI(
          `These are real news headlines about "${topicLabel}":\n${headlines}\nWrite a 2-sentence executive brief and 1-sentence trading take. Return ONLY JSON: {"execSummary":"2 sentences","tradingTake":"1 sentence","marketImpact":"BULLISH/BEARISH/MIXED/NEUTRAL"}`,
          "Return ONLY valid JSON.", 200
        );
        const ai = parseJSON(aiTxt) || { execSummary: "See headlines below.", tradingTake: "Monitor developments.", marketImpact: "NEUTRAL" };
        setData({
          topic: query || "TOP MARKET STORIES",
          marketImpact: ai.marketImpact,
          execSummary:  ai.execSummary,
          tradingTake:  ai.tradingTake,
          items: articles.map(a => ({
            headline:  a.headline,
            source:    a.source,
            date:      a.date,
            impact:    classifyHeadline(a.headline),
            summary:   a.summary?.slice(0,180) || "",
            relevance: "HIGH",
          })),
        });
      } else {
        const prompt = `Search for latest financial news about: "${query}". Return ONLY JSON: {"topic":"${query}","marketImpact":"BULLISH/BEARISH/MIXED/NEUTRAL","execSummary":"2-3 sentence brief","tradingTake":"2 sentence trading implication","items":[{"headline":"text","source":"name","date":"date","impact":"BULLISH/BEARISH/NEUTRAL","summary":"2 sentence summary"}]} Include 6-8 items.`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed);
      }
    } catch(e) {
      if (e.message.includes("NEWS_API_KEY")) setData({ topic: query, marketImpact: "NEUTRAL", execSummary: "NewsAPI key not configured. Add NEWS_API_KEY to your environment variables (free at newsapi.org/register).", tradingTake: "", items: [] });
      else console.error(e);
    }
    setLoading(false);
  };

  const presets = ["Iran Strait of Hormuz military","Global oil markets OPEC","Defense sector RTX LMT spending","Gold GLD safe haven","FRO Frontline tanker shipping","US Israel military operations","Fed interest rates 2026","Geopolitical risk premium markets"];
  const ic = (v) => v==="BULLISH"?C.green:v==="BEARISH"?C.red:C.textDim;
  const oc = data?.marketImpact==="BULLISH"?C.green:data?.marketImpact==="BEARISH"?C.red:C.amber;

  return (
    <div>
      <div style={{ marginBottom:10 }}><SearchInput value={input} onChange={setInput} onSubmit={()=>search()} placeholder="SEARCH: TICKER, TOPIC, MACRO EVENT, OR THEME (auto-loaded)" /></div>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:16 }}>
        {presets.map(p => <button key={p} onClick={()=>{setInput(p);search(p);}} style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"4px 10px", cursor:"pointer" }}>{p}</button>)}
      </div>
      {loading && <Loader msg="SCANNING MARKET INTELLIGENCE" />}
      {data && (
        <div>
          <div style={{ background:"#080808", border:`1px solid ${C.borderBright}`, padding:"12px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <Mono color={C.amber} size={10} weight={700} spacing={2}>BRIEF: {(data.topic||"").toUpperCase()}</Mono>
              <span style={{ background:oc+"22", padding:"2px 10px" }}><Mono color={oc} size={10} weight={700}>{data.marketImpact}</Mono></span>
            </div>
            <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:"0 0 10px" }}>{data.execSummary}</p>
            <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
              <Mono color={C.cyan} size={9} spacing={1}>TRADING TAKE: </Mono>
              <Mono color={C.text} size={11}>{data.tradingTake}</Mono>
            </div>
          </div>
          <div style={{ background:C.panel, border:`1px solid ${C.border}` }}>
            {(data.items||[]).map((item,i) => (
              <div key={i} style={{ padding:"9px 14px", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ display:"flex", gap:12, marginBottom:4, alignItems:"flex-start" }}>
                  <span style={{ background:ic(item.impact)+"22", color:ic(item.impact), fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"2px 5px", whiteSpace:"nowrap" }}>{item.impact}</span>
                  <Mono color={C.white} size={11} style={{flex:1,lineHeight:1.5}}>{item.headline}</Mono>
                  <div style={{ textAlign:"right", whiteSpace:"nowrap" }}>
                    <div><Mono color={C.textDim} size={9}>{item.source}</Mono></div>
                    <div><Mono color={C.muted} size={9}>{item.date}</Mono></div>
                  </div>
                </div>
                <Mono color={C.textDim} size={10} style={{lineHeight:1.6,display:"block"}}>{item.summary}</Mono>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F4: MACRO — MACRO / RATES ───────────────────────────────────────────────
function MACROPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setData(null);
    try {
      const d = await fetchMacroData();
      const r = d.rates || {};
      const fv = (v, dec=2) => v != null ? `${parseFloat(v).toFixed(dec)}%` : "N/A";
      const bps = v => v != null ? `${(parseFloat(v)*100).toFixed(0)}bps` : "N/A";
      const spd = v => {
        if (v == null) return "N/A";
        const n = parseFloat(v);
        return `${n >= 0 ? "+" : ""}${(n*100).toFixed(0)}bps`;
      };

      setData({
        indices:     d.indices,
        commodities: d.commodities,
        fx:          d.fx,
        bonds:       d.bonds,
        timestamp:   d.timestamp,
        fredAvailable: d.fredAvailable,
        rates: [
          { label: "Fed Funds",      val: fv(r.fedFunds),    highlight: true },
          { label: "SOFR",           val: fv(r.sofr) },
          { label: "2Y Treasury",    val: fv(r.t2y) },
          { label: "5Y Treasury",    val: fv(r.t5y) },
          { label: "10Y Treasury",   val: fv(r.t10y ?? r.tnx), highlight: true },
          { label: "30Y Treasury",   val: fv(r.t30y ?? r.tyx) },
          { label: "2s10s Spread",   val: spd(r.spread2s10s), spread: r.spread2s10s },
        ],
        realRates: [
          { label: "10Y Real Yield",   val: fv(r.realYield10), note: "TIPS" },
          { label: "10Y Breakeven",    val: fv(r.breakeven10), note: "Inflation" },
          { label: "Nom–Real Spread",  val: r.t10y != null && r.realYield10 != null
              ? fv(r.t10y - r.realYield10) + " nom premium" : "N/A", note: "" },
        ],
        credit: [
          { label: "IG OAS",         val: bps(r.igOas),    note: "Inv. Grade" },
          { label: "HY OAS",         val: bps(r.hyOas),    note: "High Yield" },
          { label: "TED Spread",     val: bps(r.tedSpread), note: "Credit stress" },
          { label: "IG ETF (LQD)",   val: d.bonds?.lqdPrice != null ? `$${d.bonds.lqdPrice.toFixed(2)}` : "N/A",
            chgPct: d.bonds?.lqdChg },
          { label: "HY ETF (HYG)",   val: d.bonds?.hygPrice != null ? `$${d.bonds.hygPrice.toFixed(2)}` : "N/A",
            chgPct: d.bonds?.hygChg },
          { label: "20Y+ Bond (TLT)", val: d.bonds?.tltPrice != null ? `$${d.bonds.tltPrice.toFixed(2)}` : "N/A",
            chgPct: d.bonds?.tltChg },
        ],
      });
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  const cc = v => v == null ? C.muted : v > 0 ? C.green : v < 0 ? C.red : C.text;
  const sc = v => v == null ? C.muted : parseFloat(v) < 0 ? C.green : C.red; // spread: neg = inverted (red)

  const MiniRow = ({ label, val, chgPct, note, highlight, spread, isSpread }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <Mono color={highlight ? C.white : C.text} size={11} weight={highlight ? 600 : 400}>{label}</Mono>
        {note && <Mono color={C.muted} size={8}>{note}</Mono>}
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        {chgPct != null && <Mono color={cc(chgPct)} size={9}>{chgPct > 0 ? "+" : ""}{chgPct?.toFixed(2)}%</Mono>}
        <Mono color={isSpread ? sc(spread) : C.cyan} size={11} weight={600}>{val}</Mono>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div>
          <Mono color={C.textDim} size={10} spacing={1}>GLOBAL MACRO DASHBOARD</Mono>
          {data?.timestamp && <Mono color={C.muted} size={8} style={{marginLeft:10}}>AS OF {new Date(data.timestamp).toLocaleTimeString()}</Mono>}
          {data && !data.fredAvailable && <span style={{ marginLeft:10, background:"rgba(255,165,0,0.15)", border:"1px solid rgba(255,165,0,0.3)", borderRadius:3, padding:"1px 6px" }}><Mono color={C.amber} size={8}>FRED KEY MISSING — RATE DATA LIMITED</Mono></span>}
        </div>
        <Btn onClick={load} disabled={loading} variant="outline" color={C.amber}>{loading?"LOADING...":"↺ REFRESH"}</Btn>
      </div>

      {loading && <Loader msg="FETCHING GLOBAL MARKET DATA" />}

      {data && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* Row 1: Equities + Rates */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <PanelBox title="EQUITY INDICES / VOL">
              {(data.indices||[]).map(idx => (
                <div key={idx.sym} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div><Mono color={C.text} size={11}>{idx.name}</Mono> <Mono color={C.muted} size={9}>{idx.sym}</Mono></div>
                  <div style={{ textAlign:"right" }}>
                    <Mono color={C.white} size={12} weight={600}>{idx.value?.toLocaleString("en",{maximumFractionDigits:2})}</Mono>
                    <Mono color={cc(idx.changePct)} size={10} style={{marginLeft:10}}>{idx.changePct != null ? `${idx.changePct>0?"+":""}${idx.changePct?.toFixed(2)}%` : "--"}</Mono>
                  </div>
                </div>
              ))}
            </PanelBox>

            <PanelBox title="US TREASURY CURVE">
              {(data.rates||[]).map(r => (
                <MiniRow key={r.label} label={r.label} val={r.val} highlight={r.highlight}
                  isSpread={r.label.includes("Spread")} spread={r.spread} />
              ))}
            </PanelBox>
          </div>

          {/* Row 2: Real Yields + Credit */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <PanelBox title="REAL YIELDS & INFLATION EXPECTATIONS">
              {(data.realRates||[]).map(r => (
                <MiniRow key={r.label} label={r.label} val={r.val} note={r.note} />
              ))}
              <div style={{ marginTop:8, padding:"6px 0", borderTop:`1px solid ${C.border}` }}>
                <Mono color={C.muted} size={9}>10Y Real Yield = 10Y Nominal − 10Y Breakeven.</Mono>
                <Mono color={C.muted} size={9} style={{display:"block",marginTop:3}}>Negative real yield → gold/risk assets supported.</Mono>
              </div>
            </PanelBox>

            <PanelBox title="CREDIT MARKETS">
              {(data.credit||[]).map(r => (
                <div key={r.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div>
                    <Mono color={C.text} size={11}>{r.label}</Mono>
                    {r.note && <Mono color={C.muted} size={8} style={{marginLeft:8}}>{r.note}</Mono>}
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    {r.chgPct != null && <Mono color={cc(r.chgPct)} size={9}>{r.chgPct > 0 ? "+" : ""}{r.chgPct?.toFixed(2)}%</Mono>}
                    <Mono color={C.cyan} size={11} weight={600}>{r.val}</Mono>
                  </div>
                </div>
              ))}
            </PanelBox>
          </div>

          {/* Row 3: Commodities + FX */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <PanelBox title="COMMODITIES">
              {(data.commodities||[]).map(c => (
                <div key={c.name} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <Mono color={C.text} size={11}>{c.name}</Mono>
                  <div>
                    <Mono color={C.white} size={11} weight={600}>{c.price != null ? `$${c.price.toFixed(2)}` : "--"}</Mono>
                    <Mono color={cc(c.changePct)} size={10} style={{marginLeft:10}}>{c.changePct != null ? `${c.changePct>0?"+":""}${c.changePct?.toFixed(2)}%` : "--"}</Mono>
                  </div>
                </div>
              ))}
            </PanelBox>

            <PanelBox title="FX / DOLLAR">
              {(data.fx||[]).map(f => (
                <div key={f.pair} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <Mono color={C.text} size={11}>{f.pair}</Mono>
                  <div>
                    <Mono color={C.white} size={11} weight={600}>{f.rate != null ? f.rate.toFixed(f.pair.includes("JPY")||f.pair.includes("KRW")?2:4) : "--"}</Mono>
                    <Mono color={cc(f.changePct)} size={10} style={{marginLeft:10}}>{f.changePct != null ? `${f.changePct>0?"+":""}${f.changePct?.toFixed(2)}%` : "--"}</Mono>
                  </div>
                </div>
              ))}
            </PanelBox>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F5: LEARN — FINANCE ACADEMY ─────────────────────────────────────────────
// Curriculum data — the full topic library
// ─── STATIC PRE-AUTHORED LECTURES — load instantly, no API required ──────────
const STATIC_LECTURES = {
  "Options Greeks: Delta, Gamma, Vega, Theta \u2014 Mechanics Not Definitions": {"title": "Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions", "subtitle": "The greeks are not risk metrics — they are the partial derivatives of a pricing function. Understanding what they measure geometrically changes how you hedge.", "level": "ADVANCED", "readTime": "12 min", "sections": [{"type": "concept", "title": "WHAT THE GREEKS ACTUALLY MEASURE", "content": "Each greek is a partial derivative of the option price function C(S, t, σ, r, K). Delta = ∂C/∂S: how much the option price moves per $1 move in the underlying, holding everything else constant. Gamma = ∂²C/∂S² = ∂Δ/∂S: the rate of change of delta itself — the curvature of the P&L profile. Vega = ∂C/∂σ: sensitivity to implied volatility (not realized vol — this distinction matters enormously). Theta = ∂C/∂t: time decay, almost always negative for long options.\n\nThe critical insight most people miss: these are instantaneous, local sensitivities. A delta of 0.50 does not mean 'the option has a 50% chance of expiring ITM' in any actionable hedging sense — it means that for an infinitesimally small move in S right now, the option moves 0.50. For a $5 move, you need to integrate over gamma. For a gap open, all greeks reprice simultaneously."}, {"type": "formula", "title": "THE GEOMETRY OF GAMMA AND THE P&L IDENTITY", "content": "The trader's P&L identity is the most important formula for options desks:\n\ndP&L = Delta × ΔS + ½ × Gamma × ΔS² − Theta × Δt\n\nFor a delta-hedged position (Delta = 0), this simplifies to:\n\ndP&L = ½ × Gamma × ΔS² − Theta × Δt\n\nThis is the fundamental options trade-off: you are long gamma (convexity) and short theta (time decay), or vice versa. Long gamma positions make money when realized volatility exceeds the implied vol you paid for. Short gamma positions collect theta but bleed when the underlying moves.\n\nThe break-even realized vol for a delta-hedged long option: σ_realized must exceed σ_implied to generate positive P&L. The daily break-even move is approximately S × σ_implied × √(1/252). For a $100 stock with 25% IV: $100 × 0.25 × 0.063 = $1.57/day. If the stock moves more than $1.57/day on average, long gamma wins."}, {"type": "example", "title": "SVIX IMPLOSION: FEBRUARY 5, 2018", "content": "The XIV (inverse VIX ETP) implosion is the canonical short-gamma blowup. XIV was effectively short VIX futures — short gamma on volatility itself. On Feb 5 2018, the VIX spiked from ~17 to ~37 intraday, a 118% move. XIV lost 96% of its value and was terminated.\n\nThe mechanics: XIV's delta (sensitivity to VIX moves) was approximately -1.0 at normal vol levels. But as VIX rose, the gamma of the instrument became severe. The fund's daily rebalancing mechanism — selling VIX futures to maintain constant -1x exposure — created a feedback loop: as vol rose, they sold more futures, which pushed VIX higher, which forced more selling.\n\nThe lesson: short gamma positions appear to have Sharpe ratios near 2.0 during calm periods (theta collection). The risk is that gamma losses are convex — they accelerate. A 3-sigma event does not lose 3x a 1-sigma event; it loses 9x (gamma ∝ ΔS²)."}, {"type": "institutional", "title": "HOW A DERIVATIVES DESK MANAGES GREEKS LIVE", "content": "An equity derivatives desk runs a greek ladder — a dashboard showing net Delta, Gamma, Vega, and Theta by underlying, by expiry, and in aggregate. The goal is not to zero out every greek but to keep each within risk limits while generating edge.\n\nDelta is hedged dynamically: typically at end of day for vanilla books, intraday for exotic books. Each hedge resets the delta to near-zero but crystallizes the gamma P&L from that period.\n\nVega is managed by expiry bucket — a long vega position in 1-month options is not offset by short vega in 6-month options because the vol surface can steepen or flatten.\n\nGamma and theta are inseparable. A desk long $50K gamma is also short approximately $50K theta per day. If they cannot make $50K/day from delta hedging the intraday moves, they are bleeding."}, {"type": "pitfalls", "title": "WHERE THE GREEKS MISLEAD YOU", "content": "1. Delta is not probability. N(d2) in Black-Scholes is the risk-neutral probability of expiring ITM. Delta is N(d1), which is higher. The difference grows with vol and time. A 0.50 delta call is not a coin flip.\n\n2. Vega is quoted in wrong units. Standard vega is P&L per 1 percentage point move in IV. But vol moves proportionally — a move from 20% to 21% is not the same economic event as 80% to 81%. Dealers think in log-vega for this reason.\n\n3. Gamma is path-independent but hedging is not. A stock that gaps $5 generates ½ × Gamma × 25 in one step. A stock that moves $1 five times lets you re-hedge between moves, capturing much less. Discrete hedging frequency is a real risk that BSM does not capture."}, {"type": "advanced", "title": "VANNA AND VOLGA: THE SECOND-ORDER VOL GREEKS", "content": "Beyond the standard greeks, vol surface traders manage Vanna (∂Delta/∂σ = ∂Vega/∂S) and Volga (∂²C/∂σ²). These matter enormously for barrier options, digitals, and anything with vol-of-vol exposure.\n\nVanna is the sensitivity of delta to changes in IV. When vol rises, the delta of an OTM option increases — meaning a long vanna position gains delta as the market sells off. This is why long OTM puts are better hedges than their delta suggests: you get longer delta precisely when you need it.\n\nVolga (also called Vomma) is the curvature of value with respect to vol. OTM options are long volga; ATM options have near-zero volga. This is why option sellers concentrate in OTM options: they appear cheap but contain significant volga risk that BSM does not price correctly."}], "keyTakeaways": ["Greeks are instantaneous partial derivatives — for finite moves, you must account for gamma (curvature) not just delta (slope).", "The core delta-hedged P&L identity is: ½ × Gamma × ΔS² − Theta × Δt. Long gamma wins when realized vol exceeds implied vol.", "Short gamma strategies show excellent Sharpe ratios until they do not — losses are convex (∝ ΔS²), meaning tail events are catastrophic.", "Vanna and Volga are the second-order greeks that explain why OTM options behave differently than BSM predicts."], "relatedTopics": ["Volatility Surface: Skew, Term Structure & What It Tells You", "Delta Hedging: The Dynamic Replication Argument", "Black-Scholes: Derivation, Assumptions & Where It Breaks"], "prereqs": ["Basic options payoff diagrams", "Partial derivatives / calculus fundamentals"]},
  "Delta Hedging: The Dynamic Replication Argument": {"title": "Delta Hedging: The Dynamic Replication Argument", "subtitle": "Delta hedging is not risk elimination — it's the continuous replication of an option's payoff using the underlying. The P&L of doing so is where all the edge lives.", "level": "ADVANCED", "readTime": "10 min", "sections": [{"type": "concept", "title": "THE REPLICATION ARGUMENT", "content": "Black-Scholes prices options by showing you can replicate the payoff exactly using a continuously rebalanced portfolio of the underlying and a risk-free bond. This is the arbitrage argument: if you can replicate, the price must equal the replication cost, or arbitrage exists.\n\nFor a call option C on stock S: at any moment, hold Δ = N(d1) shares of S and borrow B = Ke^(-rT)N(d2) at the risk-free rate. As S moves, Δ changes, so you continuously rebalance. The cost of running this replication strategy over the option's life equals the Black-Scholes price. This is why BSM is a no-arbitrage price, not a supply/demand price.\n\nThe critical implication: when a dealer sells you an option, they hedge by replicating it. Their P&L comes not from the option but from the difference between the IV they sold (which determines what they charged) and the realized vol over the option's life (which determines what the hedge actually costs)."}, {"type": "formula", "title": "DISCRETE HEDGING P&L AND HEDGING ERROR", "content": "In continuous time, delta hedging is perfect. In practice, you hedge at discrete intervals. The hedging error per rebalancing period is:\n\nHedging Error ≈ ½ × Gamma × (ΔS_actual² − σ_implied² × S² × Δt)\n\nThis is the realized vs. implied vol comparison in dollar terms.\n\nOver the full life of the option, cumulative P&L for a delta-hedged short option position:\n\nP&L = ∫₀ᵀ ½ × Gamma(t) × S(t)² × (σ_realized(t)² − σ_implied²) dt\n\nThis integral is path-dependent: even if average realized vol equals implied vol, you can lose money if the realized vol is high when gamma is large (near ATM, near expiry) and low when gamma is small. This is the vol timing risk that simple vol comparisons miss."}, {"type": "example", "title": "THE SPX DEALER HEDGING LOOP IN MARCH 2020", "content": "During the COVID crash (Feb 24 — March 23, 2020), the SPX fell ~34% in 23 trading days with realized vol hitting 80%+. Dealers who had sold puts (short gamma) faced a brutal hedging dynamic.\n\nAs SPX fell, put deltas increased in absolute value — from say -0.20 to -0.60 to -0.90. Dealers had to sell increasing amounts of SPX futures to maintain delta neutrality. Each leg down required more selling, which amplified the move.\n\nOn March 16, SPX fell 12% intraday. Dealers with short gamma at strikes near 3000, 2800, 2600 were simultaneously hitting high-gamma zones as the market crashed through each level. The cost of hedging that day for a $100M short gamma book: approximately $3-5M in slippage alone, just from buying back delta."}, {"type": "institutional", "title": "HOW DEALERS DECIDE HEDGING FREQUENCY", "content": "Dealers set delta-band triggers: re-hedge when delta drifts by more than X% rather than hedging on a fixed schedule. X is set by the cost of hedging (bid-ask spread × size) vs. the gamma risk of waiting.\n\nFor liquid large-cap single stocks, bands might be ±2-3 delta. For index options (SPX, QQQ), hedging is nearly continuous because the spread is 1 cent and size is deep.\n\nExotics desks hedge more actively because path-dependency means gamma concentrations shift unpredictably. A knock-out barrier option can go from near-zero gamma to infinite gamma instantaneously as the barrier approaches — requiring real-time monitoring and pre-positioned hedges near barrier levels."}, {"type": "pitfalls", "title": "THE GAPS THAT KILL DELTA HEDGES", "content": "Delta hedging only works if the underlying moves continuously. Gap risk — overnight moves, earnings, macro events — cannot be delta-hedged. A stock that gaps 20% on earnings gives you no opportunity to rebalance; you absorb the full gamma loss in one step.\n\nThis is why earnings options are structurally expensive (high IV) even if post-earnings realized vol is low: the gap risk is real and cannot be arbitraged away by dynamic hedging.\n\nFor S&P index options, gap risk is lower but macro gaps exist. March 16, 2020 opened down ~8% after a weekend — every delta hedge set on Friday was wrong by Monday open. Delta hedging manages diffusion risk; it cannot manage jump risk."}, {"type": "advanced", "title": "STOCHASTIC VOL AND THE BREAKDOWN OF DELTA HEDGING", "content": "BSM assumes constant volatility — delta hedging works perfectly under this assumption. When vol is stochastic (Heston, SABR models), delta hedging fails to perfectly replicate because there is now a second source of randomness (vol itself) that the delta hedge does not cover.\n\nUnder stochastic vol, the correct hedge requires both a delta position in S AND a vega hedge (typically another option) to eliminate both risk sources. The minimum-variance hedge ratio for the stock differs from the BSM delta by a correction term proportional to the vol-of-vol and correlation between S and σ.\n\nThis is why sophisticated desks vega-hedge in addition to delta-hedging — they buy or sell options at different strikes/tenors to neutralize vega exposure, then delta-hedge the combined portfolio."}], "keyTakeaways": ["BSM is a replication cost argument — the option price equals the cost of continuously replicating its payoff using the underlying and the risk-free bond.", "Discrete hedging P&L per period = ½ × Gamma × (realized ΔS² − implied variance × Δt). Long gamma profits when realized vol exceeds implied.", "Gap risk is the fundamental limitation — delta hedging works for diffusive moves but cannot hedge discontinuous jumps or overnight gaps.", "Under stochastic volatility, delta hedging alone is insufficient; a vega hedge in another option is needed to span the full risk space."], "relatedTopics": ["Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions", "Volatility Surface: Skew, Term Structure & What It Tells You", "Black-Scholes: Derivation, Assumptions & Where It Breaks"], "prereqs": ["Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions"]},
  "Yield Curve: Construction, Shapes & Inversion as a Recession Signal": {"title": "Yield Curve: Construction, Shapes & Inversion as a Recession Signal", "subtitle": "The yield curve is simultaneously a pricing tool, a monetary policy signal, and the most watched recession indicator — and most people only understand one of those three functions.", "level": "INTERMEDIATE", "readTime": "10 min", "sections": [{"type": "concept", "title": "WHAT THE YIELD CURVE ACTUALLY IS", "content": "The yield curve is a snapshot of yields for default-equivalent instruments across maturities at a single point in time. The standard US Treasury curve plots on-the-run yields from 1M to 30Y. But there are many curves: the OIS curve (overnight index swap, nearly risk-free), the SOFR swap curve (successor to LIBOR swaps), the corporate credit curve (spread over Treasuries), and the real yield curve (TIPS).\n\nThe yield curve is not a single object — it is the projection of a complex multi-factor system onto one dimension (maturity). The dominant factors are: Level (parallel shifts — driven by long-term inflation expectations), Slope (short rates vs. long rates — driven by monetary policy vs. growth expectations), and Curvature (belly vs. wings — driven by supply/demand for specific maturities and convexity demand).\n\nThese three factors explain ~99% of yield curve moves, which is why rates desks express views as level, slope, and curvature trades rather than bets on individual maturity yields."}, {"type": "formula", "title": "THE EXPECTATIONS HYPOTHESIS AND ITS FAILURES", "content": "The pure expectations hypothesis says the 10Y yield equals the expected path of rolling 1Y yields for the next 10 years:\n\n(1 + y₁₀)¹⁰ = (1 + E[r₁])(1 + E[r₂])...(1 + E[r₁₀])\n\nIn log terms: y₁₀ ≈ (1/10) × Σ E[rₜ]\n\nThe term premium is the deviation from this: y₁₀ = average expected short rate + term premium. Term premium compensates investors for duration risk — the risk that rates move against you over 10 years.\n\nThe NY Fed ACM model estimates term premium daily. As of 2025, the 10Y term premium was approximately 40-60bps — meaning 40-60bps of the 10Y yield reflects compensation for duration risk, not expected short rates. When term premium was negative (2015-2022), investors were paying for duration, not being compensated for it."}, {"type": "example", "title": "THE 2022-2023 INVERSION: ANATOMY OF A POLICY SHOCK", "content": "The 2-10 spread (10Y minus 2Y Treasury yield) inverted in March 2022 for the first time since 2019, and reached -109bps in March 2023 — the deepest inversion since 1981.\n\nThe Fed began hiking in March 2022 at the zero lower bound with inflation at 8%. Short rates (2Y) repriced aggressively to reflect the expected path of Fed funds — rising from 0.25% to ~5.0% by mid-2023. Long rates (10Y) rose much less — from ~1.5% to ~4.0% — because the market expected the hiking cycle to eventually reduce inflation and require cuts.\n\nThe inversion said: current short rates are unsustainably high. The market priced ~250bps of cuts over 2024-2025 embedded in the forward curve. The inversion persisted for 26 months — the longest since the early 1980s."}, {"type": "institutional", "title": "CURVE TRADES: HOW RATES DESKS POSITION", "content": "Rates desks trade the curve through three primary structures:\n\n1. Steepeners/Flatteners: Long 2Y + short 10Y (flattener, profits from curve flattening) or the reverse. These are executed as DV01-neutral trades — you size the positions so a 1bp parallel shift has zero P&L, isolating the slope view.\n\n2. Butterfly: Long the belly (5Y), short the wings (2Y and 10Y). Profits if the curve humps up. The reverse — short belly, long wings — is a barbell, which outperforms in high-vol regimes due to convexity.\n\n3. Forward rate bets: Using forward rates (e.g., the 5Y5Y forward — the 5Y rate 5 years from now) to express views on future curve shape without taking on near-term duration risk.\n\nAll curve trades are expressed in DV01 (dollar value of 1bp) to normalize across maturities."}, {"type": "pitfalls", "title": "WHY CURVE INVERSION IS A LAGGED INDICATOR", "content": "Every inversion since 1955 has preceded a recession — but the lag is 12-24 months, and the recession begins after the curve re-steepens, not while it is inverted. The bull steepening (Fed cuts, short rates fall faster than long rates) that follows inversion is historically the danger zone.\n\nThe other pitfall: not all curves are equal. The 2-10 spread is the media's favorite, but the 3M-10Y spread has a better forecasting record (Estrella-Mishkin, 1998). The near-term forward spread — 6-quarter forward rate minus current 3M yield — was the Fed's preferred indicator as of their 2018 research.\n\nHistorically, arguing 'this time is different' on curve inversion has been wrong in every prior instance."}, {"type": "advanced", "title": "CONVEXITY AND WHY LONG BONDS ARE NOT LINEARLY RISKY", "content": "Duration gives the linear approximation of price sensitivity to yield changes. But bond prices are convex in yields — the actual price change is always better than duration predicts. Convexity is ∂²P/∂y², analogous to gamma in options.\n\nFor a 30Y Treasury, convexity is very high — if yields fall 100bps, the price rises more than duration × 1% suggests. If yields rise 100bps, the price falls less than feared. Long convexity is always valuable but priced in — investors accept lower yields on long-duration bonds partially as compensation for this convexity benefit.\n\nThe negative convexity of mortgage-backed securities (MBS) is the flip side: when rates fall, homeowners prepay (caps the upside); when rates rise, they do not (extends the duration). This is why MBS investors demand a spread over Treasuries — they are selling convexity."}], "keyTakeaways": ["The yield curve is driven by three factors: level (inflation expectations), slope (monetary policy vs. growth), and curvature — these explain ~99% of moves.", "The 10Y yield = average expected short rates + term premium. Negative term premium means investors are paying for safety, not being compensated for duration risk.", "Curve inversions have preceded every recession since 1955, but with 12-24 month lags — and the recession starts when the curve re-steepens, not during inversion.", "Long bonds have positive convexity (price falls less than duration predicts when yields rise); MBS have negative convexity (prepayment risk caps upside when rates fall)."], "relatedTopics": ["Bond Math: Duration, Convexity & Why They Matter in a Rising Rate Regime", "Fed Policy Transmission: How Rate Changes Propagate Through Markets", "Interest Rate Swaps: Pricing, Risk & the OIS Discount Framework"], "prereqs": ["Bond Math: Duration, Convexity & Why They Matter in a Rising Rate Regime"]},
  "Interest Rate Swaps: Pricing, Risk & the OIS Discount Framework": {"title": "Interest Rate Swaps: Pricing, Risk & the OIS Discount Framework", "subtitle": "Swaps are the largest derivatives market by notional — $500+ trillion. Understanding how they are priced and risk-managed is foundational to rates, credit, and structured products.", "level": "ADVANCED", "readTime": "12 min", "sections": [{"type": "concept", "title": "WHAT A SWAP IS AND WHY IT EXISTS", "content": "A vanilla interest rate swap is a bilateral agreement to exchange fixed cash flows for floating cash flows on a notional principal. No principal changes hands. The fixed rate (the swap rate) is set at inception so the swap has zero initial value — it is a fair exchange of future cash flows at current market rates.\n\nWhy do they exist? Liability-asset mismatches. A bank with floating-rate deposits funding fixed-rate mortgages is short duration — it pays fixed (mortgages) but receives floating (deposits). It pays fixed / receives floating on a swap to hedge. A corporate with floating-rate debt that wants cost certainty pays fixed / receives floating.\n\nThe swap market dwarfs all others: $500T+ notional outstanding (BIS data). What matters is DV01 (dollar value of a 1bp move in rates), which is where actual risk is measured."}, {"type": "formula", "title": "SWAP PRICING AND THE FIXED RATE DERIVATION", "content": "The fixed rate on a par swap is set so the swap NPV = 0 at inception:\n\nNPV = PV(fixed leg) − PV(floating leg) = 0\n\nThe floating leg PV equals par (by the floating rate bond argument): a bond paying SOFR resets to par on each reset date.\n\nThe fixed leg PV = C × Σ df(tᵢ) × δᵢ where C is the fixed coupon, df(tᵢ) is the discount factor to payment date i, and δᵢ is the day count fraction.\n\nSetting NPV = 0:\nC = (1 − df(T)) / Σ df(tᵢ) × δᵢ\n\nThis is the par swap rate — essentially the weighted average of forward rates. After the LIBOR-SOFR transition, both the projection curve (forward SOFR rates) and the discount curve (OIS/SOFR) are the same curve — single-curve pricing, much simpler than the pre-crisis dual-curve world."}, {"type": "example", "title": "RATES SPIKE 2022: SWAP BOOK P&L ATTRIBUTION", "content": "In 2022, the US 10Y swap rate moved from ~1.5% to ~4.0% — a 250bp parallel shift. For a dealer running a $1B DV01 10Y swap book (receive-fixed), this was a catastrophic loss.\n\nDV01 of a 10Y swap at 1.5% ≈ $90,000 per $1M notional. A $1B DV01 book implies notional of ~$11B. A 250bp move × $1B DV01 = $250M loss — just from the parallel shift.\n\nThis is exactly what happened to Silicon Valley Bank. SVB had invested deposit inflows into long-duration bonds and swaps effectively receiving fixed — owned long-duration fixed income funded by short-term floating deposits. As rates rose 500bps, their HTM portfolio showed $15B in unrealized losses. When forced to sell to meet deposit withdrawals, they crystallized the losses and triggered a bank run."}, {"type": "institutional", "title": "HOW DEALERS RISK-MANAGE SWAP BOOKS", "content": "Swap desks think in DV01 by bucket: 2Y, 5Y, 10Y, 30Y. The net DV01 in each bucket must stay within risk limits.\n\nXVA (valuation adjustments) have become central to swap pricing post-2008: CVA (credit valuation adjustment — counterparty default risk), DVA (your own default risk), FVA (funding valuation adjustment — cost of posting/receiving collateral). A 10Y swap with a BBB counterparty has a meaningful CVA add-on. Dealers price this in, making their quoted swap rate slightly different from the mid-market par rate.\n\nThe swap book's greeks mirror options: DV01 is like delta. Convexity (how DV01 changes as rates move) is like gamma — long convexity means you get longer duration as rates fall and shorter as rates rise."}, {"type": "pitfalls", "title": "DURATION MISMATCH AND THE HTM ACCOUNTING TRAP", "content": "The SVB example illustrates the most common institutional trap: using accounting elections (HTM designation) to hide economic losses. HTM bonds do not show mark-to-market losses on the balance sheet — but the economic loss is real. When you are forced to sell, the loss crystallizes.\n\nThe deeper error: duration matching should be done at the economic level, not the accounting level. A bank that immunizes its income statement through HTM accounting has not immunized its capital. Rising rates reduce the economic value of long-duration assets regardless of accounting treatment.\n\nFor swap books specifically: uncollateralized swaps embed credit risk that makes duration longer in falling rate environments. This is why the XVA desk's CVA can correlate with the rates desk's DV01 risk — a correlation that traditional risk systems miss."}, {"type": "advanced", "title": "SOFR TRANSITION AND THE TERM RATE PROBLEM", "content": "The LIBOR-to-SOFR transition completed in June 2023 for USD. SOFR is overnight, backward-looking, and nearly risk-free. LIBOR was term (1M, 3M) and embedded bank credit risk.\n\nSOFR compound rates work for derivatives but are problematic for loans — borrowers need to know their interest payment before it is due. This created Term SOFR (published by CME), which uses SOFR futures to derive a forward-looking term rate. But Term SOFR is only approved for limited use — loans and certain derivatives — not for interdealer swaps.\n\nThe spread adjustment of +26.16bps (for 3M USD) was locked in at transition — a fixed historical spread that may not reflect current economic conditions. For structured products referencing LIBOR that transitioned to SOFR, this creates a mismatch between the contractual spread and the current LIBOR-SOFR basis."}], "keyTakeaways": ["The par swap rate is set so NPV = 0 at inception: C = (1 − df(T)) / Σ df(tᵢ)δᵢ — a weighted average of forward rates discounted by the SOFR curve.", "Post-SOFR transition, projection and discount curves are the same (single-curve world), simplifying pricing but creating basis issues between compounded SOFR and Term SOFR.", "SVB illustrates the HTM accounting trap: hiding economic duration losses through accounting designation does not eliminate the capital risk when forced selling occurs.", "XVA adjustments (CVA, DVA, FVA) make real swap prices differ from mid-market par rates — understanding these is required for accurate derivatives pricing."], "relatedTopics": ["Bootstrapping a Discount Curve from Swap Market Data", "Yield Curve: Construction, Shapes & Inversion as a Recession Signal", "Credit Default Swaps: Mechanics, Basis & CDS-Bond Basis Trades"], "prereqs": ["Bond Math: Duration, Convexity & Why They Matter in a Rising Rate Regime", "Yield Curve: Construction, Shapes & Inversion as a Recession Signal"]},
  "Oil Markets: WTI vs Brent, Futures Curve Structure & Geopolitical Premium": {"title": "Oil Markets: WTI vs Brent, Futures Curve Structure & Geopolitical Premium", "subtitle": "Oil is simultaneously a commodity, a financial instrument, a geopolitical weapon, and a macro indicator. Each framework gives different information — you need all four.", "level": "INTERMEDIATE", "readTime": "10 min", "sections": [{"type": "concept", "title": "WTI VS BRENT: THE GRADE SPREAD", "content": "West Texas Intermediate (WTI) and Brent Crude are both light, sweet crudes but trade in different markets with different physical delivery infrastructure. WTI is landlocked — deliverable at Cushing, Oklahoma, a pipeline hub. Brent is delivered into the North Sea and serves as the global seaborne crude benchmark; ~80% of global crude trades are priced against Brent.\n\nThe WTI-Brent spread (normally $2-4 WTI discount) widens when US crude storage at Cushing is full and tightens when US export infrastructure expands. The 2011-2014 period saw WTI trade at a $20-25 discount to Brent as the US shale boom filled Cushing faster than pipelines could move crude to Gulf Coast refineries.\n\nFor traders: the WTI-Brent spread is a proxy for US production surplus and export infrastructure constraints. Narrowing spread = US crude reaching global markets. Widening spread = domestic glut."}, {"type": "formula", "title": "FUTURES CURVE: CONTANGO, BACKWARDATION & COST OF CARRY", "content": "The futures curve for oil is defined by:\n\nF(t, T) = S(t) × e^((r + s − c)(T−t))\n\nWhere r = risk-free rate, s = storage cost, c = convenience yield.\n\nContango: F(T) > F(t) — future prices higher than spot. Implies storage costs + financing exceed convenience yield. Occurs in oversupply.\n\nBackwardation: F(T) < F(t) — spot price exceeds futures. Implies high convenience yield — having physical oil now is worth a premium because supply is tight.\n\nThe curve structure matters for commodity investors: a fund long WTI futures in contango pays a roll cost every month — selling the expiring cheap near-term contract and buying the more expensive deferred contract. In steep contango (like April 2020 when WTI traded negative), this roll cost destroyed returns even if spot prices stayed flat."}, {"type": "example", "title": "APRIL 20, 2020: WTI GOES NEGATIVE", "content": "On April 20, 2020, WTI May futures settled at -$37.63/barrel — the first negative oil price in history. The mechanics were pure logistics, not economics.\n\nCOVID demand collapse had filled US storage to 85% capacity. The May futures contract was physically deliverable at Cushing on April 21. Holders of the paper contract who could not take physical delivery had to sell at any price — including negative — because accepting physical delivery of oil they had no storage for would cost them even more.\n\nThe June contract traded at +$20 simultaneously — a $57 contango spread. The USO oil ETF, which had to roll from May to June, was destroyed: forced to sell May at negative prices and buy June at $20. This event permanently changed how commodity ETFs structure their rolls."}, {"type": "institutional", "title": "HOW ENERGY TRADERS READ THE CURVE", "content": "An energy trading desk watches the entire futures curve — not just spot price. The 1-12 month spread tells you about near-term physical supply. The 12-36 month spread tells you about medium-term production economics.\n\nThe producer hedge dynamic: US shale producers lock in prices by selling forward. When the futures curve is in backwardation and spot prices are high, producers cannot get high prices for future production. When contango prevails, producers can sell forward at attractive prices, encouraging production growth.\n\nFor macro traders, the 5Y5Y crude forward is a cleaner read on long-run supply/demand than spot. It reflects long-run equilibrium cost of production (~$55-65 for US shale, ~$40-50 for Middle East conventional). When 5Y forward is above these break-evens, capex rises."}, {"type": "pitfalls", "title": "THE GEOPOLITICAL PREMIUM PROBLEM", "content": "Every Middle East tension event adds a geopolitical premium to oil prices — typically $3-10/barrel for a moderate event, $10-20+ for genuine supply disruption risk. The problem: this premium decays quickly if no actual supply disruption occurs.\n\nSaudi Aramco Abqaiq attack (September 2019) — WTI spiked 15% on the open Monday, then gave back 2/3 of the move within 2 weeks as Saudi production was restored within days.\n\nFor a geopolitical portfolio: XOM, FRO, and GLD all embed geopolitical premiums. The risk is asymmetric — if the risk premium deflates through diplomatic resolution, these positions give back the premium simultaneously. The hedge is that actual supply disruption (Hormuz closure) would be catastrophic — but the expected value of that outcome is much lower than the tail probability suggests."}, {"type": "advanced", "title": "TANKER MARKETS: THE TON-MILE DEMAND METRIC", "content": "Tanker rates (and FRO specifically) are driven by ton-mile demand — the product of volume moved × distance traveled. Sanctions and supply disruptions can be incredibly bullish for tankers even when they are bearish for oil producers.\n\nRussia-Ukraine (2022): Russian crude was rerouted from Baltic ports (3-5 day voyage to Europe) to Indian refineries (20-25 day voyage). Same barrels moved — but 5-6x the ton-miles. VLCC rates went from ~$10,000/day to $100,000+/day within months.\n\nFor FRO: the bull case is not oil price — it is distance × volume. An Iran conflict that disrupts regional supply but redirects flows is a complex scenario for ton-miles. Hormuz closure is the tail scenario that would send VLCC rates to extreme levels briefly before demand destruction kicks in."}], "keyTakeaways": ["WTI-Brent spread reflects US production surplus and export infrastructure — a widening spread signals landlocked domestic glut, not global oversupply.", "Contango = storage opportunity (oversupply); backwardation = physical tightness. Roll costs in contango markets destroy commodity ETF returns even with flat spot prices.", "Geopolitical premiums decay rapidly if supply disruptions do not materialize — the Abqaiq attack premium evaporated in 2 weeks after Saudi production was restored.", "Tanker rates are driven by ton-miles (volume × distance), not oil price — sanctions rerouting can be massively bullish for tanker operators even in bearish oil environments."], "relatedTopics": ["Tanker Markets: VLCC Rate Dynamics, Ton-Mile Demand & Sanctions Arbitrage", "Gold as a Macro Asset: Real Rates, Dollar Correlation & Safe Haven Flows", "Strait of Hormuz Risk: Energy Chokepoints & Historical Market Impact"], "prereqs": []},
  "Volatility Surface: Skew, Term Structure & What It Tells You": {"title": "Volatility Surface: Skew, Term Structure & What It Tells You", "subtitle": "The vol surface is the market's real-time probability distribution for future returns. Learning to read it is like reading the aggregate positioning of every options participant simultaneously.", "level": "ADVANCED", "readTime": "11 min", "sections": [{"type": "concept", "title": "THE SURFACE AND WHAT IT IS", "content": "Black-Scholes implies a single constant volatility for all strikes and expirations. The market disagrees — every strike and expiry has its own implied vol (IV), and the map of IV across strike × expiry is the volatility surface.\n\nThe surface has two dimensions: the strike dimension (skew or smile) and the time dimension (term structure). At any given expiry, the IV varies by strike — this is the smile or skew. Across time, the IV at ATM varies — this is the term structure.\n\nThe surface is the market's revealed probability distribution. A steep negative skew (puts more expensive than calls) says the market assigns higher probability to large downside moves than upside moves of equal magnitude. This is inconsistent with the lognormal distribution BSM assumes — and the market is right, BSM is wrong."}, {"type": "formula", "title": "MEASURING SKEW: THE 25-DELTA RR AND BUTTERFLY", "content": "Dealers quote vol surface in terms of ATM vol, Risk Reversal (RR), and Butterfly (BF).\n\nRisk Reversal (25Δ RR) = IV(25Δ call) − IV(25Δ put)\nPositive RR: calls more expensive than puts (rare for equities, common for some FX pairs)\nNegative RR: puts more expensive than calls (standard for equity indices — negative skew)\n\nButterfly (25Δ BF) = [IV(25Δ call) + IV(25Δ put)]/2 − IV(ATM)\nPositive butterfly: OTM options more expensive than ATM on average — fat tails priced in\n\nFor SPX as of 2024: 1-month ATM IV ~15-18%, 25Δ RR ~ -4 to -7 vols (puts 4-7 vols richer than calls), 25Δ BF ~1-2 vols. The negative RR of -5 means the market prices in meaningful left-tail risk — crash protection is expensive relative to upside participation."}, {"type": "example", "title": "0DTE OPTIONS AND THE CHANGING SKEW REGIME", "content": "The explosion of 0DTE (zero days to expiry) SPX options — now 40-50% of total SPX options volume — has structurally changed the intraday vol surface.\n\nPre-2022: the 1-month vol surface dominated price discovery; intraday moves in IV were smooth. Post-2022: with $1T+ of notional in 0DTE options expiring daily, dealer gamma exposure at specific strikes became enormous by end-of-day. When SPX approached a gamma wall (a strike with massive open interest), realized vol would compress as dealers' delta hedging created a gravitational pull toward that strike.\n\nThe skew in 0DTE options is extreme — puts can be 20-30 vols richer than calls in the final hours, because downside moves in the last hour of trading are genuinely catastrophic for short put holders."}, {"type": "institutional", "title": "HOW DEALERS USE THE SURFACE", "content": "Dealers mark their books using the vol surface, not a single BSM vol. Every position's mark-to-market P&L depends on where the surface moves, not just where spot moves.\n\nVol surface risk is decomposed into: ATM vega (sensitivity to parallel surface shifts), skew risk (sensitivity to RR moves), term structure risk (sensitivity to changes in the near-vs-far vol spread), and vol-of-vol (sensitivity to changes in the butterfly).\n\nThe most common dealer trade: buy the vol surface in one maturity and sell it in another, expressing a view on term structure. If you think 1M vol will mean-revert faster than 6M vol, you sell 1M vol and buy 6M vol — a vol calendar spread. This is essentially long vega in the back, short vega in the front, monetizing term structure expectations."}, {"type": "pitfalls", "title": "USING IV AS A FORECAST", "content": "IV is not a forecast of realized vol — it is the market-clearing price for variance exposure, which includes a variance risk premium (VRP). Historically, 1-month SPX IV has been 3-4 volatility points higher than subsequent realized vol on average. This is the VRP — the premium investors pay for variance protection.\n\nThe VRP is why short vol strategies appear profitable in calm markets. But the distribution is severely left-skewed: you collect small premiums steadily and give them all back in a crisis. The VIX spike of March 2020 (from 15 to 85) in 30 days destroyed years of short-vol premium collection.\n\nThe second pitfall: comparing IV across names directly is meaningless without normalizing for term and skew. A 30% IV on a biotech and a 30% IV on SPX tell you completely different things about the market's distribution expectations."}, {"type": "advanced", "title": "LOCAL VOL VS STOCHASTIC VOL MODELS", "content": "Two major alternatives to BSM for modeling the vol surface:\n\nLocal Vol (Dupire, 1994): extracts a deterministic local vol function σ(S,t) from the market surface such that option prices are reproduced. Problem: local vol produces sticky strike behavior (the smile moves with spot), but real markets show sticky delta behavior. This makes local vol models misprice forward vol and exotic options.\n\nStochastic Vol (Heston, 1993): vol itself follows a mean-reverting diffusion process. Parameters: κ (mean reversion speed), θ (long-run vol), ξ (vol of vol), ρ (correlation between spot and vol). The negative ρ (≈ -0.7 for SPX) generates the negative skew naturally — when spot falls, vol rises. Heston prices the skew correctly but struggles with the term structure. SABR is another stochastic vol model designed for rates markets."}], "keyTakeaways": ["The vol surface maps IV across all strikes and expirations — it is the market's implied probability distribution, showing fat left tails that BSM's lognormal assumption misses.", "25Δ RR measures skew (put/call premium asymmetry); 25Δ BF measures convexity (OTM vs ATM premium). SPX negative RR reflects persistent demand for crash protection.", "IV is not a forecast — it embeds a variance risk premium of 3-4 vol points historically. Short vol looks like alpha until a crisis wipes out years of premium collection.", "Local vol models misprice exotics because they produce wrong forward vol dynamics; stochastic vol (Heston, SABR) better captures the joint behavior of spot and vol."], "relatedTopics": ["Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions", "Black-Scholes: Derivation, Assumptions & Where It Breaks", "Options Market Making: Inventory Risk, Delta Hedging & Edge"], "prereqs": ["Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions", "Delta Hedging: The Dynamic Replication Argument"]},
  "Trade Lifecycle: Execution to Settlement \u2014 Every Step and Where It Breaks": {"title": "Trade Lifecycle: Execution to Settlement — Every Step and Where It Breaks", "subtitle": "Most front-office professionals do not understand what happens between execution and settlement. That gap is where counterparty risk, operational losses, and regulatory exposure live.", "level": "INTERMEDIATE", "readTime": "10 min", "sections": [{"type": "concept", "title": "THE SEVEN STAGES OF A TRADE", "content": "A trade lifecycle has seven distinct stages, each with its own risks, systems, and failure modes:\n\n1. EXECUTION: Trade agreed between counterparties (price, size, settlement terms). For listed: exchange-matched. For OTC: bilateral negotiation or electronic venue.\n2. CAPTURE: Trade entered into the front-office system (blotter). Source of many errors — fat fingers, wrong CUSIP, wrong side.\n3. CONFIRMATION: Counterparty confirmation of economic terms. OTC trades: ISDA confirmation. Listed: exchange-provided confirm. Unconfirmed trades are a major operational risk.\n4. CLEARING: For cleared products, novation to the CCP. CCP becomes buyer to every seller, seller to every buyer. Initial margin (IM) and variation margin (VM) calls begin.\n5. SETTLEMENT: Exchange of cash and/or securities. Equities: T+1 (US, since May 2024). OTC derivatives: may be cash-settled at expiry or physically settled.\n6. RECONCILIATION: Comparing internal records vs. counterparty records vs. custodian records.\n7. REPORTING: Regulatory reporting (CFTC, ESMA, MAS) and internal P&L attribution."}, {"type": "formula", "title": "SETTLEMENT FAILS AND THEIR COST", "content": "A settlement fail occurs when one party cannot deliver securities or cash on the settlement date.\n\nFail Cost (per day) ≈ Notional × Fail Rate × (1/360)\n\nIn European markets, CSDR introduced mandatory cash penalties for settlement fails: 1bp/day for liquid shares, 0.5bp for less liquid, 0.1bp for bonds.\n\nFor a $10M equity fail: $10M × 0.0001 × 30 days = $30,000 penalty. Trivial for large institutions but significant for smaller brokers. The regulatory intent is to create economic incentive for clean settlement without mandating buy-ins, which cause their own distortions in short squeezes."}, {"type": "example", "title": "ARCHEGOS CAPITAL: HOW A LIFECYCLE FAILURE BECAME SYSTEMIC", "content": "The Archegos collapse (March 2021) is the definitive modern case study in OTC lifecycle risk. Archegos held massive concentrated positions in ViacomCBS, Discovery, and others — financed through total return swaps (TRS) with multiple prime brokers simultaneously.\n\nThe critical lifecycle failure: because TRS are OTC bilateral derivatives (not cleared, not exchange-reported), each prime broker only saw their own exposure to Archegos. No broker had full transparency into Archegos's aggregate leverage — which reached ~5x on a $35B gross portfolio.\n\nWhen ViacomCBS fell 30% in 3 days, margin calls from all prime brokers hit simultaneously. The prime brokers who moved first (Goldman, Deutsche) recovered most losses. Morgan Stanley, Credit Suisse, and Nomura waited — and absorbed $4.7B, $5.5B, and $2.9B in losses respectively. Credit Suisse's loss accelerated its eventual collapse."}, {"type": "institutional", "title": "HOW OPS AND RISK INTERACT IN A DERIVATIVES LIFECYCLE", "content": "For OTC derivatives, the lifecycle is managed across three interconnected functions:\n\nFront Office: Executes, captures in trade capture system (Murex, Calypso, Summit). Responsible for economic terms accuracy.\n\nMiddle Office: Confirms economic terms, validates trade capture vs. confirmation, monitors settlement, manages breaks. The P&L explained process — breaking down daily P&L into market moves (delta P&L), passage of time (theta), and residual unexplained — is central to risk oversight.\n\nBack Office / Operations: Legal confirmation management (ISDA confirm archive), settlement instruction standing settlement instructions (SSIs), custodian and CCP communication, reconciliation vs. prime broker/custodian records."}, {"type": "pitfalls", "title": "THE TOP 5 CAUSES OF OPERATIONAL LOSSES", "content": "1. BOOKING ERRORS: Wrong side (buy vs sell), wrong notional, wrong currency. For a $100M IRS, a wrong-side booking means you are $200M in the wrong direction before anyone notices.\n\n2. CONFIRMATION DELAYS: Unconfirmed OTC trades are unenforceable. If a counterparty defaults on an unconfirmed trade, you have no legal standing.\n\n3. MARGIN CALL FAILURES: Missed VM calls trigger defaults under CSAs. The 15-minute window for VM calls under some CSAs is nearly impossible to meet without automated systems.\n\n4. STATIC DATA ERRORS: Incorrect standing settlement instructions cause fails. Wire sent to wrong account — not always recoverable in same-day funds.\n\n5. RECONCILIATION BLINDNESS: A $5M unexplained break on a prime broker recon may represent a real position discrepancy — not caught until month-end, by which time the loss is much larger."}, {"type": "advanced", "title": "CCP MARGIN MODELS AND THE WRONG-WAY RISK PROBLEM", "content": "Central clearing transferred bilateral counterparty risk to CCPs (LCH, CME, ICE). CCPs collect initial margin (IM) and variation margin (VM) — daily MTM settlements.\n\nIM models (SPAN for futures, SIMM for OTC derivatives) use historical simulation or parametric VaR to set margin at approximately 99% confidence over a 5-day close-out period. The problem: wrong-way risk (WWR) — when your counterparty's creditworthiness is negatively correlated with the value of the trade. Standard margin models do not capture this correlation.\n\nThe 2020 COVID shock saw record margin calls — some funds received calls of $1B+ in a single day. CCPs performed (no major CCP defaulted), but the liquidity strain was extreme. A CCP failure would be systemic — the cleared market structure has concentrated default risk in a small number of systemically important entities."}], "keyTakeaways": ["The trade lifecycle has 7 stages from execution to reporting — each is a potential failure point with distinct risk, systems, and regulatory obligations.", "Archegos demonstrated the fundamental opacity of bilateral OTC: prime brokers could not see each other's exposures, enabling $5B+ losses at firms that hesitated on liquidation.", "Confirmation delays on OTC trades create unenforceable positions — unconfirmed trades have no legal standing in counterparty default scenarios.", "CCPs concentrate counterparty risk — margin models use ~99% VaR over 5-day close-out horizons, but wrong-way risk and liquidity strain remain systemic vulnerabilities."], "relatedTopics": ["Central Clearing: CCPs, Initial Margin & the Post-Crisis Plumbing", "OTC Derivatives Operations: Confirms, Reconciliation & ISDA Framework", "Prime Brokerage: Margin, Leverage, Rehypothecation & Counterparty Risk"], "prereqs": []},
  "Value at Risk: Historical, Parametric & Monte Carlo \u2014 and Why VaR Lies": {"title": "Value at Risk: Historical, Parametric & Monte Carlo — and Why VaR Lies", "subtitle": "VaR is the most widely used and most widely misunderstood risk metric in finance. Regulators require it; practitioners know its fundamental flaw — it tells you nothing about what happens when it fails.", "level": "ADVANCED", "readTime": "10 min", "sections": [{"type": "concept", "title": "WHAT VAR ACTUALLY SAYS (AND DOES NOT SAY)", "content": "VaR(95%, 1-day) = $10M means: with 95% confidence, you will not lose more than $10M in one day. Equivalently, on approximately 1 out of every 20 trading days, your loss will exceed $10M.\n\nWhat VaR does NOT say: anything about the magnitude of losses in the remaining 5% of days. A portfolio with VaR(95%) = $10M might have a maximum loss of $11M (very safe) or $1B (catastrophic). VaR is silent on the tail — which is precisely where the risk that can destroy a firm lives.\n\nThis is the fundamental Taleb critique: VaR creates a false precision about risk within the confidence interval while ignoring exactly the events that matter. The 2008 crisis saw firms breach their 99% VaR limits 15-25 days in a row — a statistical impossibility if returns were normally distributed."}, {"type": "formula", "title": "THREE APPROACHES TO CALCULATING VAR", "content": "1. PARAMETRIC (Variance-Covariance): Assumes normally distributed returns. VaR = μ − z_α × σ. For 95% VaR, z = 1.645. For 99%, z = 2.326. Fast, analytical, fails for fat tails and nonlinear positions.\n\n2. HISTORICAL SIMULATION: Take the past N days of actual P&L. Sort the P&L distribution. VaR(95%) = the 5th percentile. More realistic (captures fat tails, skew, actual correlations) but backward-looking.\n\n3. MONTE CARLO: Simulate thousands of market scenarios. Mark portfolio P&L under each scenario. VaR = nth percentile of simulation distribution. Most flexible, captures optionality and path dependence, but results depend entirely on the assumed distribution.\n\nBasel FRTB requires banks to use 97.5% Expected Shortfall (ES) rather than 99% VaR — a regulatory acknowledgment that VaR's tail silence was a systemic risk enabler."}, {"type": "example", "title": "LTCM 1998: WHEN 99% VAR BROKE DOWN", "content": "Long-Term Capital Management had risk models showing VaR(99%, 1-day) of approximately $45M in August 1998. They lost $553M on a single day (August 21, 1998) when Russia defaulted and global credit spreads blew out simultaneously.\n\nThe model failure had two causes: correlation breakdown (LTCM's spread trades were designed as independent bets, but in a crisis, all spreads widened simultaneously — correlation went to 1.0 across positions that were assumed to be uncorrelated); and liquidity illusion (the model used bid-ask spreads from normal markets; in the crisis, markets for LTCM's positions had no bid at all).\n\nThe Fed-orchestrated bailout required a creditor-arranged recapitalization of $3.6B by 16 banks to prevent disorderly unwinding of $125B in positions. The LTCM lesson: correlation and liquidity assumptions are regime-dependent. In calm markets, they are approximately right. In crisis, they are catastrophically wrong."}, {"type": "institutional", "title": "HOW DESKS ACTUALLY USE VAR", "content": "Risk limits at dealer banks are typically set in VaR terms: the equities desk has a $50M/day 99% VaR limit. Breach of VaR limits triggers an automatic escalation.\n\nIn practice, desks manage to VaR limits strategically. If a position is approaching the VaR limit, the desk can: add offsetting hedges (reduces VaR but maintains economic exposure), restructure the position to reduce measured vol, or use VaR netting (aggregate positions to reduce measured risk through model-assumed diversification).\n\nThe gaming of VaR limits is well-documented. The JP Morgan London Whale (2012) involved a credit derivatives position specifically structured to minimize reported VaR using model assumptions. The desk switched to a different VaR model mid-year that reduced reported VaR by ~50% — not because risk decreased, but because the new model made different (worse) assumptions. The position ultimately lost $6.2B."}, {"type": "pitfalls", "title": "THE FIVE WAYS VAR MISLEADS", "content": "1. TAIL SILENCE: VaR at 99% says nothing about losses in the 1%. Expected Shortfall (CVaR/ES) fixes this.\n\n2. NORMAL DISTRIBUTION ASSUMPTION: Parametric VaR using normal distribution underestimates tail risk by orders of magnitude for financial returns, which have fat tails (kurtosis > 3) and negative skew.\n\n3. CORRELATION IN CRISIS: Historical VaR lookback includes calm periods. Correlations in the historical period understate crisis correlations. Stressed VaR (using a crisis lookback period) is now required alongside regular VaR.\n\n4. LIQUIDITY BLINDNESS: VaR assumes you can exit the position at current market prices. For large or illiquid positions, the act of selling moves the market against you.\n\n5. HORIZON MISMATCH: 1-day VaR scaled to 10 days by √10 assumes i.i.d. returns. Real P&L has autocorrelation (trending vol), making scaled VaR wrong. For derivatives with gamma, it is even more wrong."}, {"type": "advanced", "title": "EXPECTED SHORTFALL AND THE MOVE TO ES", "content": "Expected Shortfall (ES), also called Conditional VaR (CVaR), measures the expected loss given that the loss exceeds VaR:\n\nES(α) = E[Loss | Loss > VaR(α)]\n\nFor a normal distribution with 99% VaR: ES ≈ 1.29 × VaR\n\nES is a coherent risk measure (satisfies subadditivity — the ES of a combined portfolio ≤ sum of individual ES). VaR is not coherent: two portfolios can each have low VaR but their combination can have very high VaR.\n\nBasel FRTB replaced 99% VaR with 97.5% ES for all internal models — roughly equivalent in normal conditions but ES captures the tail properly. The regulatory shift was direct acknowledgment that VaR's tail silence was a systemic risk enabler."}], "keyTakeaways": ["VaR says losses will not exceed X on Y% of days — it says nothing about loss magnitude in the remaining (1-Y)% of days where it fails, which is where firm-destroying risk lives.", "LTCM shows the two failure modes: crisis correlation (assumed-independent positions become perfectly correlated) and liquidity illusion (no bid at all for positions modeled with normal spreads).", "Expected Shortfall (ES/CVaR) = E[Loss | Loss > VaR] is the coherent replacement — captures average tail severity, satisfies subadditivity, now required under Basel FRTB.", "VaR is easily gamed by sophisticated desks — restructuring positions to reduce measured VaR while maintaining economic exposure is standard practice, as the London Whale demonstrated."], "relatedTopics": ["Stress Testing & Scenario Analysis: The Right Way to Think About Tail Risk", "Correlation & Contagion: Why Diversification Fails in Crises", "Modern Portfolio Theory: Efficient Frontier, Sharpe Ratio & Its Failures"], "prereqs": ["Modern Portfolio Theory: Efficient Frontier, Sharpe Ratio & Its Failures"]},
  "Gold as a Macro Asset: Real Rates, Dollar Correlation & Safe Haven Flows": {"title": "Gold as a Macro Asset: Real Rates, Dollar Correlation & Safe Haven Flows", "subtitle": "Gold's price is not driven by supply/demand fundamentals — it is primarily a function of real interest rates and dollar strength, with a safe-haven overlay that activates in specific crisis regimes.", "level": "INTERMEDIATE", "readTime": "8 min", "sections": [{"type": "concept", "title": "THE REAL RATE FRAMEWORK", "content": "Gold pays no income. Its opportunity cost is the real yield on safe assets — predominantly US 10Y TIPS (Treasury Inflation-Protected Securities). The relationship is empirically robust: gold prices move inversely with real yields over most market regimes.\n\nThe logic: when real yields are negative (nominal yield below inflation), holding gold costs nothing in relative terms — you are giving up a negative return by holding gold instead of TIPS. When real yields are positive and high, gold's zero-yield is expensive to hold.\n\nGLD's run from $1,200 in 2018 to $2,400+ in 2024 maps almost precisely to the real yield cycle: real yields went deeply negative (−1.0% to −1.5%) in 2020-2021 as the Fed held nominal rates at zero while inflation rose. In 2022-2023 as real yields turned positive, gold held its ground — suggesting new demand sources (central bank buying, geopolitical premium) overwhelmed the real rate headwind."}, {"type": "formula", "title": "THE DOLLAR CORRELATION AND DXY SENSITIVITY", "content": "Gold and the DXY (US Dollar Index) have a well-documented negative correlation — approximately −0.6 to −0.8 over most regimes. Gold is priced in USD; a weaker dollar means more dollars per ounce (mechanically bullish), and a weaker dollar also signals US relative weakness (flight to gold as alternative reserve asset).\n\nGold beta to DXY: approximately −1.0 to −1.5. A 1% decline in DXY is associated with a 1.0-1.5% rise in gold. But this relationship has regime dependency: in 2022, both the DXY and gold fell together initially (rising real rates hurt both), before gold stabilized.\n\nThe portfolio implication: the GLD/DXY correlation means gold provides hedge value in USD debasement scenarios — dollar weakness, fiscal expansion, loss of reserve currency status fears — but can underperform if the dollar strengthens due to global risk-off flight to dollar safety."}, {"type": "example", "title": "GOLD IN 2020 VS 2022: TWO REGIMES", "content": "2020 (textbook gold bull): Fed cut rates to zero in March. Real yields collapsed to −1.0%. Dollar weakened as Fed printed money. Fiscal deficit exploded. Gold rose from $1,520 in January to $2,075 by August — a 36% gain in 8 months. All drivers aligned: negative real rates, weak dollar, inflation fears, safe-haven demand.\n\n2022 (gold's confusing year): The Fed hiked 425bps. Real yields surged from −1.0% to +1.5% — a 250bp move. The DXY rose 15%. By the textbook framework, gold should have fallen 30-40%. Instead it fell only ~4% on the year and ended at $1,820.\n\nThe explanation: central bank buying surged to record levels (1,136 tonnes, per World Gold Council) — particularly from China, Turkey, India, and Russia — as EM central banks diversified reserve assets away from USD following the freezing of Russian FX reserves. This structural demand absorbed what should have been a devastating real rate headwind."}, {"type": "institutional", "title": "HOW MACRO FUNDS POSITION GOLD", "content": "Macro funds use gold in three distinct ways: as a real rates expression, as a dollar hedge, and as a geopolitical tail hedge.\n\nAs a real rates expression: go long gold when real yields are falling or deeply negative; reduce or short when real yields are rising. Express this via GLD, COMEX futures (lower cost of carry), or gold miner ETFs (GDX, GDXJ) for leveraged exposure.\n\nAs a dollar hedge: portfolio managers with significant USD-denominated assets hold gold as a DXY short proxy. Gold is more liquid than currency forwards for institutional asset allocators.\n\nAs geopolitical tail hedge: most macro funds hold a structural 2-5% gold allocation as permanent portfolio insurance for scenarios where financial infrastructure itself is threatened (currency crises, sanctions, banking system stress). The Russian sanctions experience in 2022 validated this thesis for many EM central banks."}, {"type": "pitfalls", "title": "GOLD MINER LEVERAGE AND ITS HIDDEN RISKS", "content": "GDX (VanEck Gold Miners ETF) provides 2-3x operational leverage to gold prices — a 10% move in gold typically produces a 20-30% move in gold miners. With AISC around $1,200-1,400/oz and gold at $2,400, a 10% decline in gold ($240) nearly doubles the percentage impact on their margin.\n\nThe hidden risks: currency risk (many mines are in AUD, ZAR, CAD — a strong USD raises costs relative to gold revenue), geopolitical risk in mining jurisdictions (DRC, Mali, Russia), and management risk (miners frequently misallocate through overpriced acquisitions).\n\nFor your GLD position specifically: GLD tracks spot gold minus a 0.40%/year management fee, holds allocated physical gold at HSBC. It is the cleanest expression — no operational or management risk, just real rates and dollar correlation."}, {"type": "advanced", "title": "THE YUAN-GOLD CORRELATION AND THE DE-DOLLARIZATION THESIS", "content": "Since 2022, a new structural relationship has emerged: gold prices on the Shanghai Gold Exchange (SGE) frequently trade at a premium of $30-100/oz over London/COMEX prices. This SGE premium reflects Chinese demand overwhelming local supply and signals that Chinese private investors are using gold as a domestic savings vehicle in response to CNY weakness and real estate market collapse.\n\nThe de-dollarization narrative has driven record central bank gold buying: Russia, China (225+ tonnes in 2023), Turkey, Poland, and other NATO members diversifying reserves.\n\nIf CBs buy 1,000+ tonnes/year when global mine supply is ~3,500 tonnes, the CB buying alone represents 28%+ of global production going into official reserves. The historical floor for gold may have structurally risen as a result: CB demand provides a price floor that retail and financial demand did not previously offer."}], "keyTakeaways": ["Gold's primary driver is real interest rates (10Y TIPS yield) — gold rises when real yields fall or go negative, declines when real yields rise. 2022 was the exception that proved the rule.", "DXY correlation is approximately −0.7; a 1% dollar decline is associated with 1.0-1.5% gold rise, but the relationship breaks down in risk-off scenarios where dollar and gold diverge.", "Post-2022 central bank buying (1,000+ tonnes/year) represents a structural demand shift — EM CBs diversifying away from USD reserves following Russian asset freeze.", "GLD holds allocated physical gold; gold miners (GDX) provide 2-3x operational leverage to gold price but add currency, jurisdiction, and management risk."], "relatedTopics": ["Oil Markets: WTI vs Brent, Futures Curve Structure & Geopolitical Premium", "FX: Carry Trade Mechanics, Purchasing Power Parity & Intervention Risk", "Strait of Hormuz Risk: Energy Chokepoints & Historical Market Impact"], "prereqs": []},
  "Market Microstructure: Bid-Ask Spread Decomposition & Price Discovery": {"title": "Market Microstructure: Bid-Ask Spread Decomposition & Price Discovery", "subtitle": "Every transaction costs more than the quoted spread — understanding the three components of spread decomposition reveals where information is, who has it, and how prices incorporate it.", "level": "ADVANCED", "readTime": "9 min", "sections": [{"type": "concept", "title": "THE THREE COMPONENTS OF THE BID-ASK SPREAD", "content": "The bid-ask spread is the market maker's compensation for three distinct costs:\n\n1. ORDER PROCESSING COST: Fixed administrative cost of executing a trade. Essentially zero for electronic markets; this was the dominant component in floor-trading eras.\n\n2. INVENTORY HOLDING COST: The market maker takes the other side of your trade and holds inventory. Holding directional exposure has risk — they need compensation for holding it until they can offload it to another counterparty. In illiquid names, this cost dominates.\n\n3. ADVERSE SELECTION COST: The market maker knows some traders have private information. If they quote a spread and an informed trader hits their bid, they lose — the stock will likely fall because the informed trader is selling for a reason. The adverse selection component is the market maker's compensation for this information asymmetry.\n\nThe adverse selection component is why spreads widen before major events (earnings, FDA approvals) — the probability of trading against an informed counterparty increases."}, {"type": "formula", "title": "THE ROLL MODEL AND EFFECTIVE SPREAD", "content": "The theoretical bid-ask spread from the Roll (1984) model is derived from the autocovariance of price changes:\n\nSpread = 2 × √(−Cov(ΔPₜ, ΔPₜ₋₁))\n\nIntuition: if you buy at the ask and sell at the bid repeatedly with no information, prices alternate creating negative serial correlation. The magnitude of that negative autocorrelation reveals the effective spread.\n\nEffective Spread: 2 × |Trade Price − Midpoint| — this measures what you actually paid relative to the fair mid-price.\nRealized Spread: the effective spread minus the subsequent price move in your direction — this is the market maker's actual profit after price impact.\nPrice Impact (Amihud illiquidity): Δ|P| / Volume — how much prices move per dollar of trading volume. High price impact = illiquid market where your trades move prices against you."}, {"type": "example", "title": "GAMESTOP: ADVERSE SELECTION AT EXTREME SCALE", "content": "The January 2021 GameStop short squeeze is the cleanest example of adverse selection destroying market maker profitability. As retail buying from WallStreetBets drove GME from $20 to $480, market makers faced an extreme informed trader problem.\n\nThe 'information' was public (Reddit posts) but effectively directional — every buyer was part of a coordinated squeeze. Market makers quoting 2-cent spreads in a normal market suddenly faced a situation where every buyer was right and every seller was wrong. The adverse selection component exploded.\n\nResult: market makers widened spreads dramatically (GME spreads reached $5-15 at peak volatility vs. normal $0.01), reducing liquidity. Robinhood and other brokers restricted buying — partly because the adverse selection risk to their market-making affiliates had become unacceptable. This is microstructurally logical even if controversial."}, {"type": "institutional", "title": "HOW INSTITUTIONAL TRADERS MINIMIZE MARKET IMPACT", "content": "A buy-side institution executing a large order faces a different problem than a retail trader: they are a flow that, if known, will move prices against them. The execution challenge is to minimize implementation shortfall — the difference between the paper portfolio return and the actual portfolio return after trading costs.\n\nExecution algorithms: VWAP spreads the order across the day proportional to expected volume. Minimizes tracking error vs. VWAP but does not minimize cost. TWAP spreads the order uniformly over time. IS (Implementation Shortfall) algorithms minimize the cost of executing from the decision price, balancing urgency against market impact.\n\nDark pools exist specifically to hide large order flow from the lit market. By matching institutional buyers and sellers without pre-trade transparency, dark pools reduce adverse selection risk for both sides. ~40% of US equity volume now trades in dark pools or other off-exchange venues."}, {"type": "pitfalls", "title": "THE HIDDEN COSTS THAT ARE NOT IN THE SPREAD", "content": "1. MARKET IMPACT: Your order itself moves the price against you. For a $10M order in a stock with $1M average daily volume, you are trading 10x ADV — every buy lifts the ask, increasing your average fill price.\n\n2. TIMING RISK: Executing slowly (to minimize impact) means the price can move against you while you are working the order.\n\n3. INFORMATION LEAKAGE: Brokers, prime brokers, and electronic systems can detect your order flow patterns. Predatory trading by HFT algorithms involves detecting large slow orders and trading ahead of them.\n\n4. BORROW COST FOR SHORTS: Short positions require borrowing stock. Hard-to-borrow (HTB) fees can reach 100%+ annualized for heavily-shorted stocks. This is a real holding cost that does not appear in the bid-ask spread."}, {"type": "advanced", "title": "HFT AND THE NEW MARKET MAKER ECONOMICS", "content": "High-frequency trading transformed market-making economics post-2005. HFT market makers quote tighter spreads than traditional dealers because: they hedge at microsecond speed (inventory holding cost approaches zero), use co-location to see order flow earlier than competitors, and extract the maker rebate ($0.002/share on most exchanges).\n\nThe maker-taker model (exchanges pay rebates to liquidity providers, charge fees to takers) was designed to attract HFT market-making. The result: quoted spreads are tight (often $0.01 minimum tick), but effective spreads for institutional orders are wide due to market impact and HFT detection of large flows.\n\nThe speed arms race: co-location at NYSE is ~$5M/year for a single rack. Microwave transmission between data centers is faster than fiber and is used for latency-sensitive strategies. The economic returns to this infrastructure are enormous — a 10-microsecond advantage in order routing generates millions in annual edge."}], "keyTakeaways": ["Bid-ask spread = order processing + inventory holding + adverse selection costs. Spreads widen before events because adverse selection risk (probability of trading against informed counterparty) spikes.", "Effective spread = 2 × |trade price − midpoint|; price impact = Δ|P|/volume. These measure actual transaction costs beyond the quoted spread.", "Implementation shortfall (decision price → actual execution price) is the true cost of institutional trading — VWAP/TWAP/IS algorithms balance impact cost vs. timing risk.", "HFT tightened quoted spreads but increased institutional market impact — co-location and microwave infrastructure enable front-running of detected large order flows."], "relatedTopics": ["Order Flow: How Institutional Block Trades Move Markets", "Short Selling: Locates, Hard-to-Borrow Costs & Stock Loan Dynamics", "VWAP & TWAP: Execution Algorithms and Implementation Shortfall"], "prereqs": []},
};

// Key normalizer — matches topic strings to static lecture keys
function findStaticLecture(topic) {
  const norm = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const needle = norm(topic);
  for (const [key, val] of Object.entries(STATIC_LECTURES)) {
    if (norm(key) === needle) return val;
  }
  // Partial match fallback
  for (const [key, val] of Object.entries(STATIC_LECTURES)) {
    if (norm(key).includes(needle) || needle.includes(norm(key).slice(0, 30))) return val;
  }
  return null;
}

const CURRICULUM = [
  {
    cat: "EQUITY ANALYSIS", color: C.cyan, icon: "▣", topics: [
      { title: "DCF Valuation: WACC, Terminal Value & Sensitivity Tables", level: "INT" },
      { title: "EV/EBITDA vs P/E: When Each Multiple Lies to You", level: "INT" },
      { title: "Comparable Company Analysis: Selecting & Scrubbing the Right Comps", level: "INT" },
      { title: "P/B & ROE: The Bank Stock Valuation Framework", level: "ADV" },
      { title: "Free Cash Flow: The Gap Between Accounting Earnings and Reality", level: "INT" },
      { title: "Reading a 10-K Like a Hedge Fund Analyst", level: "INT" },
      { title: "Short Interest Mechanics & Squeeze Dynamics: The GameStop Autopsy", level: "ADV" },
      { title: "Earnings Quality: How to Detect Aggressive Accounting", level: "ADV" },
    ]
  },
  {
    cat: "DERIVATIVES", color: C.purple, icon: "◈", topics: [
      { title: "Options Greeks: Delta, Gamma, Vega, Theta — Mechanics Not Definitions", level: "ADV" },
      { title: "Delta Hedging: The Dynamic Replication Argument", level: "ADV" },
      { title: "Volatility Surface: Skew, Term Structure & What It Tells You", level: "ADV" },
      { title: "Black-Scholes: Derivation, Assumptions & Where It Breaks", level: "ADV" },
      { title: "Exotic Options: Barriers, Digitals, Asian Options", level: "EXP" },
      { title: "Interest Rate Swaps: Pricing, Risk & the OIS Discount Framework", level: "ADV" },
      { title: "Credit Default Swaps: Mechanics, Basis & CDS-Bond Basis Trades", level: "ADV" },
      { title: "Structured Products: Auto-Callables, Reverse Convertibles & Equity-Linked Notes", level: "EXP" },
    ]
  },
  {
    cat: "FIXED INCOME & RATES", color: C.amber, icon: "≋", topics: [
      { title: "Bond Math: Duration, Convexity & Why They Matter in a Rising Rate Regime", level: "INT" },
      { title: "Yield Curve: Construction, Shapes & Inversion as a Recession Signal", level: "INT" },
      { title: "SOFR Transition: What Actually Changed and the Residual LIBOR Risk", level: "ADV" },
      { title: "Bootstrapping a Discount Curve from Swap Market Data", level: "ADV" },
      { title: "Credit Spreads: Investment Grade vs High Yield Spread Dynamics", level: "INT" },
      { title: "Inflation Derivatives: TIPS, Breakevens & CPI Swaps", level: "ADV" },
      { title: "Repo Markets: The Plumbing of Fixed Income Financing", level: "ADV" },
      { title: "Fed Policy Transmission: How Rate Changes Propagate Through Markets", level: "INT" },
    ]
  },
  {
    cat: "MACRO & MARKETS", color: C.teal, icon: "◎", topics: [
      { title: "Oil Markets: WTI vs Brent, Futures Curve Structure & Geopolitical Premium", level: "INT" },
      { title: "FX: Carry Trade Mechanics, Purchasing Power Parity & Intervention Risk", level: "INT" },
      { title: "Gold as a Macro Asset: Real Rates, Dollar Correlation & Safe Haven Flows", level: "INT" },
      { title: "Strait of Hormuz Risk: Energy Chokepoints & Historical Market Impact", level: "INT" },
      { title: "Defense Sector Dynamics: Backlog, LRIP Contracts & Geopolitical Catalysts", level: "INT" },
      { title: "Tanker Markets: VLCC Rate Dynamics, Ton-Mile Demand & Sanctions Arbitrage", level: "ADV" },
      { title: "Commodity Supercycles: Drivers, Historical Precedents & Signal Indicators", level: "INT" },
      { title: "Recession Indicators: The Full Dashboard Beyond the Yield Curve", level: "INT" },
    ]
  },
  {
    cat: "TRADING & MICROSTRUCTURE", color: C.green, icon: "⬡", topics: [
      { title: "Market Microstructure: Bid-Ask Spread Decomposition & Price Discovery", level: "ADV" },
      { title: "Options Market Making: Inventory Risk, Delta Hedging & Edge", level: "EXP" },
      { title: "Factor Investing: Value, Momentum, Quality, Low-Vol — Live vs Paper", level: "INT" },
      { title: "Order Flow: How Institutional Block Trades Move Markets", level: "ADV" },
      { title: "Statistical Arbitrage: Pairs Trading, Cointegration & Mean Reversion", level: "EXP" },
      { title: "VWAP & TWAP: Execution Algorithms and Implementation Shortfall", level: "INT" },
      { title: "High-Frequency Trading: Infrastructure, Strategies & Market Impact", level: "ADV" },
      { title: "Short Selling: Locates, Hard-to-Borrow Costs & Stock Loan Dynamics", level: "ADV" },
    ]
  },
  {
    cat: "PORTFOLIO & RISK", color: C.red, icon: "◉", topics: [
      { title: "Modern Portfolio Theory: Efficient Frontier, Sharpe Ratio & Its Failures", level: "INT" },
      { title: "Value at Risk: Historical, Parametric & Monte Carlo — and Why VaR Lies", level: "ADV" },
      { title: "Risk Factor Models: Barra, Fama-French & Alpha Decomposition", level: "ADV" },
      { title: "Portfolio Construction: Position Sizing, Kelly Criterion & Concentration Risk", level: "ADV" },
      { title: "Stress Testing & Scenario Analysis: The Right Way to Think About Tail Risk", level: "ADV" },
      { title: "Correlation & Contagion: Why Diversification Fails in Crises", level: "ADV" },
      { title: "Hedge Fund Structures: L/S Equity, Global Macro, Multi-Strat & Fee Dynamics", level: "INT" },
      { title: "Prime Brokerage: Margin, Leverage, Rehypothecation & Counterparty Risk", level: "ADV" },
    ]
  },
  {
    cat: "TECHNICAL ANALYSIS", color: "#FF6B35", icon: "◬", topics: [
      { title: "Price Action & Chart Patterns: What Actually Has Predictive Power", level: "INT" },
      { title: "RSI: Calculation, Divergences & Failure Swings in Trending Markets", level: "INT" },
      { title: "MACD: Signal Line Crossovers, Histograms & Momentum Confirmation", level: "INT" },
      { title: "Bollinger Bands: Volatility-Based Entries, Squeezes & Band Walks", level: "INT" },
      { title: "Volume Analysis: OBV, VWAP & Institutional Accumulation/Distribution", level: "INT" },
      { title: "Support/Resistance: Why Levels Work and When They Fail", level: "INT" },
      { title: "Elliott Wave & Fibonacci: The Case For and Against", level: "INT" },
      { title: "Options-Implied Technicals: Max Pain, Gamma Walls & Dealer Hedging Flows", level: "ADV" },
    ]
  },
  {
    cat: "OPERATIONS & INFRASTRUCTURE", color: "#9E9E9E", icon: "⬛", topics: [
      { title: "Trade Lifecycle: Execution to Settlement — Every Step and Where It Breaks", level: "INT" },
      { title: "OTC Derivatives Operations: Confirms, Reconciliation & ISDA Framework", level: "ADV" },
      { title: "Central Clearing: CCPs, Initial Margin & the Post-Crisis Plumbing", level: "ADV" },
      { title: "Prime Brokerage Operations: Margin Calls, Short Locates & Client Reporting", level: "INT" },
      { title: "Structured Note Operations: CUSIP Lifecycle, Autocall Events & Cash Flows", level: "ADV" },
      { title: "Middle Office vs Front Office: Data Flows, P&L Attribution & Dispute Management", level: "INT" },
      { title: "Regulatory Landscape: Dodd-Frank, EMIR, SFTR & Trade Reporting", level: "INT" },
      { title: "Technology Stack: Trade Capture Systems, Risk Engines & Data Architecture", level: "ADV" },
    ]
  },
];

const LEVEL_COLOR = { INT: C.green, ADV: C.amber, EXP: C.red };
const LEVEL_LABEL = { INT: "INTERMEDIATE", ADV: "ADVANCED", EXP: "EXPERT" };

// Section type rendering config
const SECTION_STYLES = {
  concept:     { border: C.cyan,   label: "CONCEPT",           bg: "#001A1A" },
  formula:     { border: C.purple, label: "THE MATH",          bg: "#0D0018" },
  example:     { border: C.amber,  label: "REAL WORLD",        bg: "#0A0800" },
  institutional:{ border: C.teal,  label: "HOW THE STREET USES THIS", bg: "#001510" },
  pitfalls:    { border: C.red,    label: "WHERE PEOPLE GO WRONG", bg: "#0F0004" },
  advanced:    { border: "#FF6B35",label: "GOING DEEPER",      bg: "#0A0500" },
};

function LEARNPanel() {
  const [view, setView]         = useState("browse"); // "browse" | "lecture" | "search"
  const [input, setInput]       = useState("");
  const [lecture, setLecture]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [history, setHistory]   = useState(() => loadFromStorage("bbg_learn_history", []));
  const [err, setErr]           = useState("");

  useEffect(() => { saveToStorage("bbg_learn_history", history.slice(0, 20)); }, [history]);

  const requestLecture = async (topic, isSearch = false) => {
    setErr("");

    // ── 1. Static pre-authored content: instant, no API ────────────────────
    const staticLecture = findStaticLecture(topic);
    if (staticLecture && !isSearch) {
      setLecture({ ...staticLecture, _isStatic: true });
      setView("lecture");
      setHistory(prev => {
        const next = [{ topic, title: staticLecture.title, ts: "static" }, ...prev.filter(h => h.topic !== topic)];
        return next.slice(0, 20);
      });
      return;
    }

    // ── 2. localStorage cache: instant for previously generated lectures ────
    const cacheKey = "bbg_lecture_" + topic.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80);
    const cached = loadFromStorage(cacheKey, null);
    if (cached?.sections && !isSearch) {
      setLecture(cached);
      setView("lecture");
      setHistory(prev => {
        const next = [{ topic, title: cached.title, ts: cached._cachedAt || "cached" }, ...prev.filter(h => h.topic !== topic)];
        return next.slice(0, 20);
      });
      return;
    }

    setLoading(true); setLecture(null);
    setView("lecture");
    const msgs = [
      "LOADING CURRICULUM...",
      `PREPARING: ${topic.toUpperCase().slice(0, 45)}...`,
      "STRUCTURING LECTURE...",
      "ADDING MARKET EXAMPLES...",
    ];
    let mi = 0;
    setLoadingMsg(msgs[0]);
    const interval = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 1800);

    try {
      const sys = `You are a world-class finance professor. Student is a VP-level derivatives professional (Citi/Morgan Stanley/BBH, 8+ years) moving toward front office. They know the basics cold — teach at trader/PM depth.

RULES:
- Skip definitions. Go straight to mechanism, math, edge cases.
- Real numbers, real market events throughout.
- Be opinionated — say what's overused, misunderstood, or underappreciated on the Street.
- Connect to derivatives, rates, and macro wherever possible.

OUTPUT: Return ONLY a JSON object. No markdown fences. No text before or after the JSON.
Use only escaped newlines (\n) inside string values — never raw line breaks inside JSON strings.

EXACT SCHEMA (do not deviate):
{"title":"string","subtitle":"string","level":"INTERMEDIATE|ADVANCED|EXPERT","readTime":"X min","sections":[{"type":"concept","title":"CAPS TITLE","content":"string with \n for newlines"},{"type":"formula","title":"CAPS TITLE","content":"string"},{"type":"example","title":"CAPS TITLE","content":"string"},{"type":"institutional","title":"CAPS TITLE","content":"string"},{"type":"pitfalls","title":"CAPS TITLE","content":"string"},{"type":"advanced","title":"CAPS TITLE","content":"string"}],"keyTakeaways":["string","string","string"],"relatedTopics":["string","string","string"],"prereqs":["string"]}`;

      const prompt = `Lecture topic: "${topic}". Six sections required: concept (the real mechanism), formula (math/derivation), example (real market event, real numbers), institutional (how a prop trader or PM actually uses this), pitfalls (common mistakes), advanced (one deeper concept worth knowing). Each section content should be 3-6 substantive sentences. Return ONLY the JSON object.`;

      const txt = await fetchAI(prompt, sys, 3000);
      const parsed = parseJSON(txt);

      // Use robust lecture parser — never fails, degrades gracefully
      const lecture = parseLectureJSON(txt);
      if (lecture) {
        // Save to localStorage cache so next load is instant
        lecture._cachedAt = new Date().toLocaleString();
        const cacheKey2 = "bbg_lecture_" + topic.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80);
        saveToStorage(cacheKey2, lecture);
        setLecture(lecture);
        setHistory(prev => {
          const next = [{ topic, title: lecture.title, ts: lecture._cachedAt }, ...prev.filter(h => h.topic !== topic)];
          return next.slice(0, 20);
        });
      } else {
        setErr("Could not parse lecture. Please try again.");
        setView("browse");
      }
    } catch(e) { setErr(e.message); setView("browse"); }
    clearInterval(interval);
    setLoading(false);
  };

  const handleSearch = () => {
    const q = input.trim();
    if (!q) return;
    requestLecture(q, true);
    setInput("");
  };

  // ─── BROWSE VIEW ────────────────────────────────────────────────────────────
  const BrowseView = () => (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom:16 }}>
        <SearchInput value={input} onChange={setInput} onSubmit={handleSearch}
          placeholder="ASK ANYTHING — OPTIONS GREEKS, YIELD CURVE, VLCC MARKETS, FACTOR MODELS..." />
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <div style={{ marginBottom:14 }}>
          <Mono color={C.textDim} size={8} spacing={1} style={{display:"block",marginBottom:6}}>RECENT LECTURES</Mono>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {history.slice(0, 8).map(h => (
              <button key={h.topic} onClick={() => requestLecture(h.topic)}
                style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"3px 10px", cursor:"pointer", letterSpacing:0.5 }}>
                {h.topic.length > 35 ? h.topic.slice(0,35)+"…" : h.topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Curriculum */}
      <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:0, border:`1px solid ${C.border}`, background:C.panel }}>
        {/* Category sidebar */}
        <div style={{ borderRight:`1px solid ${C.border}` }}>
          <div style={{ padding:"8px 12px", background:"#0A0A0A", borderBottom:`1px solid ${C.border}` }}>
            <Mono color={C.amber} size={8} spacing={1}>CURRICULUM</Mono>
          </div>
          {CURRICULUM.map(({cat, color, icon}) => (
            <div key={cat} onClick={() => setActiveCat(cat)}
              style={{ padding:"9px 12px", borderBottom:`1px solid ${C.border}`, cursor:"pointer",
                background: activeCat===cat ? color+"18" : "transparent",
                borderLeft: activeCat===cat ? `2px solid ${color}` : "2px solid transparent" }}>
              <Mono color={activeCat===cat ? color : C.textDim} size={10} weight={activeCat===cat?700:400}>
                {icon} {cat}
              </Mono>
            </div>
          ))}
        </div>

        {/* Topic list */}
        <div style={{ minHeight:400 }}>
          {!activeCat && (
            <div style={{ padding:"32px 24px", textAlign:"center" }}>
              <Mono color={C.muted} size={10} style={{display:"block",marginBottom:8}}>SELECT A CURRICULUM CATEGORY</Mono>
              <Mono color={C.border} size={9}>or use the search bar for any topic</Mono>
            </div>
          )}
          {activeCat && (() => {
            const cat = CURRICULUM.find(c => c.cat === activeCat);
            return (
              <div>
                <div style={{ padding:"8px 14px", background:"#0A0A0A", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <Mono color={cat.color} size={9} weight={700} spacing={0.5}>{cat.icon} {cat.cat}</Mono>
                  <Mono color={C.muted} size={8}>{cat.topics.length} LECTURES</Mono>
                </div>
                {cat.topics.map(({title, level}) => (
                  <div key={title} onClick={() => requestLecture(title)}
                    style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}
                    onMouseEnter={e=>{ e.currentTarget.style.background="#111"; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
                    <span style={{ background:LEVEL_COLOR[level]+"22", color:LEVEL_COLOR[level], fontFamily:"'IBM Plex Mono',monospace", fontSize:7, fontWeight:700, padding:"2px 6px", letterSpacing:1, whiteSpace:"nowrap" }}>{level}</span>
                    <Mono color={C.text} size={11}>{title}</Mono>
                    {findStaticLecture(title) && (
                      <span style={{ marginLeft:"auto", fontSize:7, color:"#00ffaa", opacity:0.6, flexShrink:0 }} title="Pre-authored — loads instantly">✦</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  // ─── LECTURE VIEW ────────────────────────────────────────────────────────────
  const LectureView = () => {
    if (!lecture) return null;
    const lcColor = LEVEL_COLOR[lecture.level] || C.text;

    return (
      <div>
        {/* Nav back */}
        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
          <button onClick={() => setView("browse")}
            style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"4px 12px", cursor:"pointer" }}>
            ← CURRICULUM
          </button>
          <Mono color={C.muted} size={9} spacing={1}>FINANCE ACADEMY · LECTURE</Mono>
          <span style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
            {lecture._isStatic && (
              <>
                <span style={{ background:"rgba(0,255,170,0.12)", border:"1px solid rgba(0,255,170,0.35)", borderRadius:3, padding:"2px 8px", fontFamily:"'IBM Plex Mono',monospace", fontSize:8, color:"#00ffaa", letterSpacing:1 }}>
                  ✦ PRE-AUTHORED
                </span>
                <button onClick={() => requestLecture(lecture.title, true)}
                  style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 8px", cursor:"pointer" }}>
                  ↺ AI VERSION
                </button>
              </>
            )}
            {lecture._cachedAt && !lecture._isStatic && (
              <>
                <Mono color={C.border} size={8}>CACHED {lecture._cachedAt}</Mono>
                <button onClick={() => {
                  const k = "bbg_lecture_" + lecture.title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80);
                  try { localStorage.removeItem(k); } catch(e) {}
                  requestLecture(lecture.title, true);
                }} style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 8px", cursor:"pointer" }}>
                  ↺ REGENERATE
                </button>
              </>
            )}
          </span>
        </div>

        {/* Lecture header */}
        <div style={{ background:"#080808", border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.green}`, padding:"16px 18px", marginBottom:12 }}>
          <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
            <span style={{ background:lcColor+"22", color:lcColor, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"2px 8px", letterSpacing:1 }}>{LEVEL_LABEL[lecture.level]}</span>
            <Mono color={C.muted} size={9}>⏱ {lecture.readTime}</Mono>
          </div>
          <div style={{ color:C.white, fontFamily:"'IBM Plex Mono',monospace", fontSize:16, fontWeight:700, letterSpacing:0.5, marginBottom:6 }}>{lecture.title}</div>
          <Mono color={C.textDim} size={11} style={{lineHeight:1.6}}>{lecture.subtitle}</Mono>

          {/* Prereqs */}
          {lecture.prereqs?.length > 0 && (
            <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              <Mono color={C.muted} size={8} spacing={1}>PREREQS:</Mono>
              {lecture.prereqs.map(p => (
                <button key={p} onClick={() => requestLecture(p)}
                  style={{ background:C.muted+"22", color:C.muted, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"2px 8px", cursor:"pointer" }}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sections */}
        {(lecture.sections || []).map((sec, i) => {
          const style = SECTION_STYLES[sec.type] || SECTION_STYLES.concept;
          return (
            <div key={i} style={{ background:style.bg, border:`1px solid ${style.border}33`, borderLeft:`3px solid ${style.border}`, padding:"14px 16px", marginBottom:10 }}>
              <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:10 }}>
                <span style={{ background:style.border+"33", color:style.border, fontFamily:"'IBM Plex Mono',monospace", fontSize:7, fontWeight:700, padding:"2px 8px", letterSpacing:2 }}>{style.label}</span>
                <Mono color={C.white} size={11} weight={700} spacing={0.5}>{sec.title}</Mono>
              </div>
              <div style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:2, whiteSpace:"pre-wrap" }}>{sec.content}</div>
            </div>
          );
        })}

        {/* Key takeaways */}
        {lecture.keyTakeaways?.length > 0 && (
          <div style={{ background:"#001A0A", border:`1px solid ${C.green}33`, borderLeft:`3px solid ${C.green}`, padding:"14px 16px", marginBottom:10 }}>
            <Mono color={C.green} size={8} weight={700} spacing={2} style={{display:"block",marginBottom:10}}>KEY TAKEAWAYS</Mono>
            {lecture.keyTakeaways.map((t, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                <Mono color={C.green} size={10}>{i+1}.</Mono>
                <Mono color={C.text} size={11} style={{lineHeight:1.7}}>{t}</Mono>
              </div>
            ))}
          </div>
        )}

        {/* Related topics */}
        {lecture.relatedTopics?.length > 0 && (
          <div style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"12px 16px", marginBottom:10 }}>
            <Mono color={C.amber} size={8} weight={700} spacing={2} style={{display:"block",marginBottom:8}}>CONTINUE LEARNING</Mono>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {lecture.relatedTopics.map(t => (
                <button key={t} onClick={() => requestLecture(t)}
                  style={{ background:C.amber+"18", color:C.amber, border:`1px solid ${C.amber}44`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"6px 14px", cursor:"pointer", letterSpacing:0.5 }}>
                  → {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search for more */}
        <div style={{ marginTop:16 }}>
          <SearchInput value={input} onChange={setInput} onSubmit={handleSearch}
            placeholder="ASK ANOTHER TOPIC..." />
        </div>
      </div>
    );
  };

  return (
    <div>
      {err && <Mono color={C.red} size={11} style={{display:"block",padding:"8px 0",marginBottom:8}}>{err}</Mono>}
      {loading ? (
        <div>
          <div style={{ marginBottom:10 }}>
            <SearchInput value={input} onChange={setInput} onSubmit={handleSearch}
              placeholder="ASK ANYTHING..." />
          </div>
          <Loader msg={loadingMsg} />
        </div>
      ) : view === "browse" ? <BrowseView /> : <LectureView />}
    </div>
  );
}

// ─── F6: DES — COMPANY DESCRIPTION (Bloomberg DES equivalent) ───────────────
function DESPanel() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    if (!input.trim()) return;
    setLoading(true); setErr(""); setData(null);
    const sym = input.toUpperCase().trim();
    try {
      if (IS_LOCAL) {
        const quoteRes = await fetchYahooQuote(sym);
        const r = quoteRes?.quoteSummary?.result?.[0];
        if (!r?.price?.regularMarketPrice && !r?.price?.regularMarketPrice?.raw) {
          throw new Error(`No data found for ${sym} — verify the ticker symbol is correct`);
        }
        const rv2 = (obj, key) => { const v = obj?.[key]; return v?.raw ?? v ?? null; };
        const profile = r.assetProfile || {};
        const price   = r.price || {};
        const stats   = r.defaultKeyStatistics || {};
        const officers = profile.companyOfficers || [];
        const ceo = officers.find(o => (o.title||"").toLowerCase().includes("chief executive") || (o.title||"").toLowerCase().includes("ceo"))?.name || "N/A";
        const emp = profile.fullTimeEmployees ? profile.fullTimeEmployees.toLocaleString() : "N/A";
        // Claude ONLY for moat + business model narrative (~250 tokens out)
        const ctx = `${sym} (${price.longName||sym}): ${(profile.longBusinessSummary||"").slice(0,500)} Sector: ${profile.sector}. Industry: ${profile.industry}.`;
        const aiTxt = await fetchAI(
          `For ${sym}, write a 2-sentence competitive moat, a 2-sentence business model explanation, and a 2-sentence recent developments summary based on this description: ${ctx}. Return ONLY JSON: {"moat":"2 sentences","businessModel":"2 sentences","recentDevelopments":"2 sentences"}`,
          "Return ONLY valid JSON.", 300
        );
        const ai = parseJSON(aiTxt) || { moat: "See description.", businessModel: "See description.", recentDevelopments: "See description." };
        setData({
          ticker: sym, company: price.longName || price.shortName || sym,
          exchange: price.exchangeName || "N/A", ticker_local: sym,
          founded: "N/A", ipo: "N/A",
          headquarters: [profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "N/A",
          employees: emp, ceo, website: profile.website || "N/A",
          description: profile.longBusinessSummary || "No description available.",
          businessModel: ai.businessModel, moat: ai.moat,
          recentDevelopments: ai.recentDevelopments,
          segments: [], geography: [], customers: "See business description.", competitors: [],
          keyMetrics: [
            { label: "Market Cap",  value: fmtNum(rv2(price,"marketCap")), context: "Total equity market value" },
            { label: "Sector",      value: profile.sector   || "N/A",      context: "GICS sector classification" },
            { label: "Industry",    value: profile.industry || "N/A",      context: "Industry sub-group" },
            { label: "Employees",   value: emp,                            context: "Full-time headcount" },
            { label: "Exchange",    value: price.exchangeName || price.fullExchangeName || "N/A", context: "Listing exchange" },
          ],
          indexMemberships: [], esgRating: "N/A", creditRating: "N/A", majorShareholders: [],
        });
      } else {
        const prompt = `Search for company profile for ${sym}. Return ONLY JSON: {"ticker":"${sym}","company":"name","exchange":"exchange","ticker_local":"${sym}","founded":"year","ipo":"year","headquarters":"City, Country","employees":"formatted","ceo":"name","website":"url","description":"5-6 sentences","businessModel":"2 sentences","moat":"2 sentences","segments":[{"name":"name","revShare":"XX%","description":"1 sentence"}],"geography":[{"region":"name","revShare":"XX%"}],"customers":"2 sentences","competitors":["c1","c2","c3"],"keyMetrics":[{"label":"metric","value":"val","context":"context"}],"indexMemberships":[],"esgRating":"N/A","creditRating":"N/A","majorShareholders":[],"recentDevelopments":"3 sentences"}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed); else setErr("Parse error.");
      }
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const quickTix = ["AAPL","NVDA","CRMD","XOM","RTX","LMT","FRO","FLR","MSFT","TSLA","JPM","GS"];

  return (
    <div>
      <div style={{ marginBottom:10 }}><SearchInput value={input} onChange={setInput} onSubmit={load} placeholder="ENTER TICKER FOR COMPANY DESCRIPTION" /></div>
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {quickTix.map(t => <button key={t} onClick={()=>setInput(t)} style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"3px 10px", cursor:"pointer", letterSpacing:1 }}>{t}</button>)}
      </div>
      {loading && <Loader msg={`LOADING COMPANY PROFILE: ${input.toUpperCase()}`} />}
      {err && <Mono color={C.red} size={11} style={{display:"block",padding:"8px 0"}}>{err}</Mono>}
      {data && (
        <div>
          {/* Header */}
          <div style={{ background:"#080808", border:`1px solid ${C.border}`, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <Mono color={C.teal} size={18} weight={700} spacing={3}>{data.ticker}</Mono>
                <Mono color={C.white} size={13} style={{marginLeft:14}}>{data.company}</Mono>
                <div style={{ marginTop:6 }}>
                  <Mono color={C.muted} size={9}>{data.exchange}</Mono>
                  <span style={{ margin:"0 10px", color:C.border }}>|</span>
                  <Mono color={C.textDim} size={9}>Founded: {data.founded}</Mono>
                  <span style={{ margin:"0 10px", color:C.border }}>|</span>
                  <Mono color={C.textDim} size={9}>IPO: {data.ipo}</Mono>
                  <span style={{ margin:"0 10px", color:C.border }}>|</span>
                  <Mono color={C.textDim} size={9}>CEO: {data.ceo}</Mono>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div><Mono color={C.textDim} size={9}>HQ: </Mono><Mono color={C.text} size={10}>{data.headquarters}</Mono></div>
                <div style={{marginTop:4}}><Mono color={C.textDim} size={9}>EMPLOYEES: </Mono><Mono color={C.text} size={10}>{data.employees}</Mono></div>
                <div style={{marginTop:4}}>
                  {(data.indexMemberships||[]).map(idx => <span key={idx} style={{ background:C.teal+"22", color:C.teal, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, padding:"1px 6px", marginLeft:4 }}>{idx}</span>)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:10, marginBottom:10 }}>
            {/* Description */}
            <div>
              <PanelBox title="BUSINESS DESCRIPTION" titleColor={C.teal} style={{marginBottom:10}}>
                <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:"0 0 10px" }}>{data.description}</p>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                  <Mono color={C.textDim} size={9} spacing={1}>BUSINESS MODEL: </Mono>
                  <Mono color={C.text} size={11}>{data.businessModel}</Mono>
                </div>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8, marginTop:8 }}>
                  <Mono color={C.textDim} size={9} spacing={1}>COMPETITIVE MOAT: </Mono>
                  <Mono color={C.cyan} size={11}>{data.moat}</Mono>
                </div>
              </PanelBox>
              <PanelBox title="RECENT STRATEGIC DEVELOPMENTS" titleColor={C.teal}>
                <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:0 }}>{data.recentDevelopments}</p>
              </PanelBox>
            </div>

            {/* Right column */}
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {(data.segments||[]).length > 0 && (
                <PanelBox title="BUSINESS SEGMENTS" titleColor={C.teal}>
                  {data.segments.map((s,i) => (
                    <div key={i} style={{ padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <Mono color={C.text} size={11} weight={600}>{s.name}</Mono>
                        <Mono color={C.teal} size={11} weight={700}>{s.revShare}</Mono>
                      </div>
                      <Mono color={C.textDim} size={10} style={{lineHeight:1.5,display:"block",marginTop:2}}>{s.description}</Mono>
                    </div>
                  ))}
                </PanelBox>
              )}
              {(data.geography||[]).length > 0 && (
                <PanelBox title="REVENUE GEOGRAPHY" titleColor={C.teal}>
                  {data.geography.map((g,i) => (
                    <div key={i} style={{ padding:"5px 0", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between" }}>
                      <Mono color={C.text} size={11}>{g.region}</Mono>
                      <Mono color={C.cyan} size={11} weight={600}>{g.revShare}</Mono>
                    </div>
                  ))}
                </PanelBox>
              )}
              <PanelBox title="COMPETITORS" titleColor={C.teal}>
                {(data.competitors||[]).map((c,i) => <div key={i} style={{ padding:"4px 0", borderBottom:`1px solid ${C.border}` }}><Mono color={C.amber} size={11} weight={600}>{c}</Mono></div>)}
              </PanelBox>
              {(data.majorShareholders||[]).length > 0 && (
                <PanelBox title="MAJOR SHAREHOLDERS" titleColor={C.teal}>
                  {data.majorShareholders.map((s,i) => (
                    <div key={i} style={{ padding:"5px 0", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between" }}>
                      <Mono color={C.text} size={10}>{s.name}</Mono>
                      <Mono color={C.teal} size={11} weight={600}>{s.pct}</Mono>
                    </div>
                  ))}
                </PanelBox>
              )}
              <div style={{ display:"flex", gap:8 }}>
                {data.creditRating && <div style={{ flex:1, background:C.panel, border:`1px solid ${C.border}`, padding:"8px 12px" }}>
                  <Mono color={C.textDim} size={8} style={{display:"block",marginBottom:4}}>CREDIT RATING</Mono>
                  <Mono color={C.amber} size={14} weight={700}>{data.creditRating}</Mono>
                </div>}
                {data.esgRating && <div style={{ flex:1, background:C.panel, border:`1px solid ${C.border}`, padding:"8px 12px" }}>
                  <Mono color={C.textDim} size={8} style={{display:"block",marginBottom:4}}>ESG RATING</Mono>
                  <Mono color={C.green} size={14} weight={700}>{data.esgRating}</Mono>
                </div>}
              </div>
            </div>
          </div>

          {(data.keyMetrics||[]).length > 0 && (
            <PanelBox title="KEY OPERATING METRICS" titleColor={C.teal}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                {data.keyMetrics.map((m,i) => (
                  <div key={i} style={{ background:"#080808", border:`1px solid ${C.border}`, padding:"10px 12px" }}>
                    <Mono color={C.textDim} size={9} style={{display:"block",marginBottom:4}}>{m.label}</Mono>
                    <Mono color={C.teal} size={14} weight={700}>{m.value}</Mono>
                    <Mono color={C.textDim} size={10} style={{display:"block",marginTop:4,lineHeight:1.5}}>{m.context}</Mono>
                  </div>
                ))}
              </div>
            </PanelBox>
          )}
        </div>
      )}
    </div>
  );
}

// ─── F7: BI — BLOOMBERG INTELLIGENCE (Research & Sector Intel) ───────────────
function BIPanel() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("stock"); // "stock" | "sector" | "theme"

  const load = async () => {
    if (!input.trim()) return;
    setLoading(true); setData(null);
    try {
      let priceContext = "";
      if (IS_LOCAL && mode === "stock") {
        // Inject real price so Claude doesn't fabricate it
        try {
          const pd = await fetchLivePrices([input.toUpperCase()]);
          const d = pd?.details?.[input.toUpperCase()];
          if (d) priceContext = ` CURRENT PRICE: $${d.price?.toFixed(2)}, change ${d.change?.toFixed(2)} (${d.changePct?.toFixed(2)}%). Use these exact numbers.`;
        } catch(e) { /* non-fatal */ }
      }
      const isStock = mode === "stock";
      const prompt = `You are a Bloomberg Intelligence senior analyst. Research: "${input}" (mode: ${mode}).${priceContext}
Return ONLY JSON: {"query":"${input}","type":"${mode}","headline":"1-line research headline","verdict":"OVERWEIGHT/NEUTRAL/UNDERWEIGHT","confidence":"HIGH/MEDIUM/LOW","priceTarget":${isStock?"number_or_null":"null"},"currentPrice":${isStock?"number_or_null":"null"},"upside":${isStock?"\"XX%\"":"null"},"summary":"3-4 sentence executive summary","bull_case":"3 sentence bull case","bear_case":"3 sentence bear case","valuation":"2 sentence valuation assessment","technicals":"2 sentence technical analysis","peerComparison":[{"name":"peer","rating":"BUY/HOLD/SELL","pt":"$XX","upside":"XX%"}],"keyThemes":["t1","t2","t3"],"watchlist":[{"trigger":"event","direction":"POSITIVE/NEGATIVE","timing":"near/medium/long term"}],"analystNote":"3 sentence first-person institutional note","dataUpdated":"${new Date().toISOString().slice(0,10)}"}`;
      const txt = await fetchAI(prompt, "Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const presets = {
    stock: ["NVDA","CRMD","RTX","LMT","FRO","XOM","GLD","META","AAPL"],
    sector: ["Defense & Aerospace","Oil & Gas E&P","Tanker Shipping","Semiconductor","Financial Technology","Gold Miners"],
    theme: ["AI infrastructure buildout","Geopolitical risk premium","Iran sanctions energy","Rate cut cycle impact","Defense budget expansion"],
  };

  const vC = { OVERWEIGHT:C.green, BULLISH:C.green, NEUTRAL:C.amber, UNDERWEIGHT:C.red, BEARISH:C.red };
  const vcolor = vC[data?.verdict] || C.text;

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        {["stock","sector","theme"].map(m => (
          <button key={m} onClick={()=>setMode(m)} style={{ background:mode===m?C.blue+"22":"transparent", color:mode===m?C.blue:C.muted, border:`1px solid ${mode===m?C.blue:C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:700, padding:"6px 18px", cursor:"pointer", letterSpacing:1 }}>
            {m.toUpperCase()}
          </button>
        ))}
        <div style={{ flex:1 }}>
          <SearchInput value={input} onChange={setInput} onSubmit={load} placeholder={`ENTER ${mode.toUpperCase()} TO RESEARCH`} />
        </div>
      </div>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:16 }}>
        {(presets[mode]||[]).map(p => <button key={p} onClick={()=>{setInput(p);}} style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"4px 10px", cursor:"pointer" }}>{p}</button>)}
      </div>
      {loading && <Loader msg={`RUNNING BI ANALYSIS: ${input.toUpperCase()}`} />}
      {data && (
        <div>
          {/* Research Header */}
          <div style={{ background:"#080808", border:`1px solid ${C.borderBright}`, padding:"14px 18px", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
              <div>
                <Mono color={C.blue} size={10} weight={700} spacing={2}>BLOOMBERG INTELLIGENCE</Mono>
                <div style={{ marginTop:6 }}><Mono color={C.white} size={14} weight={700}>{data.headline}</Mono></div>
                <div style={{ marginTop:6 }}>
                  <Mono color={C.textDim} size={9}>{data.query} · {data.type?.toUpperCase()} · Updated: {data.dataUpdated}</Mono>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ background:vcolor+"22", border:`1px solid ${vcolor}`, padding:"8px 16px", marginBottom:8 }}>
                  <Mono color={vcolor} size={16} weight={700}>{data.verdict}</Mono>
                  <div><Mono color={C.textDim} size={8} spacing={1}>CONFIDENCE: {data.confidence}</Mono></div>
                </div>
                {data.priceTarget && <div>
                  <div><Mono color={C.textDim} size={9}>PRICE TARGET </Mono><Mono color={C.white} size={12} weight={600}>${data.priceTarget}</Mono></div>
                  <div><Mono color={C.textDim} size={9}>CURRENT </Mono><Mono color={C.text} size={11}>${data.currentPrice}</Mono></div>
                  <div><Mono color={vcolor} size={11} weight={700}>{data.upside} UPSIDE</Mono></div>
                </div>}
              </div>
            </div>
            <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:"0 0 10px" }}>{data.summary}</p>
            <div style={{ background:"#050508", border:`1px solid ${C.blue}22`, padding:"10px 14px", marginTop:8 }}>
              <Mono color={C.blue} size={9} spacing={1} weight={700}>ANALYST NOTE: </Mono>
              <Mono color={C.text} size={11} style={{lineHeight:1.8,display:"block",marginTop:4}}>{data.analystNote}</Mono>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
            <PanelBox title="▲ BULL CASE" titleColor={C.green}>
              <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:11, lineHeight:1.8, margin:0 }}>{data.bull_case}</p>
            </PanelBox>
            <PanelBox title="▼ BEAR CASE" titleColor={C.red}>
              <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:11, lineHeight:1.8, margin:0 }}>{data.bear_case}</p>
            </PanelBox>
            <PanelBox title="◈ VALUATION & TECHNICALS" titleColor={C.amber}>
              <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:11, lineHeight:1.8, margin:"0 0 10px" }}>{data.valuation}</p>
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                <Mono color={C.textDim} size={9} spacing={1}>TECHNICALS: </Mono>
                <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:11, lineHeight:1.8, margin:"4px 0 0" }}>{data.technicals}</p>
              </div>
            </PanelBox>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            {(data.peerComparison||[]).length>0 && (
              <PanelBox title="PEER COMPARISON" titleColor={C.blue}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px 60px", gap:0, marginBottom:8 }}>
                  {["NAME","RATING","PT","UPSIDE"].map(h => <Mono key={h} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
                </div>
                {data.peerComparison.map((p,i) => {
                  const rc = {BUY:C.green,HOLD:C.amber,SELL:C.red}[p.rating]||C.text;
                  return (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px 60px", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                      <Mono color={C.text} size={10}>{p.name}</Mono>
                      <Mono color={rc} size={10} weight={600}>{p.rating}</Mono>
                      <Mono color={C.text} size={10}>{p.pt}</Mono>
                      <Mono color={rc} size={10}>{p.upside}</Mono>
                    </div>
                  );
                })}
              </PanelBox>
            )}
            <PanelBox title="WATCHLIST TRIGGERS" titleColor={C.blue}>
              {(data.watchlist||[]).map((w,i) => {
                const wc = w.direction==="POSITIVE"?C.green:C.red;
                return (
                  <div key={i} style={{ padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ background:wc+"22", color:wc, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"2px 6px" }}>{w.direction}</span>
                      <Mono color={C.muted} size={9}>{w.timing}</Mono>
                    </div>
                    <Mono color={C.text} size={11} style={{lineHeight:1.5,display:"block"}}>{w.trigger}</Mono>
                  </div>
                );
              })}
            </PanelBox>
          </div>

          {(data.keyThemes||[]).length>0 && (
            <PanelBox title="KEY THEMES">
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {data.keyThemes.map((t,i) => <span key={i} style={{ background:C.blue+"22", color:C.blue, fontFamily:"'IBM Plex Mono',monospace", fontSize:10, padding:"4px 12px", border:`1px solid ${C.blue}44` }}>{t}</span>)}
              </div>
            </PanelBox>
          )}
        </div>
      )}
    </div>
  );
}

// ─── F8: ECO — ECONOMIC CALENDAR ────────────────────────────────────────────
function ECOPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");

  const load = async () => {
    setLoading(true); setData(null);
    try {
      if (IS_LOCAL) {
        const d = await fetchEcoCalendar();
        if (d.error || d["Error Message"] || d["Information"]) {
          const msg = d.error || d["Error Message"] || d["Information"] || "API error";
          setData({ events: [], error: msg.includes("ALPHA_VANTAGE") ? msg : `Alpha Vantage: ${msg.slice(0,120)}` });
          setLoading(false); return;
        }
        // AV returns array of event objects
        const raw = Array.isArray(d) ? d : (d.data || []);
        const events = raw.map(e => {
          const actual = e.actual || "";
          const est    = e.estimate || e.forecast || "";
          let surprise = "TBD";
          if (actual && actual !== "" && est && est !== "") {
            const a = parseFloat(actual), f = parseFloat(est);
            if (!isNaN(a) && !isNaN(f)) surprise = a > f ? "BEAT" : a < f ? "MISS" : "IN-LINE";
          }
          return {
            date:        e.date || "",
            time:        e.time || "—",
            country:     e.country || "US",
            event:       e.event || e.name || "",
            importance:  e.impact === "High" ? "HIGH" : e.impact === "Medium" ? "MEDIUM" : "LOW",
            previous:    e.previous || "—",
            forecast:    est || "N/A",
            actual:      actual || "TBD",
            surprise,
            marketImpact:"TBD",
            notes:       "",
          };
        });
        setData({ events: events.slice(0, 35) });
      } else {
        const prompt = `Search for the economic calendar for the next 2 weeks. Return ONLY JSON: {"period":"next 2 weeks","events":[{"date":"YYYY-MM-DD","time":"HH:MM ET","country":"US/EU/UK/JP/CN","event":"name","importance":"HIGH/MEDIUM/LOW","previous":"value","forecast":"value","actual":"value or TBD","surprise":"BEAT/MISS/IN-LINE/TBD","marketImpact":"BULLISH/BEARISH/NEUTRAL/TBD","notes":"1 sentence"}]} 20-25 events. HIGH=Fed,NFP,CPI,GDP.`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed);
      }
    } catch(e) {
      setData({ events: [], error: e.message.includes("ALPHA_VANTAGE_KEY")
        ? "Set ALPHA_VANTAGE_KEY env var. Free key at alphavantage.co/support/#api-key"
        : e.message });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const importanceColor = { HIGH:C.red, MEDIUM:C.amber, LOW:C.textDim };
  const impactColor = { BULLISH:C.green, BEARISH:C.red, NEUTRAL:C.textDim, TBD:C.muted };
  const surpriseColor = { BEAT:C.green, MISS:C.red, "IN-LINE":C.textDim, TBD:C.muted };
  const filters = ["ALL","HIGH","MEDIUM","US","EU","JP"];

  const filtered = (data?.events||[]).filter(e => {
    if (filter==="ALL") return true;
    if (filter==="HIGH"||filter==="MEDIUM") return e.importance===filter;
    return e.country===filter;
  });

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ display:"flex", gap:6 }}>
          {filters.map(f => <button key={f} onClick={()=>setFilter(f)} style={{ background:filter===f?C.amber+"22":"transparent", color:filter===f?C.amber:C.muted, border:`1px solid ${filter===f?C.amber:C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, padding:"4px 12px", cursor:"pointer", letterSpacing:1 }}>{f}</button>)}
        </div>
        <Btn onClick={load} disabled={loading} variant="outline" color={C.amber}>{loading?"LOADING...":"↺ REFRESH"}</Btn>
      </div>
      {loading && <Loader msg="FETCHING ECONOMIC CALENDAR" />}
      {data && (
        <div>
          <div style={{ background:C.panel, border:`1px solid ${C.border}` }}>
            <div style={{ display:"grid", gridTemplateColumns:"90px 70px 45px 200px 70px 80px 80px 80px 80px 1fr", background:"#0A0A0A", padding:"7px 12px", borderBottom:`1px solid ${C.border}` }}>
              {["DATE","TIME","CTY","EVENT","IMP","PREV","FCST","ACTUAL","SURPRISE","NOTES"].map(h => <Mono key={h} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
            </div>
            {filtered.map((e,i) => {
              const isActual = e.actual && e.actual !== "TBD";
              return (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"90px 70px 45px 200px 70px 80px 80px 80px 80px 1fr", padding:"7px 12px", borderBottom:`1px solid ${C.border}`, background:e.importance==="HIGH"?"#0A0600":"transparent" }}>
                  <Mono color={C.text} size={10}>{e.date}</Mono>
                  <Mono color={C.textDim} size={10}>{e.time}</Mono>
                  <Mono color={C.muted} size={10}>{e.country}</Mono>
                  <Mono color={C.white} size={10} weight={e.importance==="HIGH"?700:400}>{e.event}</Mono>
                  <span style={{ background:importanceColor[e.importance]+"22", color:importanceColor[e.importance], fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"2px 4px", alignSelf:"center", height:"fit-content" }}>{e.importance}</span>
                  <Mono color={C.textDim} size={10}>{e.previous||"—"}</Mono>
                  <Mono color={C.cyan} size={10}>{e.forecast||"—"}</Mono>
                  <Mono color={isActual?C.white:C.muted} size={10} weight={isActual?600:400}>{e.actual||"—"}</Mono>
                  <Mono color={surpriseColor[e.surprise]||C.text} size={10} weight={e.surprise&&e.surprise!=="TBD"?600:400}>{e.surprise||"—"}</Mono>
                  <Mono color={C.textDim} size={9} style={{lineHeight:1.5}}>{e.notes}</Mono>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:8, display:"flex", gap:16 }}>
            {[["HIGH",C.red],["MEDIUM",C.amber],["LOW",C.textDim]].map(([l,c]) => <div key={l} style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,background:c}}/><Mono color={C.muted} size={9}>{l} IMPORTANCE</Mono></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F9: FS — FINANCIAL SUMMARY (Bloomberg FA/FS equivalent) ─────────────────
function FSPanel() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("IS"); // IS, BS, CF, RATIOS

  const load = async () => {
    if (!input.trim()) return;
    setLoading(true); setData(null);
    const sym = input.toUpperCase().trim();
    try {
      if (IS_LOCAL) {
        const [finRes, quoteRes] = await Promise.all([
          fetchYahooFinancials(sym),
          fetchYahooQuote(sym),
        ]);
        const fin     = finRes?.quoteSummary?.result?.[0] || {};
        const q       = quoteRes?.quoteSummary?.result?.[0] || {};
        const finData = q.financialData || {};
        const stats   = q.defaultKeyStatistics || {};
        const summ    = q.summaryDetail || {};
        const price   = q.price || {};

        const IS = fin.incomeStatementHistory?.incomeStatementHistory || [];
        const BS = fin.balanceSheetHistory?.balanceSheetStatements || [];
        const CF = fin.cashflowStatementHistory?.cashflowStatements || [];

        const rv  = (obj, key) => { const v = obj?.[key]; return v?.raw ?? v ?? null; };
        const pct = v => v != null ? `${(v * 100).toFixed(1)}%` : "N/A";

        // Build period labels from statement dates
        const periods = IS.slice(0,4).reverse().map(s => {
          const ts = rv(s, "endDate"); if (!ts) return "N/A";
          return `FY${new Date(ts * 1000).getFullYear()}`;
        });
        const arr = (stmts, key) => stmts.slice(0,4).reverse().map(s => rv(s, key));

        const revArr = arr(IS, "totalRevenue");
        const gpArr  = arr(IS, "grossProfit");
        const niArr  = arr(IS, "netIncome");
        const epsArr = arr(IS, "dilutedEPS");
        const bsLast = BS[0] || {};
        const cfLast = CF[0] || {};
        const totalDebt = (rv(bsLast,"longTermDebt")||0) + (rv(bsLast,"shortLongTermDebt")||rv(bsLast,"shortBorrowings")||0);
        const cash      = rv(bsLast,"cash") || 0;
        const netDebt   = totalDebt - cash;

        // Claude: quality assessment only — 2 sentences each, ~250 tokens out
        const ctx = `${sym} revenue trend: ${revArr.map(v => fmtNum(v)).join("→")}, net income: ${niArr.map(v => fmtNum(v)).join("→")}, FCF: ${fmtNum(rv(cfLast,"freeCashflow"))}, total debt: ${fmtNum(totalDebt)}, equity: ${fmtNum(rv(bsLast,"totalStockholderEquity"))}`;
        const aiTxt = await fetchAI(
          `Assess financial quality for ${sym}. Data: ${ctx}. Return ONLY JSON: {"earningsQuality":"2 sentences on cash conversion and accruals","balanceSheetStrength":"2 sentences on leverage and liquidity","assessment":"STRONG/ADEQUATE/WEAK"}`,
          "Return ONLY valid JSON.", 300
        );
        const qa = parseJSON(aiTxt) || { earningsQuality: "See data.", balanceSheetStrength: "See data.", assessment: "ADEQUATE" };

        setData({
          ticker: sym, company: price.longName || sym, currency: "USD",
          period: periods[periods.length-1] || "Latest", reportDate: "Latest available",
          incomeStatement: {
            periods: periods.length ? periods : ["FY2021","FY2022","FY2023","FY2024"],
            revenue:      revArr,
            grossProfit:  gpArr,
            ebitda:       arr(IS, "ebitda"),
            ebit:         arr(IS, "ebit"),
            netIncome:    niArr,
            eps:          epsArr,
            grossMargin:  gpArr.map((gp,i) => revArr[i] ? pct(gp/revArr[i]) : "N/A"),
            ebitdaMargin: arr(IS,"ebitda").map((e,i) => revArr[i] ? pct(e/revArr[i]) : "N/A"),
            netMargin:    niArr.map((ni,i) => revArr[i] ? pct(ni/revArr[i]) : "N/A"),
            revenueGrowth:revArr.map((v,i) => (!i || !revArr[i-1]) ? "N/A" : `${(((v/revArr[i-1])-1)*100).toFixed(1)}%`),
          },
          balanceSheet: {
            cash, totalCurrentAssets: rv(bsLast,"totalCurrentAssets"),
            totalAssets: rv(bsLast,"totalAssets"),
            shortTermDebt: rv(bsLast,"shortLongTermDebt") || rv(bsLast,"shortBorrowings"),
            longTermDebt: rv(bsLast,"longTermDebt"), totalDebt, netDebt,
            totalLiabilities: rv(bsLast,"totalLiab"),
            shareholdersEquity: rv(bsLast,"totalStockholderEquity"),
            bookValuePerShare: rv(stats,"bookValue"),
          },
          cashFlow: {
            operatingCF:      rv(cfLast,"totalCashFromOperatingActivities"),
            capex:            rv(cfLast,"capitalExpenditures"),
            freeCashFlow:     rv(cfLast,"freeCashflow") || rv(finData,"freeCashflow"),
            dividendsPaid:    rv(cfLast,"dividendsPaid"),
            shareRepurchases: rv(cfLast,"repurchaseOfStock"),
            periods: CF.slice(0,3).reverse().map(s => { const ts=rv(s,"endDate"); return ts?`FY${new Date(ts*1000).getFullYear()}`:"N/A"; }),
            fcfHistory: CF.slice(0,3).reverse().map(s => rv(s,"freeCashflow")),
          },
          keyRatios: {
            pe:           rv(summ,"trailingPE"),       forwardPe:   rv(summ,"forwardPE"),
            pb:           rv(stats,"priceToBook"),     evEbitda:    rv(stats,"enterpriseToEbitda"),
            evRevenue:    rv(stats,"enterpriseToRevenue"), debtEbitda: null,
            currentRatio: rv(finData,"currentRatio"),  quickRatio: rv(finData,"quickRatio"),
            roe: pct(rv(finData,"returnOnEquity")),     roa: pct(rv(finData,"returnOnAssets")),
            roic: "N/A", fcfYield: "N/A", dividendYield: pct(rv(summ,"dividendYield")) || "N/A",
          },
          guidance: { revenue: "N/A", eps: "N/A", notes: "See latest earnings release." },
          qualityScore: qa,
        });
      } else {
        const prompt = `Find financial statements for ${sym} with 3-year trend. Return ONLY JSON: {"ticker":"${sym}","company":"name","currency":"USD","period":"FY2024","reportDate":"date","incomeStatement":{"periods":["FY2022","FY2023","FY2024","TTM"],"revenue":[n,n,n,n],"grossProfit":[n,n,n,n],"ebitda":[n,n,n,n],"ebit":[n,n,n,n],"netIncome":[n,n,n,n],"eps":[n,n,n,n],"grossMargin":["XX%","XX%","XX%","XX%"],"ebitdaMargin":["XX%","XX%","XX%","XX%"],"netMargin":["XX%","XX%","XX%","XX%"],"revenueGrowth":["N/A","XX%","XX%","XX%"]},"balanceSheet":{"cash":n,"shortTermInvestments":n,"totalCurrentAssets":n,"totalAssets":n,"shortTermDebt":n,"longTermDebt":n,"totalDebt":n,"totalLiabilities":n,"shareholdersEquity":n,"bookValuePerShare":n,"netDebt":n},"cashFlow":{"operatingCF":n,"capex":n,"freeCashFlow":n,"dividendsPaid":n,"shareRepurchases":n,"periods":["FY2022","FY2023","FY2024"],"fcfHistory":[n,n,n]},"keyRatios":{"pe":n,"forwardPe":n,"pb":n,"evEbitda":n,"evRevenue":n,"debtEbitda":n,"currentRatio":n,"quickRatio":n,"roe":"XX%","roa":"XX%","roic":"XX%","fcfYield":"XX%","dividendYield":"XX%"},"guidance":{"revenue":"N/A","eps":"N/A","notes":"1 sentence"},"qualityScore":{"assessment":"STRONG/ADEQUATE/WEAK","earningsQuality":"2 sentences","balanceSheetStrength":"2 sentences"}}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const quickTix = ["AAPL","NVDA","CRMD","XOM","RTX","LMT","FRO","META","JPM","MSFT"];
  const fmt = (n) => n ? `$${(n/1000).toFixed(1)}B` : "—";
  const fmtM = (n) => n != null ? `$${n.toFixed(0)}M` : "—";
  const cc = (v) => {
    if (!v || v==="N/A") return C.text;
    const n = parseFloat(v);
    return n > 0 ? C.green : C.red;
  };

  return (
    <div>
      <div style={{ marginBottom:10 }}><SearchInput value={input} onChange={setInput} onSubmit={load} placeholder="ENTER TICKER FOR FULL FINANCIAL STATEMENTS" /></div>
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {quickTix.map(t => <button key={t} onClick={()=>setInput(t)} style={{ background:"transparent", color:C.textDim, border:`1px solid ${C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"3px 10px", cursor:"pointer", letterSpacing:1 }}>{t}</button>)}
      </div>
      {loading && <Loader msg={`LOADING FINANCIAL STATEMENTS: ${input.toUpperCase()}`} />}
      {data && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div>
              <Mono color={C.green} size={14} weight={700} spacing={2}>{data.ticker}</Mono>
              <Mono color={C.textDim} size={10} style={{marginLeft:12}}>{data.company}</Mono>
              <Mono color={C.muted} size={9} style={{marginLeft:12}}>Period: {data.period} · Reported: {data.reportDate} · {data.currency}</Mono>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {[["IS","INCOME STMT"],["BS","BALANCE SHEET"],["CF","CASH FLOW"],["RATIOS","KEY RATIOS"]].map(([k,l]) => (
                <button key={k} onClick={()=>setTab(k)} style={{ background:tab===k?C.green+"22":"transparent", color:tab===k?C.green:C.muted, border:`1px solid ${tab===k?C.green:C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, padding:"5px 12px", cursor:"pointer", letterSpacing:1 }}>{k}</button>
              ))}
            </div>
          </div>

          {tab === "IS" && data.incomeStatement && (
            <PanelBox title="INCOME STATEMENT (USD millions)">
              <div style={{ display:"grid", gridTemplateColumns:"180px repeat(4,1fr)", gap:0 }}>
                <Mono color={C.amber} size={9} spacing={1} style={{padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>METRIC</Mono>
                {(data.incomeStatement.periods||[]).map(p => <Mono key={p} color={C.amber} size={9} spacing={0.5} style={{padding:"6px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"right",display:"block"}}>{p}</Mono>)}
                {[
                  ["REVENUE",           data.incomeStatement.revenue,      C.cyan,  true],
                  ["GROSS PROFIT",      data.incomeStatement.grossProfit,   C.green, false],
                  ["EBITDA",            data.incomeStatement.ebitda,        C.green, false],
                  ["EBIT",              data.incomeStatement.ebit,          C.text,  false],
                  ["NET INCOME",        data.incomeStatement.netIncome,     C.green, true],
                  ["EPS",               data.incomeStatement.eps,           C.text,  false],
                  ["──────────────────", null,                               C.border,false],
                  ["GROSS MARGIN",      data.incomeStatement.grossMargin,   C.green, false],
                  ["EBITDA MARGIN",     data.incomeStatement.ebitdaMargin,  C.green, false],
                  ["NET MARGIN",        data.incomeStatement.netMargin,     C.green, false],
                  ["REVENUE GROWTH",    data.incomeStatement.revenueGrowth, C.cyan,  false],
                ].map(([label, vals, color, bold]) => (
                  <>
                    <Mono key={label} color={label.startsWith("─")?C.border:C.textDim} size={label.startsWith("─")?8:10} style={{padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>{label}</Mono>
                    {label.startsWith("─") ? (data.incomeStatement.periods||[]).map((_,j) => <span key={j} style={{borderBottom:`1px solid ${C.border}`}}/>) :
                    (vals||[]).map((v,j) => {
                      const isStr = typeof v === "string";
                      return (
                        <Mono key={j} color={isStr?cc(v):v<0?C.red:color} size={11} weight={bold?700:500}
                          style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"right",display:"block"}}>
                          {isStr ? v : (v != null ? (Math.abs(v)>1000?`${(v/1000).toFixed(1)}B`:`${v.toFixed(0)}M`) : "—")}
                        </Mono>
                      );
                    })}
                  </>
                ))}
              </div>
            </PanelBox>
          )}

          {tab === "BS" && data.balanceSheet && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <PanelBox title="ASSETS (USD millions)">
                <StatRow label="CASH & EQUIVALENTS" value={fmtM(data.balanceSheet.cash)} color={C.green} />
                <StatRow label="SHORT-TERM INVESTMENTS" value={fmtM(data.balanceSheet.shortTermInvestments)} />
                <StatRow label="TOTAL CURRENT ASSETS" value={fmtM(data.balanceSheet.totalCurrentAssets)} />
                <StatRow label="TOTAL ASSETS" value={fmtM(data.balanceSheet.totalAssets)} color={C.cyan} bold />
                <StatRow label="BOOK VALUE / SHARE" value={data.balanceSheet.bookValuePerShare?`$${data.balanceSheet.bookValuePerShare.toFixed(2)}`:"—"} />
              </PanelBox>
              <PanelBox title="LIABILITIES & CAPITAL">
                <StatRow label="SHORT-TERM DEBT" value={fmtM(data.balanceSheet.shortTermDebt)} color={C.red} />
                <StatRow label="LONG-TERM DEBT" value={fmtM(data.balanceSheet.longTermDebt)} color={C.red} />
                <StatRow label="TOTAL DEBT" value={fmtM(data.balanceSheet.totalDebt)} color={C.red} bold />
                <StatRow label="NET DEBT" value={fmtM(data.balanceSheet.netDebt)} color={data.balanceSheet.netDebt>0?C.red:C.green} />
                <StatRow label="TOTAL LIABILITIES" value={fmtM(data.balanceSheet.totalLiabilities)} />
                <StatRow label="SHAREHOLDERS' EQUITY" value={fmtM(data.balanceSheet.shareholdersEquity)} color={C.cyan} bold />
              </PanelBox>
              <PanelBox title="EARNINGS QUALITY" style={{gridColumn:"1/-1"}}>
                <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:0 }}>{data.qualityScore?.earningsQuality}</p>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8, marginTop:8 }}>
                  <Mono color={C.textDim} size={9} spacing={1}>BALANCE SHEET: </Mono>
                  <Mono color={C.text} size={11}>{data.qualityScore?.balanceSheetStrength}</Mono>
                </div>
                <div style={{ marginTop:8 }}>
                  <span style={{ background:(data.qualityScore?.assessment==="STRONG"?C.green:data.qualityScore?.assessment==="WEAK"?C.red:C.amber)+"22", color:data.qualityScore?.assessment==="STRONG"?C.green:data.qualityScore?.assessment==="WEAK"?C.red:C.amber, fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:700, padding:"4px 12px" }}>
                    QUALITY: {data.qualityScore?.assessment}
                  </span>
                </div>
              </PanelBox>
            </div>
          )}

          {tab === "CF" && data.cashFlow && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
                {[
                  { label:"OPERATING CASH FLOW",  value:data.cashFlow.operatingCF,   color:C.green },
                  { label:"CAPITAL EXPENDITURE",  value:data.cashFlow.capex,          color:C.red   },
                  { label:"FREE CASH FLOW (TTM)", value:data.cashFlow.freeCashFlow,   color:C.cyan  },
                  { label:"DIVIDENDS PAID",       value:data.cashFlow.dividendsPaid,  color:C.amber },
                  { label:"SHARE REPURCHASES",    value:data.cashFlow.shareRepurchases,color:C.purple},
                ].map(({label,value,color}) => (
                  <div key={label} style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"12px" }}>
                    <Mono color={C.textDim} size={9} style={{display:"block",marginBottom:6}}>{label}</Mono>
                    <Mono color={color} size={16} weight={700}>{value!=null?`$${Math.abs(value).toFixed(0)}M`:"—"}</Mono>
                  </div>
                ))}
              </div>
              <PanelBox title="FREE CASH FLOW TREND (USD millions)">
                <div style={{ display:"flex", gap:16 }}>
                  {(data.cashFlow.periods||[]).map((p,i) => {
                    const v = data.cashFlow.fcfHistory?.[i];
                    const maxV = Math.max(...(data.cashFlow.fcfHistory||[]).map(Math.abs));
                    const pct = maxV ? Math.abs(v)/maxV*100 : 0;
                    return (
                      <div key={p} style={{ flex:1, textAlign:"center" }}>
                        <Mono color={v>0?C.green:C.red} size={13} weight={700} style={{display:"block",marginBottom:8}}>${v?.toFixed(0)}M</Mono>
                        <div style={{ height:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                          <div style={{ width:40, height:`${pct}%`, background:v>0?C.green:C.red, opacity:0.8 }} />
                        </div>
                        <Mono color={C.textDim} size={9} style={{display:"block",marginTop:6}}>{p}</Mono>
                      </div>
                    );
                  })}
                </div>
              </PanelBox>
            </div>
          )}

          {tab === "RATIOS" && data.keyRatios && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              <PanelBox title="VALUATION">
                <StatRow label="P/E (TTM)"      value={data.keyRatios.pe}          color={C.cyan} />
                <StatRow label="P/E (FWD)"      value={data.keyRatios.forwardPe}   color={C.cyan} />
                <StatRow label="PRICE/BOOK"     value={data.keyRatios.pb} />
                <StatRow label="EV/EBITDA"      value={data.keyRatios.evEbitda}    color={C.cyan} />
                <StatRow label="EV/REVENUE"     value={data.keyRatios.evRevenue} />
                <StatRow label="FCF YIELD"      value={data.keyRatios.fcfYield}    color={C.green} />
                <StatRow label="DIV YIELD"      value={data.keyRatios.dividendYield||"N/A"} />
              </PanelBox>
              <PanelBox title="LEVERAGE">
                <StatRow label="DEBT/EBITDA"    value={data.keyRatios.debtEbitda}  color={data.keyRatios.debtEbitda>4?C.red:C.text} />
                <StatRow label="INT COVERAGE"   value={data.keyRatios.interestCoverage} />
                <StatRow label="CURRENT RATIO"  value={data.keyRatios.currentRatio} />
                <StatRow label="QUICK RATIO"    value={data.keyRatios.quickRatio} />
              </PanelBox>
              <PanelBox title="RETURNS">
                <StatRow label="ROE"            value={data.keyRatios.roe}  color={C.green} bold />
                <StatRow label="ROA"            value={data.keyRatios.roa}  color={C.green} />
                <StatRow label="ROIC"           value={data.keyRatios.roic} color={C.green} bold />
              </PanelBox>
              {data.guidance && (
                <PanelBox title="MANAGEMENT GUIDANCE" style={{gridColumn:"1/-1"}}>
                  <div style={{ display:"flex", gap:16 }}>
                    <div style={{flex:1}}><Mono color={C.textDim} size={9}>REVENUE GUIDE:</Mono> <Mono color={C.cyan} size={12} weight={600}>{data.guidance.revenue}</Mono></div>
                    <div style={{flex:1}}><Mono color={C.textDim} size={9}>EPS GUIDE:</Mono> <Mono color={C.cyan} size={12} weight={600}>{data.guidance.eps}</Mono></div>
                  </div>
                  <Mono color={C.textDim} size={10} style={{display:"block",marginTop:8,lineHeight:1.6}}>{data.guidance.notes}</Mono>
                </PanelBox>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── F10: WEI — WORLD EQUITY INDICES ────────────────────────────────────────
function WEIPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("overview"); // overview | heatmap | sector

  const load = async () => {
    setLoading(true); setData(null);
    try {
      if (IS_LOCAL) {
        // Pure Yahoo Finance — zero Claude cost
        const [indRes, secRes] = await Promise.all([
          fetchWorldIndices(),
          fetchLivePrices(["XLK","XLE","XLF","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"]).catch(() => ({ details: {} })),
        ]);
        const secNames = { XLK:"Technology",XLE:"Energy",XLF:"Financials",XLV:"Healthcare",
          XLI:"Industrials",XLY:"Consumer Disc",XLP:"Consumer Staples",
          XLU:"Utilities",XLB:"Materials",XLRE:"Real Estate",XLC:"Communication" };
        const sectorPerformance = Object.keys(secNames).map(s => ({
          sector: secNames[s], changePct: secRes.details?.[s]?.changePct ?? 0, ytd: "N/A",
        }));
        setData({ ...indRes, sectorPerformance, marketNarrative: null, lastUpdated: indRes.timestamp });
      } else {
        const prompt = `Search current global equity market data. Return ONLY JSON: {"lastUpdated":"datetime","regions":[{"region":"NORTH AMERICA","indices":[{"name":"S&P 500","ticker":"SPX","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"NASDAQ 100","ticker":"NDX","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"DJIA","ticker":"DJIA","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Russell 2000","ticker":"RUT","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"TSX Composite","ticker":"TSX","country":"CA","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"}]},{"region":"EUROPE","indices":[{"name":"Euro Stoxx 50","ticker":"SX5E","country":"EU","value":number,"changePct":number,"ytd":"XX%"},{"name":"FTSE 100","ticker":"UKX","country":"UK","value":number,"changePct":number,"ytd":"XX%"},{"name":"DAX","ticker":"DAX","country":"DE","value":number,"changePct":number,"ytd":"XX%"},{"name":"CAC 40","ticker":"CAC","country":"FR","value":number,"changePct":number,"ytd":"XX%"}]},{"region":"ASIA PACIFIC","indices":[{"name":"Nikkei 225","ticker":"NKY","country":"JP","value":number,"changePct":number,"ytd":"XX%"},{"name":"Hang Seng","ticker":"HSI","country":"HK","value":number,"changePct":number,"ytd":"XX%"},{"name":"CSI 300","ticker":"SHSZ300","country":"CN","value":number,"changePct":number,"ytd":"XX%"}]},{"region":"EMERGING MARKETS","indices":[{"name":"MSCI EM","ticker":"MXEF","country":"EM","value":number,"changePct":number,"ytd":"XX%"},{"name":"Bovespa","ticker":"IBOV","country":"BR","value":number,"changePct":number,"ytd":"XX%"}]}],"sectorPerformance":[{"sector":"Technology","changePct":number,"ytd":"XX%"},{"sector":"Energy","changePct":number,"ytd":"XX%"},{"sector":"Financials","changePct":number,"ytd":"XX%"},{"sector":"Healthcare","changePct":number,"ytd":"XX%"},{"sector":"Industrials","changePct":number,"ytd":"XX%"},{"sector":"Consumer Disc","changePct":number,"ytd":"XX%"},{"sector":"Utilities","changePct":number,"ytd":"XX%"},{"sector":"Materials","changePct":number,"ytd":"XX%"},{"sector":"Communication","changePct":number,"ytd":"XX%"}],"marketNarrative":"3 sentence global narrative"}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 2000);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const cc = v => v > 0 ? C.green : v < 0 ? C.red : C.text;
  const heatColor = (pct) => {
    if (pct > 1.5) return "#00E676";
    if (pct > 0.5) return "#69F0AE";
    if (pct > 0)   return "#B9F6CA";
    if (pct > -0.5)return "#FF8A80";
    if (pct > -1.5)return "#FF5252";
    return "#FF1744";
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ display:"flex", gap:6 }}>
          {[["overview","OVERVIEW"],["heatmap","HEATMAP"],["sector","S&P SECTORS"]].map(([k,l]) => (
            <button key={k} onClick={()=>setView(k)} style={{ background:view===k?C.purple+"22":"transparent", color:view===k?C.purple:C.muted, border:`1px solid ${view===k?C.purple:C.border}`, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, padding:"5px 14px", cursor:"pointer", letterSpacing:1 }}>{l}</button>
          ))}
        </div>
        <Btn onClick={load} disabled={loading} variant="outline" color={C.purple}>{loading?"LOADING...":"↺ REFRESH"}</Btn>
      </div>

      {loading && <Loader msg="FETCHING GLOBAL INDICES" />}

      {data && view === "overview" && (
        <div>
          {(data.regions||[]).map(region => (
            <PanelBox key={region.region} title={region.region} titleColor={C.purple} style={{marginBottom:10}}>
              <div style={{ display:"grid", gridTemplateColumns:"45px 170px 40px 110px 100px 80px 80px", gap:0, marginBottom:8 }}>
                {["CTY","INDEX","TICKER","VALUE","DAY %","WTD %","YTD %"].map(h => <Mono key={h} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
              </div>
              {(region.indices||[]).map(idx => (
                <div key={idx.ticker} style={{ display:"grid", gridTemplateColumns:"45px 170px 40px 110px 100px 80px 80px", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ background:C.purple+"22", color:C.purple, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, fontWeight:700, padding:"1px 4px", alignSelf:"center", height:"fit-content" }}>{idx.country}</span>
                  <Mono color={C.white} size={11} weight={600}>{idx.name}</Mono>
                  <Mono color={C.muted} size={9}>{idx.ticker}</Mono>
                  <Mono color={C.text} size={12} weight={600}>{idx.value?.toLocaleString("en",{maximumFractionDigits:2})}</Mono>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:40, height:4, background:"#1A1A1A", borderRadius:2 }}>
                      <div style={{ width:`${Math.min(100,Math.abs(idx.changePct)*20)}%`, height:"100%", background:cc(idx.changePct), borderRadius:2 }} />
                    </div>
                    <Mono color={cc(idx.changePct)} size={11} weight={600}>{idx.changePct>0?"+":""}{idx.changePct?.toFixed(2)}%</Mono>
                  </div>
                  <Mono color={cc(parseFloat(idx.weekChange))} size={10}>{idx.weekChange}</Mono>
                  <Mono color={cc(parseFloat(idx.ytd))} size={10}>{idx.ytd}</Mono>
                </div>
              ))}
            </PanelBox>
          ))}
        </div>
      )}

      {data && view === "heatmap" && (
        <div>
          <Mono color={C.textDim} size={9} spacing={1} style={{display:"block",marginBottom:12}}>GLOBAL INDEX HEATMAP — DAY PERFORMANCE</Mono>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:6, marginBottom:16 }}>
            {(data.regions||[]).flatMap(r => r.indices||[]).map(idx => (
              <div key={idx.ticker} style={{ background:heatColor(idx.changePct)+"33", border:`1px solid ${heatColor(idx.changePct)}66`, padding:"12px 10px", textAlign:"center" }}>
                <Mono color={C.white} size={9} weight={700} style={{display:"block"}}>{idx.name}</Mono>
                <Mono color={heatColor(idx.changePct)} size={16} weight={700} style={{display:"block",margin:"6px 0"}}>{idx.changePct>0?"+":""}{idx.changePct?.toFixed(2)}%</Mono>
                <Mono color={C.muted} size={8} style={{display:"block"}}>{idx.value?.toLocaleString("en",{maximumFractionDigits:0})}</Mono>
                <span style={{ background:C.muted+"33", color:C.muted, fontFamily:"'IBM Plex Mono',monospace", fontSize:7, padding:"1px 4px", marginTop:4, display:"inline-block" }}>{idx.country}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && view === "sector" && (
        <div>
          <Mono color={C.textDim} size={9} spacing={1} style={{display:"block",marginBottom:12}}>S&P 500 SECTOR PERFORMANCE</Mono>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            {(data.sectorPerformance||[]).map(s => {
              const pct = s.changePct || 0;
              const barW = Math.min(100, Math.abs(pct) * 30);
              return (
                <div key={s.sector} style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"10px 14px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                    <Mono color={C.text} size={11}>{s.sector}</Mono>
                    <div>
                      <Mono color={cc(pct)} size={13} weight={700}>{pct>0?"+":""}{pct.toFixed(2)}%</Mono>
                      <Mono color={cc(parseFloat(s.ytd))} size={9} style={{marginLeft:10}}>YTD: {s.ytd}</Mono>
                    </div>
                  </div>
                  <div style={{ height:4, background:"#1A1A1A", borderRadius:2 }}>
                    <div style={{ width:`${barW}%`, height:"100%", background:cc(pct), borderRadius:2, marginLeft:pct<0?`${50-barW/2}%`:"50%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data?.marketNarrative && (
        <PanelBox title="GLOBAL MARKET NARRATIVE" titleColor={C.purple}>
          <p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:0 }}>{data.marketNarrative}</p>
          <Mono color={C.muted} size={8} style={{display:"block",marginTop:8}}>Last updated: {data.lastUpdated}</Mono>
        </PanelBox>
      )}
    </div>
  );
}

// ─── MAIN TERMINAL ───────────────────────────────────────────────────────────
export default function Terminal() {
  const [active, setActive] = useState("EQ");
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const af = FUNCS.find(f => f.key === active);
  const topRow = FUNCS.slice(0,5);
  const bottomRow = FUNCS.slice(5);

  return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:#030303; }
        ::-webkit-scrollbar-thumb { background:#6B450A; }
        input::placeholder { color:#6B450A; opacity:1; }
      `}</style>

      {/* Top Bar */}
      <div style={{ background:"#000", borderBottom:"2px solid #E8960C", padding:"8px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ color:"#E8960C", fontFamily:"'IBM Plex Mono',monospace", fontSize:15, fontWeight:700, letterSpacing:4 }}>▐ TERMINAL</span>
          <span style={{ color:"#6B450A", fontFamily:"'IBM Plex Mono',monospace", fontSize:9, letterSpacing:2 }}>PROFESSIONAL FINANCIAL INTELLIGENCE PLATFORM · AI-POWERED</span>
        </div>
        <div style={{ display:"flex", gap:20, alignItems:"center", fontFamily:"'IBM Plex Mono',monospace" }}>
          <span style={{ color:C.green, fontSize:9 }}>● LIVE DATA</span>
          <span style={{ color:C.textDim, fontSize:10 }}>{time.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}</span>
          <span style={{ color:"#E8960C", fontSize:13, fontWeight:700 }}>{time.toLocaleTimeString("en-US",{hour12:false})}</span>
        </div>
      </div>

      {/* Function Key Rows */}
      {[topRow, bottomRow].map((row, ri) => (
        <div key={ri} style={{ background:"#060606", borderBottom:`1px solid ${C.border}`, display:"flex", flexShrink:0 }}>
          {row.map(fn => (
            <button key={fn.key} onClick={()=>setActive(fn.key)} style={{
              background: active===fn.key ? fn.color+"18" : "transparent",
              border:"none", borderRight:`1px solid ${C.border}`,
              borderBottom:`3px solid ${active===fn.key?fn.color:"transparent"}`,
              padding:"8px 18px", cursor:"pointer", textAlign:"left",
            }}>
              <div style={{ color:C.muted, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, marginBottom:2 }}>{fn.f}</div>
              <div style={{ color:active===fn.key?fn.color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700, letterSpacing:1 }}>{fn.label}</div>
              <div style={{ color:C.muted, fontFamily:"'IBM Plex Mono',monospace", fontSize:8, letterSpacing:0.5, marginTop:1 }}>{fn.desc}</div>
            </button>
          ))}
          {ri===0 && <div style={{flex:1}}/>}
          {ri===0 && <div style={{ display:"flex", alignItems:"center", padding:"0 20px", borderLeft:`1px solid ${C.border}` }}>
            <span style={{ color:C.amberDim, fontFamily:"'IBM Plex Mono',monospace", fontSize:9 }}>GEOPOLITICAL THESIS PORTFOLIO · EXIT ~APR 2</span>
          </div>}
        </div>
      ))}

      {/* Breadcrumb */}
      <div style={{ background:"#080808", padding:"5px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
        <span style={{ color:af?.color, fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:700, letterSpacing:2 }}>{af?.key}</span>
        <span style={{ color:C.border, fontSize:12 }}>|</span>
        <span style={{ color:C.textDim, fontFamily:"'IBM Plex Mono',monospace", fontSize:9, letterSpacing:1 }}>{af?.desc}</span>
      </div>

      {/* Main Content */}
      <div style={{ flex:1, overflowY:"auto", padding:20 }}>
        {active==="EQ"    && <EQPanel />}
        {active==="PORT"  && <PORTPanel />}
        {active==="NEWS"  && <NEWSPanel />}
        {active==="MACRO" && <MACROPanel />}
        {active==="LEARN" && <LEARNPanel />}
        {active==="DES"   && <DESPanel />}
        {active==="BI"    && <BIPanel />}
        {active==="ECO"   && <ECOPanel />}
        {active==="FS"    && <FSPanel />}
        {active==="WEI"   && <WEIPanel />}
      </div>

      {/* Status Bar */}
      <div style={{ background:"#000", borderTop:`1px solid ${C.border}`, padding:"4px 20px", display:"flex", justifyContent:"space-between", flexShrink:0, fontFamily:"'IBM Plex Mono',monospace" }}>
        <span style={{ color:C.muted, fontSize:8 }}>AI-POWERED · REAL-TIME DATA VIA WEB SEARCH · FOR EDUCATIONAL USE · NOT FINANCIAL ADVICE</span>
        <span style={{ color:C.amberDim, fontSize:8 }}>POWERED BY CLAUDE + ANTHROPIC WEB SEARCH</span>
      </div>
    </div>
  );
}

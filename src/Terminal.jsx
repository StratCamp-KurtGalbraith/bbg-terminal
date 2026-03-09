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
  const s = txt.replace(/```json\n?|```\n?/g, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
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

        // Ask Claude ONLY for analysis text + catalysts + risks (cheap: ~400 tokens out)
        const briefData = `Ticker: ${sym}, Company: ${price.longName||sym}, Sector: ${profile.sector||"N/A"}, Industry: ${profile.industry||"N/A"}, Price: $${price.regularMarketPrice?.toFixed(2)}, Market Cap: ${fmtNum(price.marketCap)}, P/E: ${summary.trailingPE?.toFixed(1)||"N/A"}, Revenue: ${fmtNum(fin.totalRevenue)}, Net Margin: ${fmtPct(fin.profitMargins)}, FCF: ${fmtNum(fin.freeCashflow)}, Debt/Equity: ${fin.debtToEquity?.toFixed(1)||"N/A"}`;
        const aiPrompt = `Write a 5-sentence institutional analysis for ${sym} (${price.longName||sym}), then list exactly 3 bull catalysts and 3 risk factors. Data: ${briefData}. Return ONLY JSON: {"analysis":"5 sentences","catalysts":["c1","c2","c3"],"risks":["r1","r2","r3"]}`;
        const aiTxt = await fetchAI(aiPrompt, "Return ONLY valid JSON, no markdown.", 600);
        const ai = parseJSON(aiTxt) || { analysis: "Analysis unavailable.", catalysts: [], risks: [] };

        // Unwrap price fields (Yahoo returns {raw, fmt} objects OR plain numbers)
        const livePrice     = rv(price, "regularMarketPrice");
        const liveChange    = rv(price, "regularMarketChange");
        const liveChangePct = rv(price, "regularMarketChangePercent");

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

  const search = async (q) => {
    const query = q || input;
    if (!query.trim()) return;
    setLoading(true); setData(null);
    try {
      if (IS_LOCAL) {
        // Fetch real headlines from NewsAPI
        const newsRes = await fetchNews(query, 8);
        const articles = newsRes.articles || [];
        if (articles.length === 0) {
          setData({ topic: query, marketImpact: "NEUTRAL", execSummary: "No recent news found for this query.", tradingTake: "Insufficient data.", items: [] });
          setLoading(false); return;
        }
        // Use Claude ONLY for exec brief + trading take (cheap: ~150 tokens out)
        const headlines = articles.map((a,i) => `${i+1}. ${a.headline}`).join("\n");
        const aiTxt = await fetchAI(
          `These are real news headlines about "${query}":\n${headlines}\nWrite a 2-sentence executive brief and 1-sentence trading take. Return ONLY JSON: {"execSummary":"2 sentences","tradingTake":"1 sentence","marketImpact":"BULLISH/BEARISH/MIXED/NEUTRAL"}`,
          "Return ONLY valid JSON.", 200
        );
        const ai = parseJSON(aiTxt) || { execSummary: "See headlines below.", tradingTake: "Monitor developments.", marketImpact: "NEUTRAL" };
        setData({
          topic: query,
          marketImpact: ai.marketImpact,
          execSummary:  ai.execSummary,
          tradingTake:  ai.tradingTake,
          items: articles.map(a => ({
            headline:  a.headline,
            source:    a.source,
            date:      a.date,
            impact:    classifyHeadline(a.headline),
            summary:   a.summary?.slice(0,160) || "",
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
      <div style={{ marginBottom:10 }}><SearchInput value={input} onChange={setInput} onSubmit={()=>search()} placeholder="TICKER, TOPIC, MACRO EVENT, OR THEME" /></div>
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
      if (IS_LOCAL) {
        // Pure live data — Yahoo Finance + FRED. Zero Claude cost.
        const d = await fetchMacroData();
        const r = d.rates || {};
        const fv = v => v != null ? `${parseFloat(v).toFixed(2)}%` : "N/A";
        const spread = r.spread2s10s != null
          ? `${parseFloat(r.spread2s10s) > 0 ? "+" : ""}${(parseFloat(r.spread2s10s) * 100).toFixed(0)}bps`
          : null;
        setData({
          indices:     d.indices,
          commodities: d.commodities,
          fx:          d.fx,
          timestamp:   d.timestamp,
          fredMissing: d.fredMissing,
          rates: [
            { label: "Fed Funds Rate",  val: fv(r.fedFunds) },
            { label: "2Y Treasury",     val: fv(r.t2y)      },
            { label: "10Y Treasury",    val: fv(r.t10y ?? r.tnx) },
            { label: "30Y Treasury",    val: fv(r.t30y ?? r.tyx) },
            { label: "2s10s Spread",    val: spread ?? "N/A" },
            { label: "SOFR",            val: fv(r.sofr)     },
          ],
          macro_env: null,
        });
      } else {
        const prompt = `Search current global market data. Return ONLY JSON: {"indices":[{"name":"S&P 500","sym":"SPX","value":number,"changePct":number},{"name":"NASDAQ 100","sym":"NDX","value":number,"changePct":number},{"name":"DJIA","sym":"DJIA","value":number,"changePct":number},{"name":"Russell 2000","sym":"RUT","value":number,"changePct":number},{"name":"VIX","sym":"VIX","value":number,"changePct":number}],"rates":[{"label":"Fed Funds Rate","val":"X.XX%"},{"label":"2Y Treasury","val":"X.XX%"},{"label":"10Y Treasury","val":"X.XX%"},{"label":"30Y Treasury","val":"X.XX%"},{"label":"2s10s Spread","val":"Xbps"},{"label":"SOFR","val":"X.XX%"}],"commodities":[{"name":"WTI Crude Oil","price":number,"changePct":number},{"name":"Brent Crude","price":number,"changePct":number},{"name":"Gold","price":number,"changePct":number},{"name":"Silver","price":number,"changePct":number},{"name":"Natural Gas","price":number,"changePct":number},{"name":"Copper","price":number,"changePct":number}],"fx":[{"pair":"DXY Index","rate":number,"changePct":number},{"pair":"EUR/USD","rate":number,"changePct":number},{"pair":"GBP/USD","rate":number,"changePct":number},{"pair":"USD/JPY","rate":number,"changePct":number},{"pair":"USD/CNH","rate":number,"changePct":number}],"macro_env":"3 sentence assessment"}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON.", 1500);
        const parsed = parseJSON(txt);
        if (parsed) setData(parsed);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  const cc = v => v > 0 ? C.green : v < 0 ? C.red : C.text;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <Mono color={C.textDim} size={10} spacing={1}>GLOBAL MACRO DASHBOARD — LIVE</Mono>
        <Btn onClick={load} disabled={loading} variant="outline" color={C.amber}>{loading?"LOADING...":"↺ REFRESH"}</Btn>
      </div>
      {loading && <Loader msg="FETCHING GLOBAL MARKET DATA" />}
      {data && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <PanelBox title="EQUITY INDICES">
              {(data.indices||[]).map(idx => (
                <div key={idx.sym} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div><Mono color={C.text} size={11}>{idx.name}</Mono> <Mono color={C.muted} size={9}>{idx.sym}</Mono></div>
                  <div><Mono color={C.white} size={12} weight={600}>{idx.value?.toLocaleString("en",{maximumFractionDigits:2})}</Mono><Mono color={cc(idx.changePct)} size={10} style={{marginLeft:10}}>{idx.changePct>0?"+":""}{idx.changePct?.toFixed(2)}%</Mono></div>
                </div>
              ))}
            </PanelBox>
            <PanelBox title="US INTEREST RATES">
              {(data.rates||[]).map(r => (
                <div key={r.label} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <Mono color={C.text} size={11}>{r.label}</Mono>
                  <div><Mono color={C.cyan} size={11} weight={600}>{r.val}</Mono>{r.chg&&<Mono color={C.textDim} size={9} style={{marginLeft:8}}>{r.chg}</Mono>}</div>
                </div>
              ))}
            </PanelBox>
            <PanelBox title="COMMODITIES">
              {(data.commodities||[]).map(c => (
                <div key={c.name} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <Mono color={C.text} size={11}>{c.name}</Mono>
                  <div><Mono color={C.white} size={11} weight={600}>${c.price?.toFixed(2)}</Mono><Mono color={cc(c.changePct)} size={10} style={{marginLeft:10}}>{c.changePct>0?"+":""}{c.changePct?.toFixed(2)}%</Mono></div>
                </div>
              ))}
            </PanelBox>
            <PanelBox title="FX / DOLLAR">
              {(data.fx||[]).map(f => (
                <div key={f.pair} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <Mono color={C.text} size={11}>{f.pair}</Mono>
                  <div><Mono color={C.white} size={11} weight={600}>{f.rate?.toFixed(4)}</Mono><Mono color={cc(f.changePct)} size={10} style={{marginLeft:10}}>{f.changePct>0?"+":""}{f.changePct?.toFixed(2)}%</Mono></div>
                </div>
              ))}
            </PanelBox>
          </div>
          {data.macro_env && <PanelBox title="MACRO ENVIRONMENT ASSESSMENT"><p style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:1.9, margin:0 }}>{data.macro_env}</p></PanelBox>}
        </div>
      )}
    </div>
  );
}

// ─── F5: LEARN — FINANCE ACADEMY ────────────────────────────────────────────
function LEARNPanel() {
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async (q) => {
    const query = q || input;
    if (!query.trim()) return;
    setLoading(true); setAnswer(""); setQuestion(query);
    try {
      const sys = `You are a world-class finance professor teaching a highly intelligent VP-level derivatives & structured products professional (8+ years across Citi, Morgan Stanley, BBH) who is transitioning toward trading-adjacent and front-office work.

Teaching style:
- Skip Wikipedia-level definitions. Assume deep foundational knowledge.
- Go deep into mechanics, edge cases, and the "why" behind the math
- Use real market examples with real numbers and current market context
- Show the math and formulas; don't shy away from quantitative depth
- Explain the institutional perspective — how a hedge fund PM, prop desk trader, or sell-side analyst actually uses this
- Connect to adjacent concepts: derivatives, rates, structured products, macro
- End with 2-3 specific "next topics to explore" to continue the learning path
- Use clear ALL-CAPS section headers and numbered sub-points for structure`;
      const txt = await fetchAI(`Deep teach me about: "${query}". Use web search for current market data or recent real-world examples that strengthen the explanation.`, sys, 2000);
      setAnswer(txt);
    } catch(e) { setAnswer(`Error: ${e.message}`); }
    setLoading(false);
  };

  const topics = [
    { cat:"VALUATION", color:C.cyan, items:["DCF from scratch — WACC, terminal value, sensitivity tables","EV/EBITDA vs P/E: when each metric lies to you","P/B ratio and ROE — bank stock analysis framework","Comparable company analysis: selecting the right comps"] },
    { cat:"FINANCIAL ANALYSIS", color:C.amber, items:["How to read a 10-K like a hedge fund analyst","Free cash flow: the gap between accounting and reality","Altman Z-Score mechanics and real limitations","DuPont decomposition: dissecting ROE into its drivers"] },
    { cat:"DERIVATIVES & RATES", color:C.purple, items:["Options delta hedging: the dynamic replication argument","Yield curve inversions: mechanics and recession signal","SOFR vs LIBOR: what actually changed and why it matters","Swaps pricing: bootstrapping a discount curve from first principles"] },
    { cat:"YOUR PORTFOLIO", color:C.teal, items:["Tanker shipping market: FRO, VLCC dynamics, Hormuz risk","Defense sector valuation: LMT and RTX comp frameworks","Gold as a geopolitical hedge: GLD mechanics vs physical gold","Energy sector: upstream vs downstream margin analysis"] },
    { cat:"TRADING CONCEPTS", color:C.green, items:["Market microstructure: bid-ask spread decomposition","Short interest and squeeze mechanics: GameStop autopsy","Factor investing: value, momentum, quality, low-vol","Options market making: inventory risk and delta hedging"] },
  ];

  return (
    <div>
      <div style={{ marginBottom:10 }}><SearchInput value={input} onChange={setInput} onSubmit={()=>ask()} placeholder="ASK ANYTHING — TAUGHT AT INSTITUTIONAL DEPTH" /></div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
        {topics.map(({cat,color,items}) => (
          <div key={cat} style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
            <Mono color={color} size={8} weight={700} spacing={1.5} style={{display:"block",marginBottom:7}}>{cat}</Mono>
            {items.map(t => (
              <div key={t} onClick={()=>ask(t)}
                style={{ color:C.textDim, fontFamily:"'IBM Plex Mono',monospace", fontSize:10, padding:"4px 0", borderBottom:`1px solid ${C.border}`, cursor:"pointer", lineHeight:1.4 }}
                onMouseEnter={e=>e.currentTarget.style.color=C.cyan}
                onMouseLeave={e=>e.currentTarget.style.color=C.textDim}
              >→ {t}</div>
            ))}
          </div>
        ))}
      </div>
      {loading && <Loader msg={`PREPARING LECTURE: ${question.toUpperCase().slice(0,50)}`} />}
      {answer && (
        <PanelBox title={`LECTURE: ${question.toUpperCase().slice(0,70)}`} titleColor={C.green}>
          <div style={{ color:C.text, fontFamily:"'IBM Plex Mono',monospace", fontSize:12, lineHeight:2.1, whiteSpace:"pre-wrap" }}>{answer}</div>
        </PanelBox>
      )}
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

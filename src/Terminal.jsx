import { useState, useEffect, useRef } from "react";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// When running locally via `node server.js`, requests route through the local proxy.
// When embedded in Claude.ai, requests go directly to the Anthropic API.
const IS_LOCAL = typeof window !== "undefined" && window.location.hostname === "localhost";
const API = IS_LOCAL ? "http://localhost:3001" : "https://api.anthropic.com/v1/messages";
const MDL = IS_LOCAL ? "claude-sonnet-4-6" : "claude-sonnet-4-20250514";

const PORTFOLIO = [
  { sym: "GLD", qty: 20,  cost: 488.770, name: "SPDR Gold Shares ETF",  sector: "Commodity"   },
  { sym: "XOM", qty: 62,  cost: 155.255, name: "Exxon Mobil Corp",      sector: "Energy"       },
  { sym: "RTX", qty: 58,  cost: 209.870, name: "RTX Corporation",       sector: "Defense"      },
  { sym: "LMT", qty: 5,   cost: 680.990, name: "Lockheed Martin Corp",  sector: "Defense"      },
  { sym: "FRO", qty: 62,  cost: 38.127,  name: "Frontline PLC",         sector: "Shipping"     },
  { sym: "FLR", qty: 50,  cost: 51.597,  name: "Fluor Corporation",     sector: "Engineering"  },
];
const CASH = 10000;

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

// ─── YAHOO FINANCE HELPERS (local only) ──────────────────────────────────────
const PROXY = "http://localhost:3001";

async function fetchLivePrices(symbols) {
  // symbols: array like ["GLD","XOM","RTX"]
  const r = await fetch(`${PROXY}/prices?symbols=${symbols.join(",")}`);
  if (!r.ok) throw new Error(`Yahoo prices HTTP ${r.status}`);
  return r.json(); // { prices: {SYM: number}, details: {...}, timestamp: "..." }
}

async function fetchLiveQuote(symbol) {
  const r = await fetch(`${PROXY}/quote?symbol=${symbol}`);
  if (!r.ok) throw new Error(`Yahoo quote HTTP ${r.status}`);
  return r.json();
}

function fmtNum(n, decimals = 2) {
  if (n == null) return null;
  if (Math.abs(n) >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(decimals)}`;
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
      let livePrice = null, liveChange = null, liveChangePct = null, liveVolume = null, liveMktCap = null;

      // Step 1: Pull real-time price from Yahoo Finance when running locally
      if (IS_LOCAL) {
        try {
          const priceData = await fetchLivePrices([sym]);
          const d = priceData?.details?.[sym];
          if (d) {
            livePrice     = d.price;
            liveChange    = d.change;
            liveChangePct = d.changePct;
            liveVolume    = d.volume ? (d.volume > 1e6 ? `${(d.volume/1e6).toFixed(1)}M` : `${(d.volume/1e3).toFixed(0)}K`) : null;
            liveMktCap    = d.marketCap ? fmtNum(d.marketCap, 0) : null;
          }
        } catch(e) { console.warn("Yahoo price fetch failed, falling back to AI:", e.message); }
      }

      // Step 2: Ask Claude for fundamentals, analysis, news (inject live price if we have it)
      const priceNote = livePrice ? `The CURRENT real-time price is $${livePrice.toFixed(2)}, change ${liveChange?.toFixed(2)} (${liveChangePct?.toFixed(2)}%). Use this exact price — do NOT substitute your own.` : "Use web search for the current price.";
      const prompt = `${priceNote}
Find financial data for stock ticker: ${sym}.
Return ONLY this JSON (no placeholders):
{"ticker":"${sym}","company":"full name","exchange":"NYSE/NASDAQ/etc","price":${livePrice ?? "number"},"change":${liveChange ?? "number"},"changePct":${liveChangePct ?? "number"},"volume":"${liveVolume ?? "formatted"}","avgVolume":"formatted","marketCap":"${liveMktCap ?? "formatted"}","pe":number_or_null,"forwardPe":number_or_null,"eps":number,"pb":number_or_null,"evEbitda":number_or_null,"grossMargin":"pct%","operatingMargin":"pct%","netMargin":"pct%","revenue":"TTM formatted","ebitda":"formatted","freeCashFlow":"formatted","debtEquity":number_or_null,"currentRatio":number_or_null,"beta":number_or_null,"week52High":number,"week52Low":number,"dividendYield":"pct% or null","shortInterest":"pct%","analystRating":"BUY/OVERWEIGHT/HOLD/UNDERWEIGHT/SELL","analystCount":number,"priceTarget":number_or_null,"sector":"sector","industry":"industry","analysis":"5 sentence institutional fundamental analysis: business model, moat, recent performance, balance sheet quality, 12-month outlook","catalysts":["c1","c2","c3"],"risks":["r1","r2","r3"],"news":[{"headline":"text","source":"name","date":"date","impact":"BULLISH/BEARISH/NEUTRAL","summary":"1 sentence"}]}`;
      const txt = await fetchAI(prompt, "You are an institutional financial analyst terminal. Return ONLY valid compact JSON, no markdown, no prose.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) {
        // Override with Yahoo Finance real-time data if available
        if (livePrice)     parsed.price      = livePrice;
        if (liveChange)    parsed.change     = liveChange;
        if (liveChangePct) parsed.changePct  = liveChangePct;
        if (liveVolume)    parsed.volume     = liveVolume;
        if (liveMktCap)    parsed.marketCap  = liveMktCap;
        setData(parsed);
      } else setErr("Parse error — try again.");
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
  const [prices, setPrices] = useState({});
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [aLoading, setALoading] = useState(false);
  const [ts, setTs] = useState("");

  const totalCost = PORTFOLIO.reduce((s,p) => s + p.qty * p.cost, 0);
  const hasPrices = Object.keys(prices).length > 0;
  const totalMktVal = hasPrices ? PORTFOLIO.reduce((s,p) => s + p.qty * (prices[p.sym]||p.cost), 0) : null;
  const totalPnL = totalMktVal ? totalMktVal - totalCost : null;
  const pnlPct = totalPnL ? (totalPnL/totalCost)*100 : null;
  const pnlColor = pnlPct > 0 ? C.green : pnlPct < 0 ? C.red : C.text;
  const portTotal = (totalMktVal||totalCost) + CASH;

  const refresh = async () => {
    setLoading(true);
    try {
      if (IS_LOCAL) {
        // Use Yahoo Finance via local proxy — real-time accurate prices
        const syms = PORTFOLIO.map(p => p.sym);
        const data = await fetchLivePrices(syms);
        if (data?.prices) { setPrices(data.prices); setTs(data.timestamp || ""); }
      } else {
        // Claude.ai: use AI web search
        const syms = PORTFOLIO.map(p=>p.sym).join(", ");
        const prompt = `Search for TODAY's current real-time stock prices for: ${syms}. Return ONLY: {"prices":{"GLD":number,"XOM":number,"RTX":number,"LMT":number,"FRO":number,"FLR":number},"timestamp":"current datetime string"}`;
        const txt = await fetchAI(prompt, "Return ONLY valid compact JSON, no markdown.", 800);
        const parsed = parseJSON(txt);
        if (parsed?.prices) { setPrices(parsed.prices); setTs(parsed.timestamp||""); }
      }
    } catch(e) { console.error("Price refresh error:", e); }
    setLoading(false);
  };

  const getAnalysis = async () => {
    setALoading(true);
    try {
      const pos = PORTFOLIO.map(p => ({ sym:p.sym, name:p.name, qty:p.qty, costBasis:p.cost, currentPrice:prices[p.sym]||null }));
      const prompt = `You are a senior portfolio manager reviewing a geopolitical conflict investment portfolio (thesis: US-Israel military ops vs Iran / Op Epic Fury, Strait of Hormuz disruption, Qatar LNG halt, Ras Tanura attack risk). Mandatory exit evaluation date: April 2, 2026.

Positions: ${JSON.stringify(pos)}
Cash Reserve: $${CASH.toLocaleString()}

Use web search for latest geopolitical news affecting this thesis. Write a structured 6-paragraph institutional portfolio review:
1. Thesis validation: current geopolitical status and whether the thesis is intact
2. Best-performing position — hold, add, or trim?
3. Weakest position (especially FRO — tanker dynamics, Iran/Hormuz sensitivity) — exit strategy?
4. Portfolio risk: concentration, sector overlap, macro tail risks, currency exposure
5. Key monitoring datapoints before April 2 exit window (what to watch)
6. Overall recommendation: hold core, selective exit, full exit, or rebalance

Be direct, institutional, and specific. Cite specific market levels and geopolitical data.`;
      const txt = await fetchAI(prompt, "", 2000);
      setAnalysis(txt);
    } catch(e) { setAnalysis(`Error: ${e.message}`); }
    setALoading(false);
  };

  const today = new Date();
  const daysLeft = Math.ceil((new Date("2026-04-02") - today) / 86400000);

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:12 }}>
        {[
          { label:"PORTFOLIO VALUE",  value:`$${portTotal.toLocaleString("en",{maximumFractionDigits:0})}`,      color:C.white   },
          { label:"TOTAL COST BASIS", value:`$${(totalCost+CASH).toLocaleString("en",{maximumFractionDigits:0})}`, color:C.text   },
          { label:"UNREALIZED P&L",   value:totalPnL?`${totalPnL>0?"+":""}$${Math.abs(totalPnL).toLocaleString("en",{maximumFractionDigits:0})}`:"—", color:pnlColor },
          { label:"TOTAL RETURN",     value:pnlPct?`${pnlPct>0?"+":""}${pnlPct.toFixed(2)}%`:"—", color:pnlColor },
          { label:"EXIT WINDOW",      value:`${daysLeft}d → APR 2`,  color:daysLeft<14?C.red:C.amber },
        ].map(({label,value,color}) => (
          <div key={label} style={{ background:C.panel, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
            <Mono color={C.textDim} size={8} spacing={0.5} style={{display:"block",marginBottom:5}}>{label}</Mono>
            <Mono color={color} size={13} weight={700}>{value}</Mono>
          </div>
        ))}
      </div>
      <div style={{ background:"#0A0800", border:`1px solid ${C.amberDim}`, padding:"8px 14px", marginBottom:12 }}>
        <Mono color={C.amberDim} size={9} spacing={1}>THESIS: </Mono>
        <Mono color={C.textDim} size={10}>Op Epic Fury / Iran conflict · Strait of Hormuz disruption · Qatar LNG / Saudi Ras Tanura attack risk · Defense + Energy + Commodities + Shipping</Mono>
      </div>
      <div style={{ background:C.panel, border:`1px solid ${C.border}`, marginBottom:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"70px 160px 75px 50px 70px 80px 90px 75px 65px", background:"#0A0A0A", padding:"7px 12px", borderBottom:`1px solid ${C.border}` }}>
          {["TICKER","NAME","SECTOR","QTY","COST","PRICE","MKT VALUE","P&L $","P&L %"].map(h => <Mono key={h} color={C.amber} size={8} spacing={0.5}>{h}</Mono>)}
        </div>
        {PORTFOLIO.map(p => {
          const price = prices[p.sym];
          const val = price ? price * p.qty : null;
          const pnl = price ? (price - p.cost) * p.qty : null;
          const pct = price ? ((price - p.cost)/p.cost)*100 : null;
          const pc = pnl > 0 ? C.green : pnl < 0 ? C.red : C.text;
          return (
            <div key={p.sym} style={{ display:"grid", gridTemplateColumns:"70px 160px 75px 50px 70px 80px 90px 75px 65px", padding:"7px 12px", borderBottom:`1px solid ${C.border}` }}>
              <Mono color={C.amber} size={12} weight={700}>{p.sym}</Mono>
              <Mono color={C.textDim} size={10}>{p.name}</Mono>
              <Mono color={C.muted} size={9}>{p.sector}</Mono>
              <Mono color={C.text} size={11}>{p.qty}</Mono>
              <Mono color={C.text} size={11}>${p.cost.toFixed(2)}</Mono>
              <Mono color={price?C.cyan:C.muted} size={11} weight={price?600:400}>{price?`$${price.toFixed(2)}`:"—"}</Mono>
              <Mono color={C.text} size={11}>{val?`$${val.toLocaleString("en",{maximumFractionDigits:0})}`:"—"}</Mono>
              <Mono color={pc} size={11} weight={600}>{pnl!=null?`${pnl>0?"+":""}$${Math.abs(pnl).toFixed(0)}`:"—"}</Mono>
              <Mono color={pc} size={11} weight={600}>{pct!=null?`${pct>0?"+":""}${pct.toFixed(1)}%`:"—"}</Mono>
            </div>
          );
        })}
        <div style={{ display:"grid", gridTemplateColumns:"70px 160px 75px 50px 70px 80px 90px 75px 65px", padding:"7px 12px", background:"#0A0A0A" }}>
          <Mono color={C.textDim} size={11}>CASH</Mono>
          <Mono color={C.textDim} size={10}>Reserve</Mono>
          <span/><span/><span/><span/>
          <Mono color={C.text} size={11}>${CASH.toLocaleString()}</Mono>
        </div>
      </div>
      {ts && <div style={{ marginBottom:8 }}><Mono color={C.muted} size={9}>Prices as of: {ts}</Mono></div>}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <Btn onClick={refresh} disabled={loading}>{loading?"FETCHING...":"REFRESH LIVE PRICES"}</Btn>
        <Btn onClick={getAnalysis} disabled={aLoading} variant="outline">{aLoading?"ANALYZING...":"AI PORTFOLIO REVIEW"}</Btn>
      </div>
      {analysis && (
        <PanelBox title="PORTFOLIO MANAGER REVIEW — GEOPOLITICAL THESIS">
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
      const prompt = `Search for the LATEST financial news about: "${query}".
Return ONLY: {"topic":"${query}","marketImpact":"BULLISH/BEARISH/MIXED/NEUTRAL","execSummary":"2-3 sentence executive brief","tradingTake":"2 sentence actionable trading implication","items":[{"headline":"text","source":"name","date":"date","impact":"BULLISH/BEARISH/NEUTRAL","summary":"2 sentence summary","relevance":"HIGH/MEDIUM/LOW"}]}
Include 6-8 items sorted by relevance. Return ONLY the JSON.`;
      const txt = await fetchAI(prompt, "You are a financial intelligence analyst. Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
    } catch(e) { console.error(e); }
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
      const prompt = `Search for current real-time global market data today. Return ONLY:
{"indices":[{"name":"S&P 500","sym":"SPX","value":number,"changePct":number},{"name":"NASDAQ 100","sym":"NDX","value":number,"changePct":number},{"name":"DJIA","sym":"DJIA","value":number,"changePct":number},{"name":"Russell 2000","sym":"RUT","value":number,"changePct":number},{"name":"VIX","sym":"VIX","value":number,"changePct":number}],"rates":[{"label":"Fed Funds Target","val":"X.XX-X.XX%"},{"label":"2Y Treasury","val":"X.XX%","chg":"+Xbps"},{"label":"10Y Treasury","val":"X.XX%","chg":"+Xbps"},{"label":"30Y Treasury","val":"X.XX%"},{"label":"2s10s Spread","val":"Xbps"},{"label":"SOFR","val":"X.XX%"}],"commodities":[{"name":"WTI Crude Oil","price":number,"changePct":number},{"name":"Brent Crude","price":number,"changePct":number},{"name":"Gold Spot","price":number,"changePct":number},{"name":"Silver","price":number,"changePct":number},{"name":"Natural Gas","price":number,"changePct":number},{"name":"Copper","price":number,"changePct":number}],"fx":[{"pair":"DXY Index","rate":number,"changePct":number},{"pair":"EUR/USD","rate":number,"changePct":number},{"pair":"GBP/USD","rate":number,"changePct":number},{"pair":"USD/JPY","rate":number,"changePct":number},{"pair":"USD/CNH","rate":number,"changePct":number}],"macro_env":"3 sentence macro environment assessment"}`;
      const txt = await fetchAI(prompt, "Return ONLY valid compact JSON, no markdown.", 1500);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
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
      const prompt = `Use web search to find comprehensive company description and background for stock: ${sym}.
Return ONLY this JSON:
{"ticker":"${sym}","company":"full legal name","exchange":"exchange","ticker_local":"local ticker","founded":"year","ipo":"year or N/A","headquarters":"City, Country","employees":"number formatted","ceo":"name","website":"url","description":"5-6 sentence comprehensive business description: what they do, how they make money, key products/services, competitive position, main end markets","businessModel":"2 sentence explanation of the core monetization model","moat":"primary competitive advantage — 2 sentences","segments":[{"name":"segment name","revShare":"XX%","description":"1 sentence"}],"geography":[{"region":"region name","revShare":"XX%"}],"customers":"2 sentence description of key customer base and concentration","competitors":["comp1","comp2","comp3","comp4"],"keyMetrics":[{"label":"key metric name","value":"value","context":"1 sentence why it matters"}],"indexMemberships":["S&P 500","DJIA","etc"],"esgRating":"rating or N/A","creditRating":"Moody's/S&P rating or N/A","majorShareholders":[{"name":"institution","pct":"XX%"}],"recentDevelopments":"3 sentence summary of the most significant recent strategic developments, M&A, or business changes in the past 12 months"}`;
      const txt = await fetchAI(prompt, "You are a financial data terminal. Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
      else setErr("Parse error — try again.");
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
      const isStock = mode === "stock";
      const prompt = `You are a Bloomberg Intelligence senior analyst. Use web search to research: "${input}" (mode: ${mode}).

Return ONLY this JSON:
{"query":"${input}","type":"${mode}","headline":"compelling 1-line research headline","verdict":"OVERWEIGHT/NEUTRAL/UNDERWEIGHT or BULLISH/BEARISH/NEUTRAL","confidence":"HIGH/MEDIUM/LOW","priceTarget":${isStock?"number_or_null":"null"},"currentPrice":${isStock?"number_or_null":"null"},"upside":${isStock?"\"XX%\"":"null"},"summary":"3-4 sentence executive research summary — the single most important insight an institutional investor needs to know","bull_case":"3 sentence bull case with specific catalysts and price levels","bear_case":"3 sentence bear case with specific risk factors and downside scenarios","valuation":"2 sentence valuation assessment — expensive, cheap, or fairly valued relative to peers and history","technicals":"2 sentence technical analysis: trend, key levels, momentum","peerComparison":[{"name":"peer/comp name","rating":"BUY/HOLD/SELL","pt":"$XX or N/A","upside":"XX%"}],"keyThemes":["theme1","theme2","theme3"],"watchlist":[{"trigger":"specific event or data point","direction":"POSITIVE/NEGATIVE","timing":"near/medium/long term"}],"analystNote":"3 sentence note written in first-person institutional analyst voice — what is the highest-conviction call here and why","dataUpdated":"today's date"}`;
      const txt = await fetchAI(prompt, "You are a Bloomberg Intelligence research analyst. Return ONLY valid compact JSON, no markdown.", 2000);
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
      const prompt = `Search for the current economic calendar — upcoming and recent major economic data releases and central bank events for the next 2 weeks, plus the most recent releases from this past week. Today's date context: early March 2026.

Return ONLY:
{"period":"next 2 weeks","events":[{"date":"YYYY-MM-DD","time":"HH:MM ET","country":"US/EU/UK/JP/CN/etc","event":"full event name","importance":"HIGH/MEDIUM/LOW","previous":"formatted value","forecast":"formatted value or N/A","actual":"formatted value or TBD","surprise":"BEAT/MISS/IN-LINE/TBD","marketImpact":"BULLISH/BEARISH/NEUTRAL/TBD","notes":"1 sentence on what to watch or what it means"}]}
Include 20-25 events. HIGH importance = Fed decisions, NFP, CPI, GDP, FOMC. MEDIUM = PPI, retail sales, PMI, housing. Return ONLY the JSON.`;
      const txt = await fetchAI(prompt, "Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
    } catch(e) { console.error(e); }
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
      const prompt = `Use web search to find comprehensive financial statement data for: ${sym}. Get the most recent annual figures AND last 3 years for trend.

Return ONLY this JSON with real numbers (in millions USD unless noted):
{"ticker":"${sym}","company":"name","currency":"USD","period":"TTM/FY2024","reportDate":"date",
"incomeStatement":{"periods":["FY2022","FY2023","FY2024","TTM"],"revenue":[num,num,num,num],"grossProfit":[num,num,num,num],"ebitda":[num,num,num,num],"ebit":[num,num,num,num],"netIncome":[num,num,num,num],"eps":[num,num,num,num],"grossMargin":["XX%","XX%","XX%","XX%"],"ebitdaMargin":["XX%","XX%","XX%","XX%"],"netMargin":["XX%","XX%","XX%","XX%"],"revenueGrowth":["N/A","XX%","XX%","XX%"]},
"balanceSheet":{"cash":num,"shortTermInvestments":num,"totalCurrentAssets":num,"totalAssets":num,"shortTermDebt":num,"longTermDebt":num,"totalDebt":num,"totalLiabilities":num,"shareholdersEquity":num,"bookValuePerShare":num,"netDebt":num},
"cashFlow":{"operatingCF":num,"capex":num,"freeCashFlow":num,"dividendsPaid":num,"shareRepurchases":num,"periods":["FY2022","FY2023","FY2024"],"fcfHistory":[num,num,num]},
"keyRatios":{"pe":num_or_null,"forwardPe":num_or_null,"pb":num_or_null,"evEbitda":num_or_null,"evRevenue":num_or_null,"debtEbitda":num_or_null,"interestCoverage":num_or_null,"currentRatio":num_or_null,"quickRatio":num_or_null,"roe":"XX%","roa":"XX%","roic":"XX%","fcfYield":"XX%","dividendYield":"XX% or null"},
"guidance":{"revenue":"management guidance range or N/A","eps":"management guidance or N/A","notes":"1 sentence on guidance or lack thereof"},
"qualityScore":{"assessment":"STRONG/ADEQUATE/WEAK","earningsQuality":"2 sentence assessment of earnings quality: accruals, non-recurring items, cash conversion","balanceSheetStrength":"2 sentence assessment of balance sheet health and leverage"}}`;
      const txt = await fetchAI(prompt, "You are a financial data terminal. Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
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
      const prompt = `Search for current real-time global equity market data today. Return ONLY:
{"lastUpdated":"datetime","regions":[
  {"region":"NORTH AMERICA","indices":[{"name":"S&P 500","ticker":"SPX","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"NASDAQ 100","ticker":"NDX","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"DJIA","ticker":"DJIA","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Russell 2000","ticker":"RUT","country":"US","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"TSX Composite","ticker":"TSX","country":"CA","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"}]},
  {"region":"EUROPE","indices":[{"name":"Euro Stoxx 50","ticker":"SX5E","country":"EU","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"FTSE 100","ticker":"UKX","country":"UK","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"DAX","ticker":"DAX","country":"DE","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"CAC 40","ticker":"CAC","country":"FR","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"IBEX 35","ticker":"IBEX","country":"ES","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"}]},
  {"region":"ASIA PACIFIC","indices":[{"name":"Nikkei 225","ticker":"NKY","country":"JP","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Hang Seng","ticker":"HSI","country":"HK","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"CSI 300","ticker":"SHSZ300","country":"CN","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"ASX 200","ticker":"ASX","country":"AU","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"KOSPI","ticker":"KOSPI","country":"KR","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"}]},
  {"region":"EMERGING MARKETS","indices":[{"name":"MSCI EM","ticker":"MXEF","country":"EM","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Bovespa","ticker":"IBOV","country":"BR","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Nifty 50","ticker":"NIFTY","country":"IN","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"},{"name":"Sensex","ticker":"SENSEX","country":"IN","value":number,"changePct":number,"ytd":"XX%","weekChange":"XX%"}]}
],"sectorPerformance":[{"sector":"Technology","changePct":number,"ytd":"XX%"},{"sector":"Energy","changePct":number,"ytd":"XX%"},{"sector":"Financials","changePct":number,"ytd":"XX%"},{"sector":"Healthcare","changePct":number,"ytd":"XX%"},{"sector":"Industrials","changePct":number,"ytd":"XX%"},{"sector":"Consumer Disc","changePct":number,"ytd":"XX%"},{"sector":"Consumer Staples","changePct":number,"ytd":"XX%"},{"sector":"Utilities","changePct":number,"ytd":"XX%"},{"sector":"Materials","changePct":number,"ytd":"XX%"},{"sector":"Real Estate","changePct":number,"ytd":"XX%"},{"sector":"Communication","changePct":number,"ytd":"XX%"}],"marketNarrative":"3 sentence global markets narrative — what is driving sentiment today and which regions/themes are outperforming"}`;
      const txt = await fetchAI(prompt, "Return ONLY valid compact JSON, no markdown.", 2000);
      const parsed = parseJSON(txt);
      if (parsed) setData(parsed);
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

# ▐ TERMINAL — AI-Powered Financial Intelligence Platform

A Bloomberg-inspired financial terminal built with **React + Claude AI + Anthropic Web Search**. Real-time market data, institutional-grade analysis, and a built-in finance academy — all in a professional dark terminal interface.

## Features

| Function Key | Panel | Bloomberg Equivalent | Description |
|---|---|---|---|
| F1 | **EQ** | EQUITY | Full equity tearsheet: price, valuation multiples, margins, 52-week range, analyst consensus, AI analysis, catalysts/risks, news flow |
| F2 | **PORT** | PRTU / PORT | Live portfolio tracker pre-loaded with your positions, real-time P&L, AI portfolio review |
| F3 | **NEWS** | TOP / NI | Market intelligence — themed news search with executive brief, trading take, and signal classification |
| F4 | **MACRO** | WIRP / WORLD | Global macro dashboard: equity indices, full yield curve, commodities, FX |
| F5 | **LEARN** | — | Finance Academy — institutional-depth AI lectures tailored to VP-level derivatives background |
| F6 | **DES** | DES | Company Description — full business profile, segments, geography, shareholders, moat, recent developments |
| F7 | **BI** | BI | Bloomberg Intelligence equivalent — AI analyst research notes with bull/bear case, peer comparison, watchlist triggers |
| F8 | **ECO** | ECO | Economic Calendar — upcoming releases with forecast vs actual, importance flags, market impact signals |
| F9 | **FS** | FA / FS | Financial Summary — full income statement, balance sheet, cash flow, key ratios across multiple periods |
| F10 | **WEI** | WEI | World Equity Indices — global index coverage with heatmap, regional breakdown, sector performance |

## Tech Stack

- **React 18** + Vite
- **Claude claude-sonnet-4-20250514** via Anthropic API
- **Anthropic Web Search Tool** for real-time market data
- **IBM Plex Mono** for authentic terminal aesthetics

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API key

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/bbg-terminal.git
cd bbg-terminal
npm install
```

### Configuration

The terminal uses the Anthropic API directly from the browser. The API key is handled by the Claude.ai environment. If running standalone, you'll need to add your API key to the fetch headers in `src/Terminal.jsx`.

### Running Locally

```bash
npm run dev
```

Open `http://localhost:5173`

### Building for Production

```bash
npm run build
npm run preview
```

## Portfolio Configuration

Edit `PORTFOLIO` and `CASH` constants at the top of `src/Terminal.jsx` to configure your own positions:

```js
const PORTFOLIO = [
  { sym: "GLD", qty: 20,  cost: 488.770, name: "SPDR Gold Shares ETF", sector: "Commodity" },
  // ... add your positions
];
const CASH = 10000;
```

## Data Methodology

All market data is fetched live via the Claude AI web search tool, which searches the internet for real-time prices, financial statements, news, and economic data. This approach mirrors how Perplexity AI rebuilt Bloomberg functionality — using AI-synthesized live search instead of expensive direct data feeds.

**Data sources include:** Yahoo Finance, Bloomberg, Reuters, CNBC, SEC filings, and other financial news sources.

> ⚠️ **Disclaimer**: This terminal is for educational and research purposes only. Not financial advice. Data may be delayed or approximate. Always verify with primary sources before making investment decisions.

## Architecture

```
src/
├── main.jsx          # React entry point
└── Terminal.jsx      # Full terminal — all 10 panels in single component
                      # EQPanel, PORTPanel, NEWSPanel, MACROPanel, LEARNPanel,
                      # DESPanel, BIPanel, ECOPanel, FSPanel, WEIPanel
```

## License

MIT

/**
 * BBG Terminal — Local Proxy Server
 * Forwards requests to Anthropic API with your API key.
 * Run: node server.js
 * Then visit: http://localhost:5173
 */

const http = require("http");
const https = require("https");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PROXY_PORT = 3001;

if (!API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY not set.");
  console.error("    Run: set ANTHROPIC_API_KEY=sk-ant-... (Windows)");
  console.error("    or:  export ANTHROPIC_API_KEY=sk-ant-... (Mac/Linux)\n");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // CORS headers — allow the Vite dev server on port 5173
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const options = {
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const proxy = https.request(options, (apiRes) => {
      res.writeHead(apiRes.statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      apiRes.pipe(res);
    });

    proxy.on("error", (err) => {
      console.error("Proxy error:", err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    proxy.write(body);
    proxy.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`\n✅  BBG Terminal proxy running on http://localhost:${PROXY_PORT}`);
  console.log(`    Now run: npm run dev`);
  console.log(`    Then open: http://localhost:5173\n`);
});

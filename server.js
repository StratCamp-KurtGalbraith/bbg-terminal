/**
 * BBG Terminal — Local Proxy Server
 * Forwards requests to Anthropic API with your API key.
 *
 * Usage:
 *   Windows:   set ANTHROPIC_API_KEY=sk-ant-...  && node server.js
 *   Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-... && node server.js
 */

const http = require("http");
const https = require("https");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PROXY_PORT = 3001;

if (!API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY not set.");
  console.error("    Windows:   set ANTHROPIC_API_KEY=sk-ant-...");
  console.error("    Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-...\n");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST")   { res.writeHead(405); res.end("Method not allowed"); return; }

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

    console.log(`→ ${new Date().toISOString()} Forwarding request (${body.length} bytes)`);

    const proxy = https.request(options, (apiRes) => {
      console.log(`← Status: ${apiRes.statusCode}`);
      res.writeHead(apiRes.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
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
  console.log(`\n✅  BBG Terminal proxy running`);
  console.log(`    Proxy: http://localhost:${PROXY_PORT}`);
  console.log(`    API Key: ${API_KEY.slice(0, 15)}...`);
  console.log(`\n    Now open a second terminal and run: npm run dev`);
  console.log(`    Then visit: http://localhost:5173\n`);
});

// Minimal static file server for the built app (public/).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "public");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent((req.url || "/").split("?")[0]));
    if (p === "/" || p === "\\") p = "/index.html";
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`ORION on http://localhost:${PORT}`));

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(SRC_DIR, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export async function serveStatic(req, res, url) {
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(PUBLIC_DIR, path);
  if (!file.startsWith(PUBLIC_DIR) || file.startsWith(SERVER_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

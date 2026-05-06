import { createServer } from "node:http";
import { handleApi } from "./router.mjs";
import { serveStatic } from "./static.mjs";
import { sendJson } from "./http.mjs";

export function createAppServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });
}

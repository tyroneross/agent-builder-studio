import { sendJson } from "../http.mjs";

export async function healthRoute(_req, res) {
  sendJson(res, 200, { ok: true, service: "chief-of-staff", localOnly: true });
}

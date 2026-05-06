import { listRituals } from "../../rituals/registry.mjs";
import { listTools } from "../../tools/registry.mjs";
import { sendJson } from "../http.mjs";

export async function ritualsRoute(_req, res) {
  sendJson(res, 200, { rituals: listRituals() });
}

export async function toolsRoute(_req, res) {
  sendJson(res, 200, { tools: listTools() });
}

import { ensureWorkspace, workspaceStatus } from "../../core/workspace/workspace.mjs";
import { sendJson } from "../http.mjs";

export async function initVaultRoute(_req, res) {
  sendJson(res, 200, await ensureWorkspace());
}

export async function vaultStatusRoute(_req, res) {
  sendJson(res, 200, await workspaceStatus());
}

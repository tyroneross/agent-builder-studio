import { createDocument } from "../../core/workspace/documents.mjs";
import { ensureWorkspace } from "../../core/workspace/workspace.mjs";
import { readBody, sendJson } from "../http.mjs";

export async function createDocumentRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  sendJson(res, 200, { document: await createDocument(body) });
}

#!/usr/bin/env node
// Colocated test: /api/agent/models must exclude embedding models (they 400
// on /api/chat; bge-m3 as alphabetical default broke the first-run demo).
import assert from "node:assert/strict";
import { isChatModel } from "../app/api/agent/models/route.js";

const TAGS_FIXTURE = [
  { name: "bge-m3:latest", details: { family: "bert", families: ["bert"] } },
  { name: "tinyllama:latest", details: { family: "llama", families: ["llama"] } },
  { name: "mxbai-embed-large:latest", details: { family: "bert", families: ["bert"] } },
  { name: "nomic-embed-text:latest", details: { family: "nomic-bert", families: ["nomic-bert"] } },
  { name: "llama3.2:3b", details: { family: "llama", families: ["llama"] } },
  { name: "qwen3:8b-q4_K_M", details: { family: "qwen3", families: ["qwen3"] } },
  { name: "gpt-oss:20b", details: { family: "gptoss", families: ["gptoss"] } },
  { name: "mystery-embed:1b" }, // no details -> name net catches it
  { name: "mystery-chat:1b" }, // no details, no embed marker -> kept
];

const kept = TAGS_FIXTURE.filter(isChatModel).map((m) => m.name);
assert.deepEqual(kept, [
  "tinyllama:latest",
  "llama3.2:3b",
  "qwen3:8b-q4_K_M",
  "gpt-oss:20b",
  "mystery-chat:1b",
]);
assert.ok(!kept.includes("bge-m3:latest"), "bge-m3 must never be offered for chat");
console.log("all models-filter checks passed");

#!/usr/bin/env node

import { readFileSync } from "node:fs";

function readInput() {
  const argText = process.argv.slice(2).join(" ").trim();
  if (argText) return argText;
  if (process.stdin.isTTY) return "Agent Builder Studio";
  return readFileSync(0, "utf8").trim();
}

const input = readInput();
const words = input.length === 0 ? 0 : input.split(/\s+/).length;
const preview = input.length > 72 ? `${input.slice(0, 69)}...` : input;
const plural = words === 1 ? "" : "s";

console.log("Sample external tool says hello.");
console.log(`Input summary: ${words} word${plural} received.`);

if (preview) {
  console.log(`Preview: ${preview}`);
}

#!/usr/bin/env node
// node --test suite for app/lib/local-request.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { assertLocalRequest } from "../app/lib/local-request.mjs";

function localRequest(headers = {}) {
  return new Request("http://localhost:3000/api/tools/register", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      ...headers,
    },
  });
}

async function rejection(response) {
  assert.ok(response, "expected assertLocalRequest to return a Response");
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("localhost host with same-origin Origin passes", () => {
  const response = assertLocalRequest(localRequest({ origin: "http://localhost:3000" }));
  assert.equal(response, null);
});

test("cross-origin Origin returns 403", async () => {
  const response = assertLocalRequest(localRequest({ origin: "http://evil.example" }));
  const result = await rejection(response);
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { ok: false, error: "same-origin request required" });
});

test("absent Origin returns 403", async () => {
  const response = assertLocalRequest(localRequest());
  const result = await rejection(response);
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, {
    ok: false,
    error: "Origin header required for mutating requests",
  });
});

test("non-localhost Host returns 403", async () => {
  const request = new Request("http://example.com/api/tools/register", {
    method: "POST",
    headers: {
      host: "example.com",
      origin: "http://example.com",
    },
  });
  const result = await rejection(assertLocalRequest(request));
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { ok: false, error: "local request required" });
});

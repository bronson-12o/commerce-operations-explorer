import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
// Test the actual bundled entrypoint: the asset fast path must not own HTML.
for (const path of [
  "/",
  "/downloads/case-study.html",
  "/downloads/data-dictionary.html",
]) {
  const response = await worker.fetch(
    new Request("https://example.test" + path),
    {},
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(await response.text(), /<!doctype html>/i);
}
assert.equal(
  (await worker.fetch(new Request("https://example.test/missing"), {})).status,
  404,
);
console.log("Built Worker document routes and security headers passed.");

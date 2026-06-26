import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, safeEqual, parseBasicAuth, parseBearer } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";

const baseConfig: AppConfig = {
  port: 8080,
  trustProxy: false,
  netcup: { customerNumber: "1", apiKey: "k", apiPassword: "p", apiUrl: "http://x" },
  ddnsUsername: "client",
  ddnsPassword: "s3cret",
  ddnsToken: "tok-abc",
  allowedDomains: ["example.com"],
  allowedHostnames: [],
  enableIpv4: true,
  enableIpv6: true,
};

function basicHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

test("safeEqual matches identical strings and rejects different ones", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false); // differing lengths must not throw
});

test("parseBasicAuth decodes user/pass and tolerates colons in password", () => {
  assert.deepEqual(parseBasicAuth(basicHeader("u", "p:with:colon")), {
    user: "u",
    pass: "p:with:colon",
  });
  assert.equal(parseBasicAuth("Bearer x"), null);
  assert.equal(parseBasicAuth(undefined), null);
});

test("parseBearer extracts token", () => {
  assert.equal(parseBearer("Bearer xyz"), "xyz");
  assert.equal(parseBearer("Basic xyz"), null);
});

test("authenticate accepts valid Basic Auth", () => {
  assert.equal(
    authenticate({ authorization: basicHeader("client", "s3cret") }, baseConfig),
    true,
  );
});

test("authenticate rejects wrong password", () => {
  assert.equal(
    authenticate({ authorization: basicHeader("client", "wrong") }, baseConfig),
    false,
  );
});

test("authenticate accepts bearer token and query token", () => {
  assert.equal(authenticate({ authorization: "Bearer tok-abc" }, baseConfig), true);
  assert.equal(authenticate({ queryToken: "tok-abc" }, baseConfig), true);
  assert.equal(authenticate({ queryToken: "nope" }, baseConfig), false);
});

test("authenticate rejects everything when no credentials presented", () => {
  assert.equal(authenticate({}, baseConfig), false);
});

test("token auth is ignored when no token is configured", () => {
  const cfg = { ...baseConfig, ddnsToken: undefined };
  assert.equal(authenticate({ queryToken: "tok-abc" }, cfg), false);
  assert.equal(authenticate({ authorization: basicHeader("client", "s3cret") }, cfg), true);
});

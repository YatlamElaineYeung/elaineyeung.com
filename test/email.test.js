// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyResendSignature } from "../src/email.js";

const secretBytes = Buffer.from("test-secret-for-unit-tests-only");
const env = { RESEND_WEBHOOK_SECRET: "whsec_" + secretBytes.toString("base64") };
const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

function signedRequest({ timestamp = Math.floor(Date.now() / 1000), signWith = secretBytes, payload = body } = {}) {
  const id = "msg_123";
  const signature = createHmac("sha256", signWith).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return new Request("https://example.workers.dev/api/resend-events", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` },
  });
}

test("accepts a correctly signed delivery report", async () => {
  assert.equal(await verifyResendSignature(env, signedRequest(), body), true);
});

test("rejects a report signed with the wrong secret", async () => {
  assert.equal(await verifyResendSignature(env, signedRequest({ signWith: Buffer.from("attacker") }), body), false);
});

test("rejects a report whose content was changed", async () => {
  assert.equal(await verifyResendSignature(env, signedRequest(), body.replace("abc", "xyz")), false);
});

test("rejects an old report replayed later", async () => {
  assert.equal(await verifyResendSignature(env, signedRequest({ timestamp: Math.floor(Date.now() / 1000) - 3600 }), body), false);
});

test("rejects everything when no webhook secret is set", async () => {
  assert.equal(await verifyResendSignature({}, signedRequest(), body), false);
});

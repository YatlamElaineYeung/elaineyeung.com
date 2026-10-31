// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmail } from "../src/contact.js";

const config = { subjectPrefix: "[elaineyeung.com]", timeZone: "America/New_York" };
const form = {
  firstName: "Jane", lastName: "Doe", email: "jane@example.com", company: "Acme",
  link: "https://boards.greenhouse.io/acme/jobs/1", message: "See careers.acme.com/roles please", resume: true,
};

test("builds the notification email", () => {
  const { subject, text } = buildEmail(form, "ref-123", Date.UTC(2026, 9, 28, 16, 0), config);
  assert.equal(subject, "[elaineyeung.com] Contact Request – Jane Doe (Resume)");
  assert.match(text, /Resume requested: Yes/);
  assert.match(text, /https:\/\/careers\.acme\.com\/roles\n    \(real domain: acme\.com\)/);
  assert.match(text, /Received Oct 28, 2026, 12:00 PM EDT · Reference ref-123/);
});

test("leaves (Resume) off the subject when not requested", () => {
  assert.equal(buildEmail({ ...form, resume: false }, "r", Date.now(), config).subject, "[elaineyeung.com] Contact Request – Jane Doe");
});

// A tiny stand-in for the D1 meta table and KV storage, enough for the hourly job
function fakeEnv(kv) {
  const meta = new Map();
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: [] }),
    first: async () => {
      if (sql.includes("COUNT(*)")) return { n: 0, oldest: null };
      const key = sql.includes("'link_review_notified'") ? "link_review_notified" : sql.includes("'last_alert'") ? "last_alert" : args[0];
      return meta.has(key) ? { value: meta.get(key) } : null;
    },
    run: async () => {
      if (sql.includes("'link_review_notified'")) meta.set("link_review_notified", args[0]);
      else if (sql.startsWith("INSERT INTO meta")) meta.set(args[0], args[1]);
    },
  });
  return {
    meta,
    ALERT_TO: "me@example.com", RESEND_API_KEY: "test", MAIL_FROM: "site@example.com",
    CONTACT_MAX_PER_HOUR: "5", CONTACT_MAX_REFUSED_PER_HOUR: "8", CONTACT_REPEAT_MINUTES: "15", ALERT_AFTER_HOURS: "3", KEEP_FAILED_DAYS: "30",
    DB: { prepare: statement, batch: async () => [] },
    LINK_RULES_KV: { get: async (key) => kv[key] ?? null, list: async () => ({ keys: Object.keys(kv).map((name) => ({ name })) }) },
  };
}

async function captureEmails(run) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); };
  try { await run(); } finally { globalThis.fetch = realFetch; }
  return sent;
}

test("emails once per new link list suggestion, without the lists", async () => {
  const { runHourly } = await import("../src/contact.js");
  const kv = { "link-rules": '{"shorteners":["a.example"]}', "link-rules-suggested": '{"shorteners":["new.example"]}' };
  const env = fakeEnv(kv);
  const reviews = (sent) => sent.filter((mail) => /Link list review ready/.test(mail.subject));
  let sent = reviews(await captureEmails(async () => { await runHourly(env); await runHourly(env); }));
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].text, /new\.example/);
  kv["link-rules-suggested"] = '{"shorteners":["other.example"]}';
  assert.equal(reviews(await captureEmails(() => runHourly(env))).length, 1);
});

test("link list watchdog alerts once per unexpected change, never with list contents", async () => {
  const { runHourly } = await import("../src/contact.js");
  const kv = { "link-rules": '{"shorteners":["a.example"]}' };
  const env = fakeEnv(kv);
  const emergencies = (sent) => sent.filter((mail) => /Possible link list emergency/.test(mail.subject));

  assert.equal(emergencies(await captureEmails(() => runHourly(env))).length, 0, "first run only records the list");
  kv["link-rules"] = '{"shorteners":["b.example"]}';
  kv["stray-key"] = "x";
  let sent = emergencies(await captureEmails(() => runHourly(env)));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /live link list changed/);
  assert.match(sent[0].text, /1 unexpected item/);
  assert.doesNotMatch(sent[0].text, /b\.example|stray-key/);
  assert.equal(emergencies(await captureEmails(() => runHourly(env))).length, 0, "the same problem isn't repeated");
});

test("an approved change recorded beforehand doesn't alert", async () => {
  const { runHourly } = await import("../src/contact.js");
  const kv = { "link-rules": '{"knownSites":["a.example"]}' };
  const env = fakeEnv(kv);
  await captureEmails(() => runHourly(env));
  kv["link-rules"] = '{"knownSites":["a.example","b.example"]}';
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kv["link-rules"]));
  env.meta.set("link_rules_hash", [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  const sent = await captureEmails(() => runHourly(env));
  assert.equal(sent.filter((mail) => /emergency/.test(mail.subject)).length, 0);
});

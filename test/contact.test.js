// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmail } from "../src/contact.js";

const config = { subjectPrefix: "[example.com]", timeZone: "UTC", requestLabel: "Sample", requestNote: "Check the sender first." };
const form = {
  firstName: "Jane", lastName: "Doe", email: "jane@example.com", company: "Acme",
  link: "https://boards.greenhouse.io/acme/jobs/1", message: "See careers.acme.com/roles please", request: true,
};

test("builds the notification email", () => {
  const { subject, text } = buildEmail(form, "ref-123", Date.UTC(2026, 9, 28, 16, 0), config);
  assert.equal(subject, "[example.com] Contact Request – Jane Doe (Sample)");
  assert.match(text, /Sample requested: Yes/);
  assert.match(text, /https:\/\/careers\.acme\.com\/roles\n    \(real domain: acme\.com\)/);
  assert.match(text, /Received Oct 28, 2026, 4:00 PM UTC · Reference ref-123/);
});

test("leaves the request label off the subject when not requested", () => {
  assert.equal(buildEmail({ ...form, request: false }, "r", Date.now(), config).subject, "[example.com] Contact Request – Jane Doe");
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
    CONTACT_MAX_PER_HOUR: "11", CONTACT_MAX_REFUSED_PER_HOUR: "12", CONTACT_REPEAT_MINUTES: "13", ALERT_AFTER_HOURS: "14", KEEP_FAILED_DAYS: "16",
    DB: { prepare: statement, batch: async () => [] },
    LINK_RULES_KV: { get: async (key) => kv[key] ?? null, list: async () => ({ keys: Object.keys(kv).map((name) => ({ name })) }) },
  };
}

async function captureEmails(run) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("api.resend.com")) return new Response("{}", { status: 404 }); // the weekly tool check finds nothing
    sent.push(JSON.parse(init.body));
    return new Response('{"id":"x"}');
  };
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

test("alert emails take their steps from the private EMAIL_STEPS secret, with a plain fallback", async () => {
  const { runHourly } = await import("../src/contact.js");
  const kv = { "link-rules": '{"shorteners":["a.example"]}' };
  const env = fakeEnv(kv);
  env.EMAIL_STEPS = JSON.stringify({ emergency: "STEP-TEXT-FROM-SECRET", review: "REVIEW-TEXT-FROM-SECRET" });
  await captureEmails(() => runHourly(env));
  kv["link-rules"] = '{"shorteners":["b.example"]}';
  let sent = await captureEmails(() => runHourly(env));
  assert.match(sent.find((mail) => /emergency/.test(mail.subject)).text, /STEP-TEXT-FROM-SECRET/);

  const plainKv = { "link-rules": '{"shorteners":["a.example"]}' };
  const plain = fakeEnv(plainKv);
  await captureEmails(() => runHourly(plain));
  plainKv["link-rules"] = '{"shorteners":["c.example"]}';
  sent = await captureEmails(() => runHourly(plain));
  const mail = sent.find((item) => /emergency/.test(item.subject));
  assert.match(mail.text, /Your steps are in your notes/);
  assert.doesNotMatch(mail.text, /claude|Terminal|Chrome/i);
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

// Weekly tool-update check: version list and release dates are faked
async function runToolCheck(env, { versions, ages, now }) {
  const { checkToolUpdate } = await import("../src/tool-updates.js");
  const sent = [];
  let lookups = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("jsdelivr")) {
      return new Response(JSON.stringify({ versions: versions.map((version) => ({ version, links: {} })) }));
    }
    if (url.includes("deps.dev")) {
      lookups++;
      const age = ages[url.split("/").pop()];
      return age === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ publishedAt: new Date(now - age * 86400000).toISOString() }));
    }
    sent.push(JSON.parse(init.body));
    return new Response('{"id":"x"}');
  };
  try { await checkToolUpdate(env, { subjectPrefix: "[example.com]" }, env.EMAIL_STEPS ? JSON.parse(env.EMAIL_STEPS).update : "plain steps", now); }
  finally { globalThis.fetch = realFetch; }
  return { sent, lookups };
}

test("tool update: emails the newest version that is at least 14 days old, once, with the private steps", async () => {
  const env = fakeEnv({});
  env.EMAIL_STEPS = JSON.stringify({ update: "UPDATE-STEPS-FROM-SECRET" });
  const now = Date.now();
  const setup = { versions: ["99.3.0", "99.2.0", "99.1.0", "4.0.1"], ages: { "99.3.0": 3, "99.2.0": 16, "99.1.0": 30 }, now };
  const first = await runToolCheck(env, setup);
  assert.equal(first.sent.length, 1);
  assert.match(first.sent[0].subject, /Tool update ready: Wrangler 99\.2\.0/);
  assert.match(first.sent[0].text, /UPDATE-STEPS-FROM-SECRET/);
  assert.doesNotMatch(first.sent[0].text, /99\.3\.0/);
  const again = await runToolCheck(env, { ...setup, now: now + 8 * 86400000 });
  assert.equal(again.sent.length, 0, "the same version isn't announced twice");
});

test("tool update: checks only weekly, ignores young or older versions, and limits emails to one per two weeks", async () => {
  const env = fakeEnv({});
  const now = Date.now();
  const young = { versions: ["99.3.0"], ages: { "99.3.0": 5 }, now };
  assert.equal((await runToolCheck(env, young)).sent.length, 0, "too new: nothing to announce");
  assert.equal((await runToolCheck(env, { ...young, now: now + 3600000 })).lookups, 0, "ran this week already");

  const env2 = fakeEnv({});
  assert.equal((await runToolCheck(env2, { versions: ["1.0.0"], ages: { "1.0.0": 400 }, now })).sent.length, 0, "older than mine");

  const env3 = fakeEnv({});
  assert.equal((await runToolCheck(env3, { versions: ["99.1.0"], ages: { "99.1.0": 20 }, now })).sent.length, 1);
  const soon = await runToolCheck(env3, { versions: ["99.2.0", "99.1.0"], ages: { "99.2.0": 15, "99.1.0": 20 }, now: now + 8 * 86400000 });
  assert.equal(soon.sent.length, 0, "a second email within two weeks waits");
  const later = await runToolCheck(env3, { versions: ["99.2.0", "99.1.0"], ages: { "99.2.0": 30, "99.1.0": 35 }, now: now + 15 * 86400000 });
  assert.equal(later.sent.length, 1);
});

test("security headers: a generic baseline in code, the full set from the SECURITY_HEADERS setting", async () => {
  const { withSecurityHeaders } = await import("../src/security-headers.js");
  const bare = withSecurityHeaders(new Response("x"), {});
  assert.equal(bare.headers.get("x-content-type-options"), "nosniff");
  assert.equal(bare.headers.get("content-security-policy"), "default-src 'self'");
  const full = withSecurityHeaders(new Response("x"), { SECURITY_HEADERS: JSON.stringify({ "X-Test": "1", "Content-Security-Policy": "default-src 'none'" }) });
  assert.equal(full.headers.get("x-test"), "1");
  assert.equal(full.headers.get("content-security-policy"), "default-src 'none'");
  const broken = withSecurityHeaders(new Response("x"), { SECURITY_HEADERS: "not json" });
  assert.equal(broken.headers.get("x-content-type-options"), "nosniff", "a broken setting falls back to the baseline");
});

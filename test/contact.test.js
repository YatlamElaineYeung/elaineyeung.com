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

test("emails once per new link list suggestion, without the lists", async () => {
  const { runHourly } = await import("../src/contact.js");
  const sent = [];
  const meta = new Map();
  let suggestion = '{"shorteners":["new.example"]}';
  const statement = (sql) => ({
    bind: (...args) => ({ ...statement(sql), args }),
    all: async () => ({ results: [] }),
    first: async function () {
      if (sql.includes("COUNT(*)")) return { n: 0, oldest: null };
      if (sql.includes("link_review_notified")) return meta.has("link") ? { value: meta.get("link") } : null;
      return null;
    },
    run: async function () { if (sql.includes("link_review_notified")) meta.set("link", this.args[0]); },
  });
  const env = {
    ALERT_TO: "me@example.com", RESEND_API_KEY: "test", MAIL_FROM: "site@example.com",
    CONTACT_MAX_PER_HOUR: "5", CONTACT_MAX_REFUSED_PER_HOUR: "8", CONTACT_REPEAT_MINUTES: "15", ALERT_AFTER_HOURS: "3", KEEP_FAILED_DAYS: "30",
    DB: { prepare: statement, batch: async () => [] },
    LINK_RULES_KV: { get: async () => suggestion },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); };
  try {
    await runHourly(env);
    await runHourly(env);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Link list review ready/);
    assert.doesNotMatch(sent[0].text, /new\.example/);
    suggestion = '{"shorteners":["other.example"]}';
    await runHourly(env);
    assert.equal(sent.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

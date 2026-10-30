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

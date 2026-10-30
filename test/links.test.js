// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLink, checkAllLinks, findLinks, secureLinksInText, trueDomain, toHttps } from "../public/links.js";
import { loadRules, parseRules, screenLink } from "../src/link-screening.js";

// Sample rules for testing only; the real lists are private (Cloudflare KV storage)
const rules = parseRules(JSON.stringify({
  knownSites: ["linkedin.com", "github.com", "google.com", "paypal.com", "microsoft.com"],
  shorteners: ["bit.ly"],
  blockedFileTypes: ["exe", "zip"],
}));

// A link passes when both the basic check and the private screening accept it
const passes = (link) => checkLink(link) === null && screenLink(link, rules) === null;
const ok = (link) => assert.equal(passes(link), true, link);
const bad = (link) => assert.equal(passes(link), false, link);

test("accepts normal links", () => {
  ok("https://www.linkedin.com/in/someone");
  ok("https://boards.greenhouse.io/acme/jobs/123");
  ok("https://github.com/someone/project");
  ok("https://careers.example-company.com/roles/42");
  ok("linkedin.com/in/someone");
  ok("https://jobs.example.co.uk/apply");
});

test("upgrades plain and http:// links to https://", () => {
  ok("http://example.com/jobs");
  assert.equal(toHttps("http://example.com/jobs"), "https://example.com/jobs");
  assert.equal(toHttps("linkedin.com/in/x"), "https://linkedin.com/in/x");
  assert.equal(toHttps("https://github.com/x"), "https://github.com/x");
});

test("rejects malformed links", () => {
  bad("https://192.168.1.10/login");
  bad("https://localhost/x");
  bad("https://exa mple.com");
});

test("rejects hidden-login tricks, shorteners, and file downloads", () => {
  bad("https://linkedin.com@evil.example/path");
  bad("https://bit.ly/abc123");
  bad("https://example.com/invoice.exe");
});

test("rejects look-alike domains", () => {
  bad("https://linkedln.com/in/someone");   // l instead of i
  bad("https://g00gle.com");                // zeros for o
  bad("https://paypa1.com");                // 1 for l
  bad("https://linked-in.com/jobs");        // extra hyphen
  bad("https://githubb.com/x");             // extra letter
  bad("https://rnicrosoft.com");            // rn for m
});

test("rejects a familiar name in front of someone else's domain", () => {
  bad("https://linkedin.com.jobs-apply.io/offer");
  assert.equal(trueDomain("linkedin.com.jobs-apply.io"), "jobs-apply.io");
});

test("rejects other alphabets and invisible characters", () => {
  bad("https://аpple.com");            // Cyrillic a
  bad("https://link​edin.com");        // zero-width space
  bad("https://xn--pple-43d.com");
});

test("finds links inside a message and limits how many", () => {
  assert.deepEqual(findLinks("See https://github.com/x and linkedin.com/in/y."), ["https://github.com/x", "linkedin.com/in/y"]);
  assert.equal(checkAllLinks("", "a.com b.com c.com d.com").error, "Please include no more than 3 links.");
  assert.equal(checkAllLinks("https://github.com/x", "No links here, just Node.js and e.g. text.").error, null);
});

test("links written inside the message are found and checked the same way", () => {
  assert.deepEqual(findLinks("Apply at careers.acme.museum/jobs/7 today"), ["careers.acme.museum/jobs/7"]);
  assert.deepEqual(findLinks("Mirror: ftp://files.example.com/x"), ["ftp://files.example.com/x"]);
  bad("ftp://files.example.com/x");
  bad("javascript://alert(1)");
  assert.equal(checkAllLinks("", "Email me at jane@acme.com, thanks").links.length, 0);
});

test("missing or broken private rules are reported, not ignored", async () => {
  assert.equal(await loadRules({}), null);
  assert.equal(await loadRules({ LINK_RULES_KV: { get: async () => null } }), null);
  assert.equal(parseRules("not json"), null);
  assert.ok(await loadRules({ LINK_RULES_KV: { get: async () => '{"knownSites":["github.com"]}' } }));
});

test("every way of writing a link in the message is checked and turned into https://", () => {
  const message = "Try google.com, www.google.com, http://google.com or https://google.com. Email jane@acme.com!";
  assert.deepEqual(findLinks(message), ["google.com", "www.google.com", "http://google.com", "https://google.com"]);
  assert.equal(
    secureLinksInText(message),
    "Try https://google.com, https://www.google.com, https://google.com or https://google.com. Email jane@acme.com!"
  );
  // Each form gets the same screening as the link box
  for (const form of ["g00gle.com", "www.g00gle.com", "http://g00gle.com", "https://g00gle.com"]) bad(form);
});

test("sites on the always-allow list are never treated as look-alikes", () => {
  const withAllow = parseRules(JSON.stringify({ knownSites: ["jobvite.com"], allowedSites: ["jobsite.com"] }));
  assert.equal(screenLink("https://jobsite.com/x", withAllow), null);
  assert.notEqual(screenLink("https://jobv1te.com/x", withAllow), null);
});

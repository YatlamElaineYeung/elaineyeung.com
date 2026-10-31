// The contact form: receives a submission, checks it, saves it, and emails it to me.
// Every check here runs on the server, so skipping the browser can't get around any of them.
import { FIELD_LIMITS } from "../public/form-rules.js";
import { checkFields } from "../public/form-check.js";
import { checkLink, findLinks, linkRejectedInMessage, secureLinksInText, toHttps, trueDomain } from "../public/links.js";
import { SUGGESTION_KEY, loadRules, screenLink } from "./link-screening.js";
import { sendEmail, verifyResendSignature } from "./email.js";

export const CONTACT_PATH = "/api/contact";
export const RESEND_EVENTS_PATH = "/api/resend-events";

const MAX_BODY_BYTES = 32 * 1024;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Settings that can change without editing code. Site details are Wrangler variables (wrangler.jsonc);
// the abuse limits and timings are Cloudflare secrets, so their values never appear in this repository.
// A missing or invalid limit makes the form refuse to run (see handleContact).
const LIMIT_SETTINGS = ["CONTACT_MAX_PER_HOUR", "CONTACT_MAX_REFUSED_PER_HOUR", "CONTACT_REPEAT_MINUTES", "ALERT_AFTER_HOURS", "KEEP_FAILED_DAYS"];

function settings(env) {
  const number = (name) => Number(env[name]);
  return {
    siteOrigin: env.SITE_ORIGIN,
    devOrigin: env.DEV_ORIGIN,
    timeZone: env.TIME_ZONE || "UTC",
    subjectPrefix: env.SUBJECT_PREFIX || "[Website]",
    limitsReady: LIMIT_SETTINGS.every((name) => number(name) > 0),
    maxPerHour: number("CONTACT_MAX_PER_HOUR"),
    // Refused links get their own allowance, so a real person can fix a few mistakes
    maxRefusedPerHour: number("CONTACT_MAX_REFUSED_PER_HOUR"),
    repeatWindowMs: number("CONTACT_REPEAT_MINUTES") * MINUTE_MS,
    alertAfterMs: number("ALERT_AFTER_HOURS") * HOUR_MS,
    keepFailedMs: number("KEEP_FAILED_DAYS") * DAY_MS,
  };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// errors: { field: message } for problems the visitor can fix; error: a message for the whole form
const fail = (status, error, errors) => json({ ok: false, ...(error ? { error } : {}), ...(errors ? { errors } : {}) }, status);
const GENERIC_ERROR = "Something went wrong. Please try again later.";
const BLOCKED_MESSAGE = "Your message couldn't be sent right now. Please try again later.";

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const formatTime = (ms, timeZone) =>
  new Date(ms).toLocaleString("en-US", {
    timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });

// ----------------------------------------------------------
// Checking the fields
// ----------------------------------------------------------
function clean(value, field) {
  return typeof value === "string" ? value.trim().slice(0, FIELD_LIMITS[field] + 1) : "";
}

function validate(input, isRefused) {
  const form = {
    firstName: clean(input.firstName, "firstName"),
    lastName: clean(input.lastName, "lastName"),
    email: clean(input.email, "email"),
    company: clean(input.company, "company"),
    link: clean(input.link, "link"),
    message: clean(input.message, "message"),
    resume: input.resume === true,
  };
  const errors = checkFields(form, isRefused);
  if (Object.keys(errors).length) return { errors };

  // Store and show every link as https://, in the link box and anywhere in the message
  if (form.link) form.link = toHttps(form.link);
  form.message = secureLinksInText(form.message);
  return { form };
}

// Cloudflare Turnstile: confirms the browser passed the bot check on my site (each pass works only once)
async function passedTurnstile(env, config, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY || !token || typeof token !== "string" || token.length > 2048) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const result = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body })).json();
    if (result.success !== true) return false;
    // A pass earned on some other website doesn't count (the preview's test keys report a sample hostname)
    return Boolean(config.devOrigin) || result.hostname === new URL(config.siteOrigin).hostname;
  } catch {
    return false;
  }
}

// Optional: asks Google Safe Browsing whether any link is a known phishing or malware site.
// Nobody visits the links; Google answers from its list, which it keeps up to date. Skipped if no key is set.
// Returns the first link Google lists as dangerous, or null.
async function dangerousLink(env, links) {
  if (!env.SAFE_BROWSING_KEY || links.length === 0) return null;
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.SAFE_BROWSING_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: new URL(env.SITE_ORIGIN).hostname, clientVersion: "1" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: links.map((link) => ({ url: toHttps(link) })),
        },
      }),
    });
    const result = await response.json();
    const flagged = new Set((result.matches || []).map((match) => match.threat?.url));
    return links.find((link) => flagged.has(toHttps(link))) ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------
// The email I receive
// ----------------------------------------------------------
export function buildEmail(form, id, receivedAt, config) {
  const name = `${form.firstName} ${form.lastName}`;
  const subject = `${config.subjectPrefix} Contact Request – ${name}${form.resume ? " (Resume)" : ""}`;
  const links = [...(form.link ? [form.link] : []), ...findLinks(form.message)].map(toHttps);
  const linkLines = links.map((link) => `  ${link}\n    (real domain: ${trueDomain(new URL(link).hostname)})`);

  const text = [
    `Name: ${name}`,
    `Email: ${form.email}`,
    `Company: ${form.company || "-"}`,
    `Relevant link: ${form.link || "-"}`,
    `Resume requested: ${form.resume ? "Yes" : "No"}`,
    "",
    "Message:",
    form.message,
    "",
    "----",
    ...(links.length ? ["Links in this message, shown as https:// (✓ passed the website's link checks):", ...linkLines, ""] : []),
    "Sender details are not verified. Check the person and company on LinkedIn before sending your resume.",
    "Never sign in to anything through a link in a message.",
    `Received ${formatTime(receivedAt, config.timeZone)} · Reference ${id}`,
  ].join("\n");

  return { subject, text };
}

async function deliver(env, row) {
  const form = JSON.parse(row.payload);
  const { subject, text } = buildEmail(form, row.id, row.created_at, settings(env));
  const result = await sendEmail(env, { to: env.CONTACT_TO, subject, text, replyTo: form.email, idempotencyKey: row.id });
  if (result.ok) {
    await env.DB.prepare("UPDATE messages SET status = 'sent', resend_id = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?")
      .bind(result.id, row.id).run();
  } else {
    await env.DB.prepare("UPDATE messages SET attempts = attempts + 1, last_error = ? WHERE id = ?")
      .bind(result.error.slice(0, 200), row.id).run();
  }
  return result.ok;
}

// ----------------------------------------------------------
// POST /api/contact
// ----------------------------------------------------------
export async function handleContact(request, env) {
  const config = settings(env);
  if (request.method !== "POST") return fail(405, "Method not allowed.");

  // Only my own site may send the form (Cloudflare also enforces this at the edge)
  const origin = request.headers.get("Origin");
  if (origin !== config.siteOrigin && !(config.devOrigin && origin === config.devOrigin)) return fail(403, "Forbidden.");
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return fail(415, GENERIC_ERROR);
  // Without these the form can't work safely, so it refuses rather than running half-protected
  const rules = await loadRules(env);
  if (!env.IP_HASH_SALT || !env.CONTACT_TO || !env.DB || !rules || !config.limitsReady) return fail(503, GENERIC_ERROR);

  // Refuse oversized requests before reading them, then check the real size too
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return fail(413, "Your message is too long.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "Your message is too long.");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail(400, GENERIC_ERROR);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, GENERIC_ERROR);

  // Hidden trap field: people never see it, bots fill it in. Answer exactly like a success,
  // so a bot can't tell it was caught and try again differently. Nothing is saved or sent.
  if (input.hp_field) return json({ ok: true });

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await sha256(env.IP_HASH_SALT + ip);
  const now = Date.now();
  const recordRefusedLink = () =>
    env.DB.prepare("INSERT INTO submissions (ip_hash, created_at, kind) VALUES (?, ?, 'refused')").bind(ipHash, now).run().catch(() => {});

  try {
    const recent = await env.DB.prepare(
      `SELECT SUM(kind = 'accepted') AS accepted, SUM(kind = 'refused') AS refused,
              MIN(CASE WHEN kind = 'accepted' THEN created_at END) AS firstAccepted,
              MIN(CASE WHEN kind = 'refused' THEN created_at END) AS firstRefused
       FROM submissions WHERE ip_hash = ? AND created_at > ?`
    ).bind(ipHash, now - HOUR_MS).first();
    const overAccepted = (recent.accepted || 0) >= config.maxPerHour;
    const overRefused = (recent.refused || 0) >= config.maxRefusedPerHour;
    if (overAccepted || overRefused) {
      // When the oldest counted attempt leaves the one-hour window, they can try again
      const resetAt = Math.max(overAccepted ? recent.firstAccepted + HOUR_MS : 0, overRefused ? recent.firstRefused + HOUR_MS : 0);
      return json({ ok: false, blocked: true, retryAfterMs: Math.max(resetAt - now, 0), error: BLOCKED_MESSAGE }, 429);
    }
  } catch {
    return fail(500, GENERIC_ERROR);
  }

  if (!(await passedTurnstile(env, config, input.turnstileToken, ip))) {
    return json({ ok: false, error: "Please complete the human check and try again.", retryCheck: true }, 400);
  }

  // Every field and every link is checked in one pass, so all problems come back together.
  // Links are refused by the basic checks, the private screening lists, or Google's list of dangerous sites.
  const typed = (name) => (typeof input[name] === "string" ? input[name].trim() : "");
  const candidates = [typed("link"), ...findLinks(typed("message"))].filter((link) => link && !checkLink(link));
  const flagged = await dangerousLink(env, candidates);
  const isRefused = (link) => Boolean(checkLink(link)) || Boolean(screenLink(link, rules)) || link === flagged;

  const { form, errors } = validate(input, isRefused);
  if (errors) {
    // Any refused link counts toward the refused-link limit (once per attempt); other mistakes never do
    const linkRefused = (typed("link") && isRefused(typed("link"))) || findLinks(typed("message")).some(isRefused);
    if (linkRefused) await recordRefusedLink();
    return fail(400, null, errors);
  }

  // A repeat of a form sent in the last few minutes (a double click, or a resend "to be sure") isn't
  // stored twice; the visitor is told it was already received. Changing any field makes it a new message,
  // and so does switching the resume request on (they forgot it the first time). Switching it off doesn't.
  const fingerprint = await sha256(JSON.stringify([
    form.firstName, form.lastName, form.email.toLowerCase(), form.company, form.link, form.message.replace(/\s+/g, " "),
  ]));
  const id = crypto.randomUUID();
  try {
    const earlier = await env.DB.prepare(
      "SELECT MAX(resume) AS resume FROM recent_forms WHERE fingerprint = ? AND created_at > ?"
    ).bind(fingerprint, now - config.repeatWindowMs).first();
    const isRepeat = earlier.resume !== null && (earlier.resume === 1 || !form.resume);
    if (isRepeat) return json({ ok: true, duplicate: true });

    await env.DB.batch([
      env.DB.prepare("INSERT INTO messages (id, created_at, status, fingerprint, payload) VALUES (?, ?, 'queued', ?, ?)")
        .bind(id, now, fingerprint, JSON.stringify(form)),
      env.DB.prepare("INSERT INTO recent_forms (fingerprint, resume, created_at) VALUES (?, ?, ?)").bind(fingerprint, form.resume ? 1 : 0, now),
      env.DB.prepare("INSERT INTO submissions (ip_hash, created_at) VALUES (?, ?)").bind(ipHash, now),
    ]);
  } catch {
    return fail(500, GENERIC_ERROR);
  }

  // Saved safely, so the visitor gets a "received" either way; if sending fails, the hourly job retries it
  try {
    await deliver(env, { id, created_at: now, payload: JSON.stringify(form) });
  } catch {
    // Left as 'queued' for the hourly retry
  }
  return json({ ok: true });
}

// ----------------------------------------------------------
// POST /api/resend-events (Resend's delivery reports)
// ----------------------------------------------------------
export async function handleResendEvent(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES || !(await verifyResendSignature(env, request, body))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const resendId = event?.data?.email_id;
  if (!resendId) return new Response("OK");

  if (event.type === "email.delivered") {
    // Delivered: the message is in my inbox, so the stored copy is deleted
    await env.DB.prepare("DELETE FROM messages WHERE resend_id = ?").bind(resendId).run();
  } else if (event.type === "email.bounced" || event.type === "email.failed") {
    await env.DB.prepare("UPDATE messages SET status = 'failed', last_error = ? WHERE resend_id = ?")
      .bind(event.type, resendId).run();
  }
  return new Response("OK");
}

// ----------------------------------------------------------
// Every hour: retry, tidy up, and alert me if anything is stuck
// ----------------------------------------------------------
export async function runHourly(env) {
  const config = settings(env);
  if (!config.limitsReady) return;
  const now = Date.now();

  const queued = await env.DB.prepare("SELECT id, created_at, payload FROM messages WHERE status = 'queued' ORDER BY created_at LIMIT 20").all();
  for (const row of queued.results) await deliver(env, row);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE created_at < ?").bind(now - 2 * HOUR_MS),
    env.DB.prepare("DELETE FROM recent_forms WHERE created_at < ?").bind(now - config.repeatWindowMs),
    // Accepted by Resend a week ago with no problem reported: Resend keeps its own 30-day log
    env.DB.prepare("DELETE FROM messages WHERE status = 'sent' AND created_at < ?").bind(now - 7 * DAY_MS),
    // Personal details aren't kept forever: a bounced message I've been alerted about daily is removed after this long
    env.DB.prepare("DELETE FROM messages WHERE status = 'failed' AND created_at < ?").bind(now - config.keepFailedMs),
  ]);

  await notifyLinkReview(env, config);

  // Stuck = not accepted for a few hours, bounced, or (once delivery reports are set up) accepted but not delivered
  const waitingForDelivery = env.RESEND_WEBHOOK_SECRET ? " OR status = 'sent'" : "";
  const stuck = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM messages WHERE status = 'failed' OR ((status = 'queued'${waitingForDelivery}) AND created_at < ?)`
  ).bind(now - config.alertAfterMs).first();
  if (!stuck.n || !env.ALERT_TO) return;

  // At most one alert a day while something is waiting
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_alert'").first();
  if (last && now - Number(last.value) < DAY_MS) return;

  const plural = stuck.n === 1 ? "message is" : "messages are";
  const result = await sendEmail(env, {
    to: env.ALERT_TO,
    subject: `${config.subjectPrefix} Action needed: ${stuck.n} website ${plural} waiting`,
    text: [
      `${stuck.n} contact form ${plural} waiting to reach your inbox (oldest since ${formatTime(stuck.oldest, config.timeZone)}).`,
      "",
      "Nothing has been lost: they are saved in your private Cloudflare storage and retried every hour.",
      "",
      "What to do: follow the \"If a website message is stuck or I get an alert\" steps in your notes.",
      "",
      "You will get at most one of these alerts a day while something is waiting.",
    ].join("\n"),
    idempotencyKey: "alert-" + new Date(now).toISOString().slice(0, 13),
  });
  if (result.ok) {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_alert', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(String(now)).run();
  }
}

// The quarterly review agent saves suggested link list changes under SUGGESTION_KEY, next to the live list.
// Email me once per new suggestion. The email never includes the lists; nothing changes on the live list
// until I review the suggestion locally and approve it.
async function notifyLinkReview(env, config) {
  if (!env.ALERT_TO || !env.LINK_RULES_KV) return;
  const suggestion = await env.LINK_RULES_KV.get(SUGGESTION_KEY).catch(() => null);
  if (!suggestion) return;

  const fingerprint = await sha256(suggestion);
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'link_review_notified'").first();
  if (last && last.value === fingerprint) return;

  const result = await sendEmail(env, {
    to: env.ALERT_TO,
    subject: `${config.subjectPrefix} Link list review ready`,
    text: [
      "The quarterly link list review has saved suggested changes to your private link lists.",
      "",
      "Nothing has changed on your live website: the suggestions wait until you approve them.",
      "",
      "What to do: open Claude Code in the elaineyeung.com project and say \"review link list suggestions\".",
    ].join("\n"),
    idempotencyKey: "link-review-" + fingerprint.slice(0, 32),
  });
  if (result.ok) {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('link_review_notified', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(fingerprint).run();
  }
}

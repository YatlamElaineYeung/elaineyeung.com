// Weekly check for a newer version of the publishing tool (Wrangler) that has been out long enough
// to trust. Emails me at most once every two weeks, and never for a version I already have.
// It only reads two free public listings, sends nothing about me, and never changes anything.
import pkg from "../package.json" with { type: "json" };
import { sendEmail } from "./email.js";

const PACKAGE = "wrangler";
const VERSION_LIST = `https://data.jsdelivr.com/v1/packages/npm/${PACKAGE}`; // newest versions come first
const RELEASE_DATE = `https://api.deps.dev/v3/systems/npm/packages/${PACKAGE}/versions/`;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 7 * DAY_MS;
const EMAIL_EVERY_MS = 14 * DAY_MS;
const MIN_AGE_MS = 14 * DAY_MS;
const MAX_LOOKUPS = 8;
const READ_BYTES = 24 * 1024; // the newest versions sit at the start, so the rest of the list is never read

const parse = (version) => version.split(".").map(Number);
function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Stable versions newer than mine, newest first, read from the start of the list only
async function newerVersions(current) {
  const response = await fetch(VERSION_LIST, { headers: { accept: "application/json" } });
  if (!response.ok || !response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < READ_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const found = [...text.matchAll(/"version":\s*"(\d+\.\d+\.\d+)"/g)].map((match) => match[1]);
  return [...new Set(found)].filter((version) => compare(version, current) > 0).sort((a, b) => compare(b, a));
}

async function publishedAt(version) {
  const response = await fetch(RELEASE_DATE + version);
  if (!response.ok) return null;
  const time = Date.parse((await response.json()).publishedAt);
  return Number.isNaN(time) ? null : time;
}

export async function checkToolUpdate(env, config, steps, now = Date.now()) {
  if (!env.ALERT_TO) return;
  const getMeta = async (key) => (await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first())?.value ?? null;
  const setMeta = (key, value) =>
    env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, String(value)).run();

  const lastCheck = Number(await getMeta("tool_update_checked"));
  if (lastCheck && now - lastCheck < CHECK_EVERY_MS) return;
  await setMeta("tool_update_checked", now); // recorded first, so a failure is retried next week, not hourly

  const current = String(pkg.devDependencies?.[PACKAGE] ?? "").replace(/^[^\d]*/, "");
  if (!/^\d+\.\d+\.\d+$/.test(current)) return;

  // Release dates only grow with the version number, so a binary search finds the newest version that is
  // old enough in a handful of lookups, however many releases there have been
  const candidates = (await newerVersions(current)).reverse(); // oldest first
  let low = 0, high = candidates.length - 1, eligible = null;
  for (let lookups = 0; low <= high && lookups < MAX_LOOKUPS; lookups++) {
    const middle = Math.floor((low + high) / 2);
    const released = await publishedAt(candidates[middle]);
    if (released && now - released >= MIN_AGE_MS) { eligible = candidates[middle]; low = middle + 1; }
    else high = middle - 1;
  }
  if (!eligible) return;

  const emailedAt = Number(await getMeta("tool_update_emailed"));
  if ((await getMeta("tool_update_version")) === eligible) return;
  if (emailedAt && now - emailedAt < EMAIL_EVERY_MS) return;

  const result = await sendEmail(env, {
    to: env.ALERT_TO,
    subject: `${config.subjectPrefix} Tool update ready: Wrangler ${eligible}`,
    text: [
      `A newer version of Wrangler (the tool that publishes your site), ${eligible}, is ready. It has been out long enough to trust.`,
      "Nothing has changed yet, and nothing changes until you approve it.",
      "",
      steps,
      "",
      "You'll get at most one of these emails every two weeks.",
    ].join("\n"),
    idempotencyKey: "tool-update-" + eligible,
  });
  if (result.ok) {
    await setMeta("tool_update_emailed", now);
    await setMeta("tool_update_version", eligible);
  }
}

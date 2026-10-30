// Server-only link screening. The lists it uses are private: they live in Cloudflare KV storage
// (binding LINK_RULES_KV, key RULES_KEY), so they never appear on the website or in this repository.
// Shape: { "knownSites": [...], "shorteners": [...], "blockedFileTypes": [...], "allowedSites": [...] }
// allowedSites: real sites that happen to look like a known site (e.g. one letter apart) and should never be refused.
import { LINK_REJECTED, toHttps, trueDomain } from "../public/links.js";

export const RULES_KEY = "link-rules";

// Returns the rules, or null if they're missing or unreadable (the form then refuses to run)
export async function loadRules(env) {
  try {
    return parseRules(await env.LINK_RULES_KV.get(RULES_KEY));
  } catch {
    return null;
  }
}

export function parseRules(json) {
  try {
    const rules = JSON.parse(json || "");
    return {
      knownSites: rules.knownSites || [],
      shorteners: rules.shorteners || [],
      blockedFileTypes: rules.blockedFileTypes || [],
      allowedSites: rules.allowedSites || [],
    };
  } catch {
    return null;
  }
}

// Swap look-alike characters for the letters they imitate
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1|!]/g, "l")
    .replace(/i/g, "l")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/-/g, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length];
}

const nameOf = (domain) => domain.split(".")[0];

// True when a domain imitates a well-known site without being it
function isLookalike(domain, knownSites) {
  if (knownSites.includes(domain)) return false;
  const name = nameOf(domain);
  return knownSites.some((known) => {
    const knownName = nameOf(known);
    if (knownName.length < 4) return false;
    if (normalize(name) === normalize(knownName)) return true;
    return knownName.length >= 6 && editDistance(name, knownName) === 1;
  });
}

// Returns null when the link passes, otherwise the general message.
// Expects a link that already passed the basic checks in public/links.js.
export function screenLink(raw, rules) {
  const url = new URL(toHttps(raw));
  const host = url.hostname.toLowerCase();
  const domain = trueDomain(host);

  if (rules.shorteners.includes(domain) || rules.shorteners.includes(host)) return LINK_REJECTED;
  const extension = (url.pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (extension && rules.blockedFileTypes.includes(extension.toLowerCase())) return LINK_REJECTED;
  if (!rules.allowedSites.includes(domain) && isLookalike(domain, rules.knownSites)) return LINK_REJECTED;
  // A familiar name placed in front of someone else's domain: "linkedin.com.jobs-apply.io"
  const inFront = host.slice(0, -domain.length);
  if (rules.knownSites.some((known) => inFront.includes(known + "."))) return LINK_REJECTED;
  return null;
}

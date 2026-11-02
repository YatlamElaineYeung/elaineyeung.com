// Basic checks for links that visitors put in the contact form.
// The site never visits a link itself; it only inspects the text of the address.
// The same file runs in the browser (instant feedback, public/contact-form.js) and in the Worker (src/contact.js).
// Deeper screening runs only on the server, with private rules (src/link-screening.js).
import { TWO_LEVEL_ENDINGS, COMMON_ENDINGS, MAX_LINKS } from "./form-rules.js";

// Invisible characters that can hide inside an address
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/;

// One general message for every link problem, so the reason a link was refused is never revealed
export const LINK_REJECTED = "This link can't be accepted. Please try a different one.";

// For links inside the message, name each refused link so the visitor knows which to change (never why)
export function linkRejectedInMessage(links) {
  const shown = links.map((link) => (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\//i.test(link) ? link : toHttps(link)));
  return shown.length === 1
    ? `This link in your message can't be accepted: ${shown[0]}. Please try a different one.`
    : `These links in your message can't be accepted: ${shown.join(", ")}. Please try different ones.`;
}

// Everything in a block of text that looks like a link: anything with "://" (any kind of link),
// "www.", a dotted name followed by a path ("site.anything/page"), or a name with a common ending ("site.com")
function linkPattern() {
  return new RegExp(
    [
      String.raw`[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+`,
      String.raw`www\.[^\s<>"']+`,
      // (?<![@\w.-]) skips email addresses like jane@acme.com, which aren't links
      String.raw`(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"']*`,
      String.raw`(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:${COMMON_ENDINGS.join("|")})\b(?:\/[^\s<>"']*)?`,
    ].join("|"),
    "gi"
  );
}

// Punctuation at the end of a sentence isn't part of the link: "see site.com." -> "site.com"
const TRAILING = /[).,;:!?'"]+$/;

export function findLinks(text) {
  return (text.match(linkPattern()) || []).map((link) => link.replace(TRAILING, ""));
}

// Rewrites every web link in a message to its https:// form, wherever it appears:
// "google.com", "www.google.com" and "http://google.com" all become "https://…".
// Other kinds of link (ftp://, etc.) are left as typed; the checks refuse them.
export function secureLinksInText(text) {
  return text.replace(linkPattern(), (match) => {
    const trailing = (match.match(TRAILING) || [""])[0];
    const link = match.slice(0, match.length - trailing.length);
    const isWebOrBare = /^https?:\/\//i.test(link) || !/^[a-z][a-z0-9+.-]*:/i.test(link);
    return (isWebOrBare ? toHttps(link) : link) + trailing;
  });
}

// The secure form of a link: "linkedin.com/in/x" and "http://site.com" both become "https://…"
export function toHttps(raw) {
  return "https://" + raw.trim().replace(/^https?:\/\//i, "");
}

// The part of a host name that actually decides who owns it: "jobs.example.co.uk" -> "example.co.uk"
export function trueDomain(host) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  const lastTwo = labels.slice(-2).join(".");
  const keep = TWO_LEVEL_ENDINGS.includes(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

// Checks one link's basic shape. Returns null when it is fine, otherwise the general message.
export function checkLink(raw) {
  if (raw.length > 2048) return LINK_REJECTED;
  if (INVISIBLE.test(raw) || /\s/.test(raw.trim())) return LINK_REJECTED;
  // Only web links: ftp://, file://, javascript: and similar are refused
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) && !/^https?:\/\//i.test(raw.trim())) return LINK_REJECTED;

  const secure = toHttps(raw);
  let url;
  try {
    url = new URL(secure);
  } catch {
    return LINK_REJECTED;
  }

  if (url.username || url.password || /^https:\/\/[^/]*@/i.test(secure)) return LINK_REJECTED;
  // Letters from other alphabets show up as "xn--" once the browser converts the address
  if (/[^\x21-\x7e]/.test(raw.trim()) || url.hostname.split(".").some((label) => label.startsWith("xn--"))) return LINK_REJECTED;
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[")) return LINK_REJECTED;
  if (!url.hostname.includes(".")) return LINK_REJECTED;
  return null;
}

// Checks the optional Relevant Link field and every link inside the message
export function checkAllLinks(relevantLink, message) {
  const links = [...(relevantLink ? [relevantLink.trim()] : []), ...findLinks(message)];
  if (links.length > MAX_LINKS) return { error: `Please include no more than ${MAX_LINKS} links.`, links };
  for (const link of links) {
    const error = checkLink(link);
    if (error) return { error, links };
  }
  return { error: null, links };
}

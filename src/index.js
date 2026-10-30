// Runs on Cloudflare in front of the site.
// Sends every visitor to one address, the SITE_ORIGIN setting in wrangler.jsonc (https://elaineyeung.com)
import { CONTACT_PATH, RESEND_EVENTS_PATH, handleContact, handleResendEvent, runHourly } from "./contact.js";

// The HTML uses this placeholder for the Turnstile bot check's public site key.
// The real key (TURNSTILE_SITE_KEY, added to wrangler.jsonc's vars at deploy; a test key in .dev.vars
// for local preview) is filled in as the page is served. Without it the bot check can't load, so the form can't send.
const SITE_KEY_PLACEHOLDER = "__TURNSTILE_SITE_KEY__";

// Browser security rules sent with every response.
// The script hash allows only the small theme script inline in index.html's <head>;
// if that script changes, its hash here must be updated or the browser will block it.
// Cloudflare Web Analytics (cookie-free visitor counts) is allowed so its beacon can load and report.
// Cloudflare Turnstile (the contact form's bot check) is allowed to load its script and its check box.
const SECURITY_HEADERS = {
  // HTTPS-only for two years (renewed on every visit), including subdomains
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'sha256-cSWxBURo/CH+U3PwzdQZQSZwzz4Mv6a4dSb7UVlLBmw=' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  return secured;
}

class SiteKeyInjector {
  constructor(siteKey) {
    this.siteKey = siteKey;
  }

  element(el) {
    el.setAttribute("data-sitekey", this.siteKey);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const canonicalHost = new URL(env.SITE_ORIGIN).hostname;

    // The Worker's backup workers.dev address only accepts Resend's delivery reports.
    // It sits outside the main domain's bot settings, so those reports always get through.
    if (url.hostname.endsWith(".workers.dev")) {
      if (url.pathname === RESEND_EVENTS_PATH) return withSecurityHeaders(await handleResendEvent(request, env));
      return withSecurityHeaders(Response.redirect(env.SITE_ORIGIN + "/", 301));
    }

    const isHttp = url.protocol === "http:";
    const isWww = url.hostname === "www." + canonicalHost;

    if (isHttp || isWww) {
      url.protocol = "https:";
      if (isWww) url.hostname = canonicalHost;
      // 301 = permanent, so browsers and search engines remember it
      return withSecurityHeaders(Response.redirect(url.toString(), 301));
    }

    if (url.pathname === CONTACT_PATH) return withSecurityHeaders(await handleContact(request, env));

    // Otherwise serve the site files from ./public
    const response = await env.ASSETS.fetch(request);

    // Only HTML pages contain the placeholder; everything else passes through untouched
    const isHtml = (response.headers.get("content-type") || "").includes("text/html");
    if (!isHtml || !env.TURNSTILE_SITE_KEY) return withSecurityHeaders(response);

    return withSecurityHeaders(
      new HTMLRewriter()
        .on(`[data-sitekey="${SITE_KEY_PLACEHOLDER}"]`, new SiteKeyInjector(env.TURNSTILE_SITE_KEY))
        .transform(response)
    );
  },

  // Cloudflare runs this every hour (see "triggers" in wrangler.jsonc)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHourly(env));
  },
};

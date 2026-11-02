// Runs on Cloudflare in front of the site.
// Sends every visitor to one address, the SITE_ORIGIN setting in wrangler.jsonc
import { CONTACT_PATH, RESEND_EVENTS_PATH, handleContact, handleResendEvent, runHourly } from "./contact.js";
import { withSecurityHeaders } from "./security-headers.js";

// The HTML uses this placeholder for the Turnstile bot check's public site key.
// The real key (TURNSTILE_SITE_KEY, added to wrangler.jsonc's vars at deploy; a test key in .dev.vars
// for local preview) is filled in as the page is served. Without it the bot check can't load, so the form can't send.
const SITE_KEY_PLACEHOLDER = "__TURNSTILE_SITE_KEY__";

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
      if (url.pathname === RESEND_EVENTS_PATH) return withSecurityHeaders(await handleResendEvent(request, env), env);
      return withSecurityHeaders(Response.redirect(env.SITE_ORIGIN + "/", 301), env);
    }

    const isHttp = url.protocol === "http:";
    const isWww = url.hostname === "www." + canonicalHost;

    if (isHttp || isWww) {
      url.protocol = "https:";
      if (isWww) url.hostname = canonicalHost;
      // 301 = permanent, so browsers and search engines remember it
      return withSecurityHeaders(Response.redirect(url.toString(), 301), env);
    }

    if (url.pathname === CONTACT_PATH) return withSecurityHeaders(await handleContact(request, env), env);

    // Otherwise serve the site files from ./public
    const response = await env.ASSETS.fetch(request);

    // Only HTML pages contain the placeholder; everything else passes through untouched
    const isHtml = (response.headers.get("content-type") || "").includes("text/html");
    if (!isHtml || !env.TURNSTILE_SITE_KEY) return withSecurityHeaders(response, env);

    return withSecurityHeaders(
      new HTMLRewriter()
        .on(`[data-sitekey="${SITE_KEY_PLACEHOLDER}"]`, new SiteKeyInjector(env.TURNSTILE_SITE_KEY))
        .transform(response),
      env
    );
  },

  // Cloudflare runs this every hour (see "triggers" in wrangler.jsonc)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHourly(env));
  },
};

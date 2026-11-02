// Settings shared by the contact form in the browser (public/contact-form.js)
// and on the server (src/contact.js). Edit them here and both stay in step.
// Only general limits live here; the server's private link screening rules are a Cloudflare secret (see src/link-screening.js).

export const MAX_WORDS = 500;
export const MAX_LINKS = 3;

// Longest allowed value for each field, in characters
export const FIELD_LIMITS = {
  firstName: 50,
  lastName: 50,
  email: 254,
  company: 100,
  link: 2048,
  message: 5000,
};

// Letters from any language, spaces, apostrophes, hyphens and periods ("J. Smith", "Robert Jr.")
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;
export const NAME_RULE_MESSAGE = "can only include letters, spaces, apostrophes, hyphens, and periods.";
export const EMAIL_PATTERN = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[a-z]{2,}$/i;

export const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// Country endings where the real name sits one level deeper (company.co.uk)
export const TWO_LEVEL_ENDINGS = [
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "co.nz", "com.br", "co.in", "com.cn", "com.hk", "com.sg",
];

// Endings recognised when someone writes a bare address like "linkedin.com/in/name" in their message
export const COMMON_ENDINGS = [
  "com", "net", "org", "io", "co", "ai", "dev", "app", "us", "me", "info", "biz", "xyz", "site", "online", "link",
  "ly", "gl", "gg", "tv", "edu", "gov", "uk", "ca", "au", "de", "fr", "jp", "cn", "hk", "sg", "in", "jobs",
  "careers", "page", "so", "to", "zip", "mov", "top", "click", "live", "shop", "work", "support",
];

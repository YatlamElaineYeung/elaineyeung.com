// Browser safety rules sent with every response.
// The full, site-specific set comes from the SECURITY_HEADERS setting (JSON: header name -> value),
// so this public file holds only a strict generic baseline that applies if that setting is missing.
const BASELINE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'",
};

export function securityHeaders(env) {
  let configured = {};
  try {
    const parsed = JSON.parse(env.SECURITY_HEADERS || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) configured = parsed;
  } catch {}
  return { ...BASELINE_HEADERS, ...configured };
}

export function withSecurityHeaders(response, env) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(env))) secured.headers.set(name, String(value));
  return secured;
}

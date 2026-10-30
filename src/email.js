// Sending email through Resend, and checking Resend's delivery reports.
// The Resend key can only send, and only from mail.elaineyeung.com.

const RESEND_API = "https://api.resend.com/emails";

// Returns { ok: true, id } or { ok: false, error }. Never throws.
// In local preview (DEV_ORIGIN set, no Resend key) the email is printed to the terminal instead of sent.
// On the live site a missing key is an error, so visitors' details never end up in logs.
export async function sendEmail(env, { to, subject, text, replyTo, idempotencyKey }) {
  if (!env.RESEND_API_KEY) {
    if (!env.DEV_ORIGIN) return { ok: false, error: "Resend key missing" };
    console.log(`[preview] email not sent (no Resend key)\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { ok: true, id: "preview-" + idempotencyKey };
  }
  try {
    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        // Resend sends at most one email per key, so a retry can never send a duplicate
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: `Resend ${response.status}: ${result.name || "error"}` };
    return { ok: true, id: result.id };
  } catch (error) {
    return { ok: false, error: "Resend unreachable" };
  }
}

// Resend signs each delivery report (via Svix). Rejects anything not signed with our webhook secret,
// or older than 5 minutes so a captured report can't be replayed later.
export async function verifyResendSignature(env, request, body) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!env.RESEND_WEBHOOK_SECRET || !id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const secret = Uint8Array.from(atob(env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));

  // The header can hold several signatures ("v1,abc v1,def"); one match is enough
  return signatures.split(" ").some((entry) => timingSafeEqual(entry.split(",")[1] || "", expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

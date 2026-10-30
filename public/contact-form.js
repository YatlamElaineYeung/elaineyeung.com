// Contact form pop-up. Opens from any "Contact Me" button.
// Nothing typed here is stored in the browser; closing the form erases it.
import { MAX_WORDS, FIELD_LIMITS, countWords } from "./form-rules.js";
import { checkFields } from "./form-check.js";
import { checkAllLinks, checkLink, findLinks, secureLinksInText, toHttps } from "./links.js";

const MIN_FILL_MS = 3000;
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const dialog = document.getElementById("contact-dialog");
const form = dialog.querySelector(".contact-form");
const formView = dialog.querySelector('[data-view="form"]');
const doneView = dialog.querySelector('[data-view="done"]');
const confirmBox = dialog.querySelector(".dialog-confirm");
const status = form.querySelector(".form-status");
const submitButton = form.querySelector(".form-submit");
const wordCount = document.getElementById("cf-message-count");
const turnstileSlot = form.querySelector(".turnstile-slot");

let openedAt = 0;
let widgetId = null;
let token = null;
let tokenWaiters = [];
let sending = false;

// Field length limits come from form-rules.js, the same values the server enforces
for (const [name, limit] of Object.entries(FIELD_LIMITS)) form.elements[name].maxLength = limit;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ----------------------------------------------------------
// Cloudflare Turnstile (loaded only when the form first opens)
// ----------------------------------------------------------
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function setToken(value) {
  token = value;
  if (value) {
    tokenWaiters.forEach((resolve) => resolve(value));
    tokenWaiters = [];
  }
}

async function startTurnstile() {
  try {
    await loadTurnstile();
  } catch {
    return; // sending will show a "try again" message
  }
  if (widgetId !== null) return;
  widgetId = window.turnstile.render(turnstileSlot, {
    sitekey: turnstileSlot.dataset.sitekey,
    appearance: "interaction-only",
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    callback: setToken,
    "expired-callback": () => setToken(null),
    "error-callback": () => setToken(null),
  });
}

function resetTurnstile() {
  setToken(null);
  if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
}

// Waits for the bot check to finish (or for the visitor to tick its box, if one appears)
function getToken(timeoutMs = 30000) {
  if (token) return Promise.resolve(token);
  return Promise.race([new Promise((resolve) => tokenWaiters.push(resolve)), wait(timeoutMs).then(() => null)]);
}

// ----------------------------------------------------------
// Opening, closing, and the "Discard your message?" prompt
// ----------------------------------------------------------
function showView(name) {
  formView.hidden = name !== "form";
  doneView.hidden = name !== "done";
  confirmBox.hidden = true;
}

function hasTyping() {
  const data = new FormData(form);
  return ["firstName", "lastName", "email", "company", "link", "message"].some((name) => String(data.get(name) || "").trim()) || data.get("resume") === "on";
}

function eraseForm() {
  form.reset();
  clearErrors();
  status.textContent = "";
  updateWordCount();
  resetTurnstile();
}

function open() {
  eraseForm();
  showView("form");
  dialog.showModal();
  document.documentElement.classList.add("dialog-open");
  openedAt = Date.now();
  startTurnstile();
  form.elements.firstName.focus();
}

function close() {
  dialog.close();
  document.documentElement.classList.remove("dialog-open");
  eraseForm();
  showView("form");
}

// Called by the ×, the Escape key, and clicks outside the form
function requestClose() {
  if (sending) return;
  if (!formView.hidden && hasTyping()) {
    confirmBox.hidden = false;
    confirmBox.querySelector("[data-keep-editing]").focus();
  } else {
    close();
  }
}

document.querySelectorAll("[data-open-contact]").forEach((button) =>
  button.addEventListener("click", () => (isBlocked() ? showBlocked() : open()))
);

// A link to https://elaineyeung.com/?contact (used in security.txt) opens the form directly
if (new URLSearchParams(location.search).has("contact")) {
  queueMicrotask(() => (isBlocked() ? showBlocked() : open()));
}
dialog.querySelector(".dialog-close").addEventListener("click", requestClose);
dialog.querySelector("[data-close-contact]").addEventListener("click", close);
dialog.querySelector("[data-discard]").addEventListener("click", close);
dialog.querySelector("[data-keep-editing]").addEventListener("click", () => {
  confirmBox.hidden = true;
  form.elements.message.focus();
});

// Escape: ask first instead of closing straight away
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!confirmBox.hidden) {
    confirmBox.hidden = true;
  } else {
    requestClose();
  }
});

// A click on the dimmed background outside the panel
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) requestClose();
});

// ----------------------------------------------------------
// Checking the fields as the visitor goes
// ----------------------------------------------------------
function fieldError(name, message) {
  const input = form.elements[name];
  const error = document.getElementById(input.id + "-error");
  error.textContent = message || "";
  input.toggleAttribute("aria-invalid", Boolean(message));
}

function clearErrors() {
  ["firstName", "lastName", "email", "company", "link", "message"].forEach((name) => fieldError(name, ""));
}

function updateWordCount() {
  const words = countWords(form.elements.message.value);
  wordCount.textContent = `${words} / ${MAX_WORDS} words`;
  wordCount.classList.toggle("over", words > MAX_WORDS);
}

// Every problem in the form, as { field: message }; same checks as the server
const currentProblems = () => checkFields(Object.fromEntries(new FormData(form)));

// Show each problem under its field, clear the rest, and put the cursor on the first one
function showProblems(problems) {
  const fields = ["firstName", "lastName", "email", "company", "link", "message"];
  fields.forEach((name) => fieldError(name, problems[name] || ""));
  const first = fields.find((name) => problems[name]);
  if (first) form.elements[first].focus();
}

form.elements.message.addEventListener("input", updateWordCount);

// Check a field when the visitor leaves it, and clear its error as soon as they fix it
form.addEventListener("focusout", (event) => {
  const name = event.target.name;
  if (!["firstName", "lastName", "email", "link", "message"].includes(name) || !event.target.value.trim()) return;
  // Show the secure form of a link ("linkedin.com/in/x" -> "https://linkedin.com/in/x") once it passes the checks
  if (name === "link" && !checkLink(event.target.value)) event.target.value = toHttps(event.target.value);
  // Same for links written anywhere in the message
  if (name === "message" && !checkAllLinks("", event.target.value).error) event.target.value = secureLinksInText(event.target.value);
  fieldError(name, currentProblems()[name] || "");
});

form.addEventListener("input", (event) => {
  if (event.target.hasAttribute("aria-invalid")) {
    if (!currentProblems()[event.target.name]) fieldError(event.target.name, "");
  }
});

// ----------------------------------------------------------
// Sending
// ----------------------------------------------------------
function setSending(on, label) {
  sending = on;
  submitButton.disabled = on;
  submitButton.textContent = label || "Send Message";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending) return; // one click sends once
  clearErrors();
  status.textContent = "";

  // Show what the browser can see straight away. Links still go to the server, which checks them
  // against its private lists, so every problem (fields and links) comes back together.
  const problems = currentProblems();
  const data = new FormData(form);
  const typedLinks = [String(data.get("link") || "").trim(), ...findLinks(String(data.get("message") || ""))].filter(Boolean);
  if (Object.keys(problems).length) {
    showProblems(problems);
    if (!typedLinks.some((link) => !checkLink(link))) return;
  }

  setSending(true, "Sending…");
  const elapsed = Date.now() - openedAt;
  if (elapsed < MIN_FILL_MS) await wait(MIN_FILL_MS - elapsed);

  const turnstileToken = await getToken();
  if (!turnstileToken) {
    setSending(false);
    status.textContent = "Please complete the human check above, then press Send Message again.";
    return;
  }

  const payload = {
    firstName: data.get("firstName").trim(),
    lastName: data.get("lastName").trim(),
    email: data.get("email").trim(),
    company: data.get("company").trim(),
    link: data.get("link").trim(),
    message: data.get("message").trim(),
    resume: data.get("resume") === "on",
    hp_field: data.get("hp_field"),
    turnstileToken,
  };

  let result;
  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    result = await response.json();
  } catch {
    result = { ok: false, error: "Something went wrong. Please try again later." };
  }

  resetTurnstile();
  setSending(false);

  if (result.ok) {
    dialog.querySelector(".done-name").textContent = payload.firstName;
    dialog.querySelector(".done-text").textContent = result.duplicate
      ? "You already sent this message, and it has been received."
      : "Your message has been received.";
    showView("done");
    dialog.querySelector(".done-title").focus();
    form.reset();
    updateWordCount();
    return;
  }

  if (result.blocked) {
    blockFor(result.retryAfterMs);
    close();
    showBlocked();
    return;
  }

  if (result.errors) showProblems(result.errors);
  if (result.error || !result.errors) status.textContent = result.error || "Something went wrong. Please try again later.";
});

// ----------------------------------------------------------
// "Your message couldn't be sent right now": its own pop-up. Until the wait is over,
// Contact Me opens this instead of the form. (The server enforces the limit either way.)
// ----------------------------------------------------------
const blockedDialog = document.getElementById("contact-blocked");
const BLOCKED_KEY = "contactBlockedUntil";
let blockedUntil = 0;
try {
  blockedUntil = Number(localStorage.getItem(BLOCKED_KEY)) || 0;
} catch {
  // Storage may be blocked (private browsing); the pop-up still works for this visit
}

function blockFor(ms) {
  blockedUntil = Date.now() + (Number(ms) > 0 ? Number(ms) : 60 * 60 * 1000);
  try {
    localStorage.setItem(BLOCKED_KEY, String(blockedUntil));
  } catch {}
}

const isBlocked = () => Date.now() < blockedUntil;

function showBlocked() {
  blockedDialog.showModal();
  blockedDialog.querySelector("[data-close-blocked]").focus();
}

blockedDialog.querySelector("[data-close-blocked]").addEventListener("click", () => blockedDialog.close());
blockedDialog.addEventListener("click", (event) => {
  if (event.target === blockedDialog) blockedDialog.close();
});

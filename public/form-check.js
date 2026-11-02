// Checks every field of the contact form and returns all problems at once, as { field: message }.
// The browser uses it to show every mistake together; the server runs the same checks before saving.
import { MAX_WORDS, MAX_LINKS, FIELD_LIMITS, NAME_PATTERN, NAME_RULE_MESSAGE, EMAIL_PATTERN, countWords } from "./form-rules.js";
import { LINK_REJECTED, checkLink, findLinks, linkRejectedInMessage } from "./links.js";

// Control characters, except new lines and tabs in the message
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// isRefused(link) decides whether a link is refused. The browser uses the basic checks;
// the server adds its private screening, so both report problems the same way.
export function checkFields(values, isRefused = (link) => Boolean(checkLink(link))) {
  const value = (name) => (typeof values[name] === "string" ? values[name].trim() : "");
  const tooLong = (name) => value(name).length > FIELD_LIMITS[name];
  const errors = {};

  for (const [name, label, title] of [["firstName", "first name", "First name"], ["lastName", "last name", "Last name"]]) {
    if (!value(name)) errors[name] = `Please enter your ${label}.`;
    else if (tooLong(name)) errors[name] = `Please shorten your ${label}.`;
    else if (!NAME_PATTERN.test(value(name))) errors[name] = `${title} ${NAME_RULE_MESSAGE}`;
  }

  if (!value("email")) errors.email = "Please enter your email address.";
  else if (tooLong("email") || !EMAIL_PATTERN.test(value("email"))) errors.email = "Please enter a valid email address.";

  if (tooLong("company") || CONTROL.test(value("company")) || /[\r\n]/.test(value("company"))) {
    errors.company = "Please shorten your company name.";
  }

  if (value("link") && isRefused(value("link"))) errors.link = LINK_REJECTED;

  const message = value("message");
  const messageLinks = findLinks(message);
  if (!message) errors.message = "Please enter a message.";
  else if (tooLong("message") || CONTROL.test(message)) errors.message = "Please check your message.";
  else if (countWords(message) > MAX_WORDS) errors.message = `You have exceeded the ${MAX_WORDS}-word limit. Please shorten your message.`;
  else if (messageLinks.length + (value("link") ? 1 : 0) > MAX_LINKS) {
    errors.message = `Please include no more than ${MAX_LINKS} links in total.`;
  } else {
    const badLinks = messageLinks.filter(isRefused);
    if (badLinks.length) errors.message = linkRejectedInMessage(badLinks);
  }

  return errors;
}

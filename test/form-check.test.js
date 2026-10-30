// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFields } from "../public/form-check.js";

test("reports every problem at once", () => {
  const errors = checkFields({ firstName: "", lastName: "", email: "jane@", message: "" });
  assert.deepEqual(Object.keys(errors).sort(), ["email", "firstName", "lastName", "message"]);
});

test("names the bad link in the message, and checks the link box separately", () => {
  const errors = checkFields({
    firstName: "Jane", lastName: "Doe", email: "jane@example.com",
    link: "ftp://files.example.com", message: "Also see ftp://other.example.com/x please",
  });
  assert.equal(errors.link, "This link can't be accepted. Please try a different one.");
  assert.equal(errors.message, "This link in your message can't be accepted: ftp://other.example.com/x. Please try a different one.");
});

test("a correct form has no problems", () => {
  assert.deepEqual(checkFields({ firstName: "Jane", lastName: "Doe", email: "jane@example.com", message: "Hello" }), {});
});

test("lists every refused link in the message", () => {
  const errors = checkFields({
    firstName: "Jane", lastName: "Doe", email: "jane@example.com",
    message: "See ftp://a.example.com/1 and ftp://b.example.com/2",
  });
  assert.equal(errors.message, "These links in your message can't be accepted: ftp://a.example.com/1, ftp://b.example.com/2. Please try different ones.");
});

test("names allow letters, spaces, apostrophes, hyphens and periods only", () => {
  const base = { email: "jane@example.com", message: "Hi" };
  assert.deepEqual(checkFields({ ...base, firstName: "Mary-Jane", lastName: "O'Brien" }), {});
  assert.deepEqual(checkFields({ ...base, firstName: "José", lastName: "Nguyễn Văn" }), {});
  assert.deepEqual(checkFields({ ...base, firstName: "J.", lastName: "Smith Jr." }), {});
  assert.equal(checkFields({ ...base, firstName: "Test2", lastName: "Doe" }).firstName, "First name can only include letters, spaces, apostrophes, hyphens, and periods.");
  assert.equal(checkFields({ ...base, firstName: "Jane", lastName: "Doe!" }).lastName, "Last name can only include letters, spaces, apostrophes, hyphens, and periods.");
});

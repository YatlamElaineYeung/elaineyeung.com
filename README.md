# elaineyeung.com

The code behind the personal website of **Yatlam (Elaine) Yeung**, AI & cloud engineer and AWS Certified Solutions Architect – Associate.

**Live site:** https://elaineyeung.com

## About this project

I designed and built this portfolio site to present my experience and projects. It's fast, secure, and mobile-friendly, runs on Cloudflare's global network at no cost, and publishes no personal contact details: visitors reach me through a private contact form.

I used Claude Code as an AI development tool: I defined the requirements, architecture, and security rules, directed the work, and reviewed and approved every change.

## How it works

1. A visitor goes to elaineyeung.com.
2. Cloudflare receives the request at the server closest to them.
3. A small program running on Cloudflare (a "Worker") checks the address. If the visitor used an insecure `http://` or `www.` address, it redirects them to `https://elaineyeung.com`.
4. The Worker sends the website files to the visitor's browser.
5. When a visitor sends a message through the **Contact Me** form, the Worker checks it, stores it privately, and emails it to me. My email address and phone number never appear on the site.

A detailed walkthrough is in **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**.

## Key design decisions

### Privacy

- **No public email address or phone number.** Visitors contact me through a form, and I reply from a professional address on my own domain. *Why:* contact details published on a website get collected by bots and end up on spam and data-broker lists.
- **The resume is shared on request, not downloadable.** The form has a "Request My Resume" option. *Why:* I choose who receives it and which roles it's used for.
- **No personal information in the public code.** Email addresses, keys, and private settings live in Cloudflare's encrypted secret storage, never in files in this repository. My work history and resume are kept out of the repository too: GitHub gets a copy of the page with those sections left out (`public-index/index.html`), while the live site shows them. *Why:* anyone can read a public repository, and bots scan GitHub for personal data and credentials.
- **Every upload is checked for personal information first.** Before anything is pushed, the files are scanned for email addresses, phone numbers, account numbers, and passwords. *Why:* anything pushed to a public repository should be treated as permanently exposed, so the check has to happen before the upload.

### Contact form security

- **Layered protection.** The form is defended at several independent layers: at Cloudflare's edge before a request reaches the code, by a bot check, and by server-side validation that repeats every browser check, so skipping the page gets around nothing. *Why:* no single control is perfect; each layer covers gaps in the others.
- **Abuse limits and link screening.** Submissions are rate-limited, and links are screened for common phishing and malware patterns. The specific limits and screening rules are kept private. *Why:* publishing exactly how a defense works makes it easier to work around.
- **Nothing is lost.** Each message is stored privately until delivery is confirmed, failed sends are retried automatically, and I'm alerted if anything is stuck. *Why:* a contact form that silently drops messages is worse than no form.
- **Minimal data, kept briefly.** The form collects only what's needed to reply, and stored copies are deleted once delivered. Visitor addresses used for rate limiting are stored only as salted hashes. *Why:* data that isn't kept can't leak.

### Website security

- **Every visitor gets an encrypted connection.** All `http://` and `www.` traffic is redirected to a single HTTPS address before any content loads. *Why:* no page or file on the site can ever be served unencrypted.
- **Browser security headers on every response.** A strict Content Security Policy, HSTS, and headers that block framing, MIME sniffing, and unneeded browser features. *Why:* even if someone found a way to inject code, the browser would refuse to run it, and the site can't be embedded in another page to trick visitors.
- **A small attack surface.** Static files, one Worker, and no third-party packages. *Why:* every dependency can have a vulnerability and needs updating, so having few leaves little to exploit.
- **A security contact.** The site publishes a standard [security.txt](https://elaineyeung.com/.well-known/security.txt) that points researchers to the contact form. *Why:* people who find a problem should have an easy, private way to report it.

### Change control

- **Every public change is reviewed before release.** The site is only published, and code is only uploaded to GitHub, after I've reviewed exactly what will change and the privacy check has passed. *Why:* a deliberate release step keeps mistakes and accidental leaks off the live site.
- **Automated tests.** The form's checks are covered by unit tests that run before each release. *Why:* a change that breaks validation is caught before it reaches visitors.

### Reliability and performance

- **Hosted on Cloudflare's global network.** *Why:* the site loads quickly from anywhere, the HTTPS certificate renews automatically, and protection against traffic floods is built in, all on the free plan.
- **Permanent (HTTP 301) redirects.** *Why:* browsers remember the secure address after the first visit, and search engines treat every version of the domain as one site.
- **Platform behavior is pinned to a fixed date** (`compatibility_date` in the settings). *Why:* changes to Cloudflare's platform can't break the site unexpectedly; upgrades happen only when I choose.
- **No frameworks or build step.** *Why:* there's nothing to compile or patch, which keeps the site fast and easy to maintain.

### Accessibility

- **Works with keyboards, screen readers, and reduced-motion settings.** The page has a "skip to content" link and descriptive labels, the form reports every problem next to its field, and animations turn off for visitors whose devices ask for reduced motion. *Why:* the site should work for everyone.

## Built with

| Technology | Used for |
|---|---|
| HTML, CSS, JavaScript | Page content, design, the contact form (no frameworks) |
| Cloudflare Workers | Hosting, HTTPS redirects, and the contact form's server side |
| Cloudflare D1 and KV | Private storage for messages and form settings |
| Cloudflare Turnstile and edge rules | Bot protection and abuse limits |
| Resend | Delivering form messages to my inbox |
| Cloudflare DNS & certificates | Connecting the domain and providing the encrypted connection |
| Node.js test runner | Unit tests for the form's checks |
| Wrangler | Cloudflare's tool for testing and publishing |
| Claude Code | AI coding agent for implementation, testing, and deployment |

## Project structure

```
elaineyeung.com/
├── public/                  # The website files visitors receive
│   ├── index.html           # (kept private, see below)
│   ├── styles.css           # Design: colors, fonts, layout, light/dark mode
│   ├── script.js            # Menu, theme switch, animations
│   ├── contact-form.js      # The contact form in the browser
│   ├── form-check.js        # Field checks shared by the browser and the Worker
│   ├── form-rules.js        # General form limits shared by both
│   ├── links.js             # Basic link checks shared by both
│   ├── favicon.svg          # Browser tab icon
│   └── .well-known/security.txt
├── src/                     # The Worker (runs on Cloudflare)
│   ├── index.js             # Redirects, security headers, routing
│   ├── contact.js           # Receives, checks, stores, and sends form messages
│   ├── link-screening.js    # Server-only link screening
│   └── email.js             # Sending email and verifying delivery reports
├── migrations/              # Database tables for message storage
├── test/                    # Unit tests
├── public-index/index.html  # The page, with personal history sections left out
├── scripts/public-index.mjs # Builds that copy from the real page
├── docs/HOW-IT-WORKS.md     # Detailed walkthrough
├── wrangler.example.jsonc   # Cloudflare settings template (real IDs kept private)
└── README.md                # This page
```

## Running and publishing

For developers working on the code. Requires [Node.js](https://nodejs.org) 22 or newer.

**Run the tests:**

```bash
npm test
```

**Preview locally:** copy `wrangler.example.jsonc` to `wrangler.jsonc`, put local preview settings in a `.dev.vars` file (excluded from the repository; the settings it needs are listed in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)), then:

```bash
npx wrangler d1 migrations apply elaineyeung-contact-form --local
npx wrangler dev --local-protocol https
```

Then open https://localhost:8787.

**Publish to the live site:**

```bash
npx wrangler deploy
```

## Privacy

This repository contains no personal contact details. To get in touch, use the contact form at [elaineyeung.com](https://elaineyeung.com) or reach me on [LinkedIn](https://www.linkedin.com/in/yatlamyeung/).

---

© Yatlam (Elaine) Yeung. All rights reserved. This code is shared for viewing only; copying, modifying, or reusing any part of it requires my written permission. See [LICENSE](LICENSE) for details.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----------------------------------------------------------
// Footer year
// ----------------------------------------------------------
document.getElementById("year").textContent = new Date().getFullYear();

// ----------------------------------------------------------
// Light / dark theme toggle (dark by default, remembers the choice)
// ----------------------------------------------------------
const root = document.documentElement;
const themeToggle = document.querySelector(".theme-toggle");

themeToggle.addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch (e) {
    // Storage may be blocked (private browsing); the toggle still works for this visit.
  }
});

// ----------------------------------------------------------
// Mobile menu
// ----------------------------------------------------------
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.getElementById("nav-links");

function setMenu(open) {
  navToggle.setAttribute("aria-expanded", String(open));
  navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  navLinks.classList.toggle("open", open);
}

navToggle.addEventListener("click", () => {
  setMenu(navToggle.getAttribute("aria-expanded") !== "true");
});

// Close the menu after choosing a link, or when pressing Escape
navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenu(false);
});

// ----------------------------------------------------------
// Header border once the page is scrolled
// ----------------------------------------------------------
const header = document.querySelector(".site-header");

function updateHeader() {
  header.classList.toggle("scrolled", window.scrollY > 8);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

// ----------------------------------------------------------
// Rotating job titles in the hero, typed out letter by letter
// ----------------------------------------------------------
const rotator = document.querySelector(".role-rotator");
const roles = ["AI Engineer", "Cloud Engineer", "AWS Specialist", "Solutions Architect"];
const article = document.querySelector(".role-article");

// "an" before a vowel sound (AI, AWS), "a" otherwise
function articleFor(role) {
  return /^(AI|AWS)\b/.test(role) ? "an" : "a";
}

if (rotator && !reduceMotion) {
  let roleIndex = 0;
  let charIndex = roles[0].length;
  let deleting = true;

  function tick() {
    let delay = deleting ? 45 : 85;

    if (deleting) {
      charIndex--;
      if (charIndex === 0) {
        deleting = false;
        roleIndex = (roleIndex + 1) % roles.length;
        if (article) article.textContent = articleFor(roles[roleIndex]);
        delay = 300;
      }
    } else {
      charIndex++;
      if (charIndex === roles[roleIndex].length) {
        deleting = true;
        delay = 2200;
      }
    }

    rotator.textContent = roles[roleIndex].slice(0, charIndex) || "​";
    setTimeout(tick, delay);
  }

  // Show the first title for a moment before it starts changing
  setTimeout(tick, 2200);
}

// ----------------------------------------------------------
// Fade sections in as they scroll into view
// ----------------------------------------------------------
const revealEls = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 }
  );
  revealEls.forEach((el) => revealObserver.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}

// ----------------------------------------------------------
// Highlight the nav link for the section on screen
// ----------------------------------------------------------
const sectionLinks = new Map();
navLinks.querySelectorAll('a[href^="#"]').forEach((link) => {
  const section = document.querySelector(link.getAttribute("href"));
  if (section) sectionLinks.set(section, link);
});

if ("IntersectionObserver" in window) {
  const activeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          sectionLinks.forEach((link) => link.classList.remove("active"));
          sectionLinks.get(entry.target).classList.add("active");
        }
      });
    },
    // A section counts as "current" when it crosses the middle band of the screen
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sectionLinks.forEach((_, section) => activeObserver.observe(section));
}

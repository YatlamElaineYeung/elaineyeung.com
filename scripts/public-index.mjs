// Builds the copy of the web page that goes on GitHub: the same page, with the sections that hold
// personal history (focus areas, experience, education) replaced by a short note.
// The real public/index.html stays on this Mac (gitignored) and is what the website serves.
// Run with: npm run public-index   (do this before every push)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const PRIVATE_SECTIONS = ["focus", "experience", "education"];
const source = readFileSync("public/index.html", "utf8");

let output = source;
for (const id of PRIVATE_SECTIONS) {
  const pattern = new RegExp(`(<section[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</section>)`);
  if (!pattern.test(output)) throw new Error(`Section "${id}" not found in public/index.html`);
  output = output.replace(
    pattern,
    `$1\n      <!-- This section's content is maintained privately. See it live at https://elaineyeung.com -->\n    $2`
  );
}

mkdirSync("public-index", { recursive: true });
writeFileSync("public-index/index.html", output);
console.log(`Wrote public-index/index.html (private sections: ${PRIVATE_SECTIONS.join(", ")})`);

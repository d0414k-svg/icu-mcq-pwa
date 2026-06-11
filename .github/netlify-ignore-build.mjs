import { execFileSync } from "node:child_process";

const dataOnlyFiles = new Set(["public/data/pubmedGenerated.json"]);
const from = process.env.CACHED_COMMIT_REF;
const to = process.env.COMMIT_REF;

if (!from || !to) {
  console.log("Continuing Netlify build: commit refs are unavailable.");
  process.exit(1);
}

let changedFiles = [];
try {
  changedFiles = execFileSync("git", ["diff", "--name-only", from, to], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
} catch (error) {
  console.log(`Continuing Netlify build: could not inspect changed files (${error.message}).`);
  process.exit(1);
}

if (changedFiles.length > 0 && changedFiles.every((file) => dataOnlyFiles.has(file))) {
  console.log("Skipping Netlify build: only PubMed data changed.");
  process.exit(0);
}

console.log(`Continuing Netlify build: changed files require rebuild (${changedFiles.join(", ") || "unknown"}).`);
process.exit(1);

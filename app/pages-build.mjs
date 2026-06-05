// Build the client and publish the static output into the repo's /docs folder,
// so GitHub Pages can serve it via "Deploy from a branch" (source: /docs) with
// NO GitHub Actions required. Run: `npm run build:docs`.
import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DOCS = "../docs";

// 1) Bundle into public/
await run("node", ["build.mjs"], { stdio: "inherit" }).then((r) => process.stdout.write(r.stdout ?? ""));

// 2) Copy the site files into /docs (preserving docs/screenshots, docs/architecture.md).
await mkdir(DOCS, { recursive: true });
const SITE = ["index.html", "404.html", "styles.css", "bundle.js", "bundle.js.map", ".nojekyll"];
for (const f of SITE) {
  await rm(`${DOCS}/${f}`, { recursive: true, force: true });
  await cp(`public/${f}`, `${DOCS}/${f}`);
}
console.log(`Published ${SITE.length} files to ${DOCS}/ — set Pages source to /docs on the default branch.`);

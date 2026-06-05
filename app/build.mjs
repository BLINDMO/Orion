// Bundle the ORION web client (engine + UI) into a single browser module.
import { build, context } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "public/bundle.js",
  sourcemap: true,
  logLevel: "info",
  loader: { ".ts": "ts" },
};

await mkdir("public", { recursive: true });
await cp("index.html", "public/index.html");
await cp("styles.css", "public/styles.css");

if (process.argv.includes("--serve")) {
  const ctx = await context(opts);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: "public", port: 5173, host: "0.0.0.0" });
  console.log(`ORION dev server → http://${host}:${port}`);
} else {
  await build(opts);
  console.log("Built → public/");
}

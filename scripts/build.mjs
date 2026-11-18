import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, rm, readdir } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/client/assets", { recursive: true });
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  jsx: "automatic",
  target: "es2022",
  outfile: "dist/client/assets/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
let html = await readFile("index.html", "utf8");
html = html.replace(
  '<script type="module" src="/src/main.tsx"></script>',
  '<link rel="stylesheet" href="/assets/app.css"/><script type="module" src="/assets/app.js"></script>',
);
try {
  await cp("public", "dist/client", { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
// Route HTML through the Worker so the hosting asset fast path cannot bypass
// document security headers. CSS, JS and evidence remain ordinary static assets.
const pages = { "/": html, "/index.html": html };
for (const entry of await readdir("dist/client", { recursive: true })) {
  if (!entry.endsWith(".html")) continue;
  pages["/" + entry] = await readFile("dist/client/" + entry, "utf8");
  await rm("dist/client/" + entry);
}
await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/pages.json", JSON.stringify(pages));
await build({
  entryPoints: ["server/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js",
  define: { __HTML_PAGES__: JSON.stringify(pages) },
});
console.log("Client assets and Cloudflare Worker built.");

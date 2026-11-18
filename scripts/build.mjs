import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
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
await writeFile("dist/client/index.html", html);
try {
  await cp("public", "dist/client", { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await build({
  entryPoints: ["server/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js",
});
console.log("Client assets and Cloudflare Worker built.");

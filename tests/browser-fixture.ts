// Isolated browser fixture: uncommitted records are visible only to this connection.
// The actual production schema, API routes, restricted role, and built UI are used.
import pg from "pg";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { makeApp } from "../server/app";
const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
await db.connect();
await db.query("BEGIN");
await db.query(
  `UPDATE analytics.dim_geography SET city=$1 WHERE geography_key=(SELECT geography_key FROM analytics.fact_order ORDER BY purchased_at DESC LIMIT 1)`,
  [`O'Brien <img src=x onerror="document.body.dataset.storedInjected=1">`],
);
await db.query("SET LOCAL ROLE commerce_reader");
const app = makeApp(() => ({
  query: async (text, values) => (await db.query(text, values)).rows,
}));
app.get("*", serveStatic({ root: "./dist/client" }));
const server = serve(
  { fetch: app.fetch, hostname: "127.0.0.1", port: 8184 },
  () =>
    console.log(
      "Disposable browser fixture http://127.0.0.1:8184 (uncommitted transaction; never deployed)",
    ),
);
async function close() {
  server.close();
  await db.query("ROLLBACK");
  await db.end();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

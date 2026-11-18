import { serve } from "@hono/node-server";
import pg from "pg";
import { makeApp } from "./app";
import { serveStatic } from "@hono/node-server/serve-static";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
const app = makeApp(() => ({
  query: async (text, values) => (await pool.query(text, values)).rows,
}));
app.get("*", serveStatic({ root: "./dist/client" }));
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8183 }, () =>
  console.log("Commerce API http://127.0.0.1:8183"),
);

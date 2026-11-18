import { Hono } from "hono";
import { filterSchema, descriptions, isQueryId, queryFor } from "./queries";
export interface Database {
  query(text: string, values?: unknown[]): Promise<Record<string, unknown>[]>;
}
export type Bindings = {
  DATABASE_URL?: string;
  QUERIES_ENABLED?: string;
  ASSETS?: { fetch(r: Request): Promise<Response> };
  QUERY_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
};
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function makeApp(database: (env: Bindings) => Database, now = Date.now) {
  const app = new Hono<{ Bindings: Bindings }>();
  // Bounded, per-instance cache for public aggregate results only. Never cache
  // order/customer detail or errors. New deployments start with an empty cache.
  const aggregateCache = new Map<string, { expires: number; value: any }>();
  let releaseInfo: { expires: number; version: unknown } | undefined;
  const windows = new Map<string, { count: number; expires: number }>();
  app.use("/api/*", async (c, next) => {
    if (c.req.path !== "/api/v1/health") {
      const ip = c.req.header("CF-Connecting-IP");
      if (c.env?.QUERY_LIMITER) {
        const key = ip ?? "unknown";
        if (!(await c.env.QUERY_LIMITER.limit({ key })).success)
          return c.json(
            { error: "Too many requests. Please try again shortly." },
            429,
          );
      } else if (ip) {
        const now = Date.now();
        let w = windows.get(ip);
        if (!w || w.expires < now) {
          if (windows.size >= 10000) {
            for (const [k, v] of windows)
              if (v.expires < now) windows.delete(k);
            if (windows.size >= 10000)
              return c.json(
                { error: "Query capacity temporarily reached" },
                429,
              );
          }
          w = { count: 0, expires: now + 60000 };
          windows.set(ip, w);
        }
        if (++w.count > 30)
          return c.json(
            { error: "Too many requests. Please try again shortly." },
            429,
          );
      }
    }
    await next();
  });
  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("X-Frame-Options", "DENY");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });
  app.get("/api/v1/health", (c) => c.json({ status: "ok", release: "0.2.0" }));
  app.get("/api/v1/ready", async (c) => {
    try {
      await database(c.env ?? {}).query("SELECT 1 AS ready");
      return c.json({ status: "ready" });
    } catch {
      return c.json({ error: "Database temporarily unavailable" }, 503);
    }
  });
  app.get("/api/v1/catalog", async (c) => {
    try {
      const db = database(c.env ?? {});
      const rows = await db.query(
        "SELECT version,loaded_at,manifest FROM api.release_info",
      );
      const examples = await db.query(
        "SELECT order_id,customer_key FROM api.orders ORDER BY purchased_at DESC LIMIT 1",
      );
      const release = rows[0];
      const manifest = release.manifest as {
        files: { name: string; rows: number }[];
      };
      return c.json({
        queries: descriptions,
        release: "0.2.0",
        dataVersion: release.version,
        loadedAt: release.loaded_at,
        source: "Olist, 2016–2018",
        currency: "BRL",
        files: manifest.files.map((x) => ({ name: x.name, rows: x.rows })),
        example: examples[0],
      });
    } catch {
      return c.json(
        {
          error:
            "Database temporarily unavailable. Engineering evidence and downloads remain available.",
        },
        503,
      );
    }
  });
  app.post("/api/v1/queries/:id", async (c) => {
    const started = performance.now();
    const id = c.req.param("id");
    const requestId = crypto.randomUUID();
    if (!isQueryId(id)) return c.json({ error: "Unknown query" }, 404);
    if (c.env?.QUERIES_ENABLED === "false")
      return c.json({ error: "Live queries are temporarily disabled" }, 503);
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > 4096) return c.json({ error: "Request too large" }, 413);
    let body;
    try {
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) {
            await reader.cancel();
            return c.json({ error: "Request too large" }, 413);
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return c.json({ error: "Invalid JSON request" }, 400);
    }
    const checked = filterSchema.safeParse(body);
    if (!checked.success)
      return c.json(
        {
          error: "Invalid filters",
          details: checked.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    const q = queryFor(id, checked.data);
    const cacheable = [
      "monthly-trends",
      "seller-categories",
      "delivery-summary",
    ].includes(id);
    const cacheKey = JSON.stringify([id, q.text, q.values]);
    const cached = cacheable ? aggregateCache.get(cacheKey) : undefined;
    if (cached && cached.expires > now())
      return c.json({
        ...cached.value,
        meta: {
          ...cached.value.meta,
          requestId,
          source: "cache",
          dbRoundTripMs: 0,
          apiDurationMs: Math.round((performance.now() - started) * 100) / 100,
          cacheAgeSeconds: Math.round(
            (now() - (cached.expires - 60000)) / 1000,
          ),
        },
      });
    try {
      const db = database(c.env ?? {});
      const before = performance.now();
      const rows = await db.query(q.text, q.values);
      const dbRoundTripMs = performance.now() - before;
      if (!releaseInfo || releaseInfo.expires <= now()) {
        const versions = await db.query("SELECT version FROM api.release_info");
        releaseInfo = { version: versions[0]?.version, expires: now() + 60000 };
      }
      const meta = {
        requestId,
        release: "0.2.0",
        dataVersion: releaseInfo.version,
        source: "live",
        rowCount: rows.length,
        dbRoundTripMs: Math.round(dbRoundTripMs * 100) / 100,
        apiDurationMs: Math.round((performance.now() - started) * 100) / 100,
      };
      console.info(
        JSON.stringify({
          requestId,
          queryId: id,
          rowCount: rows.length,
          durationMs: meta.apiDurationMs,
        }),
      );
      const value = {
        queryId: id,
        rows,
        inspection: { sql: q.text, parameters: q.values },
        meta,
      };
      if (cacheable) {
        if (aggregateCache.size >= 100)
          aggregateCache.delete(aggregateCache.keys().next().value!);
        aggregateCache.set(cacheKey, { expires: now() + 60000, value });
      }
      return c.json(value);
    } catch (e) {
      const code =
        typeof e === "object" && e && "code" in e
          ? String(e.code)
          : "unavailable";
      console.error(
        JSON.stringify({
          requestId,
          queryId: id,
          errorCategory: code === "57014" ? "timeout" : "database",
        }),
      );
      return c.json(
        {
          error:
            code === "57014"
              ? "Query timed out. Narrow the filters and try again."
              : "Database temporarily unavailable",
          requestId,
        },
        code === "57014" ? 504 : 503,
      );
    }
  });
  app.all("/api/*", (c) => c.json({ error: "Endpoint not found" }, 404));
  return app;
}

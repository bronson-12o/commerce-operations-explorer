import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { makeApp } from "../server/app";
import {
  descriptions,
  filterSchema,
  queryFor,
  type QueryId,
} from "../server/queries";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = makeApp(() => ({
  query: async (text, values) => (await pool.query(text, values)).rows,
}));
const results: { name: string; passed: boolean }[] = [];
async function call(id: string, body: unknown) {
  return app.request("/api/v1/queries/" + id, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function check(name: string, fn: () => Promise<void>) {
  await test(name, async () => {
    await fn();
    results.push({ name, passed: true });
  });
}
await check("Original CSV control totals match analytical tables", async () => {
  const controls = JSON.parse(
    await readFile("evidence/source-controls.json", "utf8"),
  );
  const r = (
    await pool.query(
      "SELECT count(*)::int AS orders,count(*) FILTER(WHERE status='delivered')::int AS delivered_orders,sum(merchandise_value) FILTER(WHERE status='delivered')::text AS merchandise_value,sum(freight_value) FILTER(WHERE status='delivered')::text AS freight_value FROM api.orders",
    )
  ).rows[0];
  assert.equal(r.orders, controls.orders);
  assert.equal(r.delivered_orders, controls.delivered_orders);
  assert.equal(r.merchandise_value, controls.delivered_merchandise_value);
  assert.equal(r.freight_value, controls.delivered_freight_value);
});
await check(
  "All six registered queries execute with bound parameters",
  async () => {
    const example = (
      await pool.query("SELECT order_id,customer_key FROM api.orders LIMIT 1")
    ).rows[0];
    for (const id of Object.keys(descriptions)) {
      const r = await call(id, {
        orderId: example.order_id,
        customerId: example.customer_key,
      });
      assert.equal(r.status, 200, id);
      const v = (await r.json()) as any;
      assert.ok(v.rows.length > 0, id);
      assert.equal(v.meta.source, "live");
      assert.ok(Array.isArray(v.inspection.parameters));
    }
  },
);
for (const payload of [
  "' OR '1'='1",
  "'; DROP TABLE core.orders; --",
  "x' UNION SELECT current_user --",
  "' OR pg_sleep(5) IS NULL --",
  "<img src=x onerror=alert(1)>",
  "O'Brien",
  "50%_discount",
])
  await check("Text remains a bound literal: " + payload, async () => {
    const r = await call("order-search", { search: payload });
    assert.equal(r.status, 200);
    const v = (await r.json()) as any;
    assert.equal(v.rows.length, 0);
    assert.equal(v.inspection.parameters[4], payload);
    assert.ok(!v.inspection.sql.includes(payload));
    const detail = await call("order-detail", { orderId: payload });
    assert.equal(detail.status, 200);
    assert.equal(((await detail.json()) as any).rows.length, 0);
  });
await check("Sort injection rejected before database execution", async () => {
  assert.equal(
    (await call("order-search", { sort: "newest;DROP TABLE core.orders" }))
      .status,
    400,
  );
});
await check(
  "Unknown query, unexpected fields, dates, and unbounded pagination rejected",
  async () => {
    assert.equal((await call("arbitrary-sql", {})).status, 404);
    for (const body of [
      { sql: "SELECT 1" },
      { limit: 101 },
      { offset: 5001 },
      { start: "2018-02-30" },
      { start: "2018-01-01", end: "2017-01-01" },
      { state: "SP' OR TRUE--" },
    ])
      assert.equal((await call("order-search", body)).status, 400);
  },
);
await check("Oversized body and malformed JSON rejected", async () => {
  assert.equal(
    (await call("order-search", { search: "a".repeat(5000) })).status,
    413,
  );
  const r = await app.request("/api/v1/queries/order-search", {
    method: "POST",
    body: "{",
  });
  assert.equal(r.status, 400);
});
await check("Security headers present on API responses", async () => {
  const r = await call("monthly-trends", {});
  assert.match(
    r.headers.get("content-security-policy") ?? "",
    /object-src 'none'/,
  );
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("cache-control"), "no-store");
});
await check(
  "Database runtime role cannot modify records or access raw data",
  async () => {
    const c = await pool.connect();
    try {
      await c.query("SET default_transaction_read_only=off");
      for (const text of [
        "DELETE FROM api.orders WHERE false",
        "UPDATE analytics.fact_order SET item_count=0 WHERE false",
        "SELECT * FROM raw.olist_orders_dataset LIMIT 1",
        "CREATE TABLE public.unauthorized(x int)",
      ]) {
        await assert.rejects(
          () => c.query(text),
          (e) => ["42501", "55000"].includes((e as { code: string }).code),
        );
      }
    } finally {
      c.release(true);
    }
  },
);
await check(
  "Readiness and disabled-service behavior are explicit",
  async () => {
    assert.equal((await app.request("/api/v1/ready")).status, 200);
    const unavailable = makeApp(() => ({
      query: async () => {
        throw new Error("secret connection string");
      },
    }));
    const r = await unavailable.request("/api/v1/queries/monthly-trends", {
      method: "POST",
      body: "{}",
    });
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes("secret"));
    const stopped = await app.request(
      "/api/v1/queries/monthly-trends",
      { method: "POST", body: "{}" },
      { QUERIES_ENABLED: "false" },
    );
    assert.equal(stopped.status, 503);
  },
);
await check("Rate limiting returns 429 without executing query", async () => {
  const r = await app.request(
    "/api/v1/queries/monthly-trends",
    { method: "POST", body: "{}" },
    { QUERY_LIMITER: { limit: async () => ({ success: false }) } },
  );
  assert.equal(r.status, 429);
});
await check(
  "Aggregate cache avoids database calls, isolates filters, expires, and excludes detail",
  async () => {
    let clock = 1000,
      calls = 0;
    const cachedApp = makeApp(
      () => ({
        query: async (text, values) => {
          calls++;
          return (await pool.query(text, values)).rows;
        },
      }),
      () => clock,
    );
    const run = (id: string, filters: unknown = {}) =>
      cachedApp.request("/api/v1/queries/" + id, {
        method: "POST",
        body: JSON.stringify(filters),
      });
    const first = (await (await run("monthly-trends")).json()) as any;
    const count = calls;
    const hit = (await (await run("monthly-trends")).json()) as any;
    assert.equal(hit.meta.source, "cache");
    assert.equal(hit.meta.dbRoundTripMs, 0);
    assert.equal(calls, count);
    assert.deepEqual(hit.rows, first.rows);
    await run("monthly-trends", { state: "SP" });
    assert.ok(calls > count);
    clock += 60001;
    assert.equal(
      ((await (await run("monthly-trends")).json()) as any).meta.source,
      "live",
    );
    await run("order-search");
    const beforeDetail = calls;
    await run("order-search");
    assert.ok(calls > beforeDetail);
  },
);
await check(
  "Separate payment aggregates prevent item/payment join fan-out",
  async () => {
    const example = (
      await pool.query(
        "SELECT order_id FROM api.items GROUP BY order_id HAVING count(*)>1 ORDER BY order_id LIMIT 1",
      )
    ).rows[0];
    const v = (await (
      await call("order-detail", { orderId: example.order_id })
    ).json()) as any;
    const r = v.rows[0];
    const cents = (s: string) => BigInt(s.replace(".", ""));
    const sum = r.items.reduce((s: bigint, x: any) => s + cents(x.price), 0n);
    assert.equal(sum, cents(r.merchandise_value));
    const pay = r.payments.reduce(
      (s: bigint, x: any) => s + cents(x.amount),
      0n,
    );
    assert.equal(pay, cents(r.payment_value));
  },
);
after(async () => {
  await pool.end();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/api-security.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        passed: results.length,
        checks: results,
      },
      null,
      2,
    ) + "\n",
  );
});

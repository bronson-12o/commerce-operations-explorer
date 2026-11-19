import React, { useEffect, useState, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ShoppingBag,
  ChartNoAxesCombined,
  Truck,
  Database,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  SlidersHorizontal,
  Search,
  Check,
  Code2,
  Layers,
  ShieldCheck,
  Activity,
  ExternalLink,
  RefreshCw,
  X,
  Info,
  Clock,
  FileText,
} from "lucide-react";
import { BuildGallery, portfolioReportUrl } from "./build-gallery";
import "./style.css";
type Row = Record<string, any>;
type Result = {
  rows: Row[];
  inspection: { sql: string; parameters: unknown[] };
  meta: {
    source: string;
    rowCount: number;
    apiDurationMs: number;
    dbRoundTripMs: number;
    dataVersion: string;
    requestId: string;
    cacheAgeSeconds?: number;
  };
};
const money = (v: any, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 2,
  }).format(Number(v ?? 0));
const number = (v: any) =>
  new Intl.NumberFormat("en-US").format(Number(v ?? 0));
const pct = (a: any, b: any) =>
  Number(b) ? `${((100 * Number(a)) / Number(b)).toFixed(1)}%` : "—";
const label = (v: string) =>
  v?.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const day = (v: any) => (v ? String(v).slice(0, 10) : "—");
const sections = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "orders", name: "Orders", icon: ShoppingBag },
  { id: "sales", name: "Sales analysis", icon: ChartNoAxesCombined },
  { id: "delivery", name: "Delivery analysis", icon: Truck },
  { id: "engineering", name: "Engineering", icon: Database },
  { id: "process", name: "How it was built", icon: FileText },
];
const initial = new URLSearchParams(location.search);
async function request(id: string, filters: Row): Promise<Result> {
  const response = await fetch(`/api/v1/queries/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Unable to complete query");
  return value;
}
function useQuery(id: string, filters: Row) {
  const [data, setData] = useState<Result>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(filters);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    request(id, JSON.parse(key))
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setData(undefined);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, key]);
  return { data, error, loading };
}
function QueryDetails({ data }: { data?: Result }) {
  return data ? (
    <details className="query-details">
      <summary>
        <Code2 size={14} /> View query details{" "}
        <span>
          {data.meta.source === "cache"
            ? `cache · ${data.meta.cacheAgeSeconds ?? 0}s old · no database call`
            : `live · ${data.meta.dbRoundTripMs.toFixed(1)} ms round trip`}
        </span>
      </summary>
      <div className="query-content">
        <p>
          Bound values are sent separately from SQL. Round-trip time includes
          network communication.
        </p>
        <pre>{data.inspection.sql}</pre>
        <div className="parameters">
          <b>Parameters</b>
          <code>{JSON.stringify(data.inspection.parameters)}</code>
        </div>
        <p>
          {data.meta.rowCount} rows · API {data.meta.apiDurationMs.toFixed(1)}{" "}
          ms · Dataset {data.meta.dataVersion} · Request {data.meta.requestId}
        </p>
      </div>
    </details>
  ) : null;
}
function Empty({ error, loading }: { error?: string; loading?: boolean }) {
  return (
    <div className="empty" role={error ? "alert" : "status"}>
      {loading ? (
        <>
          <RefreshCw className="spin" size={22} /> Loading database results…
        </>
      ) : (
        <>
          <Info size={23} />
          {error || "No records match these filters."}
        </>
      )}
    </div>
  );
}
function TrendChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 760,
    h = 240,
    l = 55,
    r = 15,
    t = 20,
    b = 35;
  const vals = rows.map((x) => Number(x.merchandise_value ?? 0));
  const max = Math.max(...vals, 1) * 1.15;
  const x = (i: number) => l + (i * (w - l - r)) / Math.max(rows.length - 1, 1);
  const y = (v: number) => h - b - (v / max) * (h - t - b);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L${x(vals.length - 1)},${h - b} L${l},${h - b} Z`;
  return (
    <div className="trend">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Monthly delivered merchandise value in Brazilian reais"
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4059d8" stopOpacity=".18" />
            <stop offset="100%" stopColor="#4059d8" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1={l}
              x2={w - r}
              y1={y(max * n)}
              y2={y(max * n)}
              stroke="#dce0f4"
              strokeDasharray="3 5"
            />
            <text
              x={l - 10}
              y={y(max * n) + 4}
              textAnchor="end"
              className="axis"
            >
              {((max * n) / 1000000).toFixed(1)}M
            </text>
          </g>
        ))}
        <path d={area} fill="url(#area)" />
        <path
          d={line}
          fill="none"
          stroke="#344dc9"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {rows.map((row, i) => (
          <g key={row.month}>
            {(i % Math.max(1, Math.ceil(rows.length / 7)) === 0 ||
              i === rows.length - 1) && (
              <text x={x(i)} y={h - 9} textAnchor="middle" className="axis">
                {new Date(row.month + "-15").toLocaleDateString("en-US", {
                  month: "short",
                  year: "2-digit",
                })}
              </text>
            )}
            <rect
              x={x(i) - 12}
              y={t}
              width="24"
              height={h - t - b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {hover === i && (
              <>
                <line x1={x(i)} x2={x(i)} y1={t} y2={h - b} stroke="#909cdf" />
                <circle cx={x(i)} cy={y(vals[i])} r="4" fill="#263cad" />
              </>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-caption">
        {hover !== null
          ? `${rows[hover].month} · ${money(vals[hover])}`
          : "Delivered merchandise value · BRL · grouped by purchase month"}
      </div>
    </div>
  );
}
function CategoryBars({ rows }: { rows: Row[] }) {
  const max = Math.max(...rows.map((x) => Number(x.merchandise_value)), 1);
  return (
    <div className="bars">
      {rows.slice(0, 6).map((r, i) => (
        <div className="bar-row" key={r.category_name}>
          <div>
            <span>{label(r.category_name)}</span>
            <b>{money(r.merchandise_value, true)}</b>
          </div>
          <div className="bar-track">
            <span
              style={{
                width: `${(Number(r.merchandise_value) / max) * 100}%`,
                background: i === 0 ? "#b34e37" : "#dc9d86",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${value === "delivered" ? "green" : value === "canceled" ? "red" : "amber"}`}
    >
      <i />
      {label(value)}
    </span>
  );
}
function App() {
  const [section, setSection] = useState(
    sections.some((s) => s.id === initial.get("view"))
      ? initial.get("view")!
      : "overview",
  );
  const [start, setStart] = useState(initial.get("start") || "2016-09-01");
  const [end, setEnd] = useState(initial.get("end") || "2018-10-31");
  const [state, setState] = useState(initial.get("state") || "ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [catalog, setCatalog] = useState<Row>();
  const filters = useMemo(() => ({ start, end, state }), [start, end, state]);
  const monthly = useQuery("monthly-trends", filters);
  const categories = useQuery("seller-categories", {
    ...filters,
    group: "category",
    limit: 8,
  });
  useEffect(() => {
    fetch("/api/v1/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCatalog)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const p = new URLSearchParams({ view: section, start, end, state });
    history.replaceState(null, "", "?" + p.toString());
  }, [section, start, end, state]);
  const nav = (id: string) => {
    setSection(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const sum = (k: string) =>
    monthly.data?.rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) ?? 0;
  const titles: Row = {
    overview: [
      "Inside Brazil’s Olist marketplace",
      "Explore 99,441 historical orders, from purchase to delivery.",
    ],
    orders: [
      "Order explorer",
      "Follow an order from purchase through delivery.",
    ],
    sales: [
      "Sales analysis",
      "Understand the categories and sellers behind merchandise value.",
    ],
    delivery: [
      "Delivery performance",
      "Explore delivery timing and customer-review coverage.",
    ],
    process: [
      "How it was built",
      "Screenshots from PostgreSQL, the data pipeline, and Power BI Desktop.",
    ],
    engineering: [
      "Behind the application",
      "Database design, measured performance, and verification evidence.",
    ],
  };
  const title = titles[section] ?? titles.overview;
  return (
    <div className="app-shell">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <a
            className="masthead-brand"
            href="?view=overview"
            onClick={(event) => {
              event.preventDefault();
              nav("overview");
            }}
          >
            <Layers size={24} />
            <span>
              Commerce <strong>Operations Explorer</strong>
            </span>
          </a>
          <nav aria-label="Main navigation" className="chapter-nav">
            {sections.map(({ id, name }) => (
              <button
                key={id}
                onClick={() => nav(id)}
                aria-current={section === id ? "page" : undefined}
              >
                {name}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="main-shell">
        <main id="main">
          <div
            className={
              section === "overview"
                ? "page-heading report-intro"
                : "page-heading"
            }
          >
            <div>
              {section === "overview" && (
                <p className="report-kicker">Olist · Brazil · 2016–2018</p>
              )}
              <h1>{title[0]}</h1>
              <p>{title[1]}</p>
            </div>
            {section === "overview" && (
              <button className="process-link" onClick={() => nav("process")}>
                See how it was built <ArrowUpRight size={17} />
              </button>
            )}
          </div>
          {section !== "engineering" && section !== "process" && (
            <>
              <div className="filterbar">
                <div className="period">
                  <Clock size={16} />
                  <span>
                    {start} — {end}
                  </span>
                  <button
                    aria-label="Change date range"
                    onClick={() => setFiltersOpen(!filtersOpen)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="filter-divider" />
                <label className="region-label">
                  Region
                  <select
                    aria-label="Region"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    <option value="ALL">All states</option>
                    {[
                      "AC",
                      "AL",
                      "AP",
                      "AM",
                      "BA",
                      "CE",
                      "DF",
                      "ES",
                      "GO",
                      "MA",
                      "MT",
                      "MS",
                      "MG",
                      "PA",
                      "PB",
                      "PR",
                      "PE",
                      "PI",
                      "RJ",
                      "RN",
                      "RS",
                      "RO",
                      "RR",
                      "SC",
                      "SP",
                      "SE",
                      "TO",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="filter-toggle"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <SlidersHorizontal size={14} />
                  Filters
                </button>
                <span className="coverage">Historical records · BRL</span>
              </div>
              {filtersOpen && (
                <div className="expanded-filters">
                  <label>
                    Purchase start
                    <input
                      aria-label="Purchase start"
                      type="date"
                      min="2016-01-01"
                      max={end}
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      onInput={(e) => setStart(e.currentTarget.value)}
                    />
                  </label>
                  <label>
                    Purchase end
                    <input
                      aria-label="Purchase end"
                      type="date"
                      min={start}
                      max="2019-12-31"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      onInput={(e) => setEnd(e.currentTarget.value)}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      setStart("2016-09-01");
                      setEnd("2018-10-31");
                      setState("ALL");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              )}
            </>
          )}
          {section === "overview" && (
            <>
              <div className="metrics">
                {[
                  {
                    name: "Delivered merchandise value",
                    value: money(sum("merchandise_value"), true),
                    sub: "Item value, excluding freight",
                    icon: ChartNoAxesCombined,
                  },
                  {
                    name: "Orders",
                    value: number(sum("orders")),
                    sub: `${number(sum("delivered_orders"))} delivered orders`,
                    icon: ShoppingBag,
                  },
                  {
                    name: "Average order value",
                    value: money(
                      sum("delivered_orders")
                        ? sum("merchandise_value") / sum("delivered_orders")
                        : 0,
                    ),
                    sub: "Delivered merchandise / orders",
                    icon: Layers,
                  },
                  {
                    name: "On-time delivery",
                    value: sum("eligible_deliveries")
                      ? pct(
                          sum("eligible_deliveries") - sum("late_orders"),
                          sum("eligible_deliveries"),
                        )
                      : "—",
                    sub: `${number(sum("eligible_deliveries"))} eligible deliveries`,
                    icon: Truck,
                  },
                ].map((x) => (
                  <div className="metric" key={x.name}>
                    <div className="metric-title">
                      {x.name}
                      <x.icon size={16} />
                    </div>
                    <div className="metric-value">
                      {monthly.loading ? "…" : monthly.error ? "—" : x.value}
                    </div>
                    <div className="metric-sub">{x.sub}</div>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Merchandise over time</h2>
                      <p>Delivered orders by purchase month</p>
                    </div>
                  </div>
                  {monthly.loading || monthly.error ? (
                    <Empty loading={monthly.loading} error={monthly.error} />
                  ) : monthly.data?.rows.length ? (
                    <TrendChart rows={monthly.data.rows} />
                  ) : (
                    <Empty />
                  )}
                  <QueryDetails data={monthly.data} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Leading categories</h2>
                      <p>Delivered merchandise value</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Explore sales"
                      onClick={() => nav("sales")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  {categories.loading || categories.error ? (
                    <Empty
                      loading={categories.loading}
                      error={categories.error}
                    />
                  ) : (
                    <CategoryBars rows={categories.data?.rows ?? []} />
                  )}
                  <div className="panel-footer">
                    <button onClick={() => nav("sales")}>
                      Explore sales analysis <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <section className="report-paths" aria-label="Explore more">
                <button onClick={() => nav("orders")}>
                  <ShoppingBag size={20} />
                  <span>
                    <strong>Trace an order</strong>
                    <small>Inspect items, payments, and delivery.</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => nav("delivery")}>
                  <Truck size={20} />
                  <span>
                    <strong>Compare delivery</strong>
                    <small>Explore timing and reviews by state.</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              </section>
              <div className="context-note">
                <Info size={15} />
                <p>
                  This is a historical analysis of anonymized Olist records.
                  Edge months may be incomplete. Merchandise value represents
                  goods sold, not platform revenue or profit.
                </p>
              </div>
            </>
          )}
          {section === "orders" && <Orders filters={filters} />}
          {section === "sales" && (
            <Sales
              filters={filters}
              monthly={monthly}
              categories={categories}
            />
          )}
          {section === "delivery" && <Delivery filters={filters} />}
          {section === "engineering" && <Engineering catalog={catalog} />}
          {section === "process" && <BuildGallery />}
          <footer>
            <span>
              Commerce Operations Explorer <span className="footer-sep">/</span>{" "}
              Independent project by Bronson Hatch
            </span>
            <a
              href="https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce"
              target="_blank"
              rel="noreferrer"
            >
              Data by Olist · CC BY-NC-SA 4.0 <ExternalLink size={11} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Orders({ filters }: { filters: Row }) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [offset, setOffset] = useState(0);
  const [orderId, setOrderId] = useState("");
  const q = useQuery("order-search", {
    ...filters,
    search,
    status,
    sort,
    limit: 50,
    offset,
  });
  useEffect(
    () => setOffset(0),
    [filters.start, filters.end, filters.state, search, status, sort],
  );
  return (
    <>
      <form
        className="order-tools"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft);
          setOffset(0);
        }}
      >
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search city"
            placeholder="Search customer city…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="button primary" type="submit">
          Search
        </button>
        <select
          aria-label="Order status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {[
            "delivered",
            "shipped",
            "canceled",
            "unavailable",
            "invoiced",
            "processing",
            "approved",
            "created",
          ].map((x) => (
            <option value={x} key={x}>
              {label(x)}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort orders"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="value">Highest item value</option>
        </select>
      </form>
      {q.loading || q.error ? (
        <Empty loading={q.loading} error={q.error} />
      ) : q.data?.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Purchased</th>
                <th>Customer location</th>
                <th>Status</th>
                <th className="right">Item value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.order_id}>
                  <td>
                    <button
                      className="order-id"
                      aria-label={`Open order ${r.order_id}`}
                      onClick={() => setOrderId(r.order_id)}
                    >
                      #{r.order_id.slice(0, 8)}
                      <small>
                        {r.item_count} {r.item_count === 1 ? "item" : "items"}
                      </small>
                    </button>
                  </td>
                  <td>{day(r.purchased_at)}</td>
                  <td>
                    {label(r.city)}
                    <small>{r.state}, Brazil</small>
                  </td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td className="right money">{money(r.merchandise_value)}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Order details ${r.order_id}`}
                      onClick={() => setOrderId(r.order_id)}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
      <div className="pagination">
        <span>
          {number(q.data?.rows.length ?? 0)} records shown · page{" "}
          {offset / 50 + 1}
        </span>
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          disabled={(q.data?.rows.length ?? 0) < 50 || offset >= 5000}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </button>
      </div>
      <QueryDetails data={q.data} />
      {orderId && <OrderDrawer id={orderId} onClose={() => setOrderId("")} />}
    </>
  );
}
function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery("order-detail", { orderId: id });
  const r = q.data?.rows[0];
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button, a[href], summary, input, select, [tabindex="0"]',
          ) ?? [],
        ).filter((x) => !x.hasAttribute("disabled"));
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <section
        ref={dialog}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <span className="eyebrow">ORDER DETAILS</span>
            <h2>#{id.slice(0, 8)}</h2>
          </div>
          <button
            aria-label="Close order details"
            className="icon-button"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {q.loading || q.error ? (
          <Empty loading={q.loading} error={q.error} />
        ) : r ? (
          <>
            <Status value={r.status} />
            <div className="detail-grid">
              <div>
                Purchased<strong>{day(r.purchased_at)}</strong>
              </div>
              <div>
                Destination
                <strong>
                  {label(r.city)}, {r.state}
                </strong>
              </div>
              <div>
                Merchandise<strong>{money(r.merchandise_value)}</strong>
              </div>
              <div>
                Freight<strong>{money(r.freight_value)}</strong>
              </div>
            </div>
            <h3>Delivery milestones</h3>
            <div className="milestones">
              {[
                ["Purchased", r.purchased_at],
                ["Estimated delivery", r.estimated_at],
                ["Actual delivery", r.delivered_at],
              ].map(([l, v]) => (
                <div key={l}>
                  <span />
                  <div>
                    {l}
                    <strong>{day(v)}</strong>
                  </div>
                </div>
              ))}
            </div>
            <h3>Order items</h3>
            {r.items.map((i: Row) => (
              <div className="detail-line" key={i.sequence}>
                <span>
                  {label(i.category)}
                  <small>Seller {i.seller_id.slice(0, 8)}</small>
                </span>
                <strong>{money(i.price)}</strong>
              </div>
            ))}
            <h3>Payments</h3>
            {r.payments.map((p: Row) => (
              <div className="detail-line" key={p.sequence}>
                <span>
                  {label(p.type)}
                  <small>{p.installments} installment(s)</small>
                </span>
                <strong>{money(p.amount)}</strong>
              </div>
            ))}
            <p className="muted">
              Items and payment records are aggregated separately to preserve
              their original grains.
            </p>
            <CustomerHistory id={r.customer_key} />
            <QueryDetails data={q.data} />
          </>
        ) : (
          <Empty />
        )}
      </section>
    </div>
  );
}
function CustomerHistory({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="text-button" onClick={() => setOpen(!open)}>
        Customer order history <ChevronDown size={14} />
      </button>
      {open && <History id={id} />}
    </div>
  );
}
function History({ id }: { id: string }) {
  const q = useQuery("customer-history", { customerId: id });
  return (
    <>
      {q.data?.rows.map((r) => (
        <div key={r.order_id} className="detail-line">
          <span>
            #{r.order_id.slice(0, 8)}
            <small>{day(r.purchased_at)}</small>
          </span>
          <strong>{money(r.merchandise_value)}</strong>
        </div>
      ))}
      <QueryDetails data={q.data} />
    </>
  );
}
function Sales({
  filters,
  monthly,
  categories,
}: {
  filters: Row;
  monthly: ReturnType<typeof useQuery>;
  categories: ReturnType<typeof useQuery>;
}) {
  const sellers = useQuery("seller-categories", {
    ...filters,
    group: "seller",
    limit: 50,
  });
  return (
    <>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Delivered merchandise trend</h2>
              <p>BRL · purchase month</p>
            </div>
          </div>
          {monthly.data ? (
            <TrendChart rows={monthly.data.rows} />
          ) : (
            <Empty loading={monthly.loading} error={monthly.error} />
          )}
          <QueryDetails data={monthly.data} />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Category mix</h2>
              <p>Ranked by delivered merchandise value</p>
            </div>
          </div>
          <CategoryBars rows={categories.data?.rows ?? []} />
          <QueryDetails data={categories.data} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Seller and category performance</h2>
            <p>
              Top 50 combinations · counts are distinct within each combination
            </p>
          </div>
        </div>
        {sellers.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Category</th>
                  <th className="right">Orders</th>
                  <th className="right">Items</th>
                  <th className="right">Merchandise value</th>
                </tr>
              </thead>
              <tbody>
                {sellers.data.rows.map((r) => (
                  <tr key={r.seller_id + r.category_name}>
                    <td className="mono">{r.seller_id.slice(0, 12)}</td>
                    <td>{label(r.category_name)}</td>
                    <td className="right">{number(r.orders)}</td>
                    <td className="right">{number(r.items)}</td>
                    <td className="right money">
                      {money(r.merchandise_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty loading={sellers.loading} error={sellers.error} />
        )}
        <QueryDetails data={sellers.data} />
      </section>
    </>
  );
}
function Delivery({ filters }: { filters: Row }) {
  const q = useQuery("delivery-summary", filters);
  return (
    <>
      <div className="insight-banner">
        <Truck size={24} />
        <div>
          <h2>Delivery promises, compared with outcomes</h2>
          <p>
            Late means delivered after the estimated calendar date. Orders
            missing either date are excluded from the rate.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Regional delivery performance</h2>
            <p>Grouped by customer state · latest review per order</p>
          </div>
        </div>
        {q.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>State</th>
                  <th className="right">Delivered</th>
                  <th className="right">Eligible</th>
                  <th>On time</th>
                  <th className="right">Avg. delivery</th>
                  <th className="right">Review score</th>
                  <th className="right">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.state}>
                    <td>
                      <strong>{r.state}</strong>
                    </td>
                    <td className="right">{number(r.delivered_orders)}</td>
                    <td className="right">{number(r.eligible_deliveries)}</td>
                    <td>
                      <div className="rate">
                        <span className="rate-track">
                          <i
                            style={{
                              width: pct(
                                r.eligible_deliveries - r.late_orders,
                                r.eligible_deliveries,
                              ),
                            }}
                          />
                        </span>
                        {pct(
                          r.eligible_deliveries - r.late_orders,
                          r.eligible_deliveries,
                        )}
                      </div>
                    </td>
                    <td className="right">
                      {r.delivery_days
                        ? Number(r.delivery_days).toFixed(1) + " days"
                        : "—"}
                    </td>
                    <td className="right">
                      {r.review_score
                        ? Number(r.review_score).toFixed(2) + " / 5"
                        : "—"}
                    </td>
                    <td className="right">{number(r.reviewed_orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty loading={q.loading} error={q.error} />
        )}
        <QueryDetails data={q.data} />
      </section>
      <div className="context-note">
        <Info size={15} />
        <p>
          Delivery time and review scores are descriptive. This analysis does
          not establish that delivery delays cause lower ratings. Review
          averages include only orders with a selected review.
        </p>
      </div>
    </>
  );
}
function Engineering({ catalog }: { catalog?: Row }) {
  const [tab, setTab] = useState("architecture");
  const [payload, setPayload] = useState("' OR '1'='1");
  const [test, setTest] = useState<Result>();
  const [testError, setTestError] = useState("");
  const [evidence, setEvidence] = useState<Row>();
  useEffect(() => {
    fetch("/evidence/release-checks.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setEvidence)
      .catch(() => {});
  }, []);
  return (
    <>
      <div className="engineering-intro">
        <div className="eyebrow">DESIGN → BUILD → VERIFY</div>
        <h2>
          One source of truth.
          <br />
          Inspectable from query to report.
        </h2>
        <p>
          A PostgreSQL application built around explicit table grains,
          reproducible business definitions, and checks against original source
          records.
        </p>
        <div className="stack-tags">
          <span>PostgreSQL 18</span>
          <span>Python</span>
          <span>TypeScript / React</span>
          <span>Power BI</span>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Engineering sections">
        {[
          ["architecture", "Database design"],
          ["performance", "Performance"],
          ["security", "Security"],
          ["downloads", "Downloads"],
        ].map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "architecture" && (
        <>
          <section className="panel padded">
            <h2>From source files to business answers</h2>
            <div className="pipeline">
              {[
                ["01", "Original files", "9 source CSVs · SHA-256 manifests"],
                ["02", "Relational core", "Keys, constraints, typed records"],
                ["03", "Star schema", "Three fact tables · shared dimensions"],
                [
                  "04",
                  "Application + BI",
                  "Bound SQL · consistent definitions",
                ],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span>{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
            <div className="model-grid">
              <div className="model-table dimension">
                <header>Dimensions</header>
                {[
                  "Date · purchase / delivery roles",
                  "Customer · unique repeat identity",
                  "Product · category",
                  "Seller · origin",
                  "Geography · order destination",
                  "Payment type / order status",
                ].map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </div>
              <div className="model-connector">
                <span>1 → many</span>
              </div>
              <div className="fact-stack">
                {[
                  ["Fact order", "One row per order"],
                  ["Fact order item", "One row per (order, item sequence)"],
                  ["Fact payment", "One row per (order, payment sequence)"],
                ].map(([a, b]) => (
                  <div className="model-table" key={a}>
                    <header>{a}</header>
                    <p>{b}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="muted">
              Facts are never joined together indiscriminately. Item and payment
              totals are aggregated separately before order-level reporting.
            </p>
          </section>
          <section className="panel padded">
            <h2>Dataset and audit trail</h2>
            <p>
              Olist historical commerce records, 2016–2018. Dates retain
              source-local timestamps; no unsupported timezone conversion is
              applied.
            </p>
            <div className="source-files">
              {catalog?.files?.map((f: Row) => (
                <div key={f.name}>
                  <span className="mono">{f.name}</span>
                  <strong>{number(f.rows)} rows</strong>
                </div>
              ))}
            </div>
            <p className="muted">
              Dataset version:{" "}
              {catalog?.dataVersion ??
                "Available when the database is connected"}
              . Review IDs and zip prefixes are not assumed unique.
            </p>
            <a
              className="text-button"
              href="/downloads/data-dictionary.html"
              target="_blank"
              rel="noreferrer"
            >
              Read definitions and schema details <ArrowUpRight size={14} />
            </a>
          </section>
        </>
      )}
      {tab === "performance" && (
        <section className="panel padded">
          <h2>Measured query performance</h2>
          <p>
            Comparisons use identical results, the same hardware, recorded query
            plans, and repeatable workloads. Database execution and network
            round trips are measured separately.
          </p>
          {evidence?.benchmarks ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Workload</th>
                    <th>Baseline median</th>
                    <th>Optimized median</th>
                    <th>Result match</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.benchmarks.map((r: Row) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{r.baseline_median_ms.toFixed(2)} ms</td>
                      <td>{r.optimized_median_ms.toFixed(2)} ms</td>
                      <td>
                        <Check size={15} />{" "}
                        {r.results_equal ? "Verified" : "Mismatch"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="notice">
              Benchmark evidence has not yet been published for this build. No
              speed improvement is claimed.
            </div>
          )}
          <div className="engineering-cards">
            <article>
              <Activity />
              <h3>Targeted optimization</h3>
              <p>
                Selective indexes, improved joins, and a stored monthly category
                summary. Index size and refresh costs stay visible.
              </p>
            </article>
            <article>
              <Layers />
              <h3>Honest scale testing</h3>
              <p>
                Real historical data and synthetic load tests are reported
                separately. Synthetic records never enter business findings.
              </p>
            </article>
            <article>
              <Clock />
              <h3>Hosting behavior</h3>
              <p>
                An idle hosted database may sleep. Its first request is distinct
                from a warm-query benchmark.
              </p>
            </article>
          </div>
          <a
            className="text-button"
            href="/evidence/release-checks.json"
            target="_blank"
            rel="noreferrer"
          >
            Download recorded measurements <Download size={14} />
          </a>
        </section>
      )}
      {tab === "security" && (
        <>
          <section className="panel padded">
            <div className="security-heading">
              <ShieldCheck />
              <div>
                <h2>Security by construction, checked in execution</h2>
                <p>
                  Controls and coverage are documented. Passing tests are
                  evidence for tested paths, not a guarantee against every
                  possible attack.
                </p>
              </div>
            </div>
            <div className="engineering-cards">
              <article>
                <h3>SQL injection</h3>
                <p>
                  Values are bound separately from SQL. Sort choices map to
                  fixed application expressions. The runtime database role has
                  read-only privileges.
                </p>
              </article>
              <article>
                <h3>Cross-site scripting</h3>
                <p>
                  Untrusted text uses React text rendering. Unsafe HTML
                  insertion is avoided. A Content Security Policy adds another
                  layer.
                </p>
              </article>
              <article>
                <h3>Bounded access</h3>
                <p>
                  Only registered queries run. Input length, result count,
                  execution time, and request limits bound database work.
                </p>
              </article>
            </div>
            <div className="notice">
              {evidence?.security
                ? `${evidence.security.passed} checks passed in the recorded release run. See the downloadable report for exact coverage.`
                : "Security test evidence is pending for this build."}
            </div>
          </section>
          <section className="panel padded">
            <h2>Inspect how untrusted input is handled</h2>
            <p>
              This calls the real city-search endpoint with a bounded text
              value. It does not run arbitrary SQL.
            </p>
            <form
              className="security-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setTestError("");
                try {
                  setTest(
                    await request("order-search", {
                      search: payload,
                      limit: 5,
                    }),
                  );
                } catch (e) {
                  setTestError((e as Error).message);
                }
              }}
            >
              <label>
                Search text
                <input
                  aria-label="Security example input"
                  maxLength={200}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                />
              </label>
              <button className="button primary">
                Run bounded example <ArrowRight size={15} />
              </button>
            </form>
            <div className="safe-render">
              <span>Rendered as text</span>
              <code data-testid="safe-render">{payload}</code>
            </div>
            {testError && <p role="alert">{testError}</p>}
            {test && (
              <>
                <p>
                  {test.rows.length} matching records. The supplied text
                  remained a bound value.
                </p>
                <QueryDetails data={test} />
              </>
            )}
          </section>
        </>
      )}
      {tab === "downloads" && (
        <section className="panel padded">
          <h2>Project files and evidence</h2>
          <p>
            Versioned artifacts for inspection and reproduction. Availability is
            explicit for work still in progress.
          </p>
          <div className="downloads">
            {[
              [
                "Interactive report",
                "Explore verified sales and delivery results in your browser.",
                portfolioReportUrl,
              ],
              [
                "Source code",
                "SQL model, pipeline, API, tests, and editable Power BI project.",
                "https://github.com/bronson-12o/commerce-operations-explorer",
              ],
              [
                "Case study",
                "Business questions, architecture, decisions, and limitations.",
                "/downloads/case-study.html",
              ],
              [
                "Data dictionary",
                "Grains, fields, relationships, and metric definitions.",
                "/downloads/data-dictionary.html",
              ],
              [
                "Verification evidence",
                "Source reconciliation, security checks, and measurements.",
                "/evidence/release-checks.json",
              ],
              [
                "Source manifest",
                "Original source-file hashes, coverage, and key profiles.",
                "/evidence/source-manifest.json",
              ],
            ].map(([t, d, u]) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <div>
                  <FileText />
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
                <ArrowUpRight />
              </a>
            ))}
          </div>
          <div className="notice">
            Power BI Desktop refresh, PBIX save/reopen, and metric
            reconciliation passed. The file includes imported historical data.
            Updating it requires regenerating the exports and setting the
            SourceFolder parameter.
          </div>
        </section>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

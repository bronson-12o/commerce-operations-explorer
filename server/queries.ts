import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid calendar date",
  );
export const filterSchema = z
  .object({
    start: date.default("2016-09-01"),
    end: date.default("2018-10-31"),
    state: z
      .enum([
        "ALL",
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
      ])
      .default("ALL"),
    status: z
      .enum([
        "all",
        "delivered",
        "shipped",
        "canceled",
        "unavailable",
        "invoiced",
        "processing",
        "approved",
        "created",
      ])
      .default("all"),
    search: z.string().max(200).default(""),
    orderId: z.string().max(200).default(""),
    customerId: z.string().max(200).default(""),
    group: z.enum(["seller", "category"]).default("seller"),
    sort: z.enum(["newest", "oldest", "value"]).default("newest"),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(5000).default(0),
  })
  .strict()
  .refine((x) => x.start <= x.end, {
    message: "Start date must precede end date",
  });
export type Filters = z.infer<typeof filterSchema>;
export const descriptions = {
  "monthly-trends": "Monthly activity and delivered merchandise value",
  "order-search": "Orders by purchase date, region, status and city",
  "order-detail": "One order, with separately aggregated items and payments",
  "customer-history": "Order history for one repeat-customer identity",
  "seller-categories": "Delivered merchandise value by seller and category",
  "delivery-summary":
    "Delivery performance and latest-review coverage by state",
};
export type QueryId = keyof typeof descriptions;
export const isQueryId = (s: string): s is QueryId =>
  Object.hasOwn(descriptions, s);
export function queryFor(
  id: QueryId,
  f: Filters,
): { text: string; values: unknown[] } {
  const base = [f.start, f.end, f.state];
  const range =
    "purchase_date >= $1::date AND purchase_date <= $2::date AND ($3='ALL' OR state=$3)";
  switch (id) {
    case "monthly-trends":
      return {
        text: `SELECT to_char(purchase_date,'YYYY-MM') AS month,count(*)::int AS orders,count(*) FILTER(WHERE status='delivered')::int AS delivered_orders,sum(merchandise_value) FILTER(WHERE status='delivered')::text AS merchandise_value,sum(freight_value) FILTER(WHERE status='delivered')::text AS freight_value,count(*) FILTER(WHERE late IS TRUE)::int AS late_orders,count(late)::int AS eligible_deliveries,round(avg(review_score)::numeric,3)::text AS review_score,count(review_score)::int AS reviewed_orders FROM api.orders WHERE ${range} GROUP BY 1 ORDER BY 1`,
        values: base,
      };
    case "order-search": {
      const sort = {
        newest: "purchased_at DESC, order_id",
        oldest: "purchased_at ASC, order_id",
        value: "merchandise_value DESC, order_id",
      }[f.sort];
      return {
        text: `SELECT order_id,customer_key,purchased_at::text,status,city,state,item_count,merchandise_value::text,freight_value::text,late,review_score FROM api.orders WHERE ${range} AND ($4='all' OR status=$4) AND ($5='' OR strpos(lower(city),lower($5))>0) ORDER BY ${sort} LIMIT $6 OFFSET $7`,
        values: [...base, f.status, f.search, f.limit, f.offset],
      };
    }
    case "order-detail":
      return {
        text: `SELECT o.order_id,o.customer_key,o.status,o.state,o.city,o.item_count,o.purchased_at::text,o.delivered_at::text,o.estimated_at::text,o.merchandise_value::text,o.freight_value::text,o.payment_value::text,o.review_score,o.late,coalesce((SELECT jsonb_agg(jsonb_build_object('sequence',i.item_sequence,'category',i.category_name,'seller_id',i.seller_id,'price',i.price::text,'freight',i.freight::text) ORDER BY i.item_sequence) FROM api.items i WHERE i.order_id=o.order_id),'[]'::jsonb) AS items,coalesce((SELECT jsonb_agg(jsonb_build_object('sequence',p.payment_sequence,'type',p.payment_type,'installments',p.installments,'amount',p.amount::text) ORDER BY p.payment_sequence) FROM api.payments p WHERE p.order_id=o.order_id),'[]'::jsonb) AS payments FROM api.orders o WHERE order_id=$1`,
        values: [f.orderId],
      };
    case "customer-history":
      return {
        text: `SELECT order_id,purchased_at::text,status,state,item_count,merchandise_value::text,late FROM api.orders WHERE customer_key=$1 ORDER BY purchased_at DESC,order_id LIMIT $2`,
        values: [f.customerId, f.limit],
      };
    case "seller-categories": {
      const group =
        f.group === "seller" ? "seller_id,category_name" : "category_name";
      return {
        text: `SELECT ${group},count(DISTINCT order_id)::int AS orders,count(*)::int AS items,sum(price)::text AS merchandise_value FROM api.items WHERE ${range} AND status='delivered' GROUP BY ${group} ORDER BY sum(price) DESC,${group} LIMIT $4`,
        values: [...base, f.limit],
      };
    }
    case "delivery-summary":
      return {
        text: `SELECT state,count(*)::int AS orders,count(*) FILTER(WHERE status='delivered')::int AS delivered_orders,count(late)::int AS eligible_deliveries,count(*) FILTER(WHERE late IS TRUE)::int AS late_orders,round(avg(delivery_days),2)::text AS delivery_days,round(avg(review_score)::numeric,3)::text AS review_score,count(review_score)::int AS reviewed_orders FROM api.orders WHERE ${range} GROUP BY state ORDER BY count(*) DESC,state`,
        values: base,
      };
  }
}

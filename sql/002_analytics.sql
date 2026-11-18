CREATE SCHEMA analytics;
CREATE SCHEMA api;
CREATE TABLE analytics.dim_date AS SELECT d::date AS date_key,extract(year FROM d)::int AS year,extract(month FROM d)::int AS month,to_char(d,'YYYY-MM') AS year_month FROM generate_series('2016-01-01'::date,'2019-12-31'::date,'1 day') d;
ALTER TABLE analytics.dim_date ADD PRIMARY KEY(date_key);
CREATE TABLE analytics.dim_customer AS SELECT * FROM core.customer;
ALTER TABLE analytics.dim_customer ADD PRIMARY KEY(customer_key);
CREATE TABLE analytics.dim_product AS SELECT * FROM core.product;
ALTER TABLE analytics.dim_product ADD PRIMARY KEY(product_id);
CREATE TABLE analytics.dim_seller AS SELECT * FROM core.seller;
ALTER TABLE analytics.dim_seller ADD PRIMARY KEY(seller_id);
CREATE TABLE analytics.dim_geography AS SELECT DISTINCT state||':'||city||':'||zip_prefix AS geography_key,state,city,zip_prefix FROM core.order_customer;
ALTER TABLE analytics.dim_geography ADD PRIMARY KEY(geography_key);
CREATE TABLE analytics.dim_payment_type AS SELECT DISTINCT payment_type FROM core.payment;
ALTER TABLE analytics.dim_payment_type ADD PRIMARY KEY(payment_type);
CREATE TABLE analytics.dim_order_status AS SELECT DISTINCT status FROM core.orders;
ALTER TABLE analytics.dim_order_status ADD PRIMARY KEY(status);
CREATE TABLE analytics.fact_order AS
WITH item_totals AS (SELECT order_id,count(*)::int AS item_count,sum(price)::numeric(14,2) AS merchandise_value,sum(freight)::numeric(14,2) AS freight_value FROM core.order_item GROUP BY order_id),
payment_totals AS (SELECT order_id,sum(amount)::numeric(14,2) AS payment_value FROM core.payment GROUP BY order_id),
latest_review AS (SELECT DISTINCT ON(order_id) order_id,score,count(*) OVER(PARTITION BY order_id)::int AS review_count FROM core.review ORDER BY order_id,answered_at DESC NULLS LAST,created_at DESC NULLS LAST,review_record_key DESC)
SELECT o.order_id,c.customer_key,c.state||':'||c.city||':'||c.zip_prefix AS geography_key,o.status,o.purchased_at,o.purchased_at::date AS purchase_date,o.delivered_at::date AS delivery_date,o.estimated_at::date AS estimated_date,o.delivered_at,o.estimated_at,
 coalesce(i.item_count,0) AS item_count,coalesce(i.merchandise_value,0)::numeric(14,2) AS merchandise_value,coalesce(i.freight_value,0)::numeric(14,2) AS freight_value,p.payment_value,
 CASE WHEN o.status='delivered' AND o.delivered_at IS NOT NULL AND o.estimated_at IS NOT NULL THEN o.delivered_at::date>o.estimated_at::date ELSE NULL END AS late,
 CASE WHEN o.delivered_at IS NOT NULL THEN extract(epoch FROM o.delivered_at-o.purchased_at)/86400.0 ELSE NULL END AS delivery_days,r.score AS review_score,coalesce(r.review_count,0) AS review_count
FROM core.orders o JOIN core.order_customer c USING(customer_id) LEFT JOIN item_totals i USING(order_id) LEFT JOIN payment_totals p USING(order_id) LEFT JOIN latest_review r USING(order_id);
ALTER TABLE analytics.fact_order ADD PRIMARY KEY(order_id), ADD FOREIGN KEY(customer_key) REFERENCES analytics.dim_customer, ADD FOREIGN KEY(geography_key) REFERENCES analytics.dim_geography, ADD FOREIGN KEY(purchase_date) REFERENCES analytics.dim_date, ADD FOREIGN KEY(status) REFERENCES analytics.dim_order_status;
CREATE TABLE analytics.fact_order_item AS SELECT i.*,o.customer_key,o.geography_key,o.purchase_date,o.status FROM core.order_item i JOIN analytics.fact_order o USING(order_id);
ALTER TABLE analytics.fact_order_item ADD PRIMARY KEY(order_id,item_sequence), ADD FOREIGN KEY(product_id) REFERENCES analytics.dim_product, ADD FOREIGN KEY(seller_id) REFERENCES analytics.dim_seller, ADD FOREIGN KEY(customer_key) REFERENCES analytics.dim_customer, ADD FOREIGN KEY(geography_key) REFERENCES analytics.dim_geography, ADD FOREIGN KEY(purchase_date) REFERENCES analytics.dim_date;
CREATE TABLE analytics.fact_payment AS SELECT p.*,o.customer_key,o.geography_key,o.purchase_date FROM core.payment p JOIN analytics.fact_order o USING(order_id);
ALTER TABLE analytics.fact_payment ADD PRIMARY KEY(order_id,payment_sequence), ADD FOREIGN KEY(payment_type) REFERENCES analytics.dim_payment_type, ADD FOREIGN KEY(customer_key) REFERENCES analytics.dim_customer, ADD FOREIGN KEY(purchase_date) REFERENCES analytics.dim_date;
CREATE MATERIALIZED VIEW analytics.monthly_category AS SELECT date_trunc('month',i.purchase_date)::date AS month,g.state,p.category_name,count(*) AS items,sum(i.price) AS merchandise_value FROM analytics.fact_order_item i JOIN analytics.dim_product p USING(product_id) JOIN analytics.dim_geography g USING(geography_key) WHERE i.status='delivered' GROUP BY 1,2,3;
CREATE VIEW api.orders AS SELECT f.*,g.state,g.city FROM analytics.fact_order f JOIN analytics.dim_geography g USING(geography_key);
CREATE VIEW api.items AS SELECT i.order_id,i.item_sequence,i.product_id,i.seller_id,i.price,i.freight,i.purchase_date,i.status,g.state,p.category_name FROM analytics.fact_order_item i JOIN analytics.dim_product p USING(product_id) JOIN analytics.dim_geography g USING(geography_key);
CREATE VIEW api.payments AS SELECT order_id,payment_sequence,payment_type,installments,amount FROM analytics.fact_payment;
CREATE VIEW api.monthly_category AS SELECT * FROM analytics.monthly_category;

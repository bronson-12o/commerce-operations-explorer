CREATE INDEX orders_period_region ON analytics.fact_order(purchase_date,geography_key);
CREATE INDEX orders_customer_history ON analytics.fact_order(customer_key,purchased_at DESC);
CREATE INDEX geography_state ON analytics.dim_geography(state);
CREATE INDEX items_seller_period ON analytics.fact_order_item(seller_id,purchase_date);
CREATE INDEX items_product_period ON analytics.fact_order_item(product_id,purchase_date);
CREATE UNIQUE INDEX monthly_category_key ON analytics.monthly_category(month,state,category_name);

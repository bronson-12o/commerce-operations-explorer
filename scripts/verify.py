"""Independent CSV-to-SQL checks and transactional recovery verification."""
from pathlib import Path
from decimal import Decimal
import csv,json,os,random
import psycopg
from pipeline import env,write_json,ROOT,read_rows
env();raw=ROOT/'data/raw'
if not raw.exists():raw=ROOT.parents[1]/'work/source-data/raw'
report={'checks':[]}
def check(name,condition,detail=None):
    if not condition:raise AssertionError(name+': '+str(detail))
    report['checks'].append({'name':name,'passed':True,'detail':detail})
orders=read_rows(raw/'olist_orders_dataset.csv');items=read_rows(raw/'olist_order_items_dataset.csv')
with psycopg.connect(os.environ['OWNER_DATABASE_URL']) as c:
    controls=json.loads((ROOT/'evidence/source-controls.json').read_text())
    actual=c.execute("SELECT count(*),count(*) FILTER(WHERE status='delivered'),sum(merchandise_value) FILTER(WHERE status='delivered'),sum(freight_value) FILTER(WHERE status='delivered') FROM analytics.fact_order").fetchone()
    check('CSV count and exact-cent merchandise/freight controls',actual==(controls['orders'],controls['delivered_orders'],Decimal(controls['delivered_merchandise_value']),Decimal(controls['delivered_freight_value'])),[str(v) for v in actual])
    sample=random.Random(20261118).sample(orders,150);expected={r['order_id']:Decimal(0) for r in sample}
    for r in items:
        if r['order_id'] in expected:expected[r['order_id']]+=Decimal(r['price'])
    sql=dict(c.execute('SELECT order_id,merchandise_value FROM analytics.fact_order WHERE order_id=ANY(%s)',(list(expected),)).fetchall())
    check('150 seeded independent per-order sums',expected==sql,{'orders':150})
    for year,state in [(2016,'SP'),(2017,'RJ'),(2018,'MG')]:
        ids={r['order_id'] for r in orders if r['order_status']=='delivered' and r['order_purchase_timestamp'].startswith(str(year))};cs={r['customer_id']:r['customer_state'] for r in read_rows(raw/'olist_customers_dataset.csv')};ids={r['order_id'] for r in orders if r['order_id'] in ids and cs[r['customer_id']]==state};expected_value=sum((Decimal(r['price']) for r in items if r['order_id'] in ids),Decimal(0));value=c.execute("SELECT coalesce(sum(merchandise_value),0) FROM api.orders WHERE status='delivered' AND extract(year FROM purchase_date)=%s AND state=%s",(year,state)).fetchone()[0];check(f'Independent filtered total: {year}/{state}',value==expected_value,str(value))
    counts={t:c.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ['core.orders','analytics.fact_order','analytics.fact_order_item','analytics.fact_payment']}
    check('Fact row counts preserve source grains',counts['core.orders']==counts['analytics.fact_order']==len(orders) and counts['analytics.fact_order_item']==len(items),counts)
    # Savepoints prove a multi-step failed load does not publish partial mutations.
    c.execute('SAVEPOINT recovery_check');before=c.execute('SELECT sum(merchandise_value) FROM analytics.fact_order').fetchone()[0]
    c.execute('UPDATE analytics.fact_order SET merchandise_value=0 WHERE order_id=%s',(orders[0]['order_id'],))
    try:c.execute("INSERT INTO core.order_item VALUES ('missing-order',1,'missing-product','missing-seller',NULL,1,0)")
    except psycopg.errors.ForeignKeyViolation:c.execute('ROLLBACK TO recovery_check')
    after=c.execute('SELECT sum(merchandise_value) FROM analytics.fact_order').fetchone()[0]
    check('Constraint failure rolls back preceding transaction changes',before==after)
    late=0;eligible=0
    for r in orders:
        if r['order_status']=='delivered' and r['order_delivered_customer_date'] and r['order_estimated_delivery_date']:
            eligible+=1;late+=r['order_delivered_customer_date'][:10]>r['order_estimated_delivery_date'][:10]
    sql=c.execute('SELECT count(late),count(*) FILTER(WHERE late IS TRUE) FROM analytics.fact_order').fetchone();check('Delivery denominator and calendar-date late rule',(eligible,late)==sql,{'eligible':eligible,'late':late})
    report['database_bytes']=c.execute('SELECT pg_database_size(current_database())').fetchone()[0]
    report['source_duplicate_review_ids']=len(read_rows(raw/'olist_order_reviews_dataset.csv'))-len({r['review_id'] for r in read_rows(raw/'olist_order_reviews_dataset.csv')})
write_json(ROOT/'evidence/data-verification.json',report)
print(json.dumps({'passed':len(report['checks']),'database_mib':round(report['database_bytes']/1024/1024,1),'duplicate_review_ids':report['source_duplicate_review_ids']}))

"""Preserve, profile and load Olist source files; promote transactionally."""
from pathlib import Path
from collections import Counter
from decimal import Decimal
import argparse,csv,hashlib,json,os,sys,time
import psycopg
from psycopg import sql
ROOT=Path(__file__).resolve().parents[1]
def env():
    if (ROOT/'.env').exists():
        for line in (ROOT/'.env').read_text().splitlines():
            if '=' in line:
                k,v=line.split('=',1);os.environ.setdefault(k,v)
def write_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,default=str)+'\n')
def read_rows(path):
    with path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def run(raw):
    env(); start=time.time(); manifest={'source':'Olist Brazilian E-Commerce Public Dataset','source_url':'https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce','license':'CC BY-NC-SA 4.0','files':[]}
    datasets={}
    for f in sorted(raw.glob('*.csv')):
        rows=read_rows(f); datasets[f.stem]=rows
        manifest['files'].append({'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'rows':len(rows),'columns':list(rows[0]) if rows else [],'missing':{k:sum(not r[k] for r in rows) for k in rows[0]} if rows else {}})
    if len(datasets)!=9:raise RuntimeError('Expected exactly nine original source CSV files.')
    version=hashlib.sha256(''.join(x['sha256'] for x in manifest['files']).encode()).hexdigest()[:16]
    manifest['data_version']=version
    with psycopg.connect(os.environ['OWNER_DATABASE_URL']) as conn:
        conn.execute('SELECT pg_advisory_xact_lock(418372)')
        conn.execute('CREATE SCHEMA IF NOT EXISTS ops')
        conn.execute('CREATE TABLE IF NOT EXISTS ops.loads (version text PRIMARY KEY, loaded_at timestamptz DEFAULT now(), manifest jsonb NOT NULL)')
        if conn.execute('SELECT 1 FROM ops.loads WHERE version=%s',(version,)).fetchone():
            print('Same source version already loaded; no changes.');return
        conn.execute('DROP SCHEMA IF EXISTS api CASCADE; DROP SCHEMA IF EXISTS analytics CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS raw CASCADE; CREATE SCHEMA raw')
        for name,rows in datasets.items():
            headers=list(rows[0]); columns=[sql.SQL('{} text').format(sql.Identifier(k)) for k in headers]
            conn.execute(sql.SQL('CREATE TABLE raw.{} (source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, {})').format(sql.Identifier(name),sql.SQL(',').join(columns)))
            with conn.cursor().copy(sql.SQL('COPY raw.{} ({}) FROM STDIN').format(sql.Identifier(name),sql.SQL(',').join(map(sql.Identifier,headers)))) as cp:
                for row in rows:cp.write_row(tuple(row[h] or None for h in headers))
        for name in ['001_model.sql','002_analytics.sql','003_indexes.sql']:
            conn.execute((ROOT/'sql'/name).read_text())
        reader=os.environ['READER_PASSWORD']
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname='commerce_reader'").fetchone():conn.execute(sql.SQL('CREATE ROLE commerce_reader LOGIN PASSWORD {}').format(sql.Literal(reader)))
        else:conn.execute(sql.SQL('ALTER ROLE commerce_reader PASSWORD {}').format(sql.Literal(reader)))
        conn.execute("ALTER ROLE commerce_reader SET statement_timeout='5s'; ALTER ROLE commerce_reader SET default_transaction_read_only=on; ALTER ROLE commerce_reader SET search_path=api,pg_catalog")
        conn.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON SCHEMA raw,core,analytics,ops FROM commerce_reader; GRANT USAGE ON SCHEMA api TO commerce_reader; GRANT SELECT ON ALL TABLES IN SCHEMA api TO commerce_reader')
        conn.execute('INSERT INTO ops.loads(version,manifest) VALUES (%s,%s::jsonb)',(version,json.dumps(manifest)))
        conn.execute('CREATE OR REPLACE VIEW api.release_info AS SELECT version,loaded_at,manifest FROM ops.loads ORDER BY loaded_at DESC LIMIT 1; GRANT SELECT ON api.release_info TO commerce_reader')
        conn.execute('ANALYZE')
    # Independent controls derive directly from original CSVs, not warehouse output.
    orders=datasets['olist_orders_dataset']; items=datasets['olist_order_items_dataset']; delivered={r['order_id'] for r in orders if r['order_status']=='delivered'}
    controls={'data_version':version,'orders':len(orders),'delivered_orders':len(delivered),'items':len(items),'payments':len(datasets['olist_order_payments_dataset']),'delivered_merchandise_value':str(sum((Decimal(r['price']) for r in items if r['order_id'] in delivered),Decimal(0))),'delivered_freight_value':str(sum((Decimal(r['freight_value']) for r in items if r['order_id'] in delivered),Decimal(0)))}
    for name,key in [('olist_order_items_dataset',('order_id','order_item_id')),('olist_order_payments_dataset',('order_id','payment_sequential')),('olist_order_reviews_dataset',('review_id',))]:
        c=Counter(tuple(r[k] for k in key) for r in datasets[name]);manifest.setdefault('key_profiles',[]).append({'file':name,'key':key,'duplicate_keys':sum(v-1 for v in c.values())})
    write_json(ROOT/'evidence/source-manifest.json',manifest);write_json(ROOT/'evidence/source-controls.json',controls)
    print(json.dumps({'data_version':version,'orders':controls['orders'],'delivered_merchandise_value':controls['delivered_merchandise_value'],'seconds':round(time.time()-start,2)}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--raw',type=Path,default=ROOT/'data/raw');run(p.parse_args().raw)

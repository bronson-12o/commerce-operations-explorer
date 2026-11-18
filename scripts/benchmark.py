"""Disposable local benchmarks; do not run against the hosted database."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from statistics import median
from urllib.parse import urlparse,urlunparse
import argparse,hashlib,json,os,platform,re,subprocess,time
import psycopg
from psycopg import sql
from pipeline import env,ROOT,write_json
env();owner=os.environ['OWNER_DATABASE_URL'];u=urlparse(owner)
if u.hostname not in ('127.0.0.1','localhost'):raise RuntimeError('Benchmarks require a local database')
work=ROOT.parents[1]/'work';backup=work/'commerce-prepared.dump'
if not backup.exists():
    with backup.open('wb') as out:subprocess.run(['docker','compose','exec','-T','db','pg_dump','-U','commerce_owner','-d','commerce','-Fc','--no-owner','--no-acl','--exclude-schema=raw'],cwd=ROOT,stdout=out,check=True)
parser=argparse.ArgumentParser();parser.add_argument('--suffix',default='');suffix=parser.parse_args().suffix
if suffix and not re.fullmatch(r'_[a-z0-9_]{1,24}',suffix):raise ValueError('Use a short lowercase suffix starting with underscore')
names=['commerce_baseline'+suffix,'commerce_benchmark'+suffix]
for name in names:
    with psycopg.connect(owner,autocommit=True) as c:
        exists=c.execute('SELECT 1 FROM pg_database WHERE datname=%s',(name,)).fetchone()
        if exists:raise RuntimeError(f'{name} already exists; preserve prior evidence and use a new explicit benchmark database name')
        c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    with backup.open('rb') as inp:subprocess.run(['docker','compose','exec','-T','db','pg_restore','-U','commerce_owner','-d',name,'--no-owner','--no-acl','--exit-on-error','--single-transaction'],cwd=ROOT,stdin=inp,check=True)
conns={n:psycopg.connect(urlunparse(u._replace(path='/'+n)),autocommit=True) for n in names}
baseline=conns[names[0]];optimized=conns[names[1]]
for name in ['orders_period_region','orders_customer_history','geography_state','items_seller_period','items_product_period']:
    baseline.execute(sql.SQL('DROP INDEX analytics.{}').format(sql.Identifier(name)))
baseline.execute('ANALYZE');optimized.execute('ANALYZE')
cases=json.loads((ROOT/'evidence/benchmark-queries.json').read_text());report={'query_registry_sha256':hashlib.sha256((ROOT/'evidence/benchmark-queries.json').read_bytes()).hexdigest(),'environment':{'machine':platform.machine(),'postgres':optimized.execute('SELECT version()').fetchone()[0],'docker_image':'postgres:18','database_origin':'full Olist prepared schemas','cache':'five warm-up executions; warm caches; paired execution order alternated','repetitions':50,'clock':'client monotonic elapsed time, includes local round-trip/fetch'},'benchmarks':[],'concurrency':[]}
def converted(case):
    # SQL registry uses numbered parameters. psycopg accepts positional %s; repeat values for repeated placeholders.
    import re
    values=[]
    def sub(m):values.append(case['values'][int(m.group(1))-1]);return '%s'
    return re.sub(r'\$(\d+)',sub,case['text']),values
def fetch(c,query,values):
    before=time.perf_counter_ns();rows=c.execute(query,values).fetchall();return (time.perf_counter_ns()-before)/1e6,rows
def p95(v):return sorted(v)[max(0,int(len(v)*.95+.999)-1)]
for case in cases:
    query,values=converted(case);a=[];b=[]
    for _ in range(5):fetch(baseline,query,values);fetch(optimized,query,values)
    for i in range(50):
        for c,target in ([(baseline,a),(optimized,b)] if i%2==0 else [(optimized,b),(baseline,a)]):
            elapsed,rows=fetch(c,query,values);target.append(elapsed)
    ra=baseline.execute(query,values).fetchall();rb=optimized.execute(query,values).fetchall();assert ra==rb,case['id']
    plans={kind:c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,values).fetchone()[0][0] for kind,c in [('baseline',baseline),('optimized',optimized)]}
    item={'id':case['id'],'name':case['name'],'baseline_median_ms':median(a),'optimized_median_ms':median(b),'baseline_p95_ms':p95(a),'optimized_p95_ms':p95(b),'results_equal':True,'raw_ms':{'baseline':a,'optimized':b},'plans':plans}
    report['benchmarks'].append(item);print(json.dumps({k:item[k] for k in ['id','baseline_median_ms','optimized_median_ms','results_equal']}),flush=True)
# Record the summary-table tradeoff using exactly equivalent category/month results.
direct="SELECT date_trunc('month',i.purchase_date)::date,g.state,p.category_name,count(*) AS items,sum(i.price) AS merchandise_value FROM analytics.fact_order_item i JOIN analytics.dim_product p USING(product_id) JOIN analytics.dim_geography g USING(geography_key) WHERE i.status='delivered' GROUP BY 1,2,3 ORDER BY 1,2,3"
summary='SELECT month,state,category_name,items,merchandise_value FROM analytics.monthly_category ORDER BY 1,2,3'
a=[];b=[]
for i in range(55):
    da,ra=fetch(optimized,direct,[]);db,rb=fetch(optimized,summary,[])
    if i>=5:a.append(da);b.append(db)
assert ra==rb
before=time.perf_counter();optimized.execute('REFRESH MATERIALIZED VIEW analytics.monthly_category');refresh=(time.perf_counter()-before)*1000
report['benchmarks'].append({'id':'category-summary','name':'Monthly category summary','baseline_median_ms':median(a),'optimized_median_ms':median(b),'baseline_p95_ms':p95(a),'optimized_p95_ms':p95(b),'results_equal':True,'raw_ms':{'baseline':a,'optimized':b},'refresh_ms':refresh})
# Synthetic data is isolated and never included in application business tables.
optimized.execute('CREATE SCHEMA synthetic')
optimized.execute("CREATE TABLE synthetic.orders AS SELECT md5('commerce-benchmark-20261118:'||g)::text AS order_id,md5((g%80000)::text) AS customer_key,date '2017-01-01'+(g%600)::int AS purchase_date,(ARRAY['SP','RJ','MG','RS','PR'])[(g%5+1)::int] AS state,((g*17)%300000)::numeric/100 AS value FROM generate_series(1,1000000) g")
optimized.execute('ALTER TABLE synthetic.orders ADD PRIMARY KEY(order_id); ANALYZE synthetic.orders')
sq='SELECT order_id,purchase_date,value FROM synthetic.orders WHERE customer_key=md5(%s) ORDER BY purchase_date DESC,order_id';v=['42'];a=[];b=[]
for i in range(55):
    t,ra=fetch(optimized,sq,v)
    if i>=5:a.append(t)
optimized.execute('CREATE INDEX customer_history ON synthetic.orders(customer_key,purchase_date DESC,order_id); ANALYZE synthetic.orders')
for i in range(55):
    t,rb=fetch(optimized,sq,v)
    if i>=5:b.append(t)
assert ra==rb
report['synthetic']={'rows':1000000,'generator_seed':'commerce-benchmark-20261118','not_business_data':True,'baseline_median_ms':median(a),'indexed_median_ms':median(b),'baseline_p95_ms':p95(a),'indexed_p95_ms':p95(b),'results_equal':True,'raw_ms':{'baseline':a,'indexed':b}}
def client_run(count):
    timings=[]
    with psycopg.connect(urlunparse(u._replace(path='/'+names[1])),autocommit=True) as c:
        for _ in range(count):t,_=fetch(c,sq,v);timings.append(t)
    return timings
for clients in [1,5,10]:
    before=time.perf_counter()
    with ThreadPoolExecutor(max_workers=clients) as ex:r=list(ex.map(client_run,[30]*clients))
    duration=time.perf_counter()-before;ts=[x for a in r for x in a];report['concurrency'].append({'clients':clients,'queries':len(ts),'median_ms':median(ts),'p95_ms':p95(ts),'throughput_queries_per_second':len(ts)/duration,'errors':0,'workload':'indexed synthetic customer history; connection setup included in throughput'})
report['storage']={n:c.execute('SELECT pg_database_size(current_database())').fetchone()[0] for n,c in conns.items()}
report['index_bytes']=optimized.execute("SELECT sum(pg_relation_size(indexrelid)) FROM pg_index WHERE indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='analytics'::regnamespace)").fetchone()[0]
restore=optimized.execute("SELECT count(*),sum(merchandise_value) FILTER(WHERE status='delivered') FROM api.orders").fetchone()
assert restore==(99441,__import__('decimal').Decimal('13221498.11'))
report['backup_restore']={'backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'fresh_databases_restored':names,'orders':restore[0],'delivered_merchandise_value':str(restore[1]),'passed':True}
for c in conns.values():c.close()
write_json(ROOT/'evidence/benchmarks.json',report);print('Benchmark, synthetic concurrency, and restore checks saved.',flush=True)

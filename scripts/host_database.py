"""Load only prepared schemas into this project's empty Neon database."""
from pathlib import Path
import json,os,subprocess
from urllib.parse import urlparse,urlunparse,quote
import psycopg
from psycopg import sql
from pipeline import env,ROOT,write_json
env();work=ROOT.parents[1]/'work';creds=work/'neon-connection.env'
owner=creds.read_text().split('=',1)[1].strip();u=urlparse(owner);host=u.hostname.replace('-pooler.','.')
owner=urlunparse(u._replace(netloc=f'{u.username}:{u.password}@{host}'))
dump=work/'commerce-prepared.dump'
with psycopg.connect(owner) as c:
    exists=c.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='core'").fetchone()[0]
if exists:raise RuntimeError('Hosted database already has core tables. Refusing to overwrite; inspect and migrate explicitly.')
with dump.open('wb') as out:
    subprocess.run(['docker','compose','exec','-T','db','pg_dump','-U','commerce_owner','-d','commerce','-Fc','--no-owner','--no-acl','--exclude-schema=raw'],cwd=ROOT,stdout=out,check=True)
runenv=os.environ|{'PGHOST':host,'PGUSER':u.username,'PGPASSWORD':u.password,'PGDATABASE':u.path.lstrip('/'),'PGSSLMODE':'require'}
with dump.open('rb') as inp:
    subprocess.run(['docker','compose','exec','-T','-e','PGHOST','-e','PGUSER','-e','PGPASSWORD','-e','PGDATABASE','-e','PGSSLMODE','db','pg_restore','--no-owner','--no-acl','--exit-on-error','--single-transaction','-d','commerce'],cwd=ROOT,env=runenv,stdin=inp,check=True)
with psycopg.connect(owner) as c:
    password=os.environ['READER_PASSWORD']
    if not c.execute("SELECT 1 FROM pg_roles WHERE rolname='commerce_reader'").fetchone():c.execute(sql.SQL('CREATE ROLE commerce_reader LOGIN PASSWORD {}').format(sql.Literal(password)))
    c.execute("ALTER ROLE commerce_reader SET statement_timeout='5s'; ALTER ROLE commerce_reader SET default_transaction_read_only=on; ALTER ROLE commerce_reader SET search_path=api,pg_catalog; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA api TO commerce_reader; GRANT SELECT ON ALL TABLES IN SCHEMA api TO commerce_reader")
    c.execute('ANALYZE')
    row=c.execute("SELECT count(*),sum(merchandise_value) FILTER(WHERE status='delivered') FROM api.orders").fetchone()
    size=c.execute('SELECT pg_database_size(current_database())').fetchone()[0]
    assert row[0]==99441 and str(row[1])=='13221498.11',(row,size)
    assert size<350*1024*1024,size
reader_url=urlunparse(u._replace(netloc=f'commerce_reader:{quote(os.environ["READER_PASSWORD"])}@{u.hostname}'))
path=ROOT/'.env.hosted';path.write_text('DATABASE_URL='+reader_url+'\n');path.chmod(0o600)
with psycopg.connect(reader_url) as c:
    assert c.execute('SELECT count(*) FROM api.orders').fetchone()[0]==99441
write_json(ROOT/'evidence/hosted-database.json',{'provider':'Neon','plan':'Free','postgres_version':18,'orders':row[0],'delivered_merchandise_value':str(row[1]),'database_bytes':size,'raw_schema_uploaded':False,'reader_verified':True})
print(json.dumps({'orders':row[0],'database_mib':round(size/1024/1024,1),'reader_verified':True}))

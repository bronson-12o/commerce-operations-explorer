"""Check authored report files against Microsoft's public JSON contracts."""
import json,urllib.request,warnings
from pathlib import Path
import jsonschema
from pipeline import ROOT,write_json
warnings.filterwarnings('ignore',category=DeprecationWarning)
cache={}
def fetch(url):
    if url not in cache:
        with urllib.request.urlopen(url.replace("schema.embedded.json","schema-embedded.json"),timeout=30) as r:cache[url]=json.load(r)
    return cache[url]
checks=[]
for p in (ROOT/'powerbi').rglob('*.json'):
    v=json.loads(p.read_text())
    if '$schema' not in v:continue
    url=v['$schema'];schema=fetch(url);resolver=jsonschema.RefResolver(base_uri=url,referrer=schema,handlers={'https':fetch})
    errors=list(jsonschema.Draft7Validator(schema,resolver=resolver).iter_errors(v))
    if errors:raise AssertionError(str(p)+': '+ '; '.join(str(e.message) for e in errors[:4]))
    checks.append(str(p.relative_to(ROOT)))
for p in list((ROOT/'powerbi').rglob('*.pbir'))+list((ROOT/'powerbi').rglob('*.pbism'))+list((ROOT/'powerbi').glob('*.pbip')):
    v=json.loads(p.read_text());url=v['$schema'];schema=fetch(url);jsonschema.Draft7Validator(schema,resolver=jsonschema.RefResolver(base_uri=url,referrer=schema,handlers={'https':fetch})).validate(v);checks.append(str(p.relative_to(ROOT)))
write_json(ROOT/'evidence/powerbi-schema-validation.json',{'files':checks,'passed':len(checks),'desktop_verification':False})
print('Microsoft schema validation passed for '+str(len(checks))+' project/report files.')

"""Download the public source archive without storing Kaggle credentials."""
from pathlib import Path
import hashlib,json,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[1];data=ROOT/'data';data.mkdir(exist_ok=True)
archive=data/'source.zip';raw=data/'raw'
if not archive.exists():
    urllib.request.urlretrieve('https://www.kaggle.com/api/v1/datasets/download/olistbr/brazilian-ecommerce',archive)
raw.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as z:
    for member in z.infolist():
        path=(raw/member.filename).resolve()
        if not path.is_relative_to(raw.resolve()):raise ValueError('Unsafe archive path')
    z.extractall(raw)
print('Public data downloaded. SHA-256: '+hashlib.sha256(archive.read_bytes()).hexdigest())

# A new upstream snapshot requires explicit manifest review before ingestion.
manifest=json.loads((ROOT/'evidence/source-manifest.json').read_text())
for source in manifest['files']:
    actual=hashlib.sha256((raw/source['name']).read_bytes()).hexdigest()
    if actual != source['sha256']:raise RuntimeError('Upstream source changed: '+source['name'])
print('All nine source hashes match the reviewed release manifest.')

"""Create local-only random credentials; never print them."""
from pathlib import Path
import secrets
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'.env'
if not p.exists():
    owner=secrets.token_hex(24); reader=secrets.token_hex(24)
    p.write_text(f'POSTGRES_PASSWORD={owner}\nREADER_PASSWORD={reader}\nOWNER_DATABASE_URL=postgresql://commerce_owner:{owner}@127.0.0.1:5483/commerce\nDATABASE_URL=postgresql://commerce_reader:{reader}@127.0.0.1:5483/commerce\n')
    p.chmod(0o600)
print('Local credentials ready (.env is private and ignored by Git).')

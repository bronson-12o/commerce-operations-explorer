"""Render capture pages from PostgreSQL catalog rows, source SQL and verification evidence."""
import argparse
from html import escape
import json
import os
from pathlib import Path

import psycopg
from psycopg import sql

from pipeline import ROOT, env

STYLE = """
:root{color:#232743;background:#f7f4ee;font:16px system-ui}body{margin:0}
main{max-width:1160px;margin:auto;padding:30px 24px}
header{color:#903c29;text-transform:uppercase;letter-spacing:2px;font:700 12px system-ui}
h1{font:48px Georgia,serif;letter-spacing:-1.5px;margin:8px 0}
h2{font:24px Georgia,serif;margin:0 0 14px}
p{color:#525772;line-height:1.5;margin:0 0 19px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.steps{grid-template-columns:1fr 1fr}
section{background:#fffdf9;border-top:4px solid #344dc9;padding:18px;min-width:0}
.steps section:nth-child(2),.grid section:nth-child(2){border-color:#b54d35}
dl{margin:0}dt{color:#505778;font-size:12px;text-transform:uppercase;font-weight:700;margin:15px 0 4px}
dd{margin:0 0 6px;font:13px ui-monospace,monospace}
.count{font:30px Georgia,serif;color:#344dc9}
pre,code{font:13px/1.7 ui-monospace,monospace}
pre{background:#eef0ff;padding:15px;white-space:pre-wrap}
li{margin:8px 0;font-size:14px}
small{display:block;margin-top:15px;color:#505778}
@media(max-width:800px){.grid,.steps{grid-template-columns:1fr}}
"""


def page(output, name, headline, subtitle, body):
    path = output / f"{name}.html"
    path.write_text(
        f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{escape(headline)}</title><style>{STYLE}</style></head><body><main>'
        f'<header>Commerce Operations Explorer</header><h1>{escape(headline)}</h1>'
        f'<p>{escape(subtitle)}</p>{body}</main></body></html>'
    )


def schema_cards(connection):
    query = """
        SELECT fact.relname, target.relname,
               pg_get_constraintdef(con.oid, true), con.contype
        FROM pg_constraint con
        JOIN pg_class fact ON fact.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = fact.relnamespace
        LEFT JOIN pg_class target ON target.oid = con.confrelid
        WHERE ns.nspname = 'analytics'
          AND fact.relname IN ('fact_order', 'fact_order_item', 'fact_payment')
          AND con.contype IN ('p', 'f')
        ORDER BY fact.relname, con.contype DESC, target.relname
    """
    constraints = connection.execute(query).fetchall()
    cards = []
    for table in ("fact_order", "fact_order_item", "fact_payment"):
        count = connection.execute(
            sql.SQL("SELECT count(*) FROM analytics.{}").format(sql.Identifier(table))
        ).fetchone()[0]
        keys = [(target, definition, kind) for fact, target, definition, kind in constraints if fact == table]
        primary = next(definition for _, definition, kind in keys if kind == "p")
        references = []
        for target, definition, kind in keys:
            if kind == "f":
                column = definition.split("(", 1)[1].split(")", 1)[0]
                references.append(f"<dd>{escape(column)} → {escape(target)}</dd>")
        cards.append(
            f"<section><h2>{table}</h2><div class='count'>{count:,} rows</div>"
            f"<dl><dt>Grain and primary key</dt><dd>{escape(primary)}</dd>"
            f"<dt>Foreign keys → dimensions</dt>{''.join(references)}</dl></section>"
        )
    return '<div class="grid">' + "".join(cards) + "</div>"


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    env()
    with psycopg.connect(os.environ["OWNER_DATABASE_URL"]) as connection:
        schema = schema_cards(connection)
    page(output, "postgresql-star-schema", "The reporting model in PostgreSQL",
         "Each fact table has its own grain. Shared dimensions let reports use the same dates, customers, and geography.",
         schema + '<small>Source: pg_constraint and row counts from the running project database. Each arrow is a declared foreign key.</small>')

    checks = json.loads((ROOT / "evidence/data-verification.json").read_text())["checks"]
    passing = [check["name"] for check in checks if check["passed"]]
    model_sql = (ROOT / "sql/002_analytics.sql").read_text()
    start = model_sql.index("CREATE TABLE analytics.fact_order_item")
    end = model_sql.index("CREATE TABLE analytics.fact_payment", start)
    excerpt = model_sql[start:end].strip().replace(" ADD FOREIGN KEY", "\n  ADD FOREIGN KEY")
    items = "".join(f"<li>{escape(name)}</li>" for name in passing)
    build = (
        '<div class="grid steps"><section><h2>Model the order items</h2>'
        '<p>SQL source from <code>sql/002_analytics.sql</code></p>'
        f'<pre>{escape(excerpt)}</pre></section>'
        '<section><h2>Reconcile the loaded database</h2>'
        f'<p><code>python scripts/verify.py</code></p><ul>{items}</ul></section></div>'
        '<small>Recreated walkthrough using the actual checked-in SQL and the latest verification run. No credentials or customer-level records are shown.</small>'
    )
    page(output, "building-and-checking", "From SQL to verified records",
         "The order-item grain is enforced in the database. The pipeline is checked against the original Olist files.", build)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    main(parser.parse_args().output)

import pg from 'pg';import {writeFile} from 'node:fs/promises';import {filterSchema,queryFor,descriptions,type QueryId} from '../server/queries';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();const example=(await db.query('SELECT order_id,customer_key FROM api.orders ORDER BY purchased_at DESC LIMIT 1')).rows[0];
const cases=Object.keys(descriptions).map(id=>({id,name:descriptions[id as QueryId],...queryFor(id as QueryId,filterSchema.parse({start:'2017-11-01',end:'2017-11-07',state:'SP',orderId:example.order_id,customerId:example.customer_key,limit:25}))}));
await writeFile('evidence/benchmark-queries.json',JSON.stringify(cases,null,2)+'\n');await db.end();

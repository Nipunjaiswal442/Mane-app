import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
const databaseUrl = new URL(process.env.DATABASE_URL || 'postgres://mane:mane@127.0.0.1:5432/mane');
if (
  !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
  !['localhost', '127.0.0.1', '[::1]', ...(process.env.INTERNAL_HOSTS || '').split(',')].includes(
    databaseUrl.hostname,
  )
)
  throw new Error('Database must be loopback or an explicitly allowed appliance host.');
export const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 10 });
export const db = drizzle(pool, { schema });
export type Queryable = Pick<pg.PoolClient, 'query'>;
export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export function camel(row: Record<string, unknown>): any {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}
export async function rows(sql: string, values: unknown[] = [], client: Queryable = pool): Promise<any[]> {
  return (await client.query(sql, values)).rows.map(camel);
}
export async function one(
  sql: string,
  values: unknown[] = [],
  client: Queryable = pool,
): Promise<any | undefined> {
  return (await rows(sql, values, client))[0];
}

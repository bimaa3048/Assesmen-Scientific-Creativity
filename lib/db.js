import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const globalForPool = globalThis;

export const pool = globalForPool.__assessmentPool || new Pool({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

if (process.env.NODE_ENV !== 'production') globalForPool.__assessmentPool = pool;

let schemaPromise;
export function ensureSchema() {
  if (!schemaPromise) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL wajib diatur ke connection string PostgreSQL.');
    }
    const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
    schemaPromise = readFile(schemaPath, 'utf8')
      .then((schema) => pool.query(schema))
      .catch((error) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

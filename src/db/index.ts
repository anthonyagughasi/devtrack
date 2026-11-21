import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const sqlHost = process.env.SQL_HOST;
    const isRemoteTcpHost = Boolean(
      sqlHost &&
        !sqlHost.startsWith('/') &&
        sqlHost !== 'localhost' &&
        sqlHost !== '127.0.0.1'
    );
    global._postgresPool = new Pool({
      host: sqlHost,
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl:
        process.env.SQL_SSL === 'true' || isRemoteTcpHost
          ? { rejectUnauthorized: false }
          : undefined,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export type Database = typeof db;

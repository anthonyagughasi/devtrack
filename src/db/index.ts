import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import { AppError } from '../server/errors.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

function getConnectionString(): string | undefined {
  const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  return url || undefined;
}

function normalizePem(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
}

function isIpv4Address(host: string | undefined): boolean {
  return Boolean(host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host));
}

export function getDatabaseConfigurationError(): string | null {
  const connectionString = getConnectionString();
  if (connectionString) {
    return null;
  }

  const sqlHost = process.env.SQL_HOST?.trim();
  const sqlUser = process.env.SQL_USER?.trim();
  const sqlDbName = process.env.SQL_DB_NAME?.trim();

  if (process.env.VERCEL && sqlHost?.startsWith('/')) {
    return 'Cloud SQL Auth Proxy Unix sockets (such as /cloudsql/... or /app/cloudsql/...) are not reachable from Vercel. Set SQL_HOST to your Cloud SQL Public IP (with SSL) or set DATABASE_URL in Vercel environment variables.';
  }

  if (!sqlHost || !sqlUser || !sqlDbName) {
    return 'Database connection is not configured for this environment. Set DATABASE_URL (or SQL_HOST, SQL_USER, SQL_PASSWORD, and SQL_DB_NAME) in server environment variables.';
  }

  return null;
}

export function assertDatabaseConfigured(): void {
  const configError = getDatabaseConfigurationError();
  if (configError) {
    throw new AppError(503, configError);
  }
}

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString = getConnectionString();
    const sqlHost = process.env.SQL_HOST?.trim();
    const isRemoteTcpHost = Boolean(
      sqlHost &&
        !sqlHost.startsWith('/') &&
        sqlHost !== 'localhost' &&
        sqlHost !== '127.0.0.1'
    );
    const sslCa = normalizePem(process.env.SQL_SSL_CA);
    const sslCert = normalizePem(process.env.SQL_SSL_CERT);
    const sslKey = normalizePem(process.env.SQL_SSL_KEY);
    const hasCustomTlsCerts = Boolean(sslCa || (sslCert && sslKey));

    const shouldUseSsl =
      hasCustomTlsCerts ||
      process.env.SQL_SSL === 'true' ||
      (process.env.SQL_SSL !== 'false' &&
        (isRemoteTcpHost ||
          Boolean(
            connectionString &&
              !connectionString.includes('localhost') &&
              !connectionString.includes('127.0.0.1')
          )));

    let sslConfig:
      | {
          rejectUnauthorized: boolean;
          ca?: string;
          cert?: string;
          key?: string;
          checkServerIdentity?: () => undefined;
        }
      | undefined;

    if (shouldUseSsl) {
      if (sslCa) {
        let connectionHost = sqlHost;
        if (!connectionHost && connectionString) {
          try {
            connectionHost = new URL(connectionString).hostname;
          } catch {
            connectionHost = undefined;
          }
        }
        const verifyHostname =
          process.env.SQL_SSL_VERIFY_HOSTNAME === 'true' && !isIpv4Address(connectionHost);
        sslConfig = {
          ca: sslCa,
          ...(sslCert && sslKey ? { cert: sslCert, key: sslKey } : {}),
          rejectUnauthorized: true,
          ...(!verifyHostname ? { checkServerIdentity: () => undefined } : {}),
        };
      } else {
        sslConfig = {
          ...(sslCert && sslKey ? { cert: sslCert, key: sslKey } : {}),
          rejectUnauthorized: false,
        };
      }
    }

    global._postgresPool = new Pool({
      ...(connectionString
        ? { connectionString }
        : {
            host: sqlHost,
            port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
            user: process.env.SQL_USER?.trim(),
            password: process.env.SQL_PASSWORD,
            database: process.env.SQL_DB_NAME?.trim(),
          }),
      ssl: sslConfig,
      max: process.env.VERCEL ? 3 : 10,
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


import fs from 'fs';
import {
  AuthTypes,
  Connector,
  GoogleAuth,
  IpAddressTypes,
} from '@google-cloud/cloud-sql-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';
import { AppError } from '../server/errors.ts';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var _postgresPool: Pool | undefined;
  var _postgresPoolKey: string | undefined;
  var _cloudSqlConnector: Connector | undefined;
  var _cloudSqlInitPromise: Promise<Pool> | undefined;
  var _drizzleDb: Database | undefined;
}

function readEnv(key: string): string | undefined {
  const val = process.env[key]?.trim();
  return val || undefined;
}

function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

export function getCloudSqlConnectionName(): string | undefined {
  return (
    readEnv('CLOUD_SQL_CONNECTION_NAME') ??
    readEnv('SQL_INSTANCE_CONNECTION_NAME')
  );
}

function resolveConnectorIpType(): IpAddressTypes {
  const raw = readEnv('CLOUD_SQL_IP_TYPE')?.toUpperCase();
  switch (raw) {
    case 'PRIVATE':
      return IpAddressTypes.PRIVATE;
    case 'PSC':
      return IpAddressTypes.PSC;
    case 'SQL_DATA':
      return IpAddressTypes.SQL_DATA;
    default:
      return IpAddressTypes.PUBLIC;
  }
}

function parseServiceAccountCredentials(rawJson: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { client_email?: unknown }).client_email !== 'string' ||
    typeof (parsed as { private_key?: unknown }).private_key !== 'string'
  ) {
    throw new Error(
      'GCP_SERVICE_ACCOUNT_KEY must include valid service account "client_email" and "private_key" fields.'
    );
  }

  const record = { ...(parsed as Record<string, unknown>) };
  record.private_key = normalizePem(String(record.private_key));
  return record;
}

export function isUnixSocketHost(host: string | undefined): boolean {
  return Boolean(host && host.startsWith('/'));
}

export function getDatabaseConfigurationError(): string | null {
  const connectionName = getCloudSqlConnectionName();
  const sqlHost = readEnv('SQL_HOST');
  const sqlUser = readEnv('SQL_USER');
  const sqlPassword = readEnv('SQL_PASSWORD');
  const sqlDbName = readEnv('SQL_DB_NAME');

  const missingCreds: string[] = [];
  if (!sqlUser) missingCreds.push('SQL_USER');
  if (!sqlPassword) missingCreds.push('SQL_PASSWORD');
  if (!sqlDbName) missingCreds.push('SQL_DB_NAME');

  if (!connectionName && !sqlHost) {
    missingCreds.unshift('CLOUD_SQL_CONNECTION_NAME (or SQL_HOST)');
    return `Cloud SQL database is not configured. Missing server environment variables: ${missingCreds.join(', ')}.`;
  }

  if (missingCreds.length > 0) {
    return `Cloud SQL database configuration is incomplete. Missing server environment variables: ${missingCreds.join(', ')}.`;
  }

  if (connectionName) {
    if (!/^[^:\s]+:[^:\s]+:[^:\s]+$/.test(connectionName)) {
      return 'CLOUD_SQL_CONNECTION_NAME must use the format "<project-id>:<region>:<instance-name>".';
    }

    const saJson = readEnv('GCP_SERVICE_ACCOUNT_KEY');
    if (saJson) {
      try {
        parseServiceAccountCredentials(saJson);
      } catch (err) {
        return err instanceof Error
          ? err.message
          : 'GCP_SERVICE_ACCOUNT_KEY is invalid.';
      }
    }
    return null;
  }

  if (isUnixSocketHost(sqlHost)) {
    if (process.env.VERCEL || !fs.existsSync(sqlHost!)) {
      return `Cloud SQL Auth Proxy Unix socket (${sqlHost}) is not reachable in this runtime. Run inside Google AI Studio / Cloud Run with the mounted socket, or configure CLOUD_SQL_CONNECTION_NAME (with Application Default Credentials or GCP_SERVICE_ACCOUNT_KEY) or Public IP + SQL_SSL_CA.`;
    }
    return null;
  }

  const rawPort = readEnv('SQL_PORT');
  if (rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return 'SQL_PORT must be a valid TCP port between 1 and 65535.';
    }
  }

  return null;
}

export function assertDatabaseConfigured(): void {
  const error = getDatabaseConfigurationError();
  if (error) {
    throw new AppError(503, error);
  }
}

export function resolveTcpSslConfig(
  host: string | undefined
): PoolConfig['ssl'] {
  if (!host || isUnixSocketHost(host)) {
    return undefined;
  }

  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') {
    const explicitMode = readEnv('SQL_SSL_MODE')?.toLowerCase();
    if (!explicitMode || explicitMode === 'disable') {
      return undefined;
    }
  }

  const sslMode = readEnv('SQL_SSL_MODE')?.toLowerCase();
  if (sslMode === 'disable') {
    return undefined;
  }

  const ca = readEnv('SQL_SSL_CA');
  const cert = readEnv('SQL_SSL_CERT');
  const key = readEnv('SQL_SSL_KEY');

  if (sslMode === 'no-verify') {
    return {
      rejectUnauthorized: false,
      ...(ca ? { ca: normalizePem(ca) } : {}),
      ...(cert ? { cert: normalizePem(cert) } : {}),
      ...(key ? { key: normalizePem(key) } : {}),
    };
  }

  return {
    rejectUnauthorized: true,
    ...(ca ? { ca: normalizePem(ca) } : {}),
    ...(cert ? { cert: normalizePem(cert) } : {}),
    ...(key ? { key: normalizePem(key) } : {}),
  };
}

function computePoolConfigKey(): string {
  return JSON.stringify({
    connectionName: getCloudSqlConnectionName() ?? null,
    ipType: readEnv('CLOUD_SQL_IP_TYPE') ?? 'PUBLIC',
    hasSaKey: Boolean(readEnv('GCP_SERVICE_ACCOUNT_KEY')),
    host: readEnv('SQL_HOST') ?? null,
    port: readEnv('SQL_PORT') ?? '5432',
    user: readEnv('SQL_USER') ?? null,
    db: readEnv('SQL_DB_NAME') ?? null,
    sslMode: readEnv('SQL_SSL_MODE') ?? null,
    hasCa: Boolean(readEnv('SQL_SSL_CA')),
    vercel: Boolean(process.env.VERCEL),
  });
}

function buildDirectObjectPoolConfig(): PoolConfig {
  const sqlHost = readEnv('SQL_HOST');
  const rawPort = readEnv('SQL_PORT');
  const port = rawPort ? Number(rawPort) : 5432;

  return {
    host: sqlHost ?? '127.0.0.1',
    ...(!isUnixSocketHost(sqlHost) ? { port } : {}),
    user: readEnv('SQL_USER') ?? 'unconfigured',
    password: readEnv('SQL_PASSWORD') ?? 'unconfigured',
    database: readEnv('SQL_DB_NAME') ?? 'unconfigured',
    ssl: resolveTcpSslConfig(sqlHost),
    max: process.env.VERCEL ? 5 : 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 15000,
  };
}

function attachPoolErrorHandler(pool: Pool): void {
  pool.on('error', (err) => {
    console.error('Unexpected error on idle Cloud SQL pool client:', err);
  });
}

export const createPool = (): Pool => {
  const key = computePoolConfigKey();

  if (!global._postgresPool || global._postgresPoolKey !== key) {
    const pool = new Pool(buildDirectObjectPoolConfig());
    attachPoolErrorHandler(pool);
    global._postgresPool = pool;
    global._postgresPoolKey = key;
    global._drizzleDb = drizzle(pool, { schema });
  }

  return global._postgresPool;
};

export async function ensureDatabaseReady(): Promise<Pool> {
  assertDatabaseConfigured();

  const key = computePoolConfigKey();
  const connectionName = getCloudSqlConnectionName();

  if (!connectionName) {
    return createPool();
  }

  if (global._postgresPool && global._postgresPoolKey === key) {
    return global._postgresPool;
  }

  if (!global._cloudSqlInitPromise) {
    global._cloudSqlInitPromise = (async () => {
      try {
        const saJson = readEnv('GCP_SERVICE_ACCOUNT_KEY');
        const auth = saJson
          ? new GoogleAuth({
              credentials: parseServiceAccountCredentials(saJson),
              scopes: [
                'https://www.googleapis.com/auth/sqlservice.admin',
                'https://www.googleapis.com/auth/cloud-platform',
              ],
            })
          : undefined;

        if (!global._cloudSqlConnector) {
          global._cloudSqlConnector = new Connector(auth ? { auth } : undefined);
        }

        const connectorOpts = await global._cloudSqlConnector.getOptions({
          instanceConnectionName: connectionName,
          ipType: resolveConnectorIpType(),
          authType: AuthTypes.PASSWORD,
        });

        const pool = new Pool({
          ...connectorOpts,
          user: readEnv('SQL_USER'),
          password: readEnv('SQL_PASSWORD'),
          database: readEnv('SQL_DB_NAME'),
          max: process.env.VERCEL ? 5 : 10,
          idleTimeoutMillis: 20000,
          connectionTimeoutMillis: 15000,
        });

        attachPoolErrorHandler(pool);
        global._postgresPool = pool;
        global._postgresPoolKey = key;
        global._drizzleDb = drizzle(pool, { schema });
        return pool;
      } catch (err) {
        global._cloudSqlInitPromise = undefined;
        throw new AppError(
          503,
          'Unable to initialize Google Cloud SQL Connector. Verify CLOUD_SQL_CONNECTION_NAME, GCP_SERVICE_ACCOUNT_KEY permissions (roles/cloudsql.client), and instance network configuration.',
          { cause: err }
        );
      }
    })();
  }

  return global._cloudSqlInitPromise;
}

export function resetPoolForTesting(): void {
  if (global._cloudSqlConnector) {
    try {
      global._cloudSqlConnector.close();
    } catch {
      // Ignore cleanup errors during test reset
    }
  }
  global._cloudSqlConnector = undefined;
  global._cloudSqlInitPromise = undefined;
  global._postgresPool = undefined;
  global._postgresPoolKey = undefined;
  global._drizzleDb = undefined;
}

function getActiveDb(): Database {
  if (!global._drizzleDb || global._postgresPoolKey !== computePoolConfigKey()) {
    if (!getCloudSqlConnectionName()) {
      createPool();
    } else if (!global._drizzleDb) {
      createPool();
    }
  }
  return global._drizzleDb!;
}

// Initialize initial pool instance synchronously when using direct SQL_* Object Method
if (!getCloudSqlConnectionName()) {
  createPool();
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const active = getActiveDb();
    const value = Reflect.get(active as object, prop, receiver);
    return typeof value === 'function' ? value.bind(active) : value;
  },
});

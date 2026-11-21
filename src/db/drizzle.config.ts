import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST?.trim();
const sqlPort = process.env.SQL_PORT?.trim() ? Number(process.env.SQL_PORT.trim()) : 5432;
const sqlDbName = process.env.SQL_DB_NAME?.trim();
const user = process.env.SQL_ADMIN_USER?.trim() || process.env.SQL_USER?.trim();
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;
const sslCa = process.env.SQL_SSL_CA?.trim().replace(/\\n/g, '\n');

if (!sqlHost) {
  throw new Error('SQL_HOST must be set in environment variables.');
}
if (!sqlDbName) {
  throw new Error('SQL_DB_NAME must be set in environment variables.');
}
if (!user) {
  throw new Error('SQL_ADMIN_USER (or SQL_USER) must be set in environment variables.');
}
if (!password) {
  throw new Error('SQL_ADMIN_PASSWORD (or SQL_PASSWORD) must be set in environment variables.');
}

const isUnixSocket = sqlHost.startsWith('/');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: sqlHost,
    ...(!isUnixSocket ? { port: sqlPort } : {}),
    user,
    password,
    database: sqlDbName,
    ssl: isUnixSocket
      ? false
      : sslCa
        ? { ca: sslCa, rejectUnauthorized: true }
        : { rejectUnauthorized: true },
  },
  verbose: true,
});

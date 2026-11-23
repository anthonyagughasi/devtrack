import 'dotenv/config';
import crypto from 'crypto';
import http from 'http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  assertDatabaseConfigured,
  createPool,
  db,
  getDatabaseConfigurationError,
  isUnixSocketHost,
  resetPoolForTesting,
  resolveTcpSslConfig,
} from '../../db/index.ts';
import {
  oauthAccounts,
  passwordResetTokens,
  projects,
  sessions,
  users,
} from '../../db/schema.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../lib/validations.ts';
import { app } from '../../../server.ts';
import vercelHandler from '../../../api/index.mjs';
import { AppError, mapDatabaseError } from '../errors.ts';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import {
  SESSION_COOKIE_NAME,
  changeUserPassword,
  deleteSessionByToken,
  getUserBySessionToken,
  hashToken,
  loginWithEmail,
  registerWithEmail,
  resetPasswordWithToken,
  syncAuthenticatedFirebaseUser,
} from '../services/auth.ts';
import { createProject, listUserProjects } from '../services/projects.ts';
import { createTask, listUserTasks } from '../services/tasks.ts';
import {
  syncFirebaseUserWithExecutor,
  type DbUserRow,
} from '../services/users.ts';

const runSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const createdUserIds: number[] = [];
const createdProjectIds: number[] = [];

const hasLiveCloudSql = !getDatabaseConfigurationError();

afterAll(async () => {
  if (hasLiveCloudSql) {
    if (createdProjectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  }
});

function extractWhereEq(expr: unknown): { columnName: string; value: unknown } {
  const chunks =
    expr && typeof expr === 'object' && 'queryChunks' in expr
      ? ((expr as { queryChunks?: unknown[] }).queryChunks ?? [])
      : [];
  let columnName = '';
  let value: unknown = undefined;
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object') {
      if ('name' in chunk && typeof (chunk as { name?: unknown }).name === 'string') {
        columnName = (chunk as { name: string }).name;
      } else if (
        'encoder' in chunk &&
        'value' in chunk &&
        !('queryChunks' in chunk)
      ) {
        value = (chunk as { value: unknown }).value;
      }
    }
  }
  return { columnName, value };
}

function createInMemoryDrizzleExecutor() {
  let nextUserId = 1;
  let nextOAuthId = 1;
  const userRows: DbUserRow[] = [];
  const oauthRows: Array<{
    id: number;
    userId: number;
    provider: string;
    providerAccountId: string;
    createdAt: Date;
  }> = [];

  const executor = {
    select(projection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          let joinedUsers = false;
          const builder = {
            innerJoin(joinTable: unknown) {
              if (joinTable === users) joinedUsers = true;
              return builder;
            },
            where(whereExpr: unknown) {
              const { columnName, value } = extractWhereEq(whereExpr);
              let results: unknown[] = [];

              if (table === users) {
                results = userRows.filter((u) => {
                  if (columnName === 'uid') return u.uid === value;
                  if (columnName === 'email') return u.email === value;
                  if (columnName === 'id') return u.id === value;
                  return false;
                });
              } else if (table === oauthAccounts && joinedUsers && projection?.user) {
                const matchedLinks = oauthRows.filter((o) => {
                  if (columnName === 'provider_account_id') return o.providerAccountId === value;
                  if (columnName === 'user_id') return o.userId === value;
                  return false;
                });
                results = matchedLinks
                  .map((link) => {
                    const user = userRows.find((u) => u.id === link.userId);
                    return user ? { user } : null;
                  })
                  .filter(Boolean);
              }

              return {
                limit(n: number) {
                  return Promise.resolve(results.slice(0, n));
                },
              };
            },
          };
          return builder;
        },
      };
    },
    insert(table: unknown) {
      return {
        values(payload: Record<string, unknown>) {
          if (table === users) {
            return {
              returning() {
                const now = new Date();
                const row: DbUserRow = {
                  id: nextUserId++,
                  uid: String(payload.uid),
                  name: String(payload.name),
                  email: String(payload.email),
                  passwordHash: null,
                  emailVerifiedAt: (payload.emailVerifiedAt as Date | null) ?? null,
                  avatar: (payload.avatar as string | null) ?? null,
                  role: 'USER',
                  themePreference: 'dark',
                  notifyOnAssign: true,
                  notifyOnComment: true,
                  notifyOnInvite: true,
                  notifyOnDeadline: true,
                  createdAt: now,
                  updatedAt: now,
                };
                userRows.push(row);
                return Promise.resolve([row]);
              },
            };
          }

          if (table === oauthAccounts) {
            return {
              onConflictDoNothing() {
                const exists = oauthRows.some(
                  (r) =>
                    r.provider === payload.provider &&
                    r.providerAccountId === payload.providerAccountId
                );
                if (!exists) {
                  oauthRows.push({
                    id: nextOAuthId++,
                    userId: Number(payload.userId),
                    provider: String(payload.provider),
                    providerAccountId: String(payload.providerAccountId),
                    createdAt: new Date(),
                  });
                }
                return Promise.resolve([]);
              },
            };
          }

          throw new Error('Unsupported table insert in test executor');
        },
      };
    },
    update(table: unknown) {
      return {
        set(updates: Record<string, unknown>) {
          return {
            where(whereExpr: unknown) {
              return {
                returning() {
                  if (table !== users) return Promise.resolve([]);
                  const { columnName, value } = extractWhereEq(whereExpr);
                  const idx = userRows.findIndex((u) =>
                    columnName === 'id' ? u.id === value : false
                  );
                  if (idx === -1) return Promise.resolve([]);
                  userRows[idx] = { ...userRows[idx], ...updates };
                  return Promise.resolve([userRows[idx]]);
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    executor: executor as unknown as Parameters<typeof syncFirebaseUserWithExecutor>[0],
    userRows,
    oauthRows,
  };
}

async function requestApp(
  method: string,
  urlPath: string,
  options?: {
    body?: unknown;
    headers?: Record<string, string>;
    handler?: (req: http.IncomingMessage, res: http.ServerResponse) => unknown;
  }
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  setCookie: string[];
  json: Record<string, unknown>;
}> {
  const targetHandler = options?.handler ?? app;
  const server = http.createServer((req, res) => {
    targetHandler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers ?? {}),
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const headersObj: http.IncomingHttpHeaders = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    const getSetCookie = (
      response.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie;
    const setCookie =
      typeof getSetCookie === 'function'
        ? getSetCookie.call(response.headers)
        : headersObj['set-cookie']
          ? [String(headersObj['set-cookie'])]
          : [];
    return { status: response.status, headers: headersObj, setCookie, json };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function withSavedDbEnv<T>(fn: () => T): T {
  const keys = [
    'CLOUD_SQL_CONNECTION_NAME',
    'SQL_INSTANCE_CONNECTION_NAME',
    'GCP_SERVICE_ACCOUNT_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'CLOUD_SQL_IP_TYPE',
    'SQL_HOST',
    'SQL_PORT',
    'SQL_USER',
    'SQL_PASSWORD',
    'SQL_DB_NAME',
    'SQL_SSL_MODE',
    'SQL_SSL_CA',
    'VERCEL',
  ] as const;

  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }

  const restore = () => {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    resetPoolForTesting();
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(restore) as T;
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

describe('DevTrack Auth Validation Schemas', () => {
  it('enforces strong password rules, confirmation match, and reset token length', () => {
    expect(
      registerSchema.safeParse({
        name: 'Test User',
        email: 'user@example.com',
        password: 'weak',
        confirmPassword: 'weak',
      }).success
    ).toBe(false);

    expect(
      registerSchema.safeParse({
        name: 'Test User',
        email: 'user@example.com',
        password: 'StrongPass1',
        confirmPassword: 'Mismatch1',
      }).success
    ).toBe(false);

    expect(
      registerSchema.safeParse({
        name: 'Test User',
        email: 'User@Example.COM',
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(true);

    expect(loginSchema.safeParse({ email: 'bad', password: '' }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: 'ok@example.com' }).success).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: 'a1b2c3d4e5f6g7h8i9j0',
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: 'short',
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: '',
        newPassword: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(true);
  });
});

describe('Google Cloud SQL Configuration, Connector Validation & Error Mapping', () => {
  it('detects missing SQL_* / CLOUD_SQL_CONNECTION_NAME env vars with actionable messages', () => {
    withSavedDbEnv(() => {
      delete process.env.CLOUD_SQL_CONNECTION_NAME;
      delete process.env.SQL_INSTANCE_CONNECTION_NAME;
      delete process.env.SQL_HOST;
      delete process.env.SQL_USER;
      delete process.env.SQL_PASSWORD;
      delete process.env.SQL_DB_NAME;

      const msg = getDatabaseConfigurationError();
      expect(msg).toContain('CLOUD_SQL_CONNECTION_NAME (or SQL_HOST)');
      expect(msg).toContain('SQL_USER');
      expect(msg).toContain('SQL_PASSWORD');
      expect(msg).toContain('SQL_DB_NAME');
      expect(() => assertDatabaseConfigured()).toThrow(/Cloud SQL database is not configured/);
    });
  });

  it('rejects AI Studio Unix sockets when running on Vercel with actionable diagnostics', () => {
    withSavedDbEnv(() => {
      delete process.env.CLOUD_SQL_CONNECTION_NAME;
      delete process.env.SQL_INSTANCE_CONNECTION_NAME;
      process.env.VERCEL = '1';
      process.env.SQL_HOST = '/app/cloudsql/spatial-campaign-nlvvl:europe-west2:ai-studio-4e7b9940';
      process.env.SQL_USER = 'ai_studio_app_user';
      process.env.SQL_PASSWORD = 'example-password';
      process.env.SQL_DB_NAME = 'cloud_sql_development_database';

      const msg = getDatabaseConfigurationError();
      expect(msg).toContain('not reachable in this runtime');
      expect(msg).toContain('CLOUD_SQL_CONNECTION_NAME');
    });
  });

  it('supports CLOUD_SQL_CONNECTION_NAME natively with ADC and validates optional GCP_SERVICE_ACCOUNT_KEY JSON', () => {
    withSavedDbEnv(() => {
      delete process.env.SQL_HOST;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      process.env.SQL_USER = 'ai_studio_app_user';
      process.env.SQL_PASSWORD = 'example-password';
      process.env.SQL_DB_NAME = 'cloud_sql_development_database';

      process.env.CLOUD_SQL_CONNECTION_NAME = 'invalid-connection-name';
      expect(getDatabaseConfigurationError()).toContain('<project-id>:<region>:<instance-name>');

      process.env.CLOUD_SQL_CONNECTION_NAME =
        'spatial-campaign-nlvvl:europe-west2:ai-studio-4e7b9940';
      delete process.env.GCP_SERVICE_ACCOUNT_KEY;
      // Natively valid using Application Default Credentials (no manual service account key required)
      expect(getDatabaseConfigurationError()).toBeNull();

      process.env.GCP_SERVICE_ACCOUNT_KEY = 'not-json';
      expect(getDatabaseConfigurationError()).toContain('not valid JSON');

      process.env.GCP_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'spatial-campaign-nlvvl' });
      expect(getDatabaseConfigurationError()).toContain('client_email');

      process.env.GCP_SERVICE_ACCOUNT_KEY = JSON.stringify({
        client_email: 'devtrack-sql@spatial-campaign-nlvvl.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n',
      });
      expect(getDatabaseConfigurationError()).toBeNull();
    });
  });

  it('resolves SSL correctly for Unix sockets vs localhost vs remote Public IP + SQL_SSL_CA and sizes Vercel pool', () => {
    withSavedDbEnv(() => {
      expect(
        isUnixSocketHost('/app/cloudsql/spatial-campaign-nlvvl:europe-west2:ai-studio-4e7b9940')
      ).toBe(true);
      expect(
        resolveTcpSslConfig('/app/cloudsql/spatial-campaign-nlvvl:europe-west2:ai-studio-4e7b9940')
      ).toBeUndefined();
      expect(resolveTcpSslConfig('localhost')).toBeUndefined();

      process.env.SQL_SSL_CA = '-----BEGIN CERTIFICATE-----\\nDEMO\\n-----END CERTIFICATE-----';
      expect(resolveTcpSslConfig('34.89.10.20')).toEqual({
        rejectUnauthorized: true,
        ca: '-----BEGIN CERTIFICATE-----\nDEMO\n-----END CERTIFICATE-----',
      });

      process.env.VERCEL = '1';
      delete process.env.CLOUD_SQL_CONNECTION_NAME;
      process.env.SQL_HOST = '34.89.10.20';
      process.env.SQL_USER = 'ai_studio_app_user';
      process.env.SQL_PASSWORD = 'example-password';
      process.env.SQL_DB_NAME = 'cloud_sql_development_database';
      resetPoolForTesting();
      const pool = createPool();
      expect(pool.options.max).toBe(5);
    });
  });

  it('maps PostgreSQL error codes cleanly without opaque 500s', () => {
    const dupErr = mapDatabaseError(
      { cause: { code: '23505', constraint: 'users_email_unique', message: 'duplicate key' } },
      { duplicateMessage: 'An account with this email address already exists.' }
    );
    expect(dupErr?.statusCode).toBe(409);

    const connRefused = mapDatabaseError({
      cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
    });
    expect(connRefused?.statusCode).toBe(503);

    const authErr = mapDatabaseError({
      cause: { code: '28P01', message: 'password authentication failed' },
    });
    expect(authErr?.statusCode).toBe(503);

    const missingTable = mapDatabaseError({
      cause: { code: '42P01', message: 'relation "users" does not exist' },
    });
    expect(missingTable?.statusCode).toBe(503);
    expect(missingTable?.message).toContain('not initialized');
  });
});

describe('Firebase User Sync & Safe Account Linking', () => {
  it('creates user on first sync, prevents duplicate accounts for verified Google overlap, and blocks unverified takeover', async () => {
    const { executor, userRows, oauthRows } = createInMemoryDrizzleExecutor();

    const created = await syncFirebaseUserWithExecutor(executor, {
      uid: 'fb-password-uid-1',
      email: 'Alice.Dev@Example.COM',
      emailVerified: false,
      name: 'Alice Dev',
      provider: 'password',
    });

    expect(created.isNewUser).toBe(true);
    expect(created.user.email).toBe('alice.dev@example.com');
    expect(created.user.emailVerified).toBe(false);
    expect('passwordHash' in created.user).toBe(false);
    expect(userRows.length).toBe(1);
    expect(oauthRows).toHaveLength(1);

    const repeat = await syncFirebaseUserWithExecutor(executor, {
      uid: 'fb-password-uid-1',
      email: 'alice.dev@example.com',
      emailVerified: false,
      name: 'Alice Dev',
      provider: 'password',
    });
    expect(repeat.isNewUser).toBe(false);
    expect(repeat.user.id).toBe(created.user.id);
    expect(userRows.length).toBe(1);

    await expect(
      syncFirebaseUserWithExecutor(executor, {
        uid: 'fb-unverified-attacker-uid',
        email: 'alice.dev@example.com',
        emailVerified: false,
        name: 'Impersonator',
        provider: 'password',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(userRows.length).toBe(1);

    const linkedGoogle = await syncFirebaseUserWithExecutor(executor, {
      uid: 'fb-google-uid-1',
      email: 'alice.dev@example.com',
      emailVerified: true,
      name: 'Alice Dev',
      avatar: 'https://example.com/avatar.png',
      provider: 'google',
    });
    expect(linkedGoogle.isNewUser).toBe(false);
    expect(linkedGoogle.user.id).toBe(created.user.id);
    expect(linkedGoogle.user.emailVerified).toBe(true);
    expect(userRows.length).toBe(1);
    expect(oauthRows.length).toBe(2);
  });
});

describe('Express API & Vercel Serverless Handler Behavior', () => {
  it('serves /api/health, /api/auth/config, /api/auth/logout, and validates /api/auth/google + Vercel catch-all', async () => {
    const health = await requestApp('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json.status).toBe('ok');
    expect(health.json.databaseConfigured).toBe(!getDatabaseConfigurationError());
    expect(health.json.firebaseConfigured).toBe(true);

    const config = await requestApp('GET', '/api/auth/config');
    expect(config.status).toBe(200);
    expect(config.json).toEqual({
      firebaseConfigured: true,
      googleConfigured: true,
      emailConfigured: false,
      emailVerificationEnforced: false,
    });

    if (hasLiveCloudSql) {
      const missingToken = await requestApp('POST', '/api/auth/google', { body: {} });
      expect(missingToken.status).toBe(400);

      const verifySpy = vi
        .spyOn(adminAuth, 'verifyIdToken')
        .mockRejectedValueOnce(new Error('Invalid token'));
      try {
        const invalidToken = await requestApp('POST', '/api/auth/google', {
          body: { idToken: 'bad-token' },
        });
        expect(invalidToken.status).toBe(401);
      } finally {
        verifySpy.mockRestore();
      }
    }

    const logout = await requestApp('POST', '/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.json.success).toBe(true);

    const vercelHealth = await requestApp(
      'GET',
      '/api/index.mjs?__vercel_path=health',
      { handler: vercelHandler }
    );
    expect(vercelHealth.status).toBe(200);
    expect(vercelHealth.json.status).toBe('ok');
  });

  it('returns 503 with clear Cloud SQL guidance when DB env vars are unconfigured', async () => {
    await withSavedDbEnv(async () => {
      delete process.env.CLOUD_SQL_CONNECTION_NAME;
      delete process.env.SQL_INSTANCE_CONNECTION_NAME;
      delete process.env.SQL_HOST;
      delete process.env.SQL_USER;
      delete process.env.SQL_PASSWORD;
      delete process.env.SQL_DB_NAME;
      resetPoolForTesting();

      const req = { cookies: {}, headers: {} } as unknown as AuthRequest;
      const res = {
        status() {
          return this;
        },
        json() {
          return this;
        },
      } as unknown as Parameters<typeof requireAuth>[1];

      let passedError: unknown = null;
      await requireAuth(req, res, (err?: unknown) => {
        passedError = err ?? null;
      });
      expect(passedError).toBeInstanceOf(AppError);
      expect((passedError as AppError).statusCode).toBe(503);

      const regRes = await requestApp('POST', '/api/auth/register', {
        body: {
          name: 'Test User',
          email: 'unconfigured@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        },
      });
      expect(regRes.status).toBe(503);
      expect(String(regRes.json.error)).toContain('CLOUD_SQL_CONNECTION_NAME');
    });
  });
});

describe.runIf(hasLiveCloudSql)(
  'DevTrack Live Google Cloud SQL Integration Workflows (AI Studio PostgreSQL)',
  () => {
    const email = `cloudsql-auth-${runSuffix}@example.com`;
    const password = 'CloudSqlPass123!';
    const updatedPassword = 'UpdatedCloudSql456!';
    const googleUid = `fb-google-${runSuffix}`;
    let userId = 0;
    let sessionCookieHeader = '';
    let activeSessionToken = '';

    it('0. preserves existing Cloud SQL database records untouched', async () => {
      const counts = await db.execute(
        sql`SELECT count(*)::int AS user_count FROM users`
      );
      const countRow = counts.rows[0] as { user_count?: number } | undefined;
      expect(Number(countRow?.user_count ?? 0)).toBeGreaterThanOrEqual(1);
    });

    it('1. registers directly via POST /api/auth/register (immediate access, no email verification blocker) and rejects duplicate email', async () => {
      const res = await requestApp('POST', '/api/auth/register', {
        body: {
          name: 'Cloud SQL Test Engineer',
          email,
          password,
          confirmPassword: password,
        },
      });

      expect(res.status).toBe(201);
      expect(res.json.requiresVerification).toBe(false);
      const userObj = res.json.user as { id: number; email: string };
      expect(userObj.email).toBe(email.toLowerCase());
      expect(res.setCookie.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);

      userId = userObj.id;
      createdUserIds.push(userId);

      const rawCookie = res.setCookie.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
      sessionCookieHeader = rawCookie.split(';')[0] ?? '';
      expect(sessionCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);

      await expect(
        registerWithEmail({
          name: 'Duplicate',
          email,
          password,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('2. logs in with email/password via POST /api/auth/login and rejects wrong password with 401', async () => {
      const badLogin = await requestApp('POST', '/api/auth/login', {
        body: { email, password: 'WrongPassword123!' },
      });
      expect(badLogin.status).toBe(401);

      const goodLogin = await requestApp('POST', '/api/auth/login', {
        body: { email, password },
      });
      expect(goodLogin.status).toBe(200);
      expect((goodLogin.json.user as { id: number }).id).toBe(userId);

      const rawCookie =
        goodLogin.setCookie.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
      sessionCookieHeader = rawCookie.split(';')[0] ?? '';
      activeSessionToken = sessionCookieHeader.replace(`${SESSION_COOKIE_NAME}=`, '');

      const verifiedUser = await getUserBySessionToken(activeSessionToken);
      expect(verifiedUser?.id).toBe(userId);

      // Clean direct service check
      const svcLogin = await loginWithEmail({ email, password, userAgent: 'Vitest/Login' });
      expect(svcLogin.user.id).toBe(userId);
      await deleteSessionByToken(svcLogin.sessionToken);
    });

    it('3. links verified Google Firebase sign-in via POST /api/auth/google without creating duplicate users', async () => {
      const decodedGoogle = {
        uid: googleUid,
        email,
        email_verified: true,
        name: 'Cloud SQL Test Engineer',
        picture: 'https://example.com/pic.png',
        firebase: { sign_in_provider: 'google.com' },
      } as unknown as DecodedIdToken;

      const verifySpy = vi.spyOn(adminAuth, 'verifyIdToken').mockResolvedValueOnce(decodedGoogle);
      try {
        const res = await requestApp('POST', '/api/auth/google', {
          body: { idToken: 'mocked-google-id-token' },
        });
        expect(res.status).toBe(200);
        expect((res.json.user as { id: number; emailVerified: boolean }).id).toBe(userId);
        expect((res.json.user as { emailVerified: boolean }).emailVerified).toBe(true);
      } finally {
        verifySpy.mockRestore();
      }

      const oauthRows = await db
        .select()
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, userId));
      expect(oauthRows.some((r) => r.providerAccountId === googleUid)).toBe(true);
    });

    it('4. creates projects and tasks via API/services, verifies persistence, updates & resets password cleanly, and logs out', async () => {
      // Create project and task via HTTP endpoints using the session cookie
      const projRes = await requestApp('POST', '/api/projects', {
        headers: { Cookie: sessionCookieHeader },
        body: {
          name: `Cloud SQL Project ${runSuffix}`,
          description: 'Verifying Drizzle persistence in Cloud SQL',
          status: 'ACTIVE',
        },
      });
      expect(projRes.status).toBe(201);
      const createdProj = projRes.json.project as { id: number; name: string };
      createdProjectIds.push(createdProj.id);

      const taskRes = await requestApp('POST', '/api/tasks', {
        headers: { Cookie: sessionCookieHeader },
        body: {
          projectId: createdProj.id,
          title: 'Verify Cloud SQL task',
          description: 'End-to-end check',
          status: 'TODO',
          priority: 'HIGH',
        },
      });
      expect(taskRes.status).toBe(201);
      expect((taskRes.json.task as { projectId: number }).projectId).toBe(createdProj.id);

      const accessibleProjects = await listUserProjects(userId, {});
      expect(accessibleProjects.some((p) => p.id === createdProj.id)).toBe(true);

      const accessibleTasks = await listUserTasks(userId, { projectId: createdProj.id });
      expect(accessibleTasks.length).toBe(1);

      // Update password while signed in
      const passRes = await requestApp('PATCH', '/api/me/password', {
        headers: { Cookie: sessionCookieHeader },
        body: {
          currentPassword: password,
          newPassword: updatedPassword,
          confirmPassword: updatedPassword,
        },
      });
      expect(passRes.status).toBe(200);

      // Forgot-password responds honestly without 500
      const forgotRes = await requestApp('POST', '/api/auth/forgot-password', {
        body: { email },
      });
      expect(forgotRes.status).toBe(200);
      expect(forgotRes.json.emailConfigured).toBe(false);

      // Direct reset token workflow verification
      const rawResetToken = crypto.randomBytes(24).toString('hex');
      await db.insert(passwordResetTokens).values({
        userId,
        tokenHash: hashToken(rawResetToken),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      const resetRes = await resetPasswordWithToken(rawResetToken, password);
      expect(resetRes.success).toBe(true);

      // Logout clears sessions cleanly and subsequent /api/me returns 401
      const nextLogin = await loginWithEmail({ email, password, userAgent: 'Vitest/PostReset' });
      const logoutRes = await requestApp('POST', '/api/auth/logout', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${nextLogin.sessionToken}` },
      });
      expect(logoutRes.status).toBe(200);
      expect(await getUserBySessionToken(nextLogin.sessionToken)).toBeNull();

      const meAfterLogout = await requestApp('GET', '/api/me', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${nextLogin.sessionToken}` },
      });
      expect(meAfterLogout.status).toBe(401);

      // Clean up any leftover sessions for the test user
      await db.delete(sessions).where(eq(sessions.userId, userId));
      // Unused direct helper sanity check
      const helperProject = await createProject(userId, {
        name: `Direct Project ${runSuffix}`,
        description: '',
        status: 'PLANNING',
      });
      createdProjectIds.push(helperProject.id);
      const helperTask = await createTask(userId, {
        projectId: helperProject.id,
        title: 'Direct Task',
        description: '',
        status: 'TODO',
        priority: 'MEDIUM',
      });
      expect(helperTask.projectId).toBe(helperProject.id);

      // Also test direct syncAuthenticatedFirebaseUser helper
      const directSync = await syncAuthenticatedFirebaseUser({
        uid: googleUid,
        email,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      } as unknown as DecodedIdToken);
      expect(directSync.user.id).toBe(userId);
      await deleteSessionByToken(directSync.sessionToken);

      await expect(
        changeUserPassword(userId, 'WrongCurrent1!', 'AnotherPass123!')
      ).rejects.toMatchObject({ statusCode: 401 });
    });
  }
);

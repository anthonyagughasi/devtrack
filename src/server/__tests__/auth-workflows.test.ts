import 'dotenv/config';
import http from 'http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  assertDatabaseConfigured,
  createPool,
  db,
  getDatabaseConfigurationError,
  resetPoolForTesting,
  resolveSslConfig,
} from '../../db/index.ts';
import { oauthAccounts, sessions, users } from '../../db/schema.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
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
  createSessionRecord,
  deleteSessionByToken,
  getUserBySessionToken,
  syncAuthenticatedFirebaseUser,
} from '../services/auth.ts';
import { createProject, listUserProjects } from '../services/projects.ts';
import { createTask } from '../services/tasks.ts';
import {
  syncFirebaseUserWithExecutor,
  type DbUserRow,
} from '../services/users.ts';

const runSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const createdUserIds: number[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0 && process.env.DATABASE_URL) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
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
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: Record<string, unknown> }> {
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
    return { status: response.status, headers: headersObj, json };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe('DevTrack Auth Validation Schemas', () => {
  it('enforces strong password rules, confirmation match, and Firebase reset oobCode', () => {
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
        oobCode: 'firebase-oob-code-12345',
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        oobCode: 'bad',
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(false);
  });
});

describe('Neon PostgreSQL DATABASE_URL & Error Mapping', () => {
  it('validates DATABASE_URL exclusively without any legacy Cloud SQL env vars', () => {
    const savedDatabaseUrl = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(getDatabaseConfigurationError()).toContain('DATABASE_URL');
      expect(getDatabaseConfigurationError()).toContain('Neon');
      expect(() => assertDatabaseConfigured()).toThrow(/DATABASE_URL/);

      process.env.DATABASE_URL = 'not-a-url';
      expect(getDatabaseConfigurationError()).toContain('not a valid PostgreSQL');

      process.env.DATABASE_URL = 'mysql://user:pass@host/db';
      expect(getDatabaseConfigurationError()).toContain('postgres://');

      process.env.DATABASE_URL =
        'postgresql://neondb_owner:secret@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
      expect(getDatabaseConfigurationError()).toBeNull();
      expect(() => assertDatabaseConfigured()).not.toThrow();
    } finally {
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDatabaseUrl;
      resetPoolForTesting();
    }
  });

  it('resolves strict SSL for Neon URLs and appropriate modes for local URLs', () => {
    expect(
      resolveSslConfig(
        'postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require'
      )
    ).toEqual({ rejectUnauthorized: true });

    expect(
      resolveSslConfig('postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb')
    ).toEqual({ rejectUnauthorized: true });

    expect(resolveSslConfig('postgresql://postgres:postgres@localhost:5432/devtrack')).toBeUndefined();
    expect(
      resolveSslConfig('postgresql://user:pass@db.example.com:5432/devtrack?sslmode=disable')
    ).toBeUndefined();
    expect(
      resolveSslConfig('postgresql://user:pass@db.example.com:5432/devtrack?sslmode=no-verify')
    ).toEqual({ rejectUnauthorized: false });

    const savedUrl = process.env.DATABASE_URL;
    const savedVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = '1';
      process.env.DATABASE_URL =
        'postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require';
      resetPoolForTesting();
      const pool = createPool();
      expect(pool.options.max).toBe(5);
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
      if (savedVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = savedVercel;
      resetPoolForTesting();
    }
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

    const missingTable = mapDatabaseError({
      cause: { code: '42P01', message: 'relation "users" does not exist' },
    });
    expect(missingTable?.statusCode).toBe(503);
    expect(missingTable?.message).toContain('not initialized');
  });
});

describe('Firebase User Sync & Safe Account Linking', () => {
  it('creates user on first sync, prevents duplicate accounts for verified Google/password overlap, and blocks unverified takeover', async () => {
    const { executor, userRows, oauthRows } = createInMemoryDrizzleExecutor();

    // 1. Direct email/password registration via Firebase (unverified allowed immediately)
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
    expect(oauthRows[0]).toMatchObject({
      userId: created.user.id,
      provider: 'password',
      providerAccountId: 'fb-password-uid-1',
    });

    // 2. Repeat sign-in with same UID does not create duplicate row
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

    // 3. Unverified different UID claiming same email is rejected with 409
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

    // 4. Verified Google OAuth UID with same email links safely without creating duplicate user
    const linkedGoogle = await syncFirebaseUserWithExecutor(executor, {
      uid: 'fb-google-uid-1',
      email: 'alice.dev@example.com',
      emailVerified: true,
      name: 'Alice Dev',
      avatar: 'https://example.com/avatar.png',
      provider: 'google.com',
    });
    expect(linkedGoogle.isNewUser).toBe(false);
    expect(linkedGoogle.user.id).toBe(created.user.id);
    expect(linkedGoogle.user.uid).toBe('fb-password-uid-1');
    expect(linkedGoogle.user.emailVerified).toBe(true);
    expect(linkedGoogle.user.avatar).toBe('https://example.com/avatar.png');
    expect(userRows.length).toBe(1);
    expect(oauthRows.length).toBe(2);

    // 5. Subsequent sign-in with the linked Google UID resolves via oauth_accounts
    const googleAgain = await syncFirebaseUserWithExecutor(executor, {
      uid: 'fb-google-uid-1',
      email: 'alice.dev@example.com',
      emailVerified: true,
      provider: 'google.com',
    });
    expect(googleAgain.isNewUser).toBe(false);
    expect(googleAgain.user.id).toBe(created.user.id);
    expect(userRows.length).toBe(1);
  });
});

describe('Express API & Vercel Serverless Handler Behavior', () => {
  it('serves /api/health, /api/auth/config, /api/auth/logout, and validates /api/auth/session', async () => {
    const health = await requestApp('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json.status).toBe('ok');
    expect(health.json.databaseConfigured).toBe(Boolean(process.env.DATABASE_URL));
    expect(health.json.firebaseConfigured).toBe(true);

    const config = await requestApp('GET', '/api/auth/config');
    expect(config.status).toBe(200);
    expect(config.json).toEqual({
      firebaseConfigured: true,
      googleConfigured: true,
      emailVerificationEnforced: false,
    });

    const missingToken = await requestApp('POST', '/api/auth/session', { body: {} });
    expect(missingToken.status).toBe(400);

    const verifySpy = vi
      .spyOn(adminAuth, 'verifyIdToken')
      .mockRejectedValueOnce(new Error('Invalid token'));
    try {
      const invalidToken = await requestApp('POST', '/api/auth/session', {
        body: { idToken: 'bad-token' },
      });
      expect(invalidToken.status).toBe(401);
    } finally {
      verifySpy.mockRestore();
    }

    const logout = await requestApp('POST', '/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.json.success).toBe(true);

    // Vercel rewrite wrapper preserves /api/health & /api/auth/config routing
    const vercelHealth = await requestApp(
      'GET',
      '/api/index.mjs?__vercel_path=health',
      { handler: vercelHandler }
    );
    expect(vercelHealth.status).toBe(200);
    expect(vercelHealth.json.status).toBe('ok');
  });

  it('requireAuth returns 503 when DATABASE_URL is missing and 401 when unauthenticated', async () => {
    const savedDatabaseUrl = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
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

      const protectedRes = await requestApp('GET', '/api/me');
      expect(protectedRes.status).toBe(503);
    } finally {
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDatabaseUrl;
    }
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))(
  'DevTrack Live Neon PostgreSQL Integration Workflows',
  () => {
    const email = `neon-auth-${runSuffix}@example.com`;
    const primaryUid = `fb-primary-${runSuffix}`;
    const googleUid = `fb-google-${runSuffix}`;
    let userId = 0;
    let activeSessionToken = '';

    it('1. syncs direct Firebase email/password registration immediately into Neon and creates a session', async () => {
      const decoded = {
        uid: primaryUid,
        email,
        email_verified: false,
        name: 'Neon Test Engineer',
        firebase: { sign_in_provider: 'password' },
      } as unknown as DecodedIdToken;

      const res = await syncAuthenticatedFirebaseUser(decoded, {
        userAgent: 'Vitest/Neon-Register',
      });
      userId = res.user.id;
      createdUserIds.push(userId);
      activeSessionToken = res.sessionToken;

      expect(res.isNewUser).toBe(true);
      expect(res.user.email).toBe(email.toLowerCase());
      expect(res.user.emailVerified).toBe(false);
      expect(res.sessionToken).toBeTruthy();

      const sessionUser = await getUserBySessionToken(activeSessionToken);
      expect(sessionUser?.id).toBe(userId);
    });

    it('2. links verified Google sign-in to the same PostgreSQL user without creating duplicates', async () => {
      const decodedGoogle = {
        uid: googleUid,
        email,
        email_verified: true,
        name: 'Neon Test Engineer',
        picture: 'https://example.com/pic.png',
        firebase: { sign_in_provider: 'google.com' },
      } as unknown as DecodedIdToken;

      const res = await syncAuthenticatedFirebaseUser(decodedGoogle, {
        userAgent: 'Vitest/Neon-Google',
      });
      expect(res.isNewUser).toBe(false);
      expect(res.user.id).toBe(userId);
      expect(res.user.emailVerified).toBe(true);
      await deleteSessionByToken(res.sessionToken);

      const oauthRows = await db
        .select()
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, userId));
      expect(oauthRows.length).toBe(2);
    });

    it('3. creates projects & tasks, reads workspace, and invalidates sessions cleanly on logout', async () => {
      const project = await createProject(userId, {
        name: `Neon Verification Project ${runSuffix}`,
        description: 'End-to-end Neon workflow verification',
        status: 'ACTIVE',
      });
      const task = await createTask(userId, {
        projectId: project.id,
        title: 'Verify Neon persistence',
        description: 'Ensure tasks persist after Firebase session sync',
        status: 'TODO',
        priority: 'HIGH',
      });
      expect(task.projectId).toBe(project.id);

      const accessible = await listUserProjects(userId, {});
      expect(accessible.some((p) => p.id === project.id)).toBe(true);

      // requireAuth succeeds with valid session cookie
      const req = {
        cookies: { [SESSION_COOKIE_NAME]: activeSessionToken },
        headers: {},
      } as unknown as AuthRequest;
      let nextCalled = false;
      const res = {
        status() {
          return this;
        },
        json() {
          return this;
        },
      } as unknown as Parameters<typeof requireAuth>[1];

      await requireAuth(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(req.dbUser?.id).toBe(userId);

      // Logout removes session from Neon DB and subsequent requireAuth returns 401
      await deleteSessionByToken(activeSessionToken);
      expect(await getUserBySessionToken(activeSessionToken)).toBeNull();

      const remainingSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      expect(remainingSessions.length).toBe(0);

      let unauthStatus = 0;
      let unauthNext = false;
      const unauthRes = {
        status(code: number) {
          unauthStatus = code;
          return this;
        },
        json() {
          return this;
        },
      } as unknown as Parameters<typeof requireAuth>[1];

      await requireAuth(req, unauthRes, () => {
        unauthNext = true;
      });
      expect(unauthNext).toBe(false);
      expect(unauthStatus).toBe(401);
    });
  }
);

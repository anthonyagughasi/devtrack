import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { db } from '../../db/index.ts';
import {
  emailVerificationTokens,
  oauthAccounts,
  passwordResetTokens,
  sessions,
  users,
} from '../../db/schema.ts';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../lib/validations.ts';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import {
  DEFAULT_DEV_SENDER,
  getResendConfig,
  getSmtpConfig,
} from '../services/email.ts';
import {
  SESSION_COOKIE_NAME,
  authenticateWithGoogleToken,
  changeUserPassword,
  createSessionRecord,
  deleteSessionByToken,
  generateSecureToken,
  getUserBySessionToken,
  hashToken,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from '../services/auth.ts';

const runSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const createdUserIds: number[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe('DevTrack Auth Validation Schemas', () => {
  it('enforces strong password rules and confirmation match', () => {
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
        token: 'a'.repeat(32),
        password: 'StrongPass1',
        confirmPassword: 'StrongPass1',
      }).success
    ).toBe(true);
  });

  it('reads exact Resend and SMTP env variable names with onboarding@resend.dev default', () => {
    const saved = {
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      EMAIL_FROM: process.env.EMAIL_FROM,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
    };

    try {
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_USER = 'resend';
      process.env.SMTP_PASS = 're_test_pass';
      delete process.env.EMAIL_FROM;
      process.env.RESEND_API_KEY = 're_test_api';

      const smtp = getSmtpConfig();
      expect(smtp).toEqual({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        user: 'resend',
        pass: 're_test_pass',
        from: DEFAULT_DEV_SENDER,
      });

      process.env.EMAIL_FROM = 'DevTrack <onboarding@resend.dev>';
      expect(getSmtpConfig()?.from).toBe('DevTrack <onboarding@resend.dev>');
      expect(getResendConfig()).toEqual({
        apiKey: 're_test_api',
        from: 'DevTrack <onboarding@resend.dev>',
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('DevTrack Authentication Workflows (Live Cloud SQL PostgreSQL)', () => {
  const email = `auth-test-${runSuffix}@example.com`;
  const password = 'DevTrack123!';
  const newPassword = 'UpdatedPass456!';
  let userId = 0;
  let activeSessionToken = '';

  it('1. registers a user with bcrypt password hash and never returns passwordHash', async () => {
    const res = await registerWithEmail({
      name: 'Auth Test Engineer',
      email,
      password,
      baseUrl: 'http://localhost:3000',
      userAgent: 'Vitest/1.0',
    });

    userId = res.user.id;
    createdUserIds.push(userId);

    expect(res.user.email).toBe(email.toLowerCase());
    expect(res.user.hasPassword).toBe(true);
    expect('passwordHash' in res.user).toBe(false);
    expect(res.requiresVerification).toBe(false);
    expect(res.sessionToken).toBeTruthy();
    activeSessionToken = res.sessionToken!;

    const [dbRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(dbRow).toBeDefined();
    expect(dbRow.passwordHash).toBeTruthy();
    expect(dbRow.passwordHash).not.toBe(password);
    expect(dbRow.passwordHash!.startsWith('$2')).toBe(true);

    const verifyRows = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
    expect(verifyRows.length).toBe(0);
  });

  it('2. rejects duplicate email registration with 409', async () => {
    await expect(
      registerWithEmail({
        name: 'Duplicate User',
        email: email.toUpperCase(),
        password,
        baseUrl: 'http://localhost:3000',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('3. logs in with valid email and password and issues a database session', async () => {
    const res = await loginWithEmail({
      email,
      password,
      userAgent: 'Vitest/Login',
    });

    expect(res.user.id).toBe(userId);
    expect(res.sessionToken).toBeTruthy();
    activeSessionToken = res.sessionToken;
  });

  it('4. rejects incorrect password with 401', async () => {
    await expect(
      loginWithEmail({
        email,
        password: 'WrongPassword99!',
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('5. authenticates via Google token, links oauth_accounts, and marks email verified', async () => {
    const googleEmail = `google-test-${runSuffix}@example.com`;
    const googleUid = `google-uid-${runSuffix}`;
    const fakeDecoded = {
      uid: googleUid,
      email: googleEmail,
      email_verified: true,
      name: 'Google Test User',
      picture: null,
    } as unknown as DecodedIdToken;

    const res = await authenticateWithGoogleToken(fakeDecoded, 'Vitest/Google');
    createdUserIds.push(res.user.id);

    expect(res.user.email).toBe(googleEmail);
    expect(res.user.emailVerified).toBe(true);
    expect(res.sessionToken).toBeTruthy();

    const oauthRows = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, res.user.id));
    expect(oauthRows.length).toBe(1);
    expect(oauthRows[0].provider).toBe('google');
    expect(oauthRows[0].providerAccountId).toBe(googleUid);

    await deleteSessionByToken(res.sessionToken);
  });

  it('6. handles forgot-password honestly when email provider is not configured', async () => {
    const hasEmail = Boolean(
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
        (process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
    );
    const res = await requestPasswordReset(email, 'http://localhost:3000');
    expect(res.emailConfigured).toBe(hasEmail);
    if (!hasEmail) {
      expect(res.sent).toBe(false);
      expect(res.message).toContain('SMTP_HOST');
    }
  });

  it('7, 8 & 9. resets password with valid token, invalidates old sessions, rejects expired & reused tokens', async () => {
    // Seed an expired reset token and verify rejection
    const expiredRaw = generateSecureToken();
    await db.insert(passwordResetTokens).values({
      userId,
      tokenHash: hashToken(expiredRaw),
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      resetPasswordWithToken(expiredRaw, newPassword)
    ).rejects.toMatchObject({ statusCode: 400 });

    // Seed a valid reset token
    const validRaw = generateSecureToken();
    await db.insert(passwordResetTokens).values({
      userId,
      tokenHash: hashToken(validRaw),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const resetRes = await resetPasswordWithToken(validRaw, newPassword);
    expect(resetRes.success).toBe(true);

    // Existing sessions must be invalidated
    const oldSessionUser = await getUserBySessionToken(activeSessionToken);
    expect(oldSessionUser).toBeNull();

    // Reuse of reset token must fail
    await expect(
      resetPasswordWithToken(validRaw, 'AnotherPass789!')
    ).rejects.toMatchObject({ statusCode: 400 });

    // Old password fails, new password succeeds
    await expect(loginWithEmail({ email, password })).rejects.toMatchObject({
      statusCode: 401,
    });
    const relogin = await loginWithEmail({ email, password: newPassword });
    activeSessionToken = relogin.sessionToken;
    expect(relogin.user.id).toBe(userId);
  });

  it('10. does not block login for unverified email and still supports verifyEmailWithToken', async () => {
    // Even if REQUIRE_EMAIL_VERIFICATION=true is set, unverified email/password accounts can sign in directly
    const prevFlag = process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    try {
      const directLogin = await loginWithEmail({ email, password: newPassword });
      expect(directLogin.user.id).toBe(userId);
      expect(directLogin.sessionToken).toBeTruthy();
      await deleteSessionByToken(directLogin.sessionToken);
    } finally {
      if (prevFlag === undefined) {
        delete process.env.REQUIRE_EMAIL_VERIFICATION;
      } else {
        process.env.REQUIRE_EMAIL_VERIFICATION = prevFlag;
      }
    }

    // Expired verification token rejected
    const expiredVerify = generateSecureToken();
    await db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(expiredVerify),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(verifyEmailWithToken(expiredVerify)).rejects.toMatchObject({
      statusCode: 400,
    });

    // Valid verification token succeeds and cannot be reused
    const validVerify = generateSecureToken();
    await db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(validVerify),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const verified = await verifyEmailWithToken(validVerify);
    expect(verified.success).toBe(true);

    await expect(verifyEmailWithToken(validVerify)).rejects.toMatchObject({
      statusCode: 400,
    });

    const userFromSession = await getUserBySessionToken(activeSessionToken);
    expect(userFromSession?.emailVerified).toBe(true);
  });

  it('11, 12 & 13. persists session, protects requireAuth middleware, updates password, and invalidates on logout', async () => {
    // Protected middleware succeeds with valid session cookie
    const req = {
      cookies: { [SESSION_COOKIE_NAME]: activeSessionToken },
      headers: {},
    } as unknown as AuthRequest;
    let statusAssigned = 200;
    const res = {
      status(code: number) {
        statusAssigned = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Parameters<typeof requireAuth>[1];

    let nextCalled = false;
    await requireAuth(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(statusAssigned).toBe(200);
    expect(req.dbUser?.id).toBe(userId);

    // Change password in settings
    await changeUserPassword(userId, newPassword, 'FinalPass999!');
    const freshSession = await createSessionRecord(userId, 'Vitest/Final');
    expect(await getUserBySessionToken(freshSession)).not.toBeNull();

    // Logout removes session from DB
    await deleteSessionByToken(activeSessionToken);
    await deleteSessionByToken(freshSession);
    expect(await getUserBySessionToken(activeSessionToken)).toBeNull();

    const dbSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(dbSessions.length).toBe(0);

    // Protected middleware rejects invalidated cookie with 401
    const unauthReq = {
      cookies: { [SESSION_COOKIE_NAME]: activeSessionToken },
      headers: {},
    } as unknown as AuthRequest;
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

    await requireAuth(unauthReq, unauthRes, () => {
      unauthNext = true;
    });
    expect(unauthNext).toBe(false);
    expect(unauthStatus).toBe(401);
  });
});

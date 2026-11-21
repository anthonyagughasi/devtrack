import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { db } from '../../db/index.ts';
import {
  emailVerificationTokens,
  oauthAccounts,
  passwordResetTokens,
  sessions,
  users,
} from '../../db/schema.ts';
import { AppError } from '../errors.ts';
import {
  getMissingEmailConfigMessage,
  isEmailProviderConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './email.ts';
import { syncPendingInvitationNotificationsForUser } from './team.ts';
import { getOrCreateUser, sanitizeUser, type UserRecord } from './users.ts';

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const SESSION_COOKIE_NAME = 'devtrack_session';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isEmailVerificationEnforced(): boolean {
  return false;
}

export async function createSessionRecord(
  userId: number,
  userAgent?: string
): Promise<string> {
  try {
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await db.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });

    return rawToken;
  } catch (error) {
    console.error('Failed to create database session:', error);
    throw new AppError(500, 'Failed to create authentication session.', { cause: error });
  }
}

export async function getUserBySessionToken(
  rawToken: string
): Promise<UserRecord | null> {
  try {
    const tokenHash = hashToken(rawToken);
    const rows = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (rows.length === 0) return null;
    return sanitizeUser(rows[0].user);
  } catch (error) {
    console.error('Failed to validate session:', error);
    throw new AppError(500, 'Failed to validate session.', { cause: error });
  }
}

export async function deleteSessionByToken(rawToken: string): Promise<void> {
  try {
    const tokenHash = hashToken(rawToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  } catch (error) {
    console.error('Failed to delete session:', error);
    throw new AppError(500, 'Failed to sign out cleanly.', { cause: error });
  }
}

export async function registerWithEmail(input: {
  name: string;
  email: string;
  password: string;
  baseUrl: string;
  userAgent?: string;
}) {
  try {
    const cleanEmail = input.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (existing) {
      throw new AppError(409, 'An account with this email address already exists.');
    }

    const passwordHash = await hashPassword(input.password);

    const createdUser = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(users)
        .values({
          uid: `local_${crypto.randomUUID()}`,
          name: input.name.trim(),
          email: cleanEmail,
          passwordHash,
          emailVerifiedAt: null,
        })
        .returning();

      await syncPendingInvitationNotificationsForUser(tx, inserted.id);

      return inserted;
    });

    const sessionToken = await createSessionRecord(createdUser.id, input.userAgent);

    return {
      user: sanitizeUser(createdUser),
      requiresVerification: false,
      emailConfigured: isEmailProviderConfigured(),
      sessionToken,
      message: 'Account created successfully.',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Email registration failed:', error);
    throw new AppError(500, 'Failed to create account.', { cause: error });
  }
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
  userAgent?: string;
}) {
  try {
    const cleanEmail = input.email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError(401, 'Invalid email address or password.');
    }

    const matches = await verifyPassword(input.password, user.passwordHash);
    if (!matches) {
      throw new AppError(401, 'Invalid email address or password.');
    }

    await syncPendingInvitationNotificationsForUser(db, user.id);

    const sessionToken = await createSessionRecord(user.id, input.userAgent);
    return {
      user: sanitizeUser(user),
      sessionToken,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Email login failed:', error);
    throw new AppError(500, 'Authentication failed.', { cause: error });
  }
}

export async function authenticateWithGoogleToken(
  decoded: DecodedIdToken,
  userAgent?: string
) {
  try {
    const email = decoded.email || `${decoded.uid}@users.devtrack.app`;
    const isVerified = Boolean(decoded.email_verified);
    const user = await getOrCreateUser(
      decoded.uid,
      email,
      decoded.name,
      decoded.picture ?? null,
      isVerified
    );

    await db
      .insert(oauthAccounts)
      .values({
        userId: user.id,
        provider: 'google',
        providerAccountId: decoded.uid,
      })
      .onConflictDoNothing();

    await syncPendingInvitationNotificationsForUser(db, user.id);

    const sessionToken = await createSessionRecord(user.id, userAgent);
    return { user, sessionToken };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Google OAuth session creation failed:', error);
    throw new AppError(500, 'Failed to complete Google authentication.', {
      cause: error,
    });
  }
}

export async function requestPasswordReset(email: string, baseUrl: string) {
  try {
    if (!isEmailProviderConfigured()) {
      return {
        sent: false,
        emailConfigured: false,
        message: getMissingEmailConfigMessage(),
      };
    }

    const cleanEmail = email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (user) {
      const rawToken = generateSecureToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.userId, user.id),
              isNull(passwordResetTokens.usedAt)
            )
          );

        await tx.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });
      });

      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
      try {
        await sendPasswordResetEmail(cleanEmail, user.name, resetUrl);
      } catch (emailErr) {
        await db
          .delete(passwordResetTokens)
          .where(eq(passwordResetTokens.tokenHash, tokenHash))
          .catch(() => undefined);
        throw emailErr;
      }
    }

    // Neutral response regardless of whether account exists
    return {
      sent: true,
      emailConfigured: true,
      message:
        'If an account exists with that email address, password reset instructions will be sent.',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Password reset request failed:', error);
    throw new AppError(500, 'Failed to process password reset request.', {
      cause: error,
    });
  }
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string) {
  try {
    const tokenHash = hashToken(rawToken.trim());
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) {
      throw new AppError(400, 'Invalid password reset token.');
    }
    if (record.usedAt) {
      throw new AppError(400, 'This password reset link has already been used.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'This password reset link has expired.');
    }

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, record.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, record.id));

      // Invalidate all existing sessions for security
      await tx.delete(sessions).where(eq(sessions.userId, record.userId));
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Password reset failed:', error);
    throw new AppError(500, 'Failed to reset password.', { cause: error });
  }
}

export async function verifyEmailWithToken(rawToken: string) {
  try {
    const tokenHash = hashToken(rawToken.trim());
    const [record] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) {
      throw new AppError(400, 'Invalid email verification token.');
    }
    if (record.usedAt) {
      throw new AppError(400, 'This verification link has already been used.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'This verification link has expired.');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, record.userId));

      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, record.id));

      await syncPendingInvitationNotificationsForUser(tx, record.userId);
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Email verification failed:', error);
    throw new AppError(500, 'Failed to verify email address.', { cause: error });
  }
}

export async function resendVerificationEmail(email: string, baseUrl: string) {
  try {
    if (!isEmailProviderConfigured()) {
      return {
        sent: false,
        emailConfigured: false,
        message: getMissingEmailConfigMessage(),
      };
    }

    const cleanEmail = email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (user && !user.emailVerifiedAt) {
      const rawToken = generateSecureToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

      await db.transaction(async (tx) => {
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(emailVerificationTokens.userId, user.id),
              isNull(emailVerificationTokens.usedAt)
            )
          );

        await tx.insert(emailVerificationTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });
      });

      const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;
      await sendVerificationEmail(cleanEmail, user.name, verifyUrl);
    }

    return {
      sent: true,
      emailConfigured: true,
      message:
        'If an unverified account exists with that email, a new verification link has been sent.',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Resend verification failed:', error);
    throw new AppError(500, 'Failed to resend verification email.', { cause: error });
  }
}

export async function changeUserPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
) {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new AppError(404, 'User not found.');

    if (user.passwordHash) {
      if (!currentPassword) {
        throw new AppError(400, 'Current password is required.');
      }
      const matches = await verifyPassword(currentPassword, user.passwordHash);
      if (!matches) {
        throw new AppError(401, 'Current password is incorrect.');
      }
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Change password failed:', error);
    throw new AppError(500, 'Failed to update password.', { cause: error });
  }
}

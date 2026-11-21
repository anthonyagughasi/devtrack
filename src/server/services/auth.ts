import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { db, ensureDatabaseReady, type Database } from '../../db/index.ts';
import { passwordResetTokens, sessions, users } from '../../db/schema.ts';
import { AppError, mapDatabaseError } from '../errors.ts';
import { syncPendingInvitationNotificationsForUser } from './team.ts';
import { sanitizeUser, syncFirebaseUser, type UserRecord } from './users.ts';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BCRYPT_ROUNDS = 12;

export const SESSION_COOKIE_NAME = 'devtrack_session';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function createSessionRecord(
  userId: number,
  userAgent?: string,
  executor: DbOrTx = db
): Promise<string> {
  try {
    await ensureDatabaseReady();
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await executor.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });

    return rawToken;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to create database session:', error);
    throw new AppError(500, 'Failed to create authentication session.', { cause: error });
  }
}

export async function getUserBySessionToken(
  rawToken: string
): Promise<UserRecord | null> {
  try {
    await ensureDatabaseReady();
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
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to validate session:', error);
    throw new AppError(500, 'Failed to validate session.', { cause: error });
  }
}

export async function deleteSessionByToken(rawToken: string): Promise<void> {
  try {
    await ensureDatabaseReady();
    const tokenHash = hashToken(rawToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to delete session:', error);
    throw new AppError(500, 'Failed to sign out cleanly.', { cause: error });
  }
}

export async function registerWithEmail(input: {
  name: string;
  email: string;
  password: string;
  userAgent?: string;
}): Promise<{
  user: UserRecord;
  requiresVerification: boolean;
  sessionToken: string;
  message: string;
}> {
  try {
    await ensureDatabaseReady();
    const cleanEmail = input.email.trim().toLowerCase();
    const cleanName = input.name.trim();

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'An account with this email address already exists.');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const uid = `local_${crypto.randomUUID()}`;

    const { created, sessionToken } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(users)
        .values({
          uid,
          name: cleanName,
          email: cleanEmail,
          passwordHash,
          emailVerifiedAt: null,
          avatar: null,
        })
        .returning();

      await syncPendingInvitationNotificationsForUser(tx, inserted.id);
      const token = await createSessionRecord(inserted.id, input.userAgent, tx);
      return { created: inserted, sessionToken: token };
    });

    return {
      user: sanitizeUser(created),
      requiresVerification: false,
      sessionToken,
      message: 'Account created successfully.',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error, {
      duplicateMessage: 'An account with this email address already exists.',
    });
    if (mapped) throw mapped;
    console.error('Registration failed:', error);
    throw new AppError(500, 'Unable to create account right now.', { cause: error });
  }
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
  userAgent?: string;
}): Promise<{ user: UserRecord; sessionToken: string }> {
  try {
    await ensureDatabaseReady();
    const cleanEmail = input.email.trim().toLowerCase();

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (rows.length === 0) {
      throw new AppError(401, 'Invalid email address or password.');
    }

    const userRow = rows[0];
    if (!userRow.passwordHash) {
      throw new AppError(
        401,
        'This account uses Google Sign-In. Please continue with Google or set a password in Settings.'
      );
    }

    const valid = await bcrypt.compare(input.password, userRow.passwordHash);
    if (!valid) {
      throw new AppError(401, 'Invalid email address or password.');
    }

    await syncPendingInvitationNotificationsForUser(db, userRow.id);
    const sessionToken = await createSessionRecord(userRow.id, input.userAgent);

    return {
      user: sanitizeUser(userRow),
      sessionToken,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Email login failed:', error);
    throw new AppError(500, 'Unable to sign in right now.', { cause: error });
  }
}

export async function syncAuthenticatedFirebaseUser(
  decoded: DecodedIdToken,
  options?: { name?: string; userAgent?: string }
): Promise<{ user: UserRecord; sessionToken: string; isNewUser: boolean }> {
  try {
    await ensureDatabaseReady();
    const provider = decoded.firebase?.sign_in_provider ?? 'google';
    const { user, isNewUser } = await syncFirebaseUser({
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
      name: options?.name?.trim() || decoded.name || null,
      avatar: decoded.picture ?? null,
      provider,
    });

    await syncPendingInvitationNotificationsForUser(db, user.id);

    const sessionToken = await createSessionRecord(user.id, options?.userAgent);
    return { user, sessionToken, isNewUser };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) {
      console.error('Firebase session sync database error:', error);
      throw mapped;
    }
    console.error('Firebase session synchronization failed:', error);
    throw new AppError(500, 'Failed to synchronize authentication session.', {
      cause: error,
    });
  }
}

export async function authenticateWithGoogleToken(
  decoded: DecodedIdToken,
  userAgent?: string
): Promise<{ user: UserRecord; sessionToken: string; isNewUser: boolean }> {
  return syncAuthenticatedFirebaseUser(decoded, { userAgent });
}

export async function changeUserPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: true }> {
  try {
    await ensureDatabaseReady();
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow) {
      throw new AppError(404, 'User not found.');
    }

    if (userRow.passwordHash) {
      if (!currentPassword) {
        throw new AppError(400, 'Current password is required.');
      }
      const matches = await bcrypt.compare(currentPassword, userRow.passwordHash);
      if (!matches) {
        throw new AppError(401, 'Current password is incorrect.');
      }
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db
      .update(users)
      .set({
        passwordHash: newHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to change password:', error);
    throw new AppError(500, 'Failed to update password.', { cause: error });
  }
}

export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<{ success: true }> {
  try {
    await ensureDatabaseReady();
    const tokenHash = hashToken(rawToken.trim());

    await db.transaction(async (tx) => {
      const [tokenRow] = await tx
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!tokenRow) {
        throw new AppError(400, 'This password reset token is invalid or has expired.');
      }

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, tokenRow.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, tokenRow.id));

      await tx.delete(sessions).where(eq(sessions.userId, tokenRow.userId));
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to reset password:', error);
    throw new AppError(500, 'Failed to reset password.', { cause: error });
  }
}

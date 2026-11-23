import { eq } from 'drizzle-orm';
import { db, ensureDatabaseReady, type Database } from '../../db/index.ts';
import { oauthAccounts, users } from '../../db/schema.ts';
import { AppError, mapDatabaseError } from '../errors.ts';

export interface DbUserRow {
  id: number;
  uid: string;
  name: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  avatar: string | null;
  role: string;
  themePreference: string;
  notifyOnAssign: boolean;
  notifyOnComment: boolean;
  notifyOnInvite: boolean;
  notifyOnDeadline: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: number;
  uid: string;
  name: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  avatar: string | null;
  role: string;
  themePreference: string;
  notifyOnAssign: boolean;
  notifyOnComment: boolean;
  notifyOnInvite: boolean;
  notifyOnDeadline: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncFirebaseUserInput {
  uid: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatar?: string | null;
  provider?: string | null;
}

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function sanitizeUser(row: DbUserRow): UserRecord {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    email: row.email,
    emailVerified: Boolean(row.emailVerifiedAt),
    hasPassword: Boolean(row.passwordHash),
    avatar: row.avatar,
    role: row.role,
    themePreference: row.themePreference,
    notifyOnAssign: row.notifyOnAssign,
    notifyOnComment: row.notifyOnComment,
    notifyOnInvite: row.notifyOnInvite,
    notifyOnDeadline: row.notifyOnDeadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureOAuthAccountLink(
  executor: DbOrTx,
  userId: number,
  provider: string,
  providerAccountId: string
): Promise<void> {
  await executor
    .insert(oauthAccounts)
    .values({
      userId,
      provider,
      providerAccountId,
    })
    .onConflictDoNothing();
}

export async function syncFirebaseUserWithExecutor(
  executor: DbOrTx,
  input: SyncFirebaseUserInput
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const cleanEmail = (input.email?.trim() || `${input.uid}@users.devtrack.app`).toLowerCase();
  const hasRealEmail = Boolean(input.email && input.email.trim());
  const isVerified = Boolean(input.emailVerified);
  const provider = (input.provider?.trim() || 'firebase').toLowerCase();
  const displayName =
    input.name?.trim() || cleanEmail.split('@')[0] || 'Developer';

  const byUid = await executor
    .select()
    .from(users)
    .where(eq(users.uid, input.uid))
    .limit(1);

  if (byUid.length > 0) {
    const existing = byUid[0];
    const updates: Partial<typeof users.$inferInsert> = {};
    if (hasRealEmail && existing.email !== cleanEmail) {
      updates.email = cleanEmail;
    }
    if (isVerified && !existing.emailVerifiedAt) {
      updates.emailVerifiedAt = new Date();
    }
    if (!existing.avatar && input.avatar) {
      updates.avatar = input.avatar;
    }
    if (input.name?.trim() && (!existing.name || existing.name === cleanEmail.split('@')[0])) {
      updates.name = input.name.trim();
    }

    let finalRow = existing;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      const updated = await executor
        .update(users)
        .set(updates)
        .where(eq(users.id, existing.id))
        .returning();
      finalRow = updated[0];
    }

    await ensureOAuthAccountLink(executor, finalRow.id, provider, input.uid);
    return { user: sanitizeUser(finalRow), isNewUser: false };
  }

  const linkedByOAuth = await executor
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(eq(oauthAccounts.providerAccountId, input.uid))
    .limit(1);

  if (linkedByOAuth.length > 0) {
    const existing = linkedByOAuth[0].user;
    const updates: Partial<typeof users.$inferInsert> = {};
    if (isVerified && !existing.emailVerifiedAt) {
      updates.emailVerifiedAt = new Date();
    }
    if (!existing.avatar && input.avatar) {
      updates.avatar = input.avatar;
    }
    let finalRow = existing;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      const updated = await executor
        .update(users)
        .set(updates)
        .where(eq(users.id, existing.id))
        .returning();
      finalRow = updated[0];
    }
    await ensureOAuthAccountLink(executor, finalRow.id, provider, input.uid);
    return { user: sanitizeUser(finalRow), isNewUser: false };
  }

  if (hasRealEmail) {
    const byEmail = await executor
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (byEmail.length > 0) {
      const existing = byEmail[0];
      if (!isVerified) {
        throw new AppError(
          409,
          'An account with this email address already exists. Sign in with your original method or verify your email before linking.'
        );
      }

      const updated = await executor
        .update(users)
        .set({
          avatar: existing.avatar ?? input.avatar ?? null,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();

      await ensureOAuthAccountLink(executor, updated[0].id, provider, input.uid);
      return { user: sanitizeUser(updated[0]), isNewUser: false };
    }
  }

  const inserted = await executor
    .insert(users)
    .values({
      uid: input.uid,
      email: cleanEmail,
      name: displayName,
      avatar: input.avatar ?? null,
      emailVerifiedAt: isVerified ? new Date() : null,
    })
    .returning();

  await ensureOAuthAccountLink(executor, inserted[0].id, provider, input.uid);
  return { user: sanitizeUser(inserted[0]), isNewUser: true };
}

export async function syncFirebaseUser(
  input: SyncFirebaseUserInput
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  try {
    await ensureDatabaseReady();
    return await db.transaction(async (tx) => syncFirebaseUserWithExecutor(tx, input));
  } catch (error) {
    if (error instanceof AppError) throw error;

    // Retry once if a concurrent request inserted the same uid/email between select & insert
    const mapped = mapDatabaseError(error);
    if (mapped?.statusCode === 409) {
      try {
        return await db.transaction(async (tx) => syncFirebaseUserWithExecutor(tx, input));
      } catch (retryError) {
        if (retryError instanceof AppError) throw retryError;
      }
    }

    if (mapped) throw mapped;
    console.error('Failed to synchronize Firebase user:', error);
    throw new AppError(500, 'Failed to synchronize user profile.', { cause: error });
  }
}

export async function updateUserSettings(
  userId: number,
  data: {
    name?: string;
    avatar?: string | null;
    themePreference?: 'dark' | 'light';
    notifyOnAssign?: boolean;
    notifyOnComment?: boolean;
    notifyOnInvite?: boolean;
    notifyOnDeadline?: boolean;
  }
): Promise<UserRecord> {
  try {
    await ensureDatabaseReady();
    const updatePayload: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.avatar !== undefined) updatePayload.avatar = data.avatar;
    if (data.themePreference !== undefined) updatePayload.themePreference = data.themePreference;
    if (data.notifyOnAssign !== undefined) updatePayload.notifyOnAssign = data.notifyOnAssign;
    if (data.notifyOnComment !== undefined) updatePayload.notifyOnComment = data.notifyOnComment;
    if (data.notifyOnInvite !== undefined) updatePayload.notifyOnInvite = data.notifyOnInvite;
    if (data.notifyOnDeadline !== undefined) updatePayload.notifyOnDeadline = data.notifyOnDeadline;

    const [updated] = await db
      .update(users)
      .set(updatePayload)
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new AppError(404, 'User not found.');
    }

    return sanitizeUser(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to update user settings:', error);
    throw new AppError(500, 'Failed to update settings.', { cause: error });
  }
}

export async function updateUserAvatar(
  userId: number,
  avatarDataUri: string | null
): Promise<UserRecord> {
  try {
    await ensureDatabaseReady();
    const [updated] = await db
      .update(users)
      .set({
        avatar: avatarDataUri,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new AppError(404, 'User not found.');
    }

    return sanitizeUser(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to update user avatar:', error);
    throw new AppError(500, 'Failed to update profile picture.', { cause: error });
  }
}

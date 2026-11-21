import { eq } from 'drizzle-orm';
import { assertDatabaseConfigured, db } from '../../db/index.ts';
import { users } from '../../db/schema.ts';
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

export async function getOrCreateUser(
  uid: string,
  email: string,
  name?: string,
  avatar?: string | null,
  markEmailVerified = false
): Promise<UserRecord> {
  try {
    assertDatabaseConfigured();
    const cleanEmail = email.trim().toLowerCase();
    const displayName = name?.trim() || cleanEmail.split('@')[0] || 'Developer';

    const byUid = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    if (byUid.length > 0) {
      const updates: Partial<typeof users.$inferInsert> = {};
      if (byUid[0].email !== cleanEmail) updates.email = cleanEmail;
      if (markEmailVerified && !byUid[0].emailVerifiedAt) {
        updates.emailVerifiedAt = new Date();
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        const updated = await db
          .update(users)
          .set(updates)
          .where(eq(users.uid, uid))
          .returning();
        return sanitizeUser(updated[0]);
      }
      return sanitizeUser(byUid[0]);
    }

    const byEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (byEmail.length > 0) {
      const updated = await db
        .update(users)
        .set({
          uid,
          avatar: byEmail[0].avatar ?? avatar ?? null,
          emailVerifiedAt:
            byEmail[0].emailVerifiedAt ?? (markEmailVerified ? new Date() : null),
          updatedAt: new Date(),
        })
        .where(eq(users.id, byEmail[0].id))
        .returning();
      return sanitizeUser(updated[0]);
    }

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        name: displayName,
        avatar: avatar ?? null,
        emailVerifiedAt: markEmailVerified ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      return sanitizeUser(inserted[0]);
    }

    const retryByUid = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);
    if (retryByUid.length > 0) return sanitizeUser(retryByUid[0]);

    const retryByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);
    if (retryByEmail.length > 0) {
      const updated = await db
        .update(users)
        .set({
          uid,
          emailVerifiedAt:
            retryByEmail[0].emailVerifiedAt ?? (markEmailVerified ? new Date() : null),
          updatedAt: new Date(),
        })
        .where(eq(users.id, retryByEmail[0].id))
        .returning();
      return sanitizeUser(updated[0]);
    }

    throw new AppError(500, 'Failed to synchronize user profile.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error('Failed to upsert user:', error);
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
    console.error('Failed to update user settings:', error);
    throw new AppError(500, 'Failed to update settings.', { cause: error });
  }
}

export async function updateUserAvatar(
  userId: number,
  avatarDataUri: string | null
): Promise<UserRecord> {
  try {
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
    console.error('Failed to update user avatar:', error);
    throw new AppError(500, 'Failed to update profile picture.', { cause: error });
  }
}

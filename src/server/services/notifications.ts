import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/index.ts';
import { notifications, tasks, users } from '../../db/schema.ts';
import { AppError } from '../errors.ts';

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function createNotification(
  executor: DbOrTx,
  input: {
    userId: number;
    type:
      | 'TASK_ASSIGNED'
      | 'TASK_UPDATED'
      | 'TASK_COMMENT'
      | 'PROJECT_INVITATION'
      | 'DEADLINE_APPROACHING';
    title: string;
    message: string;
    link?: string | null;
  }
): Promise<void> {
  try {
    const [recipient] = await executor
      .select({
        notifyOnAssign: users.notifyOnAssign,
        notifyOnComment: users.notifyOnComment,
        notifyOnInvite: users.notifyOnInvite,
        notifyOnDeadline: users.notifyOnDeadline,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (!recipient) return;

    if (input.type === 'TASK_ASSIGNED' && !recipient.notifyOnAssign) return;
    if (input.type === 'TASK_COMMENT' && !recipient.notifyOnComment) return;
    if (input.type === 'PROJECT_INVITATION' && !recipient.notifyOnInvite) return;
    if (input.type === 'DEADLINE_APPROACHING' && !recipient.notifyOnDeadline) return;

    await executor.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
    throw new AppError(500, 'Failed to send notification.', { cause: error });
  }
}

export async function syncApproachingDeadlines(userId: number): Promise<void> {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const [userPref] = await db
      .select({ notifyOnDeadline: users.notifyOnDeadline })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userPref?.notifyOnDeadline) return;

    const dueSoonTasks = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeId, userId),
          ne(tasks.status, 'COMPLETED'),
          gte(tasks.dueDate, now),
          lte(tasks.dueDate, soon)
        )
      );

    if (dueSoonTasks.length === 0) return;

    const existing = await db
      .select({ link: notifications.link })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'DEADLINE_APPROACHING'),
          gte(notifications.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
        )
      );

    const notifiedLinks = new Set(existing.map((e) => e.link));

    for (const task of dueSoonTasks) {
      const link = `/projects/${task.projectId}?task=${task.id}`;
      if (!notifiedLinks.has(link)) {
        await db.insert(notifications).values({
          userId,
          type: 'DEADLINE_APPROACHING',
          title: 'Upcoming deadline',
          message: `"${task.title}" is due within 48 hours.`,
          link,
        });
      }
    }
  } catch (error) {
    console.error('Deadline notification sync failed:', error);
  }
}

export async function getUserNotifications(userId: number) {
  try {
    await syncApproachingDeadlines(userId);

    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(40);

    const [{ unreadCount }] = await db
      .select({ unreadCount: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

    return { items, unreadCount };
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    throw new AppError(500, 'Failed to load notifications.', { cause: error });
  }
}

export async function markNotificationRead(userId: number, notificationId: number) {
  try {
    const [updated] = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();

    if (!updated) {
      throw new AppError(404, 'Notification not found.');
    }

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to mark notification read:', error);
    throw new AppError(500, 'Failed to update notification.', { cause: error });
  }
}

export async function markAllNotificationsRead(userId: number) {
  try {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  } catch (error) {
    console.error('Failed to mark all notifications read:', error);
    throw new AppError(500, 'Failed to mark notifications as read.', { cause: error });
  }
}

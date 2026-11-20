import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/index.ts';
import { activityLogs, projectMembers, projects, users } from '../../db/schema.ts';
import { AppError } from '../errors.ts';

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function logActivity(
  executor: DbOrTx,
  input: {
    actorId: number;
    projectId?: number | null;
    taskId?: number | null;
    action: string;
    resourceType: 'PROJECT' | 'TASK' | 'COMMENT' | 'MEMBER' | 'INVITATION';
    resourceName: string;
    details?: string | null;
  }
): Promise<void> {
  try {
    await executor.insert(activityLogs).values({
      actorId: input.actorId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceName: input.resourceName,
      details: input.details ?? null,
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
    throw new AppError(500, 'Failed to record activity history.', { cause: error });
  }
}

export async function getAccessibleProjectIds(userId: number): Promise<number[]> {
  try {
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));

    const ownedRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, userId));

    const ids = new Set<number>();
    for (const r of memberRows) ids.add(r.projectId);
    for (const r of ownedRows) ids.add(r.id);
    return Array.from(ids);
  } catch (error) {
    console.error('Failed to resolve accessible projects:', error);
    throw new AppError(500, 'Failed to load accessible projects.', { cause: error });
  }
}

export async function listAccessibleActivities(
  userId: number,
  options: { projectId?: number; page?: number; limit?: number } = {}
) {
  try {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const offset = (page - 1) * limit;

    const accessibleIds = await getAccessibleProjectIds(userId);
    if (options.projectId && !accessibleIds.includes(options.projectId)) {
      throw new AppError(403, 'You do not have access to this project.');
    }

    const whereCondition = options.projectId
      ? eq(activityLogs.projectId, options.projectId)
      : accessibleIds.length > 0
        ? or(
            inArray(activityLogs.projectId, accessibleIds),
            eq(activityLogs.actorId, userId)
          )
        : eq(activityLogs.actorId, userId);

    const rows = await db
      .select({
        id: activityLogs.id,
        actorId: activityLogs.actorId,
        actorName: users.name,
        actorEmail: users.email,
        actorAvatar: users.avatar,
        projectId: activityLogs.projectId,
        projectName: projects.name,
        taskId: activityLogs.taskId,
        action: activityLogs.action,
        resourceType: activityLogs.resourceType,
        resourceName: activityLogs.resourceName,
        details: activityLogs.details,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .innerJoin(users, eq(activityLogs.actorId, users.id))
      .leftJoin(projects, eq(activityLogs.projectId, projects.id))
      .where(whereCondition)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(whereCondition);

    return {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to list activity logs:', error);
    throw new AppError(500, 'Failed to load activity feed.', { cause: error });
  }
}

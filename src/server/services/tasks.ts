import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  projectMembers,
  projects,
  taskComments,
  tasks,
  users,
} from '../../db/schema.ts';
import type { TaskPriority, TaskStatus } from '../../lib/validations.ts';
import { AppError } from '../errors.ts';
import { requireProjectAccess } from '../permissions.ts';
import { getAccessibleProjectIds, logActivity } from './activity.ts';
import { createNotification } from './notifications.ts';

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listUserTasks(
  userId: number,
  filters: {
    projectId?: number;
    status?: string;
    priority?: string;
    assignee?: string;
    q?: string;
    sort?: string;
  } = {}
) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) return [];

    if (filters.projectId && !accessibleIds.includes(filters.projectId)) {
      throw new AppError(403, 'You do not have access to this project.');
    }

    const conditions = [
      filters.projectId
        ? eq(tasks.projectId, filters.projectId)
        : inArray(tasks.projectId, accessibleIds),
    ];

    if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters.priority && filters.priority !== 'ALL') {
      conditions.push(eq(tasks.priority, filters.priority));
    }
    if (filters.assignee === 'ME') {
      conditions.push(eq(tasks.assigneeId, userId));
    } else if (filters.assignee === 'UNASSIGNED') {
      conditions.push(sql`${tasks.assigneeId} IS NULL`);
    } else if (filters.assignee && /^\d+$/.test(filters.assignee)) {
      conditions.push(eq(tasks.assigneeId, Number(filters.assignee)));
    }

    if (filters.q && filters.q.trim()) {
      const pattern = `%${filters.q.trim()}%`;
      const cond = or(ilike(tasks.title, pattern), ilike(tasks.description, pattern));
      if (cond) conditions.push(cond);
    }

    const orderByClause =
      filters.sort === 'dueDate'
        ? [asc(tasks.dueDate), desc(tasks.createdAt)]
        : filters.sort === 'priority'
          ? [desc(tasks.createdAt)]
          : [asc(tasks.position), desc(tasks.createdAt)];

    const taskRows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        position: tasks.position,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        projectName: projects.name,
        assigneeId: tasks.assigneeId,
        createdById: tasks.createdById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(...orderByClause);

    if (taskRows.length === 0) return [];

    const taskIds = taskRows.map((t) => t.id);
    const userIds = new Set<number>();
    for (const t of taskRows) {
      userIds.add(t.createdById);
      if (t.assigneeId) userIds.add(t.assigneeId);
    }

    const [userRows, commentCounts] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
        .from(users)
        .where(inArray(users.id, Array.from(userIds))),
      db
        .select({
          taskId: taskComments.taskId,
          count: sql<number>`count(*)::int`,
        })
        .from(taskComments)
        .where(inArray(taskComments.taskId, taskIds))
        .groupBy(taskComments.taskId),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const countMap = new Map(commentCounts.map((c) => [c.taskId, c.count]));

    const result = taskRows.map((t) => ({
      ...t,
      assignee: t.assigneeId ? userMap.get(t.assigneeId) ?? null : null,
      createdBy: userMap.get(t.createdById) ?? null,
      commentCount: countMap.get(t.id) ?? 0,
    }));

    if (filters.sort === 'priority') {
      const rank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      result.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
    }

    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to list tasks:', error);
    throw new AppError(500, 'Failed to load tasks.', { cause: error });
  }
}

export async function createTask(
  userId: number,
  input: {
    projectId: number;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: number | null;
  }
) {
  try {
    await requireProjectAccess(input.projectId, userId);

    if (input.assigneeId) {
      const [member] = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.assigneeId)
          )
        )
        .limit(1);
      if (!member) {
        throw new AppError(400, 'Assignee must be a member of this project.');
      }
    }

    return await db.transaction(async (tx) => {
      const status = input.status ?? 'TODO';
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<number>`coalesce(max(${tasks.position}), -1)::int` })
        .from(tasks)
        .where(and(eq(tasks.projectId, input.projectId), eq(tasks.status, status)));

      const [created] = await tx
        .insert(tasks)
        .values({
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? '',
          status,
          priority: input.priority ?? 'MEDIUM',
          position: maxPos + 1,
          dueDate: parseDateInput(input.dueDate),
          assigneeId: input.assigneeId ?? null,
          createdById: userId,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        })
        .returning();

      await logActivity(tx, {
        actorId: userId,
        projectId: created.projectId,
        taskId: created.id,
        action: 'TASK_CREATED',
        resourceType: 'TASK',
        resourceName: created.title,
        details: `Created task "${created.title}" (${created.priority})`,
      });

      if (created.assigneeId && created.assigneeId !== userId) {
        await logActivity(tx, {
          actorId: userId,
          projectId: created.projectId,
          taskId: created.id,
          action: 'TASK_ASSIGNED',
          resourceType: 'TASK',
          resourceName: created.title,
          details: `Assigned "${created.title}"`,
        });

        await createNotification(tx, {
          userId: created.assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'New task assigned',
          message: `You were assigned to "${created.title}".`,
          link: `/projects/${created.projectId}?task=${created.id}`,
        });
      }

      return created;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to create task:', error);
    throw new AppError(500, 'Failed to create task.', { cause: error });
  }
}

export async function getTaskDetails(taskId: number, userId: number) {
  try {
    const [task] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        position: tasks.position,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        projectName: projects.name,
        assigneeId: tasks.assigneeId,
        createdById: tasks.createdById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new AppError(404, 'Task not found.');
    }

    await requireProjectAccess(task.projectId, userId);

    const [comments, activities, members] = await Promise.all([
      db
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          authorId: taskComments.authorId,
          authorName: users.name,
          authorEmail: users.email,
          authorAvatar: users.avatar,
          content: taskComments.content,
          createdAt: taskComments.createdAt,
          updatedAt: taskComments.updatedAt,
        })
        .from(taskComments)
        .innerJoin(users, eq(taskComments.authorId, users.id))
        .where(eq(taskComments.taskId, taskId))
        .orderBy(asc(taskComments.createdAt)),
      db
        .select({
          id: activityLogs.id,
          actorId: activityLogs.actorId,
          actorName: users.name,
          actorAvatar: users.avatar,
          action: activityLogs.action,
          details: activityLogs.details,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .innerJoin(users, eq(activityLogs.actorId, users.id))
        .where(eq(activityLogs.taskId, taskId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(20),
      db
        .select({
          userId: projectMembers.userId,
          role: projectMembers.role,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, task.projectId)),
    ]);

    const assignee = task.assigneeId
      ? members.find((m) => m.userId === task.assigneeId) ?? null
      : null;
    const [createdBy] = await db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(eq(users.id, task.createdById))
      .limit(1);

    return {
      task: {
        ...task,
        assignee: assignee
          ? { id: assignee.userId, name: assignee.name, email: assignee.email, avatar: assignee.avatar }
          : null,
        createdBy: createdBy ?? null,
      },
      comments,
      activities,
      projectMembers: members,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to get task details:', error);
    throw new AppError(500, 'Failed to load task details.', { cause: error });
  }
}

export async function updateTask(
  taskId: number,
  userId: number,
  input: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: number | null;
    position?: number;
  }
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!existing) throw new AppError(404, 'Task not found.');

    await requireProjectAccess(existing.projectId, userId);

    if (input.assigneeId) {
      const [member] = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, existing.projectId),
            eq(projectMembers.userId, input.assigneeId)
          )
        )
        .limit(1);
      if (!member) {
        throw new AppError(400, 'Assignee must be a member of this project.');
      }
    }

    return await db.transaction(async (tx) => {
      const updateData: Partial<typeof tasks.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.dueDate !== undefined) updateData.dueDate = parseDateInput(input.dueDate);
      if (input.assigneeId !== undefined) updateData.assigneeId = input.assigneeId;
      if (input.position !== undefined) updateData.position = input.position;

      if (input.status !== undefined) {
        updateData.status = input.status;
        if (input.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
          updateData.completedAt = new Date();
        } else if (input.status !== 'COMPLETED') {
          updateData.completedAt = null;
        }
      }

      const [updated] = await tx
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, taskId))
        .returning();

      const statusChanged = input.status !== undefined && input.status !== existing.status;
      const assigneeChanged =
        input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId;
      const priorityChanged =
        input.priority !== undefined && input.priority !== existing.priority;

      if (statusChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: updated.status === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
          resourceType: 'TASK',
          resourceName: updated.title,
          details:
            updated.status === 'COMPLETED'
              ? `Completed "${updated.title}"`
              : `Moved "${updated.title}" from ${existing.status} to ${updated.status}`,
        });
      } else if (priorityChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: 'TASK_UPDATED',
          resourceType: 'TASK',
          resourceName: updated.title,
          details: `Changed priority of "${updated.title}" to ${updated.priority}`,
        });
      } else if (assigneeChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: 'TASK_ASSIGNED',
          resourceType: 'TASK',
          resourceName: updated.title,
          details: updated.assigneeId
            ? `Reassigned "${updated.title}"`
            : `Unassigned "${updated.title}"`,
        });
      } else {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: 'TASK_UPDATED',
          resourceType: 'TASK',
          resourceName: updated.title,
          details: `Updated "${updated.title}"`,
        });
      }

      if (assigneeChanged && updated.assigneeId && updated.assigneeId !== userId) {
        await createNotification(tx, {
          userId: updated.assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'Task assigned to you',
          message: `You were assigned to "${updated.title}".`,
          link: `/projects/${updated.projectId}?task=${updated.id}`,
        });
      } else if (updated.assigneeId && updated.assigneeId !== userId && statusChanged) {
        await createNotification(tx, {
          userId: updated.assigneeId,
          type: 'TASK_UPDATED',
          title: 'Task status updated',
          message: `"${updated.title}" is now ${updated.status.replace('_', ' ')}.`,
          link: `/projects/${updated.projectId}?task=${updated.id}`,
        });
      }

      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to update task:', error);
    throw new AppError(500, 'Failed to update task.', { cause: error });
  }
}

export async function moveTask(
  taskId: number,
  userId: number,
  input: { status: TaskStatus; position: number }
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!existing) throw new AppError(404, 'Task not found.');

    await requireProjectAccess(existing.projectId, userId);

    return await db.transaction(async (tx) => {
      const targetColumnTasks = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, existing.projectId),
            eq(tasks.status, input.status)
          )
        )
        .orderBy(asc(tasks.position), asc(tasks.id));

      const filtered = targetColumnTasks.filter((t) => t.id !== taskId);
      const boundedPos = Math.max(0, Math.min(input.position, filtered.length));
      filtered.splice(boundedPos, 0, existing);

      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const isMoved = item.id === taskId;
        await tx
          .update(tasks)
          .set({
            status: isMoved ? input.status : item.status,
            position: i,
            updatedAt: isMoved ? new Date() : item.updatedAt,
            completedAt: isMoved
              ? input.status === 'COMPLETED'
                ? existing.completedAt ?? new Date()
                : null
              : item.completedAt,
          })
          .where(eq(tasks.id, item.id));
      }

      const [updated] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (existing.status !== input.status) {
        await logActivity(tx, {
          actorId: userId,
          projectId: existing.projectId,
          taskId: existing.id,
          action: input.status === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
          resourceType: 'TASK',
          resourceName: existing.title,
          details:
            input.status === 'COMPLETED'
              ? `Completed "${existing.title}"`
              : `Moved "${existing.title}" from ${existing.status} to ${input.status}`,
        });

        if (existing.assigneeId && existing.assigneeId !== userId) {
          await createNotification(tx, {
            userId: existing.assigneeId,
            type: 'TASK_UPDATED',
            title: 'Task moved on board',
            message: `"${existing.title}" moved to ${input.status.replace('_', ' ')}.`,
            link: `/projects/${existing.projectId}?task=${existing.id}`,
          });
        }
      }

      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to move task:', error);
    throw new AppError(500, 'Failed to move task.', { cause: error });
  }
}

export async function deleteTask(taskId: number, userId: number) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!existing) throw new AppError(404, 'Task not found.');

    await requireProjectAccess(existing.projectId, userId);

    return await db.transaction(async (tx) => {
      await logActivity(tx, {
        actorId: userId,
        projectId: existing.projectId,
        taskId: null,
        action: 'TASK_DELETED',
        resourceType: 'TASK',
        resourceName: existing.title,
        details: `Deleted task "${existing.title}"`,
      });

      await tx.delete(tasks).where(eq(tasks.id, taskId));
      return { deletedId: taskId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to delete task:', error);
    throw new AppError(500, 'Failed to delete task.', { cause: error });
  }
}

export async function addTaskComment(taskId: number, userId: number, content: string) {
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) throw new AppError(404, 'Task not found.');

    await requireProjectAccess(task.projectId, userId);

    return await db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(taskComments)
        .values({
          taskId,
          authorId: userId,
          content,
        })
        .returning();

      await logActivity(tx, {
        actorId: userId,
        projectId: task.projectId,
        taskId: task.id,
        action: 'COMMENT_ADDED',
        resourceType: 'COMMENT',
        resourceName: task.title,
        details: `Commented on "${task.title}"`,
      });

      const notifyTargetIds = new Set<number>();
      if (task.assigneeId && task.assigneeId !== userId) notifyTargetIds.add(task.assigneeId);
      if (task.createdById !== userId) notifyTargetIds.add(task.createdById);

      for (const targetId of notifyTargetIds) {
        await createNotification(tx, {
          userId: targetId,
          type: 'TASK_COMMENT',
          title: 'New comment on task',
          message: `New comment on "${task.title}": ${content.slice(0, 80)}`,
          link: `/projects/${task.projectId}?task=${task.id}`,
        });
      }

      const [author] = await tx
        .select({ name: users.name, email: users.email, avatar: users.avatar })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return {
        ...comment,
        authorName: author?.name ?? 'User',
        authorEmail: author?.email ?? '',
        authorAvatar: author?.avatar ?? null,
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to add comment:', error);
    throw new AppError(500, 'Failed to post comment.', { cause: error });
  }
}

export async function updateTaskComment(
  commentId: number,
  userId: number,
  content: string
) {
  try {
    const [existing] = await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, commentId))
      .limit(1);

    if (!existing) throw new AppError(404, 'Comment not found.');
    if (existing.authorId !== userId) {
      throw new AppError(403, 'You can only edit your own comments.');
    }

    const [updated] = await db
      .update(taskComments)
      .set({ content, updatedAt: new Date() })
      .where(eq(taskComments.id, commentId))
      .returning();

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to update comment:', error);
    throw new AppError(500, 'Failed to update comment.', { cause: error });
  }
}

export async function deleteTaskComment(commentId: number, userId: number) {
  try {
    const [existing] = await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, commentId))
      .limit(1);

    if (!existing) throw new AppError(404, 'Comment not found.');

    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, existing.taskId))
      .limit(1);

    if (!task) throw new AppError(404, 'Associated task not found.');

    const role = await requireProjectAccess(task.projectId, userId);
    if (existing.authorId !== userId && role !== 'OWNER' && role !== 'ADMINISTRATOR') {
      throw new AppError(403, 'You do not have permission to delete this comment.');
    }

    await db.delete(taskComments).where(eq(taskComments.id, commentId));
    return { deletedId: commentId };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to delete comment:', error);
    throw new AppError(500, 'Failed to delete comment.', { cause: error });
  }
}

import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  projectMembers,
  projects,
  taskComments,
  tasks,
  users,
} from '../../db/schema.ts';
import type { ProjectRole, ProjectStatus } from '../../lib/validations.ts';
import { AppError } from '../errors.ts';
import { requireProjectAccess } from '../permissions.ts';
import { getAccessibleProjectIds, logActivity } from './activity.ts';

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listUserProjects(
  userId: number,
  filters: { q?: string; status?: string } = {}
) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) return [];

    const conditions = [inArray(projects.id, accessibleIds)];
    if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(projects.status, filters.status));
    }
    if (filters.q && filters.q.trim()) {
      const pattern = `%${filters.q.trim()}%`;
      const searchCond = or(
        ilike(projects.name, pattern),
        ilike(projects.description, pattern)
      );
      if (searchCond) conditions.push(searchCond);
    }

    const projectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        startDate: projects.startDate,
        deadline: projects.deadline,
        ownerId: projects.ownerId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        ownerName: users.name,
        ownerEmail: users.email,
        ownerAvatar: users.avatar,
      })
      .from(projects)
      .innerJoin(users, eq(projects.ownerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt));

    if (projectRows.length === 0) return [];

    const projectIds = projectRows.map((p) => p.id);

    const [taskRows, memberRows] = await Promise.all([
      db
        .select({
          projectId: tasks.projectId,
          status: tasks.status,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(inArray(tasks.projectId, projectIds)),
      db
        .select({
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          role: projectMembers.role,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(inArray(projectMembers.projectId, projectIds)),
    ]);

    const now = Date.now();
    const taskStatsMap = new Map<
      number,
      { total: number; completed: number; overdue: number }
    >();
    for (const t of taskRows) {
      const entry = taskStatsMap.get(t.projectId) ?? {
        total: 0,
        completed: 0,
        overdue: 0,
      };
      entry.total += 1;
      if (t.status === 'COMPLETED') {
        entry.completed += 1;
      } else if (t.dueDate && t.dueDate.getTime() < now) {
        entry.overdue += 1;
      }
      taskStatsMap.set(t.projectId, entry);
    }

    const membersMap = new Map<
      number,
      Array<{ userId: number; role: string; name: string; email: string; avatar: string | null }>
    >();
    for (const m of memberRows) {
      const list = membersMap.get(m.projectId) ?? [];
      list.push({
        userId: m.userId,
        role: m.role,
        name: m.name,
        email: m.email,
        avatar: m.avatar,
      });
      membersMap.set(m.projectId, list);
    }

    return projectRows.map((p) => {
      const stats = taskStatsMap.get(p.id) ?? { total: 0, completed: 0, overdue: 0 };
      const members = membersMap.get(p.id) ?? [];
      const myMembership = members.find((m) => m.userId === userId);
      const myRole: ProjectRole =
        p.ownerId === userId
          ? 'OWNER'
          : ((myMembership?.role as ProjectRole) ?? 'MEMBER');
      const progress =
        stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status as ProjectStatus,
        startDate: p.startDate,
        deadline: p.deadline,
        ownerId: p.ownerId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        owner: {
          id: p.ownerId,
          name: p.ownerName,
          email: p.ownerEmail,
          avatar: p.ownerAvatar,
        },
        role: myRole,
        totalTasks: stats.total,
        completedTasks: stats.completed,
        overdueTasks: stats.overdue,
        progress,
        memberCount: Math.max(1, members.length),
        members,
      };
    });
  } catch (error) {
    console.error('Failed to list user projects:', error);
    throw new AppError(500, 'Failed to load projects.', { cause: error });
  }
}

export async function createProject(
  userId: number,
  input: {
    name: string;
    description?: string;
    status?: ProjectStatus;
    startDate?: string | null;
    deadline?: string | null;
  }
) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({
          name: input.name,
          description: input.description ?? '',
          status: input.status ?? 'PLANNING',
          startDate: parseDateInput(input.startDate),
          deadline: parseDateInput(input.deadline),
          ownerId: userId,
        })
        .returning();

      await tx.insert(projectMembers).values({
        projectId: created.id,
        userId,
        role: 'OWNER',
      });

      await logActivity(tx, {
        actorId: userId,
        projectId: created.id,
        action: 'PROJECT_CREATED',
        resourceType: 'PROJECT',
        resourceName: created.name,
        details: `Created project "${created.name}" (${created.status})`,
      });

      return created;
    });
  } catch (error) {
    console.error('Failed to create project:', error);
    throw new AppError(500, 'Failed to create project.', { cause: error });
  }
}

export async function getProjectDetails(projectId: number, userId: number) {
  try {
    const role = await requireProjectAccess(projectId, userId);

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        startDate: projects.startDate,
        deadline: projects.deadline,
        ownerId: projects.ownerId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        ownerName: users.name,
        ownerEmail: users.email,
        ownerAvatar: users.avatar,
      })
      .from(projects)
      .innerJoin(users, eq(projects.ownerId, users.id))
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new AppError(404, 'Project not found.');
    }

    const [memberRows, taskRows, activityRows] = await Promise.all([
      db
        .select({
          id: projectMembers.id,
          userId: projectMembers.userId,
          role: projectMembers.role,
          joinedAt: projectMembers.joinedAt,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(projectMembers.joinedAt),
      db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(tasks.position, desc(tasks.createdAt)),
      db
        .select({
          id: activityLogs.id,
          actorId: activityLogs.actorId,
          actorName: users.name,
          actorAvatar: users.avatar,
          action: activityLogs.action,
          resourceType: activityLogs.resourceType,
          resourceName: activityLogs.resourceName,
          details: activityLogs.details,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .innerJoin(users, eq(activityLogs.actorId, users.id))
        .where(eq(activityLogs.projectId, projectId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(25),
    ]);

    const taskIds = taskRows.map((t) => t.id);
    const commentCounts = new Map<number, number>();
    if (taskIds.length > 0) {
      const counts = await db
        .select({
          taskId: taskComments.taskId,
          count: sql<number>`count(*)::int`,
        })
        .from(taskComments)
        .where(inArray(taskComments.taskId, taskIds))
        .groupBy(taskComments.taskId);
      for (const c of counts) {
        commentCounts.set(c.taskId, c.count);
      }
    }

    const userIdsNeeded = new Set<number>();
    for (const t of taskRows) {
      userIdsNeeded.add(t.createdById);
      if (t.assigneeId) userIdsNeeded.add(t.assigneeId);
    }

    const userLookup = new Map<
      number,
      { id: number; name: string; email: string; avatar: string | null }
    >();
    if (userIdsNeeded.size > 0) {
      const uRows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(users)
        .where(inArray(users.id, Array.from(userIdsNeeded)));
      for (const u of uRows) userLookup.set(u.id, u);
    }

    const now = Date.now();
    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((t) => t.status === 'COMPLETED').length;
    const inProgressTasks = taskRows.filter((t) => t.status === 'IN_PROGRESS').length;
    const todoTasks = taskRows.filter((t) => t.status === 'TODO').length;
    const overdueTasks = taskRows.filter(
      (t) => t.status !== 'COMPLETED' && t.dueDate && t.dueDate.getTime() < now
    ).length;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const formattedTasks = taskRows.map((t) => ({
      ...t,
      projectName: project.name,
      assignee: t.assigneeId ? userLookup.get(t.assigneeId) ?? null : null,
      createdBy: userLookup.get(t.createdById) ?? null,
      commentCount: commentCounts.get(t.id) ?? 0,
    }));

    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate,
        deadline: project.deadline,
        ownerId: project.ownerId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        owner: {
          id: project.ownerId,
          name: project.ownerName,
          email: project.ownerEmail,
          avatar: project.ownerAvatar,
        },
        role,
        totalTasks,
        completedTasks,
        inProgressTasks,
        todoTasks,
        overdueTasks,
        progress,
      },
      members: memberRows,
      tasks: formattedTasks,
      activities: activityRows,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to get project details:', error);
    throw new AppError(500, 'Failed to load project details.', { cause: error });
  }
}

export async function updateProject(
  projectId: number,
  userId: number,
  input: {
    name?: string;
    description?: string;
    status?: ProjectStatus;
    startDate?: string | null;
    deadline?: string | null;
  }
) {
  try {
    await requireProjectAccess(projectId, userId, ['OWNER', 'ADMINISTRATOR']);

    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!existing) throw new AppError(404, 'Project not found.');

      const updateData: Partial<typeof projects.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.startDate !== undefined) updateData.startDate = parseDateInput(input.startDate);
      if (input.deadline !== undefined) updateData.deadline = parseDateInput(input.deadline);

      const [updated] = await tx
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, projectId))
        .returning();

      await logActivity(tx, {
        actorId: userId,
        projectId: updated.id,
        action: 'PROJECT_UPDATED',
        resourceType: 'PROJECT',
        resourceName: updated.name,
        details: `Updated project "${updated.name}" (${updated.status})`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to update project:', error);
    throw new AppError(500, 'Failed to update project.', { cause: error });
  }
}

export async function deleteProject(projectId: number, userId: number) {
  try {
    await requireProjectAccess(projectId, userId, ['OWNER']);

    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!existing) throw new AppError(404, 'Project not found.');

      await logActivity(tx, {
        actorId: userId,
        projectId: null,
        action: 'PROJECT_DELETED',
        resourceType: 'PROJECT',
        resourceName: existing.name,
        details: `Deleted project "${existing.name}"`,
      });

      await tx.delete(projects).where(eq(projects.id, projectId));
      return { deletedId: projectId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to delete project:', error);
    throw new AppError(500, 'Failed to delete project.', { cause: error });
  }
}

export async function seedStarterWorkspace(userId: number) {
  try {
    const existing = await getAccessibleProjectIds(userId);
    if (existing.length > 0) {
      throw new AppError(400, 'Starter workspace can only be created when you have no projects.');
    }

    const now = new Date();
    const day = 24 * 60 * 60 * 1000;

    return await db.transaction(async (tx) => {
      const [p1] = await tx
        .insert(projects)
        .values({
          name: 'Core API Gateway v3',
          description: 'Edge rate limiting, JWT verification middleware, and PostgreSQL connection pool hardening.',
          status: 'ACTIVE',
          startDate: new Date(now.getTime() - 12 * day),
          deadline: new Date(now.getTime() + 18 * day),
          ownerId: userId,
        })
        .returning();

      const [p2] = await tx
        .insert(projects)
        .values({
          name: 'Telemetry Console',
          description: 'Real-time worker latency visualization and anomaly webhook dispatcher.',
          status: 'PLANNING',
          startDate: new Date(now.getTime() - 4 * day),
          deadline: new Date(now.getTime() + 26 * day),
          ownerId: userId,
        })
        .returning();

      await tx.insert(projectMembers).values([
        { projectId: p1.id, userId, role: 'OWNER' },
        { projectId: p2.id, userId, role: 'OWNER' },
      ]);

      const insertedTasks = await tx
        .insert(tasks)
        .values([
          {
            projectId: p1.id,
            title: 'Implement token bucket rate limiter',
            description: 'Enforce per-tenant API bursts at edge ingress with sliding window counters.',
            status: 'COMPLETED',
            priority: 'HIGH',
            position: 0,
            dueDate: new Date(now.getTime() - 2 * day),
            assigneeId: userId,
            createdById: userId,
            completedAt: new Date(now.getTime() - 2 * day),
          },
          {
            projectId: p1.id,
            title: 'Add Drizzle query error boundary',
            description: 'Sanitize PostgreSQL error propagation across all route controllers.',
            status: 'IN_PROGRESS',
            priority: 'URGENT',
            position: 0,
            dueDate: new Date(now.getTime() + 2 * day),
            assigneeId: userId,
            createdById: userId,
          },
          {
            projectId: p1.id,
            title: 'Write RBAC integration test suite',
            description: 'Verify OWNER, ADMINISTRATOR, and MEMBER permission enforcement on all endpoints.',
            status: 'TODO',
            priority: 'HIGH',
            position: 0,
            dueDate: new Date(now.getTime() + 5 * day),
            assigneeId: userId,
            createdById: userId,
          },
          {
            projectId: p2.id,
            title: 'Design time-series Recharts throughput view',
            description: 'Aggregate 14-day task completion trends using tabular numerals.',
            status: 'IN_PROGRESS',
            priority: 'MEDIUM',
            position: 0,
            dueDate: new Date(now.getTime() + 7 * day),
            assigneeId: userId,
            createdById: userId,
          },
          {
            projectId: p2.id,
            title: 'Configure webhook retry backoff',
            description: 'Bounded exponential backoff for outbound project webhook delivery.',
            status: 'TODO',
            priority: 'LOW',
            position: 1,
            dueDate: new Date(now.getTime() + 12 * day),
            assigneeId: null,
            createdById: userId,
          },
        ])
        .returning();

      await tx.insert(taskComments).values({
        taskId: insertedTasks[1].id,
        authorId: userId,
        content: 'Verified that sanitized error responses never expose SQL table details.',
      });

      await logActivity(tx, {
        actorId: userId,
        projectId: p1.id,
        action: 'PROJECT_CREATED',
        resourceType: 'PROJECT',
        resourceName: p1.name,
        details: `Created project "${p1.name}"`,
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: p2.id,
        action: 'PROJECT_CREATED',
        resourceType: 'PROJECT',
        resourceName: p2.name,
        details: `Created project "${p2.name}"`,
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: p1.id,
        taskId: insertedTasks[0].id,
        action: 'TASK_COMPLETED',
        resourceType: 'TASK',
        resourceName: insertedTasks[0].title,
        details: `Completed "${insertedTasks[0].title}"`,
      });

      return { projects: [p1, p2] };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to seed starter workspace:', error);
    throw new AppError(500, 'Failed to create starter workspace.', { cause: error });
  }
}

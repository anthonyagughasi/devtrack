import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { activityLogs, projectMembers, projects, tasks, users } from '../../db/schema.ts';
import { AppError } from '../errors.ts';
import { getAccessibleProjectIds } from './activity.ts';

export async function getDashboardAnalytics(userId: number, days = 14) {
  try {
    const windowDays = Math.min(90, Math.max(7, days));
    const accessibleIds = await getAccessibleProjectIds(userId);

    if (accessibleIds.length === 0) {
      return {
        summary: {
          totalProjects: 0,
          activeProjects: 0,
          completedProjects: 0,
          totalTasks: 0,
          completedTasks: 0,
          overdueTasks: 0,
        },
        tasksByStatus: [
          { name: 'To Do', status: 'TODO', count: 0 },
          { name: 'In Progress', status: 'IN_PROGRESS', count: 0 },
          { name: 'Completed', status: 'COMPLETED', count: 0 },
        ],
        tasksByPriority: [
          { name: 'Low', priority: 'LOW', count: 0 },
          { name: 'Medium', priority: 'MEDIUM', count: 0 },
          { name: 'High', priority: 'HIGH', count: 0 },
          { name: 'Urgent', priority: 'URGENT', count: 0 },
        ],
        projectProgress: [],
        completionTrend: buildEmptyTrend(windowDays),
        teamWorkload: [],
        recentActivity: [],
        myTasks: [],
        upcomingDeadlines: [],
        overdueTaskList: [],
        activeProjects: [],
      };
    }

    const [projectRows, taskRows, memberRows, activityRows] = await Promise.all([
      db
        .select()
        .from(projects)
        .where(inArray(projects.id, accessibleIds))
        .orderBy(desc(projects.updatedAt)),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          projectId: tasks.projectId,
          projectName: projects.name,
          assigneeId: tasks.assigneeId,
          createdAt: tasks.createdAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(inArray(tasks.projectId, accessibleIds)),
      db
        .select({
          userId: projectMembers.userId,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(inArray(projectMembers.projectId, accessibleIds)),
      db
        .select({
          id: activityLogs.id,
          actorId: activityLogs.actorId,
          actorName: users.name,
          actorAvatar: users.avatar,
          projectId: activityLogs.projectId,
          projectName: projects.name,
          action: activityLogs.action,
          resourceType: activityLogs.resourceType,
          resourceName: activityLogs.resourceName,
          details: activityLogs.details,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .innerJoin(users, eq(activityLogs.actorId, users.id))
        .leftJoin(projects, eq(activityLogs.projectId, projects.id))
        .where(inArray(activityLogs.projectId, accessibleIds))
        .orderBy(desc(activityLogs.createdAt))
        .limit(12),
    ]);

    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1000;

    const totalProjects = projectRows.length;
    const activeProjectsList = projectRows.filter((p) => p.status === 'ACTIVE');
    const completedProjects = projectRows.filter((p) => p.status === 'COMPLETED').length;
    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((t) => t.status === 'COMPLETED').length;
    const overdueTaskList = taskRows
      .filter((t) => t.status !== 'COMPLETED' && t.dueDate && t.dueDate.getTime() < now)
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));

    const tasksByStatus = [
      {
        name: 'To Do',
        status: 'TODO',
        count: taskRows.filter((t) => t.status === 'TODO').length,
      },
      {
        name: 'In Progress',
        status: 'IN_PROGRESS',
        count: taskRows.filter((t) => t.status === 'IN_PROGRESS').length,
      },
      {
        name: 'Completed',
        status: 'COMPLETED',
        count: completedTasks,
      },
    ];

    const tasksByPriority = [
      {
        name: 'Low',
        priority: 'LOW',
        count: taskRows.filter((t) => t.priority === 'LOW').length,
      },
      {
        name: 'Medium',
        priority: 'MEDIUM',
        count: taskRows.filter((t) => t.priority === 'MEDIUM').length,
      },
      {
        name: 'High',
        priority: 'HIGH',
        count: taskRows.filter((t) => t.priority === 'HIGH').length,
      },
      {
        name: 'Urgent',
        priority: 'URGENT',
        count: taskRows.filter((t) => t.priority === 'URGENT').length,
      },
    ];

    const projectProgress = projectRows
      .filter((p) => p.status !== 'ARCHIVED')
      .slice(0, 8)
      .map((p) => {
        const pTasks = taskRows.filter((t) => t.projectId === p.id);
        const pDone = pTasks.filter((t) => t.status === 'COMPLETED').length;
        const pct = pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0;
        return {
          id: p.id,
          name: p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name,
          fullName: p.name,
          status: p.status,
          progress: pct,
          totalTasks: pTasks.length,
          completedTasks: pDone,
        };
      });

    // Completion & creation trend over windowDays
    const trendMap = new Map<string, { date: string; label: string; completed: number; created: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const label = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
      }).format(d);
      trendMap.set(key, { date: key, label, completed: 0, created: 0 });
    }

    for (const t of taskRows) {
      const createdKey = t.createdAt.toISOString().slice(0, 10);
      const cBucket = trendMap.get(createdKey);
      if (cBucket) cBucket.created += 1;

      if (t.completedAt) {
        const doneKey = t.completedAt.toISOString().slice(0, 10);
        const dBucket = trendMap.get(doneKey);
        if (dBucket) dBucket.completed += 1;
      }
    }

    // Team workload across accessible projects
    const uniqueUsers = new Map<
      number,
      { userId: number; name: string; email: string; avatar: string | null }
    >();
    for (const m of memberRows) {
      if (!uniqueUsers.has(m.userId)) uniqueUsers.set(m.userId, m);
    }

    const teamWorkload = Array.from(uniqueUsers.values()).map((u) => {
      const assigned = taskRows.filter((t) => t.assigneeId === u.userId);
      const done = assigned.filter((t) => t.status === 'COMPLETED').length;
      const inProgress = assigned.filter((t) => t.status === 'IN_PROGRESS').length;
      const todo = assigned.filter((t) => t.status === 'TODO').length;
      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        total: assigned.length,
        todo,
        inProgress,
        completed: done,
      };
    });

    const myTasks = taskRows
      .filter((t) => t.assigneeId === userId && t.status !== 'COMPLETED')
      .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
      .slice(0, 8);

    const upcomingDeadlines = taskRows
      .filter(
        (t) =>
          t.status !== 'COMPLETED' &&
          t.dueDate &&
          t.dueDate.getTime() >= now &&
          t.dueDate.getTime() <= soon
      )
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .slice(0, 8);

    const activeProjects = activeProjectsList.slice(0, 6).map((p) => {
      const pTasks = taskRows.filter((t) => t.projectId === p.id);
      const pDone = pTasks.filter((t) => t.status === 'COMPLETED').length;
      return {
        ...p,
        totalTasks: pTasks.length,
        completedTasks: pDone,
        progress: pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0,
      };
    });

    return {
      summary: {
        totalProjects,
        activeProjects: activeProjectsList.length,
        completedProjects,
        totalTasks,
        completedTasks,
        overdueTasks: overdueTaskList.length,
      },
      tasksByStatus,
      tasksByPriority,
      projectProgress,
      completionTrend: Array.from(trendMap.values()),
      teamWorkload,
      recentActivity: activityRows,
      myTasks,
      upcomingDeadlines,
      overdueTaskList: overdueTaskList.slice(0, 8),
      activeProjects,
    };
  } catch (error) {
    console.error('Failed to calculate dashboard analytics:', error);
    throw new AppError(500, 'Failed to load dashboard analytics.', { cause: error });
  }
}

function buildEmptyTrend(days: number) {
  const result: Array<{ date: string; label: string; completed: number; created: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    result.push({
      date: d.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
      }).format(d),
      completed: 0,
      created: 0,
    });
  }
  return result;
}

import { collection, getDocs, query, where } from 'firebase/firestore';
import { firestoreDb, handleFirestoreError, OperationType } from '../lib/firebase';
import { isOverdue } from '../lib/utils';
import type { TaskPriority, TaskStatus } from '../lib/validations';
import type { ActivityItem, DashboardAnalytics } from '../types/app';
import { nullableIso, timestampToIso } from './firestore-helpers';
import { getAccessibleProjectsRaw } from './projects';

export async function getDashboardAnalytics(
  userId: string,
  days = 14
): Promise<DashboardAnalytics> {
  const safeDays = Math.min(90, Math.max(7, Number.isFinite(days) ? days : 14));
  const projects = await getAccessibleProjectsRaw(userId);

  const nowMs = Date.now();
  const soonMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  let totalTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;

  const statusCounts: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
  };
  const priorityCounts: Record<TaskPriority, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    URGENT: 0,
  };

  const trendMap = new Map<string, { label: string; completed: number; created: number }>();
  for (let i = safeDays - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    trendMap.set(key, { label, completed: 0, created: 0 });
  }

  const workloadMap = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string;
      avatar: string | null;
      total: number;
      todo: number;
      inProgress: number;
      completed: number;
    }
  >();

  const projectProgress: DashboardAnalytics['projectProgress'] = [];
  const activeProjectsList: DashboardAnalytics['activeProjects'] = [];
  const recentActivity: ActivityItem[] = [];
  const myTasks: DashboardAnalytics['myTasks'] = [];
  const upcomingDeadlines: DashboardAnalytics['upcomingDeadlines'] = [];
  const overdueTaskList: DashboardAnalytics['overdueTaskList'] = [];

  await Promise.all(
    projects.map(async (proj) => {
      const [membersSnap, tasksSnap, activitiesSnap] = await Promise.all([
        getDocs(
          query(
            collection(firestoreDb, 'projects', proj.id, 'members'),
            where('projectId', '==', proj.id)
          )
        ).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/members`)
        ),
        getDocs(
          query(
            collection(firestoreDb, 'projects', proj.id, 'tasks'),
            where('projectId', '==', proj.id)
          )
        ).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/tasks`)
        ),
        getDocs(
          query(
            collection(firestoreDb, 'projects', proj.id, 'activities'),
            where('projectId', '==', proj.id)
          )
        ).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/activities`)
        ),
      ]);

      for (const md of membersSnap.docs) {
        const m = md.data();
        const uid = String(m.userId ?? md.id);
        if (!workloadMap.has(uid)) {
          workloadMap.set(uid, {
            userId: uid,
            name: String(m.name ?? 'Member'),
            email: String(m.email ?? ''),
            avatar: typeof m.avatar === 'string' ? m.avatar : null,
            total: 0,
            todo: 0,
            inProgress: 0,
            completed: 0,
          });
        }
      }

      let projTotal = 0;
      let projCompleted = 0;

      for (const td of tasksSnap.docs) {
        const t = td.data();
        const status = (String(t.status ?? 'TODO') as TaskStatus) || 'TODO';
        const priority = (String(t.priority ?? 'MEDIUM') as TaskPriority) || 'MEDIUM';
        const dueDate = nullableIso(t.dueDate);
        const createdAtIso = timestampToIso(t.createdAt);
        const completedAtIso = nullableIso(t.completedAt);
        const assigneeId = typeof t.assigneeId === 'string' ? t.assigneeId : null;
        const title = String(t.title ?? 'Task');

        totalTasks += 1;
        projTotal += 1;
        if (status in statusCounts) statusCounts[status] += 1;
        if (priority in priorityCounts) priorityCounts[priority] += 1;

        if (status === 'COMPLETED') {
          completedTasks += 1;
          projCompleted += 1;
        }

        const overdue = isOverdue(dueDate, status);
        if (overdue) {
          overdueTasks += 1;
        }

        const createdBucket = trendMap.get(createdAtIso.slice(0, 10));
        if (createdBucket) createdBucket.created += 1;

        if (completedAtIso) {
          const completedBucket = trendMap.get(completedAtIso.slice(0, 10));
          if (completedBucket) completedBucket.completed += 1;
        }

        if (assigneeId) {
          const w = workloadMap.get(assigneeId);
          if (w) {
            w.total += 1;
            if (status === 'TODO') w.todo += 1;
            else if (status === 'IN_PROGRESS') w.inProgress += 1;
            else if (status === 'COMPLETED') w.completed += 1;
          }
        }

        if (assigneeId === userId && status !== 'COMPLETED') {
          myTasks.push({
            id: td.id,
            title,
            status,
            priority,
            dueDate,
            projectId: proj.id,
            projectName: proj.name,
          });
        }

        if (overdue) {
          overdueTaskList.push({
            id: td.id,
            title,
            status,
            priority,
            dueDate,
            projectId: proj.id,
            projectName: proj.name,
          });
        } else if (status !== 'COMPLETED' && dueDate) {
          const dueMs = new Date(dueDate).getTime();
          if (dueMs >= nowMs && dueMs <= soonMs) {
            upcomingDeadlines.push({
              id: td.id,
              title,
              status,
              priority,
              dueDate,
              projectId: proj.id,
              projectName: proj.name,
            });
          }
        }
      }

      const progress = projTotal > 0 ? Math.round((projCompleted / projTotal) * 100) : 0;
      if (proj.status !== 'ARCHIVED') {
        projectProgress.push({
          id: proj.id,
          name: proj.name.length > 18 ? `${proj.name.slice(0, 17)}…` : proj.name,
          fullName: proj.name,
          status: proj.status,
          progress,
          totalTasks: projTotal,
          completedTasks: projCompleted,
        });
      }

      if (proj.status === 'ACTIVE') {
        activeProjectsList.push({
          id: proj.id,
          name: proj.name,
          status: proj.status,
          deadline: proj.deadline,
          totalTasks: projTotal,
          completedTasks: projCompleted,
          progress,
        });
      }

      for (const ad of activitiesSnap.docs) {
        const a = ad.data();
        recentActivity.push({
          id: ad.id,
          actorId: String(a.actorId ?? ''),
          actorName: String(a.actorName ?? 'Member'),
          actorAvatar: typeof a.actorAvatar === 'string' ? a.actorAvatar : null,
          projectId: proj.id,
          projectName: String(a.projectName ?? proj.name),
          taskId: typeof a.taskId === 'string' ? a.taskId : null,
          action: String(a.action ?? ''),
          resourceType: typeof a.resourceType === 'string' ? a.resourceType : undefined,
          resourceName: typeof a.resourceName === 'string' ? a.resourceName : undefined,
          details: typeof a.details === 'string' ? a.details : null,
          createdAt: timestampToIso(a.createdAt),
        });
      }
    })
  );

  recentActivity.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  upcomingDeadlines.sort(
    (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
  );
  overdueTaskList.sort(
    (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
  );

  return {
    summary: {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      completedProjects: projects.filter((p) => p.status === 'COMPLETED').length,
      totalTasks,
      completedTasks,
      overdueTasks,
    },
    tasksByStatus: [
      { name: 'To Do', status: 'TODO', count: statusCounts.TODO },
      { name: 'In Progress', status: 'IN_PROGRESS', count: statusCounts.IN_PROGRESS },
      { name: 'Completed', status: 'COMPLETED', count: statusCounts.COMPLETED },
    ],
    tasksByPriority: [
      { name: 'Low', priority: 'LOW', count: priorityCounts.LOW },
      { name: 'Medium', priority: 'MEDIUM', count: priorityCounts.MEDIUM },
      { name: 'High', priority: 'HIGH', count: priorityCounts.HIGH },
      { name: 'Urgent', priority: 'URGENT', count: priorityCounts.URGENT },
    ],
    projectProgress: projectProgress.slice(0, 6),
    completionTrend: Array.from(trendMap.entries()).map(([date, val]) => ({
      date,
      label: val.label,
      completed: val.completed,
      created: val.created,
    })),
    teamWorkload: Array.from(workloadMap.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6),
    recentActivity: recentActivity.slice(0, 12),
    myTasks: myTasks.slice(0, 6),
    upcomingDeadlines: upcomingDeadlines.slice(0, 6),
    overdueTaskList: overdueTaskList.slice(0, 6),
    activeProjects: activeProjectsList.slice(0, 5),
  };
}

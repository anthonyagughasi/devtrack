import { collection, getDocs, query, where } from 'firebase/firestore';
import { firestoreDb, handleFirestoreError, OperationType } from '../lib/firebase';
import type { ActivityItem } from '../types/app';
import { assertNotDemoFirestoreLeak, isDemoProfile } from '../demo/demo-session';
import { demoListWorkspaceActivity } from '../demo/demo-store';
import { timestampToIso } from './firestore-helpers';
import { getAccessibleProjectsRaw } from './projects';

export async function listWorkspaceActivity(
  userId: string,
  options: { projectId?: string; page?: number; limit?: number } = {}
): Promise<{
  items: ActivityItem[];
  total: number;
  page: number;
  totalPages: number;
}> {
  if (isDemoProfile(userId)) {
    return demoListWorkspaceActivity(userId, options);
  }
  assertNotDemoFirestoreLeak(userId);
  const projects = await getAccessibleProjectsRaw(userId);
  const filteredProjects = options.projectId
    ? projects.filter((p) => p.id === options.projectId)
    : projects;

  const allActivities: ActivityItem[] = [];

  await Promise.all(
    filteredProjects.map(async (proj) => {
      const path = `projects/${proj.id}/activities`;
      try {
        const snap = await getDocs(
          query(
            collection(firestoreDb, 'projects', proj.id, 'activities'),
            where('projectId', '==', proj.id)
          )
        );
        for (const d of snap.docs) {
          const data = d.data();
          allActivities.push({
            id: d.id,
            actorId: String(data.actorId ?? ''),
            actorName: String(data.actorName ?? 'Member'),
            actorAvatar: typeof data.actorAvatar === 'string' ? data.actorAvatar : null,
            projectId: proj.id,
            projectName: String(data.projectName ?? proj.name),
            taskId: typeof data.taskId === 'string' ? data.taskId : null,
            action: String(data.action ?? ''),
            resourceType: typeof data.resourceType === 'string' ? data.resourceType : undefined,
            resourceName: typeof data.resourceName === 'string' ? data.resourceName : undefined,
            details: typeof data.details === 'string' ? data.details : null,
            createdAt: timestampToIso(data.createdAt),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    })
  );

  allActivities.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const pageSize = Math.min(50, Math.max(1, options.limit ?? 20));
  const total = allActivities.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, options.page ?? 1));
  const start = (page - 1) * pageSize;

  return {
    items: allActivities.slice(start, start + pageSize),
    total,
    page,
    totalPages,
  };
}

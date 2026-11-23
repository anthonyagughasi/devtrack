import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AppError,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { isOverdue } from '../lib/utils';
import {
  createProjectSchema,
  updateProjectSchema,
  type ProjectRole,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from '../lib/validations';
import type {
  ActivityItem,
  ProjectMemberItem,
  ProjectSummary,
  TaskItem,
  UserProfile,
  UserSummary,
} from '../types/app';
import {
  addActivityToBatch,
  commitOperationsInChunks,
  generateSecureToken,
  normalizeDateIsoInput,
  nullableIso,
  requireProjectRole,
  timestampToIso,
} from './firestore-helpers';

export interface AccessibleProjectRaw {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  deadline: string | null;
  ownerId: string;
  owner: UserSummary;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}

export async function getAccessibleProjectsRaw(
  userId: string
): Promise<AccessibleProjectRaw[]> {
  const refsPath = `users/${userId}/projectRefs`;
  let refsSnap;
  try {
    refsSnap = await getDocs(collection(firestoreDb, 'users', userId, 'projectRefs'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, refsPath);
  }

  if (refsSnap.empty) return [];

  const results = await Promise.all(
    refsSnap.docs.map(async (refDoc): Promise<AccessibleProjectRaw | null> => {
      const refData = refDoc.data();
      const projectId = String(refData.projectId ?? refDoc.id);
      const role = String(refData.role ?? 'MEMBER') as ProjectRole;

      try {
        const projSnap = await getDoc(doc(firestoreDb, 'projects', projectId));
        if (!projSnap.exists()) return null;
        const data = projSnap.data();
        const ownerId = String(data.ownerId ?? '');
        return {
          id: projSnap.id,
          name: String(data.name ?? 'Untitled Project'),
          description: String(data.description ?? ''),
          status: String(data.status ?? 'ACTIVE') as ProjectStatus,
          startDate: nullableIso(data.startDate),
          deadline: nullableIso(data.deadline),
          ownerId,
          owner: {
            id: ownerId,
            name: String(data.ownerName ?? 'Owner'),
            email: String(data.ownerEmail ?? ''),
            avatar: typeof data.ownerAvatar === 'string' ? data.ownerAvatar : null,
          },
          role,
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      } catch {
        // Stale ref or removed access
        return null;
      }
    })
  );

  return results
    .filter((item): item is AccessibleProjectRaw => item !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listUserProjects(
  userId: string,
  filters?: { q?: string; status?: string }
): Promise<ProjectSummary[]> {
  const rawProjects = await getAccessibleProjectsRaw(userId);
  const queryText = filters?.q?.trim().toLowerCase() ?? '';
  const statusFilter = filters?.status?.trim() ?? '';

  const filtered = rawProjects.filter((p) => {
    if (statusFilter && statusFilter !== 'ALL' && p.status !== statusFilter) {
      return false;
    }
    if (queryText) {
      const hay = `${p.name} ${p.description}`.toLowerCase();
      if (!hay.includes(queryText)) return false;
    }
    return true;
  });

  return Promise.all(
    filtered.map(async (proj) => {
      const [membersSnap, tasksSnap] = await Promise.all([
        getDocs(collection(firestoreDb, 'projects', proj.id, 'members')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/members`)
        ),
        getDocs(collection(firestoreDb, 'projects', proj.id, 'tasks')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/tasks`)
        ),
      ]);

      const members = membersSnap.docs.map((m) => {
        const md = m.data();
        return {
          userId: String(md.userId ?? m.id),
          role: String(md.role ?? 'MEMBER'),
          name: String(md.name ?? 'Member'),
          email: String(md.email ?? ''),
          avatar: typeof md.avatar === 'string' ? md.avatar : null,
        };
      });

      let completedTasks = 0;
      let overdueTasks = 0;
      for (const td of tasksSnap.docs) {
        const t = td.data();
        const st = String(t.status ?? 'TODO');
        const due = nullableIso(t.dueDate);
        if (st === 'COMPLETED') completedTasks += 1;
        if (isOverdue(due, st)) overdueTasks += 1;
      }

      const totalTasks = tasksSnap.size;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        ...proj,
        totalTasks,
        completedTasks,
        overdueTasks,
        progress,
        memberCount: members.length,
        members,
      };
    })
  );
}

export async function createProject(
  actor: UserProfile,
  input: {
    name: string;
    description?: string;
    status?: ProjectStatus;
    startDate?: string | null;
    deadline?: string | null;
  }
): Promise<{ id: string; name: string }> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid project input.');
  }

  const projectId = generateSecureToken(12);
  const batch = writeBatch(firestoreDb);

  const projectRef = doc(firestoreDb, 'projects', projectId);
  const memberRef = doc(firestoreDb, 'projects', projectId, 'members', actor.uid);
  const userRefDoc = doc(firestoreDb, 'users', actor.uid, 'projectRefs', projectId);

  batch.set(projectRef, {
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    status: parsed.data.status,
    startDate: normalizeDateIsoInput(parsed.data.startDate),
    deadline: normalizeDateIsoInput(parsed.data.deadline),
    ownerId: actor.uid,
    ownerName: actor.name.slice(0, 80) || 'Owner',
    ownerEmail: actor.email,
    ownerAvatar: actor.avatar ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(memberRef, {
    projectId,
    userId: actor.uid,
    name: actor.name.slice(0, 80) || 'Owner',
    email: actor.email,
    avatar: actor.avatar ?? null,
    role: 'OWNER',
    inviteToken: null,
    joinedAt: serverTimestamp(),
  });

  batch.set(userRefDoc, {
    projectId,
    userId: actor.uid,
    role: 'OWNER',
    joinedAt: serverTimestamp(),
  });

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName: parsed.data.name,
    action: 'PROJECT_CREATED',
    resourceType: 'PROJECT',
    resourceName: parsed.data.name,
    details: `Created project "${parsed.data.name}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}`);
  }

  return { id: projectId, name: parsed.data.name };
}

export interface ProjectDetailResult {
  project: {
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    startDate: string | null;
    deadline: string | null;
    ownerId: string;
    owner: UserSummary;
    role: ProjectRole;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    todoTasks: number;
    overdueTasks: number;
    progress: number;
  };
  members: ProjectMemberItem[];
  tasks: TaskItem[];
  activities: ActivityItem[];
}

export async function getProjectDetails(
  userId: string,
  projectId: string
): Promise<ProjectDetailResult> {
  const role = await requireProjectRole(projectId, userId);

  const [projSnap, membersSnap, tasksSnap, activitiesSnap] = await Promise.all([
    getDoc(doc(firestoreDb, 'projects', projectId)).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `projects/${projectId}`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'members')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/members`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'tasks')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'activities')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/activities`)
    ),
  ]);

  if (!projSnap.exists()) {
    throw new AppError(404, 'Project not found.');
  }

  const pd = projSnap.data();
  const projectName = String(pd.name ?? 'Project');

  const members: ProjectMemberItem[] = membersSnap.docs
    .map((d) => {
      const md = d.data();
      return {
        id: d.id,
        userId: String(md.userId ?? d.id),
        role: String(md.role ?? 'MEMBER') as ProjectRole,
        joinedAt: timestampToIso(md.joinedAt),
        name: String(md.name ?? 'Member'),
        email: String(md.email ?? ''),
        avatar: typeof md.avatar === 'string' ? md.avatar : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const memberMap = new Map<string, UserSummary>();
  for (const m of members) {
    memberMap.set(m.userId, {
      id: m.userId,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
    });
  }

  const commentCounts = await Promise.all(
    tasksSnap.docs.map(async (td) => {
      try {
        const cSnap = await getDocs(
          collection(firestoreDb, 'projects', projectId, 'tasks', td.id, 'comments')
        );
        return [td.id, cSnap.size] as const;
      } catch {
        return [td.id, 0] as const;
      }
    })
  );
  const commentCountMap = new Map<string, number>(commentCounts);

  const tasks: TaskItem[] = tasksSnap.docs
    .map((td) => {
      const t = td.data();
      const assigneeId = typeof t.assigneeId === 'string' ? t.assigneeId : null;
      const createdById = String(t.createdById ?? '');
      return {
        id: td.id,
        title: String(t.title ?? ''),
        description: String(t.description ?? ''),
        status: String(t.status ?? 'TODO') as TaskStatus,
        priority: String(t.priority ?? 'MEDIUM') as TaskPriority,
        position: typeof t.position === 'number' ? t.position : 0,
        dueDate: nullableIso(t.dueDate),
        projectId,
        projectName,
        assigneeId,
        createdById,
        createdAt: timestampToIso(t.createdAt),
        updatedAt: timestampToIso(t.updatedAt),
        completedAt: nullableIso(t.completedAt),
        assignee: assigneeId ? memberMap.get(assigneeId) ?? null : null,
        createdBy: memberMap.get(createdById) ?? null,
        commentCount: commentCountMap.get(td.id) ?? 0,
      };
    })
    .sort((a, b) => a.position - b.position);

  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const todoTasks = tasks.filter((t) => t.status === 'TODO').length;
  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const activities: ActivityItem[] = activitiesSnap.docs
    .map((ad) => {
      const a = ad.data();
      return {
        id: ad.id,
        actorId: String(a.actorId ?? ''),
        actorName: String(a.actorName ?? 'Member'),
        actorAvatar: typeof a.actorAvatar === 'string' ? a.actorAvatar : null,
        projectId,
        projectName: String(a.projectName ?? projectName),
        taskId: typeof a.taskId === 'string' ? a.taskId : null,
        action: String(a.action ?? ''),
        resourceType: typeof a.resourceType === 'string' ? a.resourceType : undefined,
        resourceName: typeof a.resourceName === 'string' ? a.resourceName : undefined,
        details: typeof a.details === 'string' ? a.details : null,
        createdAt: timestampToIso(a.createdAt),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  return {
    project: {
      id: projSnap.id,
      name: projectName,
      description: String(pd.description ?? ''),
      status: String(pd.status ?? 'ACTIVE') as ProjectStatus,
      startDate: nullableIso(pd.startDate),
      deadline: nullableIso(pd.deadline),
      ownerId: String(pd.ownerId ?? ''),
      owner: {
        id: String(pd.ownerId ?? ''),
        name: String(pd.ownerName ?? 'Owner'),
        email: String(pd.ownerEmail ?? ''),
        avatar: typeof pd.ownerAvatar === 'string' ? pd.ownerAvatar : null,
      },
      role,
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      overdueTasks,
      progress,
    },
    members,
    tasks,
    activities,
  };
}

export async function updateProject(
  actor: UserProfile,
  projectId: string,
  input: {
    name?: string;
    description?: string;
    status?: ProjectStatus;
    startDate?: string | null;
    deadline?: string | null;
  }
): Promise<{ id: string }> {
  await requireProjectRole(projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid project update.');
  }

  const projRef = doc(firestoreDb, 'projects', projectId);
  let snap;
  try {
    snap = await getDoc(projRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `projects/${projectId}`);
  }
  if (!snap.exists()) {
    throw new AppError(404, 'Project not found.');
  }

  const existing = snap.data();
  const nextName = parsed.data.name ?? String(existing.name ?? 'Project');

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.startDate !== undefined) {
    patch.startDate = normalizeDateIsoInput(parsed.data.startDate);
  }
  if (parsed.data.deadline !== undefined) {
    patch.deadline = normalizeDateIsoInput(parsed.data.deadline);
  }

  const batch = writeBatch(firestoreDb);
  batch.update(projRef, patch);
  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName: nextName,
    action: 'PROJECT_UPDATED',
    resourceType: 'PROJECT',
    resourceName: nextName,
    details: `Updated project "${nextName}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
  }

  return { id: projectId };
}

export async function deleteProject(actor: UserProfile, projectId: string): Promise<void> {
  await requireProjectRole(projectId, actor.uid, ['OWNER']);

  const [tasksSnap, activitiesSnap, membersSnap, invitationsSnap] = await Promise.all([
    getDocs(collection(firestoreDb, 'projects', projectId, 'tasks')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'activities')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/activities`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'members')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/members`)
    ),
    getDocs(
      query(
        collection(firestoreDb, 'invitations'),
        where('projectOwnerId', '==', actor.uid)
      )
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations')),
  ]);

  const commentRefs: Array<ReturnType<typeof doc>> = [];
  await Promise.all(
    tasksSnap.docs.map(async (td) => {
      const cSnap = await getDocs(
        collection(firestoreDb, 'projects', projectId, 'tasks', td.id, 'comments')
      );
      for (const cd of cSnap.docs) {
        commentRefs.push(cd.ref);
      }
    })
  );

  // 1. Delete comments first
  if (commentRefs.length > 0) {
    await commitOperationsInChunks(
      commentRefs.map((ref) => (b) => b.delete(ref))
    );
  }

  // 2. Delete tasks, activities, and project invitations
  const cleanupOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const td of tasksSnap.docs) {
    cleanupOps.push((b) => b.delete(td.ref));
  }
  for (const ad of activitiesSnap.docs) {
    cleanupOps.push((b) => b.delete(ad.ref));
  }
  for (const invDoc of invitationsSnap.docs) {
    if (String(invDoc.data().projectId ?? '') === projectId) {
      cleanupOps.push((b) => b.delete(invDoc.ref));
    }
  }
  if (cleanupOps.length > 0) {
    await commitOperationsInChunks(cleanupOps);
  }

  // 3. Delete members, user projectRefs, and project root in one atomic batch
  const finalBatch = writeBatch(firestoreDb);
  for (const md of membersSnap.docs) {
    finalBatch.delete(md.ref);
    finalBatch.delete(doc(firestoreDb, 'users', md.id, 'projectRefs', projectId));
  }
  finalBatch.delete(doc(firestoreDb, 'projects', projectId));

  try {
    await finalBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}`);
  }
}

export async function seedStarterWorkspace(actor: UserProfile): Promise<{ seeded: boolean }> {
  const existing = await getAccessibleProjectsRaw(actor.uid);
  if (existing.length > 0) {
    return { seeded: false };
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const p1Id = generateSecureToken(12);
  const p2Id = generateSecureToken(12);

  // Batch 1: Projects + Owner Memberships + ProjectRefs + Project Activities
  const batch1 = writeBatch(firestoreDb);

  const starterProjects = [
    {
      id: p1Id,
      name: 'DevTrack Cloud Platform',
      description:
        'Core workspace workflows, Firebase Authentication, Cloud Firestore security rules, and real-time project collaboration.',
      status: 'ACTIVE' as ProjectStatus,
      startDate: new Date(now - 7 * dayMs).toISOString(),
      deadline: new Date(now + 21 * dayMs).toISOString(),
    },
    {
      id: p2Id,
      name: 'Analytics & Telemetry UI',
      description:
        'Sprint velocity charts, deliverable deadline tracking, and executive engineering KPI rollups.',
      status: 'PLANNING' as ProjectStatus,
      startDate: new Date(now - 2 * dayMs).toISOString(),
      deadline: new Date(now + 35 * dayMs).toISOString(),
    },
  ];

  for (const sp of starterProjects) {
    batch1.set(doc(firestoreDb, 'projects', sp.id), {
      name: sp.name,
      description: sp.description,
      status: sp.status,
      startDate: sp.startDate,
      deadline: sp.deadline,
      ownerId: actor.uid,
      ownerName: actor.name.slice(0, 80) || 'Owner',
      ownerEmail: actor.email,
      ownerAvatar: actor.avatar ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch1.set(doc(firestoreDb, 'projects', sp.id, 'members', actor.uid), {
      projectId: sp.id,
      userId: actor.uid,
      name: actor.name.slice(0, 80) || 'Owner',
      email: actor.email,
      avatar: actor.avatar ?? null,
      role: 'OWNER',
      inviteToken: null,
      joinedAt: serverTimestamp(),
    });

    batch1.set(doc(firestoreDb, 'users', actor.uid, 'projectRefs', sp.id), {
      projectId: sp.id,
      userId: actor.uid,
      role: 'OWNER',
      joinedAt: serverTimestamp(),
    });

    addActivityToBatch(batch1, {
      actor,
      projectId: sp.id,
      projectName: sp.name,
      action: 'PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceName: sp.name,
      details: `Created starter project "${sp.name}"`,
    });
  }

  try {
    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'starter-projects');
  }

  // Batch 2: Starter tasks (committed after members exist so isProjectMember() passes)
  const batch2 = writeBatch(firestoreDb);
  const firstTaskId = generateSecureToken(12);

  const starterTasks: Array<{
    id: string;
    projectId: string;
    projectName: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    position: number;
    dueDate: string;
    completed: boolean;
  }> = [
    {
      id: firstTaskId,
      projectId: p1Id,
      projectName: starterProjects[0].name,
      title: 'Audit Firestore security rules & project RBAC',
      description:
        'Verify project membership checks, role boundaries, and least-privilege document validation across collections.',
      status: 'COMPLETED',
      priority: 'HIGH',
      position: 0,
      dueDate: new Date(now - 1 * dayMs).toISOString(),
      completed: true,
    },
    {
      id: generateSecureToken(12),
      projectId: p1Id,
      projectName: starterProjects[0].name,
      title: 'Configure Firebase Auth providers & authorized domains',
      description:
        'Confirm Email/Password and Google Sign-In methods are active for local preview and Vercel production.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      position: 0,
      dueDate: new Date(now + 1 * dayMs).toISOString(),
      completed: false,
    },
    {
      id: generateSecureToken(12),
      projectId: p1Id,
      projectName: starterProjects[0].name,
      title: 'Invite engineering collaborators via token workflow',
      description:
        'Generate single-use invitations from Team or Project Overview to onboard teammates cleanly.',
      status: 'TODO',
      priority: 'MEDIUM',
      position: 0,
      dueDate: new Date(now + 4 * dayMs).toISOString(),
      completed: false,
    },
    {
      id: generateSecureToken(12),
      projectId: p2Id,
      projectName: starterProjects[1].name,
      title: 'Benchmark Kanban board drag-and-drop transitions',
      description:
        'Validate optimistic card reordering and completion timestamp updates across workflow stages.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      position: 0,
      dueDate: new Date(now + 3 * dayMs).toISOString(),
      completed: false,
    },
    {
      id: generateSecureToken(12),
      projectId: p2Id,
      projectName: starterProjects[1].name,
      title: 'Publish sprint burndown telemetry widgets',
      description:
        'Ensure task completion trends and workload aggregates update dynamically from Cloud Firestore.',
      status: 'TODO',
      priority: 'LOW',
      position: 0,
      dueDate: new Date(now + 9 * dayMs).toISOString(),
      completed: false,
    },
  ];

  for (const st of starterTasks) {
    batch2.set(doc(firestoreDb, 'projects', st.projectId, 'tasks', st.id), {
      projectId: st.projectId,
      projectName: st.projectName,
      title: st.title,
      description: st.description,
      status: st.status,
      priority: st.priority,
      position: st.position,
      dueDate: st.dueDate,
      assigneeId: actor.uid,
      createdById: actor.uid,
      completedAt: st.completed ? serverTimestamp() : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    addActivityToBatch(batch2, {
      actor,
      projectId: st.projectId,
      projectName: st.projectName,
      taskId: st.id,
      action: 'TASK_CREATED',
      resourceType: 'TASK',
      resourceName: st.title,
      details: `Created task "${st.title}"`,
    });
  }

  try {
    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'starter-tasks');
  }

  // Batch 3: Starter comment (committed after task exists so exists(.../tasks/{tid}) passes)
  const batch3 = writeBatch(firestoreDb);
  batch3.set(
    doc(
      firestoreDb,
      'projects',
      p1Id,
      'tasks',
      firstTaskId,
      'comments',
      generateSecureToken(12)
    ),
    {
      projectId: p1Id,
      taskId: firstTaskId,
      authorId: actor.uid,
      authorName: actor.name.slice(0, 80) || 'Owner',
      authorEmail: actor.email,
      authorAvatar: actor.avatar ?? null,
      content:
        'Workspace initialized on Cloud Firestore with role-based access rules enforced per project.',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );

  try {
    await batch3.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'starter-comment');
  }

  return { seeded: true };
}

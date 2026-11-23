import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  AppError,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  commentSchema,
  createTaskSchema,
  moveTaskSchema,
  updateTaskSchema,
  type TaskPriority,
  type TaskStatus,
} from '../lib/validations';
import type {
  ActivityItem,
  ProjectMemberItem,
  TaskCommentItem,
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
  rawTimestampOrNull,
  requireProjectRole,
  timestampToIso,
} from './firestore-helpers';
import { sendProjectNotification } from './notifications';
import { getAccessibleProjectsRaw } from './projects';

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

async function findTaskLocation(
  userId: string,
  taskId: string,
  projectIdHint?: string
): Promise<{
  projectId: string;
  taskSnap: Awaited<ReturnType<typeof getDoc>>;
}> {
  if (projectIdHint) {
    const snap = await getDoc(
      doc(firestoreDb, 'projects', projectIdHint, 'tasks', taskId)
    ).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `projects/${projectIdHint}/tasks/${taskId}`)
    );
    if (!snap.exists()) {
      throw new AppError(404, 'Task not found.');
    }
    return { projectId: projectIdHint, taskSnap: snap };
  }

  const projects = await getAccessibleProjectsRaw(userId);
  for (const proj of projects) {
    try {
      const snap = await getDoc(doc(firestoreDb, 'projects', proj.id, 'tasks', taskId));
      if (snap.exists()) {
        return { projectId: proj.id, taskSnap: snap };
      }
    } catch {
      // Continue searching accessible projects
    }
  }

  throw new AppError(404, 'Task not found.');
}

function mapMemberSummaries(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): Map<string, UserSummary> {
  const map = new Map<string, UserSummary>();
  for (const d of docs) {
    const data = d.data();
    const uid = String(data.userId ?? d.id);
    map.set(uid, {
      id: uid,
      name: String(data.name ?? 'Member'),
      email: String(data.email ?? ''),
      avatar: typeof data.avatar === 'string' ? data.avatar : null,
    });
  }
  return map;
}

export async function listUserTasks(
  userId: string,
  filters?: {
    projectId?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    q?: string;
    sort?: string;
  }
): Promise<TaskItem[]> {
  const projects = await getAccessibleProjectsRaw(userId);
  const targetProjects =
    filters?.projectId && filters.projectId !== 'ALL'
      ? projects.filter((p) => p.id === filters.projectId)
      : projects;

  const allTasks: TaskItem[] = [];

  await Promise.all(
    targetProjects.map(async (proj) => {
      const [membersSnap, tasksSnap] = await Promise.all([
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
      ]);

      const memberMap = mapMemberSummaries(membersSnap.docs);

      const commentCounts = await Promise.all(
        tasksSnap.docs.map(async (td) => {
          try {
            const cSnap = await getDocs(
              query(
                collection(firestoreDb, 'projects', proj.id, 'tasks', td.id, 'comments'),
                where('projectId', '==', proj.id)
              )
            );
            return [td.id, cSnap.size] as const;
          } catch {
            return [td.id, 0] as const;
          }
        })
      );
      const commentMap = new Map<string, number>(commentCounts);

      for (const td of tasksSnap.docs) {
        const t = td.data();
        const assigneeId = typeof t.assigneeId === 'string' ? t.assigneeId : null;
        const createdById = String(t.createdById ?? '');
        allTasks.push({
          id: td.id,
          title: String(t.title ?? ''),
          description: String(t.description ?? ''),
          status: String(t.status ?? 'TODO') as TaskStatus,
          priority: String(t.priority ?? 'MEDIUM') as TaskPriority,
          position: typeof t.position === 'number' ? t.position : 0,
          dueDate: nullableIso(t.dueDate),
          projectId: proj.id,
          projectName: proj.name,
          assigneeId,
          createdById,
          createdAt: timestampToIso(t.createdAt),
          updatedAt: timestampToIso(t.updatedAt),
          completedAt: nullableIso(t.completedAt),
          assignee: assigneeId ? memberMap.get(assigneeId) ?? null : null,
          createdBy: memberMap.get(createdById) ?? null,
          commentCount: commentMap.get(td.id) ?? 0,
        });
      }
    })
  );

  const qLower = filters?.q?.trim().toLowerCase() ?? '';
  const filtered = allTasks.filter((t) => {
    if (filters?.status && filters.status !== 'ALL' && t.status !== filters.status) {
      return false;
    }
    if (filters?.priority && filters.priority !== 'ALL' && t.priority !== filters.priority) {
      return false;
    }
    if (filters?.assignee === 'ME' && t.assigneeId !== userId) {
      return false;
    }
    if (filters?.assignee === 'UNASSIGNED' && t.assigneeId !== null) {
      return false;
    }
    if (
      filters?.assignee &&
      !['ALL', 'ME', 'UNASSIGNED'].includes(filters.assignee) &&
      t.assigneeId !== filters.assignee
    ) {
      return false;
    }
    if (qLower) {
      const hay = `${t.title} ${t.description} ${t.projectName ?? ''}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  const sortKey = filters?.sort ?? 'position';
  filtered.sort((a, b) => {
    if (sortKey === 'dueDate') {
      if (!a.dueDate && !b.dueDate) return a.position - b.position;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    if (sortKey === 'priority') {
      return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    }
    if (sortKey === 'updatedAt') {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    return a.position - b.position;
  });

  return filtered;
}

export async function createTask(
  actor: UserProfile,
  input: {
    projectId: string;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: string | null;
  }
): Promise<{ id: string; projectId: string }> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid task input.');
  }

  const projectId = parsed.data.projectId;
  await requireProjectRole(projectId, actor.uid);

  const [projSnap, membersSnap, tasksSnap] = await Promise.all([
    getDoc(doc(firestoreDb, 'projects', projectId)).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `projects/${projectId}`)
    ),
    getDocs(
      query(
        collection(firestoreDb, 'projects', projectId, 'members'),
        where('projectId', '==', projectId)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/members`)
    ),
    getDocs(
      query(
        collection(firestoreDb, 'projects', projectId, 'tasks'),
        where('projectId', '==', projectId)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks`)
    ),
  ]);

  if (!projSnap.exists()) {
    throw new AppError(404, 'Project not found.');
  }

  const projectName = String(projSnap.data().name ?? 'Project');
  const assigneeId = parsed.data.assigneeId ?? null;
  if (assigneeId && !membersSnap.docs.some((m) => m.id === assigneeId)) {
    throw new AppError(400, 'Selected assignee is not a member of this project.');
  }

  let maxPos = -1;
  for (const td of tasksSnap.docs) {
    const pos = typeof td.data().position === 'number' ? td.data().position : 0;
    if (td.data().status === parsed.data.status && pos > maxPos) {
      maxPos = pos;
    }
  }

  const taskId = generateSecureToken(12);
  const taskRef = doc(firestoreDb, 'projects', projectId, 'tasks', taskId);
  const batch = writeBatch(firestoreDb);

  batch.set(taskRef, {
    projectId,
    projectName: projectName.slice(0, 120),
    title: parsed.data.title,
    description: parsed.data.description ?? '',
    status: parsed.data.status,
    priority: parsed.data.priority,
    position: maxPos + 1,
    dueDate: normalizeDateIsoInput(parsed.data.dueDate),
    assigneeId,
    createdById: actor.uid,
    completedAt: parsed.data.status === 'COMPLETED' ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    taskId,
    action: 'TASK_CREATED',
    resourceType: 'TASK',
    resourceName: parsed.data.title,
    details: `Created task "${parsed.data.title}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}/tasks/${taskId}`);
  }

  if (assigneeId && assigneeId !== actor.uid) {
    await sendProjectNotification({
      recipientUid: assigneeId,
      actorUid: actor.uid,
      projectId,
      type: 'TASK_ASSIGNED',
      title: 'Task assigned to you',
      message: `${actor.name} assigned you "${parsed.data.title}" in ${projectName}.`,
      link: `/projects/${projectId}?task=${taskId}`,
    });
  }

  return { id: taskId, projectId };
}

export async function getTaskDetails(
  userId: string,
  taskId: string,
  projectIdHint?: string
): Promise<{
  task: TaskItem;
  comments: TaskCommentItem[];
  activities: ActivityItem[];
  projectMembers: ProjectMemberItem[];
}> {
  const { projectId, taskSnap } = await findTaskLocation(userId, taskId, projectIdHint);
  await requireProjectRole(projectId, userId);

  const [membersSnap, commentsSnap, activitiesSnap] = await Promise.all([
    getDocs(
      query(
        collection(firestoreDb, 'projects', projectId, 'members'),
        where('projectId', '==', projectId)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/members`)
    ),
    getDocs(
      query(
        collection(firestoreDb, 'projects', projectId, 'tasks', taskId, 'comments'),
        where('projectId', '==', projectId)
      )
    ).catch((err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `projects/${projectId}/tasks/${taskId}/comments`
      )
    ),
    getDocs(
      query(
        collection(firestoreDb, 'projects', projectId, 'activities'),
        where('projectId', '==', projectId)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/activities`)
    ),
  ]);

  const projectMembers: ProjectMemberItem[] = membersSnap.docs.map((d) => {
    const md = d.data();
    return {
      id: d.id,
      userId: String(md.userId ?? d.id),
      role: String(md.role ?? 'MEMBER') as ProjectMemberItem['role'],
      joinedAt: timestampToIso(md.joinedAt),
      name: String(md.name ?? 'Member'),
      email: String(md.email ?? ''),
      avatar: typeof md.avatar === 'string' ? md.avatar : null,
    };
  });
  const memberMap = mapMemberSummaries(membersSnap.docs);

  const t: DocumentData = taskSnap.data() ?? {};
  const assigneeId = typeof t.assigneeId === 'string' ? t.assigneeId : null;
  const createdById = String(t.createdById ?? '');

  const task: TaskItem = {
    id: taskSnap.id,
    title: String(t.title ?? ''),
    description: String(t.description ?? ''),
    status: String(t.status ?? 'TODO') as TaskStatus,
    priority: String(t.priority ?? 'MEDIUM') as TaskPriority,
    position: typeof t.position === 'number' ? t.position : 0,
    dueDate: nullableIso(t.dueDate),
    projectId,
    projectName: String(t.projectName ?? 'Project'),
    assigneeId,
    createdById,
    createdAt: timestampToIso(t.createdAt),
    updatedAt: timestampToIso(t.updatedAt),
    completedAt: nullableIso(t.completedAt),
    assignee: assigneeId ? memberMap.get(assigneeId) ?? null : null,
    createdBy: memberMap.get(createdById) ?? null,
    commentCount: commentsSnap.size,
  };

  const comments: TaskCommentItem[] = commentsSnap.docs
    .map((cd) => {
      const c = cd.data();
      return {
        id: cd.id,
        taskId,
        authorId: String(c.authorId ?? ''),
        authorName: String(c.authorName ?? 'Member'),
        authorEmail: String(c.authorEmail ?? ''),
        authorAvatar: typeof c.authorAvatar === 'string' ? c.authorAvatar : null,
        content: String(c.content ?? ''),
        createdAt: timestampToIso(c.createdAt),
        updatedAt: timestampToIso(c.updatedAt),
      };
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const activities: ActivityItem[] = activitiesSnap.docs
    .map((ad) => {
      const a = ad.data();
      return {
        id: ad.id,
        actorId: String(a.actorId ?? ''),
        actorName: String(a.actorName ?? 'Member'),
        actorAvatar: typeof a.actorAvatar === 'string' ? a.actorAvatar : null,
        projectId,
        projectName: String(a.projectName ?? task.projectName ?? 'Project'),
        taskId: typeof a.taskId === 'string' ? a.taskId : null,
        action: String(a.action ?? ''),
        resourceType: typeof a.resourceType === 'string' ? a.resourceType : undefined,
        resourceName: typeof a.resourceName === 'string' ? a.resourceName : undefined,
        details: typeof a.details === 'string' ? a.details : null,
        createdAt: timestampToIso(a.createdAt),
      };
    })
    .filter((a) => a.taskId === taskId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { task, comments, activities, projectMembers };
}

export async function updateTask(
  actor: UserProfile,
  taskId: string,
  input: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: string | null;
    position?: number;
  },
  projectIdHint?: string
): Promise<void> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid task update.');
  }

  const { projectId, taskSnap } = await findTaskLocation(actor.uid, taskId, projectIdHint);
  await requireProjectRole(projectId, actor.uid);

  const existing: DocumentData = taskSnap.data() ?? {};
  const projectName = String(existing.projectName ?? 'Project');

  if (parsed.data.assigneeId) {
    const memberSnap = await getDoc(
      doc(firestoreDb, 'projects', projectId, 'members', parsed.data.assigneeId)
    );
    if (!memberSnap.exists()) {
      throw new AppError(400, 'Selected assignee is not a member of this project.');
    }
  }

  const nextStatus = parsed.data.status ?? (String(existing.status ?? 'TODO') as TaskStatus);
  const nextTitle = parsed.data.title ?? String(existing.title ?? 'Task');
  const prevAssignee = typeof existing.assigneeId === 'string' ? existing.assigneeId : null;
  const nextAssignee =
    parsed.data.assigneeId !== undefined ? parsed.data.assigneeId : prevAssignee;

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;
  if (parsed.data.dueDate !== undefined) {
    patch.dueDate = normalizeDateIsoInput(parsed.data.dueDate);
  }
  if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;

  if (nextStatus === 'COMPLETED' && existing.status !== 'COMPLETED') {
    patch.completedAt = serverTimestamp();
  } else if (nextStatus !== 'COMPLETED') {
    patch.completedAt = null;
  } else {
    patch.completedAt = rawTimestampOrNull(existing.completedAt);
  }

  const batch = writeBatch(firestoreDb);
  batch.update(doc(firestoreDb, 'projects', projectId, 'tasks', taskId), patch);

  const actionName =
    nextStatus === 'COMPLETED' && existing.status !== 'COMPLETED'
      ? 'TASK_COMPLETED'
      : 'TASK_UPDATED';
  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    taskId,
    action: actionName,
    resourceType: 'TASK',
    resourceName: nextTitle,
    details:
      actionName === 'TASK_COMPLETED'
        ? `Completed task "${nextTitle}"`
        : `Updated task "${nextTitle}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}/tasks/${taskId}`);
  }

  if (nextAssignee && nextAssignee !== prevAssignee && nextAssignee !== actor.uid) {
    await sendProjectNotification({
      recipientUid: nextAssignee,
      actorUid: actor.uid,
      projectId,
      type: 'TASK_ASSIGNED',
      title: 'Task assigned to you',
      message: `${actor.name} assigned you "${nextTitle}" in ${projectName}.`,
      link: `/projects/${projectId}?task=${taskId}`,
    });
  } else if (
    nextStatus === 'COMPLETED' &&
    existing.status !== 'COMPLETED' &&
    typeof existing.createdById === 'string' &&
    existing.createdById !== actor.uid
  ) {
    await sendProjectNotification({
      recipientUid: existing.createdById,
      actorUid: actor.uid,
      projectId,
      type: 'TASK_UPDATED',
      title: 'Task completed',
      message: `${actor.name} marked "${nextTitle}" as completed.`,
      link: `/projects/${projectId}?task=${taskId}`,
    });
  }
}

export async function moveTask(
  actor: UserProfile,
  taskId: string,
  input: { status: TaskStatus; position: number },
  projectIdHint?: string
): Promise<void> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid move payload.');
  }

  const { projectId, taskSnap } = await findTaskLocation(actor.uid, taskId, projectIdHint);
  await requireProjectRole(projectId, actor.uid);

  const existing: DocumentData = taskSnap.data() ?? {};
  const projectName = String(existing.projectName ?? 'Project');
  const title = String(existing.title ?? 'Task');

  let completedAt: ReturnType<typeof serverTimestamp> | ReturnType<typeof rawTimestampOrNull> = null;
  if (parsed.data.status === 'COMPLETED') {
    completedAt =
      existing.status !== 'COMPLETED'
        ? serverTimestamp()
        : rawTimestampOrNull(existing.completedAt) ?? serverTimestamp();
  }

  const batch = writeBatch(firestoreDb);
  batch.update(doc(firestoreDb, 'projects', projectId, 'tasks', taskId), {
    status: parsed.data.status,
    position: parsed.data.position,
    completedAt,
    updatedAt: serverTimestamp(),
  });

  const action =
    parsed.data.status === 'COMPLETED' && existing.status !== 'COMPLETED'
      ? 'TASK_COMPLETED'
      : 'TASK_MOVED';

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    taskId,
    action,
    resourceType: 'TASK',
    resourceName: title,
    details:
      action === 'TASK_COMPLETED'
        ? `Completed task "${title}"`
        : `Moved "${title}" to ${parsed.data.status.replace('_', ' ')}`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}/tasks/${taskId}`);
  }
}

export async function deleteTask(
  actor: UserProfile,
  taskId: string,
  projectIdHint?: string
): Promise<void> {
  const { projectId, taskSnap } = await findTaskLocation(actor.uid, taskId, projectIdHint);
  await requireProjectRole(projectId, actor.uid);

  const existing: DocumentData = taskSnap.data() ?? {};
  const projectName = String(existing.projectName ?? 'Project');
  const title = String(existing.title ?? 'Task');

  const commentsSnap = await getDocs(
    query(
      collection(firestoreDb, 'projects', projectId, 'tasks', taskId, 'comments'),
      where('projectId', '==', projectId)
    )
  ).catch((err) =>
    handleFirestoreError(
      err,
      OperationType.LIST,
      `projects/${projectId}/tasks/${taskId}/comments`
    )
  );

  if (!commentsSnap.empty) {
    await commitOperationsInChunks(
      commentsSnap.docs.map((c) => (b) => b.delete(c.ref))
    );
  }

  const batch = writeBatch(firestoreDb);
  batch.delete(doc(firestoreDb, 'projects', projectId, 'tasks', taskId));
  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    taskId: null,
    action: 'TASK_DELETED',
    resourceType: 'TASK',
    resourceName: title,
    details: `Deleted task "${title}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}/tasks/${taskId}`);
  }
}

export async function addTaskComment(
  actor: UserProfile,
  taskId: string,
  content: string,
  projectIdHint?: string
): Promise<TaskCommentItem> {
  const parsed = commentSchema.safeParse({ content });
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Comment cannot be empty.');
  }

  const { projectId, taskSnap } = await findTaskLocation(actor.uid, taskId, projectIdHint);
  await requireProjectRole(projectId, actor.uid);

  const taskData: DocumentData = taskSnap.data() ?? {};
  const projectName = String(taskData.projectName ?? 'Project');
  const taskTitle = String(taskData.title ?? 'Task');

  const commentId = generateSecureToken(12);
  const commentRef = doc(
    firestoreDb,
    'projects',
    projectId,
    'tasks',
    taskId,
    'comments',
    commentId
  );

  const batch = writeBatch(firestoreDb);
  batch.set(commentRef, {
    projectId,
    taskId,
    authorId: actor.uid,
    authorName: actor.name.slice(0, 80) || 'Member',
    authorEmail: actor.email,
    authorAvatar: actor.avatar ?? null,
    content: parsed.data.content,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    taskId,
    action: 'COMMENT_ADDED',
    resourceType: 'TASK',
    resourceName: taskTitle,
    details: `Commented on "${taskTitle}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `projects/${projectId}/tasks/${taskId}/comments/${commentId}`
    );
  }

  const notifyUids = new Set<string>();
  if (typeof taskData.assigneeId === 'string' && taskData.assigneeId !== actor.uid) {
    notifyUids.add(taskData.assigneeId);
  }
  if (typeof taskData.createdById === 'string' && taskData.createdById !== actor.uid) {
    notifyUids.add(taskData.createdById);
  }

  await Promise.all(
    Array.from(notifyUids).map((recipientUid) =>
      sendProjectNotification({
        recipientUid,
        actorUid: actor.uid,
        projectId,
        type: 'TASK_COMMENT',
        title: `New comment on "${taskTitle}"`,
        message: `${actor.name}: ${parsed.data.content.slice(0, 140)}`,
        link: `/projects/${projectId}?task=${taskId}`,
      })
    )
  );

  const nowIso = new Date().toISOString();
  return {
    id: commentId,
    taskId,
    authorId: actor.uid,
    authorName: actor.name,
    authorEmail: actor.email,
    authorAvatar: actor.avatar ?? null,
    content: parsed.data.content,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function updateTaskComment(
  actor: UserProfile,
  projectId: string,
  taskId: string,
  commentId: string,
  content: string
): Promise<void> {
  const parsed = commentSchema.safeParse({ content });
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Comment cannot be empty.');
  }

  await requireProjectRole(projectId, actor.uid);

  const ref = doc(firestoreDb, 'projects', projectId, 'tasks', taskId, 'comments', commentId);
  const snap = await getDoc(ref).catch((err) =>
    handleFirestoreError(
      err,
      OperationType.GET,
      `projects/${projectId}/tasks/${taskId}/comments/${commentId}`
    )
  );

  if (!snap.exists()) {
    throw new AppError(404, 'Comment not found.');
  }
  if (String(snap.data().authorId ?? '') !== actor.uid) {
    throw new AppError(403, 'You can only edit your own comments.');
  }

  try {
    await updateDoc(ref, {
      content: parsed.data.content,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `projects/${projectId}/tasks/${taskId}/comments/${commentId}`
    );
  }
}

export async function deleteTaskComment(
  actor: UserProfile,
  projectId: string,
  taskId: string,
  commentId: string
): Promise<void> {
  const role = await requireProjectRole(projectId, actor.uid);

  const ref = doc(firestoreDb, 'projects', projectId, 'tasks', taskId, 'comments', commentId);
  const snap = await getDoc(ref).catch((err) =>
    handleFirestoreError(
      err,
      OperationType.GET,
      `projects/${projectId}/tasks/${taskId}/comments/${commentId}`
    )
  );

  if (!snap.exists()) {
    throw new AppError(404, 'Comment not found.');
  }
  const authorId = String(snap.data().authorId ?? '');
  if (authorId !== actor.uid && role !== 'OWNER' && role !== 'ADMINISTRATOR') {
    throw new AppError(403, 'You do not have permission to delete this comment.');
  }

  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `projects/${projectId}/tasks/${taskId}/comments/${commentId}`
    );
  }
}

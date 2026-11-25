import { AppError } from '../lib/firebase';
import { canRemoveTargetMember } from '../lib/permissions';
import { isOverdue } from '../lib/utils';
import {
  acceptInvitationSchema,
  commentSchema,
  createProjectSchema,
  createTaskSchema,
  inviteMemberSchema,
  moveTaskSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
  updateTaskSchema,
  updateUserSettingsSchema,
  type ProjectRole,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from '../lib/validations';
import type { ProjectDetailResult } from '../services/projects';
import type { TeamMemberSummary } from '../services/team';
import type {
  ActivityItem,
  DashboardAnalytics,
  InvitationItem,
  NotificationItem,
  ProjectMemberItem,
  ProjectSummary,
  TaskCommentItem,
  TaskItem,
  UserProfile,
  UserSummary,
} from '../types/app';
import {
  createInitialDemoWorkspace,
  DEMO_TEAM_DIRECTORY,
  type DemoInvitationRecord,
  type DemoTaskRecord,
  type DemoWorkspaceState,
} from './demo-seed';
import {
  DEMO_USER_ID,
  DEMO_WORKSPACE_STORAGE_KEY,
} from './demo-session';

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH = 340000;

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

let memoryWorkspaceFallback: DemoWorkspaceState | null = null;

function generateDemoId(prefix: string): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

function normalizeDateIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cloneWorkspace(state: DemoWorkspaceState): DemoWorkspaceState {
  return JSON.parse(JSON.stringify(state)) as DemoWorkspaceState;
}

function isValidDemoWorkspace(candidate: unknown): candidate is DemoWorkspaceState {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Partial<DemoWorkspaceState>;
  return (
    obj.version === 1 &&
    Boolean(obj.profile && obj.profile.uid === DEMO_USER_ID) &&
    Array.isArray(obj.projects) &&
    Array.isArray(obj.members) &&
    Array.isArray(obj.tasks) &&
    Array.isArray(obj.comments) &&
    Array.isArray(obj.activities) &&
    Array.isArray(obj.notifications) &&
    Array.isArray(obj.invitations)
  );
}

export function loadDemoWorkspace(): DemoWorkspaceState {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(DEMO_WORKSPACE_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidDemoWorkspace(parsed)) {
          memoryWorkspaceFallback = cloneWorkspace(parsed);
          return cloneWorkspace(parsed);
        }
      }
    } catch {
      // Ignore storage access or malformed JSON and fall back cleanly
    }
  }

  if (memoryWorkspaceFallback) {
    return cloneWorkspace(memoryWorkspaceFallback);
  }

  const seeded = createInitialDemoWorkspace();
  saveDemoWorkspace(seeded);
  return cloneWorkspace(seeded);
}

export function saveDemoWorkspace(state: DemoWorkspaceState): DemoWorkspaceState {
  const snapshot = cloneWorkspace(state);
  memoryWorkspaceFallback = snapshot;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DEMO_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Memory fallback preserves session if storage quota/incognito blocks writes
    }
  }

  return cloneWorkspace(snapshot);
}

export function resetDemoWorkspace(): DemoWorkspaceState {
  const fresh = createInitialDemoWorkspace();
  return saveDemoWorkspace(fresh);
}

export function clearDemoMemoryCacheForTests(): void {
  memoryWorkspaceFallback = null;
}

export function getDemoProfile(): UserProfile {
  return loadDemoWorkspace().profile;
}

export function updateDemoProfileSettings(input: {
  name?: string;
  avatar?: string | null;
  themePreference?: 'dark' | 'light';
  notifyOnAssign?: boolean;
  notifyOnComment?: boolean;
  notifyOnInvite?: boolean;
  notifyOnDeadline?: boolean;
}): UserProfile {
  const parsed = updateUserSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid settings input.');
  }

  const state = loadDemoWorkspace();
  const nowIso = new Date().toISOString();

  const nextName =
    parsed.data.name !== undefined ? parsed.data.name.trim().slice(0, 80) : state.profile.name;
  const nextAvatar =
    parsed.data.avatar !== undefined ? parsed.data.avatar : state.profile.avatar;

  state.profile = {
    ...state.profile,
    name: nextName,
    avatar: nextAvatar,
    themePreference: parsed.data.themePreference ?? state.profile.themePreference,
    notifyOnAssign: parsed.data.notifyOnAssign ?? state.profile.notifyOnAssign,
    notifyOnComment: parsed.data.notifyOnComment ?? state.profile.notifyOnComment,
    notifyOnInvite: parsed.data.notifyOnInvite ?? state.profile.notifyOnInvite,
    notifyOnDeadline: parsed.data.notifyOnDeadline ?? state.profile.notifyOnDeadline,
    updatedAt: nowIso,
  };

  if (parsed.data.name !== undefined || parsed.data.avatar !== undefined) {
    for (const m of state.members) {
      if (m.userId === DEMO_USER_ID) {
        m.name = nextName;
        m.avatar = nextAvatar;
      }
    }
    for (const c of state.comments) {
      if (c.authorId === DEMO_USER_ID) {
        c.authorName = nextName;
        c.authorAvatar = nextAvatar;
      }
    }
    for (const act of state.activities) {
      if (act.actorId === DEMO_USER_ID) {
        act.actorName = nextName;
        act.actorAvatar = nextAvatar;
      }
    }
    for (const inv of state.invitations) {
      if (inv.invitedById === DEMO_USER_ID) {
        inv.invitedByName = nextName;
      }
    }
  }

  saveDemoWorkspace(state);
  return state.profile;
}

async function compressDemoImageToDataUrl(file: File): Promise<string> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new AppError(400, 'Browser image processing is unavailable.');
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(objectUrl);
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new AppError(400, 'Browser image processing is unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/webp', 0.82);
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH || !dataUrl.startsWith('data:image/')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        }
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.55);
        }
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
          reject(new AppError(400, 'Image is too large after compression. Choose a smaller image.'));
          return;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new AppError(400, 'Unable to read the selected image file.'));
    };
    img.src = objectUrl;
  });
}

export async function uploadDemoAvatarFile(file: File): Promise<UserProfile> {
  const normalizedType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (!ALLOWED_AVATAR_TYPES.has(normalizedType)) {
    throw new AppError(400, 'Please select a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new AppError(400, 'Profile picture must be 2 MB or smaller.');
  }

  const dataUrl = await compressDemoImageToDataUrl(file);
  return updateDemoProfileSettings({ avatar: dataUrl });
}

export function removeDemoAvatar(): UserProfile {
  return updateDemoProfileSettings({ avatar: null });
}

function getMemberRole(
  state: DemoWorkspaceState,
  projectId: string,
  userId: string
): ProjectRole | null {
  const membership = state.members.find(
    (m) => m.projectId === projectId && m.userId === userId
  );
  return membership?.role ?? null;
}

function requireDemoRole(
  state: DemoWorkspaceState,
  projectId: string,
  userId: string,
  allowedRoles: readonly ProjectRole[] = ['OWNER', 'ADMINISTRATOR', 'MEMBER']
): ProjectRole {
  const role = getMemberRole(state, projectId, userId);
  if (!role) {
    throw new AppError(403, 'You do not have access to this project.');
  }
  if (!allowedRoles.includes(role)) {
    throw new AppError(
      403,
      'You do not have permission to perform this action on this project.'
    );
  }
  return role;
}

function resolveUserSummary(state: DemoWorkspaceState, userId: string): UserSummary {
  if (userId === state.profile.uid) {
    return {
      id: state.profile.uid,
      name: state.profile.name,
      email: state.profile.email,
      avatar: state.profile.avatar,
    };
  }
  const member = state.members.find((m) => m.userId === userId);
  if (member) {
    return {
      id: member.userId,
      name: member.name,
      email: member.email,
      avatar: member.avatar,
    };
  }
  const known = DEMO_TEAM_DIRECTORY.find((d) => d.userId === userId);
  if (known) {
    return {
      id: known.userId,
      name: known.name,
      email: known.email,
      avatar: known.avatar,
    };
  }
  return {
    id: userId,
    name: 'Workspace Member',
    email: '',
    avatar: null,
  };
}

function appendDemoActivity(
  state: DemoWorkspaceState,
  input: {
    actor: UserProfile;
    projectId: string;
    projectName: string;
    taskId?: string | null;
    action: string;
    resourceType?: string;
    resourceName?: string;
    details?: string | null;
  }
): void {
  state.activities.unshift({
    id: generateDemoId('demo_act'),
    actorId: input.actor.uid,
    actorName: input.actor.name.slice(0, 80) || 'Member',
    actorAvatar: input.actor.avatar ?? null,
    projectId: input.projectId,
    projectName: input.projectName,
    taskId: input.taskId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceName: input.resourceName,
    details: input.details ?? null,
    createdAt: new Date().toISOString(),
  });
}

function appendDemoNotification(
  state: DemoWorkspaceState,
  input: {
    id?: string;
    userId: string;
    projectId?: string;
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
): void {
  if (!input.userId || input.userId !== DEMO_USER_ID) return;
  if (input.id && state.notifications.some((n) => n.id === input.id)) return;

  state.notifications.unshift({
    id: input.id ?? generateDemoId('demo_notif'),
    userId: input.userId,
    projectId: input.projectId,
    type: input.type,
    title: input.title,
    message: input.message,
    link: input.link ?? null,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

function getAccessibleDemoProjects(state: DemoWorkspaceState, userId: string) {
  const roleByProject = new Map<string, ProjectRole>();
  for (const m of state.members) {
    if (m.userId === userId) {
      roleByProject.set(m.projectId, m.role);
    }
  }

  return state.projects
    .filter((p) => roleByProject.has(p.id))
    .map((p) => ({
      project: p,
      role: roleByProject.get(p.id)!,
    }))
    .sort(
      (a, b) =>
        new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime()
    );
}

function mapDemoTaskItem(
  state: DemoWorkspaceState,
  t: DemoTaskRecord
): TaskItem {
  const commentCount = state.comments.filter((c) => c.taskId === t.id).length;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    position: t.position,
    dueDate: t.dueDate,
    projectId: t.projectId,
    projectName: t.projectName,
    assigneeId: t.assigneeId,
    createdById: t.createdById,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: t.completedAt,
    assignee: t.assigneeId ? resolveUserSummary(state, t.assigneeId) : null,
    createdBy: resolveUserSummary(state, t.createdById),
    commentCount,
  };
}

function isActivePendingInvite(inv: DemoInvitationRecord, nowMs: number): boolean {
  if (inv.status !== 'PENDING') return false;
  return !inv.expiresAt || new Date(inv.expiresAt).getTime() >= nowMs;
}

function mapDemoInvitation(inv: DemoInvitationRecord): InvitationItem {
  return {
    id: inv.id,
    projectId: inv.projectId,
    projectName: inv.projectName,
    email: inv.email,
    role: inv.role,
    token: inv.token,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    invitedByName: inv.invitedByName,
  };
}

// ---------------------------------------------------------------------------
// Dashboard Analytics
// ---------------------------------------------------------------------------

export async function demoGetDashboardAnalytics(
  userId: string,
  days = 14
): Promise<DashboardAnalytics> {
  const safeDays = Math.min(90, Math.max(7, Number.isFinite(days) ? days : 14));
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, userId);

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
  const myTasks: DashboardAnalytics['myTasks'] = [];
  const upcomingDeadlines: DashboardAnalytics['upcomingDeadlines'] = [];
  const overdueTaskList: DashboardAnalytics['overdueTaskList'] = [];

  const accessibleProjectIds = new Set(accessible.map((item) => item.project.id));

  for (const { project: proj } of accessible) {
    const projMembers = state.members.filter((m) => m.projectId === proj.id);
    for (const m of projMembers) {
      if (!workloadMap.has(m.userId)) {
        workloadMap.set(m.userId, {
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatar: m.avatar,
          total: 0,
          todo: 0,
          inProgress: 0,
          completed: 0,
        });
      }
    }

    const projTasks = state.tasks.filter((t) => t.projectId === proj.id);
    let projTotal = 0;
    let projCompleted = 0;

    for (const t of projTasks) {
      totalTasks += 1;
      projTotal += 1;
      statusCounts[t.status] += 1;
      priorityCounts[t.priority] += 1;

      if (t.status === 'COMPLETED') {
        completedTasks += 1;
        projCompleted += 1;
      }

      const overdue = isOverdue(t.dueDate, t.status);
      if (overdue) overdueTasks += 1;

      const createdBucket = trendMap.get(t.createdAt.slice(0, 10));
      if (createdBucket) createdBucket.created += 1;

      if (t.completedAt) {
        const completedBucket = trendMap.get(t.completedAt.slice(0, 10));
        if (completedBucket) completedBucket.completed += 1;
      }

      if (t.assigneeId) {
        const w = workloadMap.get(t.assigneeId);
        if (w) {
          w.total += 1;
          if (t.status === 'TODO') w.todo += 1;
          else if (t.status === 'IN_PROGRESS') w.inProgress += 1;
          else if (t.status === 'COMPLETED') w.completed += 1;
        }
      }

      if (t.assigneeId === userId && t.status !== 'COMPLETED') {
        myTasks.push({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          projectId: proj.id,
          projectName: proj.name,
        });
      }

      if (overdue) {
        overdueTaskList.push({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          projectId: proj.id,
          projectName: proj.name,
        });
      } else if (t.status !== 'COMPLETED' && t.dueDate) {
        const dueMs = new Date(t.dueDate).getTime();
        if (dueMs >= nowMs && dueMs <= soonMs) {
          upcomingDeadlines.push({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate,
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
  }

  const recentActivity = state.activities
    .filter((a) => !a.projectId || accessibleProjectIds.has(a.projectId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  upcomingDeadlines.sort(
    (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
  );
  overdueTaskList.sort(
    (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
  );

  return {
    summary: {
      totalProjects: accessible.length,
      activeProjects: accessible.filter((a) => a.project.status === 'ACTIVE').length,
      completedProjects: accessible.filter((a) => a.project.status === 'COMPLETED').length,
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
    recentActivity,
    myTasks: myTasks.slice(0, 6),
    upcomingDeadlines: upcomingDeadlines.slice(0, 6),
    overdueTaskList: overdueTaskList.slice(0, 6),
    activeProjects: activeProjectsList.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function demoListUserProjects(
  userId: string,
  filters?: { q?: string; status?: string }
): Promise<ProjectSummary[]> {
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, userId);

  const queryText = filters?.q?.trim().toLowerCase() ?? '';
  const statusFilter = filters?.status?.trim() ?? '';

  const filtered = accessible.filter(({ project: p }) => {
    if (statusFilter && statusFilter !== 'ALL' && p.status !== statusFilter) {
      return false;
    }
    if (queryText) {
      const hay = `${p.name} ${p.description}`.toLowerCase();
      if (!hay.includes(queryText)) return false;
    }
    return true;
  });

  return filtered.map(({ project: p, role }) => {
    const members = state.members
      .filter((m) => m.projectId === p.id)
      .map((m) => ({
        userId: m.userId,
        role: m.role,
        name: m.name,
        email: m.email,
        avatar: m.avatar,
      }));

    const projTasks = state.tasks.filter((t) => t.projectId === p.id);
    const completedTasks = projTasks.filter((t) => t.status === 'COMPLETED').length;
    const overdueTasks = projTasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
    const totalTasks = projTasks.length;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      startDate: p.startDate,
      deadline: p.deadline,
      ownerId: p.ownerId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      owner: resolveUserSummary(state, p.ownerId),
      role,
      totalTasks,
      completedTasks,
      overdueTasks,
      progress,
      memberCount: members.length,
      members,
    };
  });
}

export async function demoCreateProject(
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

  const state = loadDemoWorkspace();
  const projectId = generateDemoId('demo_proj');
  const nowIso = new Date().toISOString();

  state.projects.unshift({
    id: projectId,
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    status: parsed.data.status,
    startDate: normalizeDateIso(parsed.data.startDate),
    deadline: normalizeDateIso(parsed.data.deadline),
    ownerId: actor.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  state.members.push({
    projectId,
    userId: actor.uid,
    name: actor.name.slice(0, 80) || 'Owner',
    email: actor.email,
    avatar: actor.avatar ?? null,
    role: 'OWNER',
    joinedAt: nowIso,
  });

  appendDemoActivity(state, {
    actor,
    projectId,
    projectName: parsed.data.name,
    action: 'PROJECT_CREATED',
    resourceType: 'PROJECT',
    resourceName: parsed.data.name,
    details: `Created project "${parsed.data.name}"`,
  });

  saveDemoWorkspace(state);
  return { id: projectId, name: parsed.data.name };
}

export async function demoGetProjectDetails(
  userId: string,
  projectId: string
): Promise<ProjectDetailResult> {
  const state = loadDemoWorkspace();
  const role = requireDemoRole(state, projectId, userId);

  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) {
    throw new AppError(404, 'Project not found.');
  }

  const members: ProjectMemberItem[] = state.members
    .filter((m) => m.projectId === projectId)
    .map((m) => ({
      id: m.userId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tasks: TaskItem[] = state.tasks
    .filter((t) => t.projectId === projectId)
    .map((t) => mapDemoTaskItem(state, t))
    .sort((a, b) => a.position - b.position);

  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const todoTasks = tasks.filter((t) => t.status === 'TODO').length;
  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const activities: ActivityItem[] = state.activities
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  return {
    project: {
      id: proj.id,
      name: proj.name,
      description: proj.description,
      status: proj.status,
      startDate: proj.startDate,
      deadline: proj.deadline,
      ownerId: proj.ownerId,
      owner: resolveUserSummary(state, proj.ownerId),
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

export async function demoUpdateProject(
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
  const state = loadDemoWorkspace();
  requireDemoRole(state, projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid project update.');
  }

  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) {
    throw new AppError(404, 'Project not found.');
  }

  const nowIso = new Date().toISOString();
  if (parsed.data.name !== undefined) {
    proj.name = parsed.data.name;
    for (const t of state.tasks) {
      if (t.projectId === projectId) t.projectName = parsed.data.name;
    }
    for (const inv of state.invitations) {
      if (inv.projectId === projectId) inv.projectName = parsed.data.name;
    }
  }
  if (parsed.data.description !== undefined) proj.description = parsed.data.description;
  if (parsed.data.status !== undefined) proj.status = parsed.data.status;
  if (parsed.data.startDate !== undefined) {
    proj.startDate = normalizeDateIso(parsed.data.startDate);
  }
  if (parsed.data.deadline !== undefined) {
    proj.deadline = normalizeDateIso(parsed.data.deadline);
  }
  proj.updatedAt = nowIso;

  appendDemoActivity(state, {
    actor,
    projectId,
    projectName: proj.name,
    action: 'PROJECT_UPDATED',
    resourceType: 'PROJECT',
    resourceName: proj.name,
    details: `Updated project "${proj.name}"`,
  });

  saveDemoWorkspace(state);
  return { id: projectId };
}

export async function demoDeleteProject(
  actor: UserProfile,
  projectId: string
): Promise<void> {
  const state = loadDemoWorkspace();
  requireDemoRole(state, projectId, actor.uid, ['OWNER']);

  const taskIds = new Set(
    state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id)
  );
  state.projects = state.projects.filter((p) => p.id !== projectId);
  state.members = state.members.filter((m) => m.projectId !== projectId);
  state.tasks = state.tasks.filter((t) => t.projectId !== projectId);
  state.comments = state.comments.filter(
    (c) => c.projectId !== projectId && !taskIds.has(c.taskId)
  );
  state.activities = state.activities.filter((a) => a.projectId !== projectId);
  state.invitations = state.invitations.filter((inv) => inv.projectId !== projectId);
  state.notifications = state.notifications.filter((n) => n.projectId !== projectId);

  saveDemoWorkspace(state);
}

export async function demoSeedStarterWorkspace(
  actor: UserProfile
): Promise<{ seeded: boolean }> {
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, actor.uid);
  if (accessible.length > 0) {
    return { seeded: false };
  }
  resetDemoWorkspace();
  return { seeded: true };
}

// ---------------------------------------------------------------------------
// Tasks & Comments
// ---------------------------------------------------------------------------

export async function demoListUserTasks(
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
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, userId);
  const targetIds = new Set(
    (filters?.projectId && filters.projectId !== 'ALL'
      ? accessible.filter((a) => a.project.id === filters.projectId)
      : accessible
    ).map((a) => a.project.id)
  );

  const allTasks = state.tasks
    .filter((t) => targetIds.has(t.projectId))
    .map((t) => mapDemoTaskItem(state, t));

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

export async function demoCreateTask(
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

  const state = loadDemoWorkspace();
  const projectId = parsed.data.projectId;
  requireDemoRole(state, projectId, actor.uid);

  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) {
    throw new AppError(404, 'Project not found.');
  }

  const assigneeId = parsed.data.assigneeId ?? null;
  if (
    assigneeId &&
    !state.members.some((m) => m.projectId === projectId && m.userId === assigneeId)
  ) {
    throw new AppError(400, 'Selected assignee is not a member of this project.');
  }

  let maxPos = -1;
  for (const t of state.tasks) {
    if (t.projectId === projectId && t.status === parsed.data.status && t.position > maxPos) {
      maxPos = t.position;
    }
  }

  const taskId = generateDemoId('demo_task');
  const nowIso = new Date().toISOString();

  state.tasks.push({
    id: taskId,
    projectId,
    projectName: proj.name,
    title: parsed.data.title,
    description: parsed.data.description ?? '',
    status: parsed.data.status,
    priority: parsed.data.priority,
    position: maxPos + 1,
    dueDate: normalizeDateIso(parsed.data.dueDate),
    assigneeId,
    createdById: actor.uid,
    completedAt: parsed.data.status === 'COMPLETED' ? nowIso : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  proj.updatedAt = nowIso;

  appendDemoActivity(state, {
    actor,
    projectId,
    projectName: proj.name,
    taskId,
    action: 'TASK_CREATED',
    resourceType: 'TASK',
    resourceName: parsed.data.title,
    details: `Created task "${parsed.data.title}"`,
  });

  saveDemoWorkspace(state);
  return { id: taskId, projectId };
}

function findDemoTask(
  state: DemoWorkspaceState,
  userId: string,
  taskId: string,
  projectIdHint?: string
): DemoTaskRecord {
  const accessibleIds = new Set(
    getAccessibleDemoProjects(state, userId).map((a) => a.project.id)
  );
  const found = state.tasks.find(
    (t) =>
      t.id === taskId &&
      (!projectIdHint || t.projectId === projectIdHint) &&
      accessibleIds.has(t.projectId)
  );
  if (!found) {
    throw new AppError(404, 'Task not found.');
  }
  return found;
}

export async function demoGetTaskDetails(
  userId: string,
  taskId: string,
  projectIdHint?: string
): Promise<{
  task: TaskItem;
  comments: TaskCommentItem[];
  activities: ActivityItem[];
  projectMembers: ProjectMemberItem[];
}> {
  const state = loadDemoWorkspace();
  const taskRecord = findDemoTask(state, userId, taskId, projectIdHint);
  requireDemoRole(state, taskRecord.projectId, userId);

  const projectMembers: ProjectMemberItem[] = state.members
    .filter((m) => m.projectId === taskRecord.projectId)
    .map((m) => ({
      id: m.userId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
    }));

  const comments: TaskCommentItem[] = state.comments
    .filter((c) => c.taskId === taskId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(({ projectId: _pid, ...rest }) => rest);

  const activities: ActivityItem[] = state.activities
    .filter((a) => a.projectId === taskRecord.projectId && a.taskId === taskId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    task: mapDemoTaskItem(state, taskRecord),
    comments,
    activities,
    projectMembers,
  };
}

export async function demoUpdateTask(
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

  const state = loadDemoWorkspace();
  const task = findDemoTask(state, actor.uid, taskId, projectIdHint);
  requireDemoRole(state, task.projectId, actor.uid);

  if (
    parsed.data.assigneeId &&
    !state.members.some(
      (m) => m.projectId === task.projectId && m.userId === parsed.data.assigneeId
    )
  ) {
    throw new AppError(400, 'Selected assignee is not a member of this project.');
  }

  const nowIso = new Date().toISOString();
  const wasCompleted = task.status === 'COMPLETED';
  const nextStatus = parsed.data.status ?? task.status;

  if (parsed.data.title !== undefined) task.title = parsed.data.title;
  if (parsed.data.description !== undefined) task.description = parsed.data.description;
  if (parsed.data.status !== undefined) task.status = parsed.data.status;
  if (parsed.data.priority !== undefined) task.priority = parsed.data.priority;
  if (parsed.data.position !== undefined) task.position = parsed.data.position;
  if (parsed.data.dueDate !== undefined) {
    task.dueDate = normalizeDateIso(parsed.data.dueDate);
  }
  if (parsed.data.assigneeId !== undefined) task.assigneeId = parsed.data.assigneeId;

  if (nextStatus === 'COMPLETED' && !wasCompleted) {
    task.completedAt = nowIso;
  } else if (nextStatus !== 'COMPLETED') {
    task.completedAt = null;
  }
  task.updatedAt = nowIso;

  const proj = state.projects.find((p) => p.id === task.projectId);
  if (proj) proj.updatedAt = nowIso;

  const actionName =
    nextStatus === 'COMPLETED' && !wasCompleted ? 'TASK_COMPLETED' : 'TASK_UPDATED';

  appendDemoActivity(state, {
    actor,
    projectId: task.projectId,
    projectName: task.projectName,
    taskId: task.id,
    action: actionName,
    resourceType: 'TASK',
    resourceName: task.title,
    details:
      actionName === 'TASK_COMPLETED'
        ? `Completed task "${task.title}"`
        : `Updated task "${task.title}"`,
  });

  saveDemoWorkspace(state);
}

export async function demoMoveTask(
  actor: UserProfile,
  taskId: string,
  input: { status: TaskStatus; position: number },
  projectIdHint?: string
): Promise<void> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid move payload.');
  }

  const state = loadDemoWorkspace();
  const task = findDemoTask(state, actor.uid, taskId, projectIdHint);
  requireDemoRole(state, task.projectId, actor.uid);

  const nowIso = new Date().toISOString();
  const wasCompleted = task.status === 'COMPLETED';
  const nextStatus = parsed.data.status;

  task.status = nextStatus;
  task.position = parsed.data.position;
  if (nextStatus === 'COMPLETED') {
    task.completedAt = wasCompleted ? task.completedAt ?? nowIso : nowIso;
  } else {
    task.completedAt = null;
  }
  task.updatedAt = nowIso;

  // Keep other tasks in the destination column cleanly ordered around the moved item
  const siblings = state.tasks
    .filter((t) => t.projectId === task.projectId && t.status === nextStatus && t.id !== task.id)
    .sort((a, b) => a.position - b.position);
  const clampedIndex = Math.max(0, Math.min(parsed.data.position, siblings.length));
  siblings.splice(clampedIndex, 0, task);
  siblings.forEach((item, index) => {
    item.position = index;
  });

  const action =
    nextStatus === 'COMPLETED' && !wasCompleted ? 'TASK_COMPLETED' : 'TASK_MOVED';

  appendDemoActivity(state, {
    actor,
    projectId: task.projectId,
    projectName: task.projectName,
    taskId: task.id,
    action,
    resourceType: 'TASK',
    resourceName: task.title,
    details:
      action === 'TASK_COMPLETED'
        ? `Completed task "${task.title}"`
        : `Moved "${task.title}" to ${nextStatus.replace('_', ' ')}`,
  });

  saveDemoWorkspace(state);
}

export async function demoDeleteTask(
  actor: UserProfile,
  taskId: string,
  projectIdHint?: string
): Promise<void> {
  const state = loadDemoWorkspace();
  const task = findDemoTask(state, actor.uid, taskId, projectIdHint);
  requireDemoRole(state, task.projectId, actor.uid);

  state.tasks = state.tasks.filter((t) => t.id !== taskId);
  state.comments = state.comments.filter((c) => c.taskId !== taskId);

  appendDemoActivity(state, {
    actor,
    projectId: task.projectId,
    projectName: task.projectName,
    taskId: null,
    action: 'TASK_DELETED',
    resourceType: 'TASK',
    resourceName: task.title,
    details: `Deleted task "${task.title}"`,
  });

  saveDemoWorkspace(state);
}

export async function demoAddTaskComment(
  actor: UserProfile,
  taskId: string,
  content: string,
  projectIdHint?: string
): Promise<TaskCommentItem> {
  const parsed = commentSchema.safeParse({ content });
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Comment cannot be empty.');
  }

  const state = loadDemoWorkspace();
  const task = findDemoTask(state, actor.uid, taskId, projectIdHint);
  requireDemoRole(state, task.projectId, actor.uid);

  const commentId = generateDemoId('demo_comment');
  const nowIso = new Date().toISOString();

  const record = {
    id: commentId,
    projectId: task.projectId,
    taskId,
    authorId: actor.uid,
    authorName: actor.name.slice(0, 80) || 'Member',
    authorEmail: actor.email,
    authorAvatar: actor.avatar ?? null,
    content: parsed.data.content,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  state.comments.push(record);
  appendDemoActivity(state, {
    actor,
    projectId: task.projectId,
    projectName: task.projectName,
    taskId,
    action: 'COMMENT_ADDED',
    resourceType: 'TASK',
    resourceName: task.title,
    details: `Commented on "${task.title}"`,
  });

  saveDemoWorkspace(state);
  const { projectId: _pid, ...returned } = record;
  return returned;
}

export async function demoUpdateTaskComment(
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

  const state = loadDemoWorkspace();
  requireDemoRole(state, projectId, actor.uid);

  const comment = state.comments.find(
    (c) => c.id === commentId && c.taskId === taskId && c.projectId === projectId
  );
  if (!comment) {
    throw new AppError(404, 'Comment not found.');
  }
  if (comment.authorId !== actor.uid) {
    throw new AppError(403, 'You can only edit your own comments.');
  }

  comment.content = parsed.data.content;
  comment.updatedAt = new Date().toISOString();
  saveDemoWorkspace(state);
}

export async function demoDeleteTaskComment(
  actor: UserProfile,
  projectId: string,
  taskId: string,
  commentId: string
): Promise<void> {
  const state = loadDemoWorkspace();
  const role = requireDemoRole(state, projectId, actor.uid);

  const comment = state.comments.find(
    (c) => c.id === commentId && c.taskId === taskId && c.projectId === projectId
  );
  if (!comment) {
    throw new AppError(404, 'Comment not found.');
  }
  if (comment.authorId !== actor.uid && role !== 'OWNER' && role !== 'ADMINISTRATOR') {
    throw new AppError(403, 'You do not have permission to delete this comment.');
  }

  state.comments = state.comments.filter((c) => c.id !== commentId);
  saveDemoWorkspace(state);
}

// ---------------------------------------------------------------------------
// Team & Invitations
// ---------------------------------------------------------------------------

export async function demoListWorkspaceTeam(userId: string): Promise<{
  members: TeamMemberSummary[];
  invitations: InvitationItem[];
}> {
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, userId);
  const memberMap = new Map<string, TeamMemberSummary>();

  for (const { project: proj } of accessible) {
    const projMembers = state.members.filter((m) => m.projectId === proj.id);
    for (const m of projMembers) {
      let summary = memberMap.get(m.userId);
      if (!summary) {
        summary = {
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatar: m.avatar,
          projects: [],
          taskStats: { total: 0, completed: 0, active: 0, overdue: 0 },
          activityCount: 0,
        };
        memberMap.set(m.userId, summary);
      }
      summary.projects.push({
        projectId: proj.id,
        projectName: proj.name,
        role: m.role,
        joinedAt: m.joinedAt,
      });
    }

    for (const t of state.tasks.filter((item) => item.projectId === proj.id)) {
      if (!t.assigneeId) continue;
      const summary = memberMap.get(t.assigneeId);
      if (!summary) continue;
      summary.taskStats.total += 1;
      if (t.status === 'COMPLETED') {
        summary.taskStats.completed += 1;
      } else {
        summary.taskStats.active += 1;
      }
      if (isOverdue(t.dueDate, t.status)) {
        summary.taskStats.overdue += 1;
      }
    }

    for (const a of state.activities.filter((item) => item.projectId === proj.id)) {
      const summary = memberMap.get(a.actorId);
      if (summary) summary.activityCount += 1;
    }
  }

  const nowMs = Date.now();
  const invitations = state.invitations
    .filter(
      (inv) =>
        (inv.projectOwnerId === userId || inv.invitedById === userId) &&
        isActivePendingInvite(inv, nowMs)
    )
    .map(mapDemoInvitation)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    members: Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    invitations,
  };
}

export async function demoListProjectInvitations(
  userId: string,
  projectId: string
): Promise<InvitationItem[]> {
  const state = loadDemoWorkspace();
  requireDemoRole(state, projectId, userId, ['OWNER', 'ADMINISTRATOR']);

  const nowMs = Date.now();
  return state.invitations
    .filter(
      (inv) =>
        inv.projectId === projectId &&
        (inv.projectOwnerId === userId || inv.invitedById === userId) &&
        isActivePendingInvite(inv, nowMs)
    )
    .map(mapDemoInvitation)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function demoListIncomingInvitations(
  userEmail: string
): Promise<InvitationItem[]> {
  const email = userEmail.trim().toLowerCase();
  if (!email) return [];

  const state = loadDemoWorkspace();
  const nowMs = Date.now();
  return state.invitations
    .filter((inv) => inv.email.toLowerCase() === email && isActivePendingInvite(inv, nowMs))
    .map(mapDemoInvitation)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function demoInviteMember(
  actor: UserProfile,
  projectId: string,
  input: { email: string; role: 'ADMINISTRATOR' | 'MEMBER' }
): Promise<InvitationItem> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid invitation payload.');
  }

  const state = loadDemoWorkspace();
  const actorRole = requireDemoRole(state, projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);
  if (parsed.data.role === 'ADMINISTRATOR' && actorRole !== 'OWNER') {
    throw new AppError(403, 'Only project owners can invite administrators.');
  }

  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) {
    throw new AppError(404, 'Project not found.');
  }

  const alreadyMember = state.members.some(
    (m) => m.projectId === projectId && m.email.toLowerCase() === parsed.data.email
  );
  if (alreadyMember) {
    throw new AppError(409, 'This user is already a member of the project.');
  }

  const token = generateDemoId('demo_invite');
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const record: DemoInvitationRecord = {
    id: token,
    projectId,
    projectName: proj.name,
    projectOwnerId: proj.ownerId,
    email: parsed.data.email,
    role: parsed.data.role,
    token,
    status: 'PENDING',
    invitedById: actor.uid,
    invitedByName: actor.name.slice(0, 80) || 'Member',
    expiresAt: expiresAtIso,
    acceptedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  state.invitations.unshift(record);
  appendDemoActivity(state, {
    actor,
    projectId,
    projectName: proj.name,
    action: 'MEMBER_INVITED',
    resourceType: 'INVITATION',
    resourceName: parsed.data.email,
    details: `Invited ${parsed.data.email} as ${parsed.data.role}`,
  });

  saveDemoWorkspace(state);
  return mapDemoInvitation(record);
}

export async function demoAcceptInvitation(
  actor: UserProfile,
  rawToken: string
): Promise<{ projectId: string }> {
  const parsed = acceptInvitationSchema.safeParse({ token: rawToken });
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invitation token is invalid.');
  }

  const state = loadDemoWorkspace();
  const token = parsed.data.token;
  const inv = state.invitations.find((i) => i.token === token || i.id === token);
  if (!inv) {
    throw new AppError(404, 'Invitation token was not found or is no longer accessible.');
  }
  if (inv.status !== 'PENDING') {
    throw new AppError(400, `Invitation has already been ${inv.status.toLowerCase()}.`);
  }
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
    throw new AppError(400, 'This invitation token has expired.');
  }
  if (inv.email.toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new AppError(
      403,
      `This invitation was issued for ${inv.email}. Sign in with that email to accept.`
    );
  }

  const alreadyMember = state.members.some(
    (m) => m.projectId === inv.projectId && m.userId === actor.uid
  );
  if (alreadyMember) {
    throw new AppError(409, 'You are already a member of this project.');
  }

  const nowIso = new Date().toISOString();
  state.members.push({
    projectId: inv.projectId,
    userId: actor.uid,
    name: actor.name.slice(0, 80) || 'Member',
    email: actor.email,
    avatar: actor.avatar ?? null,
    role: inv.role === 'ADMINISTRATOR' ? 'ADMINISTRATOR' : 'MEMBER',
    joinedAt: nowIso,
  });

  inv.status = 'ACCEPTED';
  inv.acceptedAt = nowIso;
  inv.updatedAt = nowIso;

  appendDemoActivity(state, {
    actor,
    projectId: inv.projectId,
    projectName: inv.projectName,
    action: 'MEMBER_JOINED',
    resourceType: 'MEMBER',
    resourceName: actor.name,
    details: `${actor.name} joined project "${inv.projectName}"`,
  });

  saveDemoWorkspace(state);
  return { projectId: inv.projectId };
}

export async function demoDeclineInvitation(
  actor: UserProfile,
  rawToken: string
): Promise<void> {
  const token = rawToken.trim();
  const state = loadDemoWorkspace();
  const inv = state.invitations.find((i) => i.token === token || i.id === token);
  if (!inv) {
    throw new AppError(404, 'Invitation not found.');
  }
  if (inv.status !== 'PENDING') {
    throw new AppError(400, 'Invitation is no longer pending.');
  }
  if (inv.email.toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new AppError(403, 'You can only decline invitations addressed to your email.');
  }

  inv.status = 'DECLINED';
  inv.updatedAt = new Date().toISOString();
  saveDemoWorkspace(state);
}

export async function demoRevokeInvitation(
  actor: UserProfile,
  token: string
): Promise<void> {
  const state = loadDemoWorkspace();
  const inv = state.invitations.find((i) => i.id === token || i.token === token);
  if (!inv) {
    throw new AppError(404, 'Invitation not found.');
  }
  requireDemoRole(state, inv.projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);
  if (inv.status !== 'PENDING') {
    throw new AppError(400, 'Only pending invitations can be revoked.');
  }

  inv.status = 'REVOKED';
  inv.updatedAt = new Date().toISOString();
  saveDemoWorkspace(state);
}

export async function demoUpdateMemberRole(
  actor: UserProfile,
  projectId: string,
  targetUserId: string,
  role: 'ADMINISTRATOR' | 'MEMBER'
): Promise<void> {
  const parsed = updateMemberRoleSchema.safeParse({ role });
  if (!parsed.success) {
    throw new AppError(400, 'Invalid member role.');
  }

  const state = loadDemoWorkspace();
  requireDemoRole(state, projectId, actor.uid, ['OWNER']);

  const member = state.members.find(
    (m) => m.projectId === projectId && m.userId === targetUserId
  );
  if (!member) {
    throw new AppError(404, 'Project member not found.');
  }
  if (member.role === 'OWNER') {
    throw new AppError(403, 'Project owner role cannot be modified.');
  }

  member.role = parsed.data.role;
  const proj = state.projects.find((p) => p.id === projectId);
  appendDemoActivity(state, {
    actor,
    projectId,
    projectName: proj?.name ?? 'Project',
    action: 'MEMBER_ROLE_UPDATED',
    resourceType: 'MEMBER',
    resourceName: member.name,
    details: `Changed ${member.name} role to ${parsed.data.role}`,
  });

  saveDemoWorkspace(state);
}

export async function demoRemoveMember(
  actor: UserProfile,
  projectId: string,
  targetUserId: string
): Promise<void> {
  const state = loadDemoWorkspace();
  const actorRole = requireDemoRole(state, projectId, actor.uid);

  const member = state.members.find(
    (m) => m.projectId === projectId && m.userId === targetUserId
  );
  if (!member) {
    throw new AppError(404, 'Project member not found.');
  }
  if (!canRemoveTargetMember(actorRole, member.role, actor.uid === targetUserId)) {
    throw new AppError(403, 'You do not have permission to remove this member.');
  }

  const nowIso = new Date().toISOString();
  for (const t of state.tasks) {
    if (t.projectId === projectId && t.assigneeId === targetUserId) {
      t.assigneeId = null;
      t.updatedAt = nowIso;
    }
  }

  state.members = state.members.filter(
    (m) => !(m.projectId === projectId && m.userId === targetUserId)
  );

  const proj = state.projects.find((p) => p.id === projectId);
  if (actor.uid !== targetUserId) {
    appendDemoActivity(state, {
      actor,
      projectId,
      projectName: proj?.name ?? 'Project',
      action: 'MEMBER_REMOVED',
      resourceType: 'MEMBER',
      resourceName: member.name,
      details: `Removed ${member.name} from "${proj?.name ?? 'Project'}"`,
    });
  }

  saveDemoWorkspace(state);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function demoListWorkspaceActivity(
  userId: string,
  options: { projectId?: string; page?: number; limit?: number } = {}
): Promise<{
  items: ActivityItem[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const state = loadDemoWorkspace();
  const accessible = getAccessibleDemoProjects(state, userId);
  const targetIds = new Set(
    (options.projectId
      ? accessible.filter((a) => a.project.id === options.projectId)
      : accessible
    ).map((a) => a.project.id)
  );

  const allActivities = state.activities
    .filter((a) => a.projectId && targetIds.has(a.projectId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function demoGetUserNotifications(
  profile: UserProfile
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const state = loadDemoWorkspace();
  const now = Date.now();
  const soon = now + 48 * 60 * 60 * 1000;
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const accessibleIds = new Set(
    getAccessibleDemoProjects(state, profile.uid).map((a) => a.project.id)
  );
  let dirty = false;

  if (profile.notifyOnDeadline) {
    for (const t of state.tasks) {
      if (!accessibleIds.has(t.projectId)) continue;
      if (t.assigneeId !== profile.uid || t.status === 'COMPLETED' || !t.dueDate) continue;
      const dueMs = new Date(t.dueDate).getTime();
      if (dueMs >= now && dueMs <= soon) {
        const notifId = `demo_deadline_${t.id}_${dayKey}`;
        if (!state.notifications.some((n) => n.id === notifId)) {
          appendDemoNotification(state, {
            id: notifId,
            userId: profile.uid,
            projectId: t.projectId,
            type: 'DEADLINE_APPROACHING',
            title: 'Upcoming deadline',
            message: `"${t.title}" is due within 48 hours.`,
            link: `/projects/${t.projectId}?task=${t.id}`,
          });
          dirty = true;
        }
      }
    }
  }

  if (dirty) {
    saveDemoWorkspace(state);
  }

  const mapped = state.notifications
    .filter((n) => n.userId === profile.uid)
    .filter((item) => {
      if (item.type === 'TASK_ASSIGNED' && !profile.notifyOnAssign) return false;
      if (item.type === 'TASK_COMMENT' && !profile.notifyOnComment) return false;
      if (item.type === 'PROJECT_INVITATION' && !profile.notifyOnInvite) return false;
      if (item.type === 'DEADLINE_APPROACHING' && !profile.notifyOnDeadline) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const items = mapped.slice(0, 40);
  const unreadCount = mapped.filter((n) => !n.read).length;
  return { items, unreadCount };
}

export async function demoMarkNotificationRead(
  userId: string,
  notificationId: string
): Promise<void> {
  const state = loadDemoWorkspace();
  const notif = state.notifications.find(
    (n) => n.id === notificationId && n.userId === userId
  );
  if (!notif) {
    throw new AppError(404, 'Notification not found.');
  }
  notif.read = true;
  saveDemoWorkspace(state);
}

export async function demoMarkAllNotificationsRead(userId: string): Promise<void> {
  const state = loadDemoWorkspace();
  let changed = false;
  for (const n of state.notifications) {
    if (n.userId === userId && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) {
    saveDemoWorkspace(state);
  }
}

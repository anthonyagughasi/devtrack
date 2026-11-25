import type { User as FirebaseUser } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialDemoWorkspace, DEMO_TEAM_DIRECTORY } from '../demo/demo-seed';
import {
  assertNotDemoFirestoreLeak,
  DEMO_ACTIVE_STORAGE_KEY,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_WORKSPACE_STORAGE_KEY,
  isDemoPath,
  isDemoProfile,
  isDemoSessionStored,
  setDemoSessionStored,
} from '../demo/demo-session';
import {
  clearDemoMemoryCacheForTests,
  getDemoProfile,
  resetDemoWorkspace,
  updateDemoProfileSettings,
} from '../demo/demo-store';
import { listWorkspaceActivity } from '../services/activity';
import { getDashboardAnalytics } from '../services/dashboard';
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendProjectNotification,
} from '../services/notifications';
import {
  createProject,
  deleteProject,
  getAccessibleProjectsRaw,
  getProjectDetails,
  listUserProjects,
  updateProject,
} from '../services/projects';
import {
  addTaskComment,
  createTask,
  deleteTask,
  deleteTaskComment,
  getTaskDetails,
  listUserTasks,
  moveTask,
  updateTask,
  updateTaskComment,
} from '../services/tasks';
import {
  acceptInvitation,
  declineInvitation,
  inviteMember,
  listIncomingInvitations,
  listProjectInvitations,
  listWorkspaceTeam,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from '../services/team';
import { syncUserProfile, updateUserProfileSettings } from '../services/users';

function installMockWindow(options?: { throwOnStorage?: boolean; pathname?: string }) {
  const storageMap = new Map<string, string>();
  const throwOnStorage = options?.throwOnStorage ?? false;

  const localStorageMock = {
    getItem(key: string): string | null {
      if (throwOnStorage) throw new Error('Storage disabled in restricted incognito');
      return storageMap.has(key) ? storageMap.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      if (throwOnStorage) throw new Error('Storage disabled in restricted incognito');
      storageMap.set(key, value);
    },
    removeItem(key: string): void {
      if (throwOnStorage) throw new Error('Storage disabled in restricted incognito');
      storageMap.delete(key);
    },
    clear(): void {
      if (throwOnStorage) throw new Error('Storage disabled in restricted incognito');
      storageMap.clear();
    },
    key(index: number): string | null {
      return Array.from(storageMap.keys())[index] ?? null;
    },
    get length(): number {
      return storageMap.size;
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      localStorage: localStorageMock,
      location: {
        pathname: options?.pathname ?? '/demo',
        search: '',
      },
    },
  });

  return { storageMap };
}

function removeMockWindow() {
  try {
    Reflect.deleteProperty(globalThis, 'window');
  } catch {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
}

describe('Recruiter Demo Mode', () => {
  beforeEach(() => {
    clearDemoMemoryCacheForTests();
    setDemoSessionStored(false);
    installMockWindow({ pathname: '/demo' });
    setDemoSessionStored(true);
    resetDemoWorkspace();
  });

  afterEach(() => {
    setDemoSessionStored(false);
    clearDemoMemoryCacheForTests();
    removeMockWindow();
  });

  it('seeds realistic fictional workspace data with zero real credentials or UIDs', () => {
    const seed = createInitialDemoWorkspace();
    expect(seed.profile.uid).toBe(DEMO_USER_ID);
    expect(seed.profile.email).toBe(DEMO_USER_EMAIL);
    expect(seed.projects.length).toBe(5); // 4 joined + 1 invited
    expect(seed.tasks.length).toBeGreaterThanOrEqual(14);
    expect(seed.comments.length).toBeGreaterThanOrEqual(4);
    expect(seed.activities.length).toBeGreaterThanOrEqual(8);
    expect(seed.notifications.some((n) => !n.read)).toBe(true);
    expect(seed.notifications.some((n) => n.read)).toBe(true);
    expect(seed.invitations).toHaveLength(2);

    for (const member of DEMO_TEAM_DIRECTORY) {
      expect(member.email).toMatch(/@northstar-demo\.dev$/);
      expect(member.userId.startsWith('demo_')).toBe(true);
    }
  });

  it('recognizes demo routes and demo profiles accurately', () => {
    expect(isDemoPath('/demo')).toBe(true);
    expect(isDemoPath('/demo/projects/demo_proj_payments')).toBe(true);
    expect(isDemoPath('/projects')).toBe(false);
    expect(isDemoPath('/')).toBe(false);

    const profile = getDemoProfile();
    expect(isDemoProfile(profile)).toBe(true);
    expect(isDemoProfile(DEMO_USER_ID)).toBe(true);
    expect(isDemoProfile('real_firebase_uid_123')).toBe(false);
    expect(isDemoSessionStored()).toBe(true);
  });

  it('supports end-to-end dashboard, project, task, Kanban, comment, and activity workflows locally', async () => {
    const profile = getDemoProfile();

    const analytics = await getDashboardAnalytics(profile.uid, 14);
    expect(analytics.summary.totalProjects).toBe(4);
    expect(analytics.summary.overdueTasks).toBeGreaterThanOrEqual(2);
    expect(analytics.summary.completedTasks).toBeGreaterThanOrEqual(4);

    // Create, update, inspect project
    const createdProj = await createProject(profile, {
      name: 'Canary Deployment Checklist',
      description: 'Recruiter interactive test project',
      status: 'ACTIVE',
    });
    expect(createdProj.id).toMatch(/^demo_proj_/);

    await updateProject(profile, createdProj.id, {
      name: 'Canary Deployment Checklist v2',
      status: 'ARCHIVED',
    });

    const projects = await listUserProjects(profile.uid, { q: 'Canary Deployment' });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.status).toBe('ARCHIVED');

    // Create, update, move, comment, delete task
    const createdTask = await createTask(profile, {
      projectId: createdProj.id,
      title: 'Verify zero-downtime migration checklist',
      description: 'Run dry run before cutover',
      status: 'TODO',
      priority: 'URGENT',
      assigneeId: profile.uid,
    });

    await moveTask(
      profile,
      createdTask.id,
      { status: 'COMPLETED', position: 0 },
      createdProj.id
    );

    const comment = await addTaskComment(
      profile,
      createdTask.id,
      'Verified dry-run metrics look solid.',
      createdProj.id
    );
    await updateTaskComment(
      profile,
      createdProj.id,
      createdTask.id,
      comment.id,
      'Updated comment: dry-run metrics look solid.'
    );

    const taskDetail = await getTaskDetails(profile.uid, createdTask.id, createdProj.id);
    expect(taskDetail.task.status).toBe('COMPLETED');
    expect(taskDetail.task.completedAt).toBeTruthy();
    expect(taskDetail.comments).toHaveLength(1);
    expect(taskDetail.comments[0]?.content).toContain('Updated comment');

    await updateTask(
      profile,
      createdTask.id,
      { status: 'IN_PROGRESS', priority: 'HIGH' },
      createdProj.id
    );
    const updatedTasks = await listUserTasks(profile.uid, { projectId: createdProj.id });
    expect(updatedTasks[0]?.status).toBe('IN_PROGRESS');
    expect(updatedTasks[0]?.priority).toBe('HIGH');

    await deleteTaskComment(profile, createdProj.id, createdTask.id, comment.id);
    await deleteTask(profile, createdTask.id, createdProj.id);
    const afterDelete = await getProjectDetails(profile.uid, createdProj.id);
    expect(afterDelete.tasks).toHaveLength(0);

    const activityFeed = await listWorkspaceActivity(profile.uid, { projectId: createdProj.id });
    expect(activityFeed.items.length).toBeGreaterThanOrEqual(4);

    await deleteProject(profile, createdProj.id);
    const afterProjDelete = await listUserProjects(profile.uid, { q: 'Canary Deployment' });
    expect(afterProjDelete).toHaveLength(0);
  });

  it('supports team invitations, incoming accept/decline, role changes, and member removal', async () => {
    const profile = getDemoProfile();

    const incomingBefore = await listIncomingInvitations(profile.email);
    expect(incomingBefore).toHaveLength(1);
    expect(incomingBefore[0]?.projectId).toBe('demo_proj_partner_portal');

    const accepted = await acceptInvitation(profile, incomingBefore[0]!.token);
    expect(accepted.projectId).toBe('demo_proj_partner_portal');

    const projectsAfterAccept = await listUserProjects(profile.uid);
    expect(projectsAfterAccept.some((p) => p.id === 'demo_proj_partner_portal')).toBe(true);

    // Outgoing invite & revoke
    const invited = await inviteMember(profile, 'demo_proj_payments', {
      email: 'alex.rivera@northstar-demo.dev',
      role: 'MEMBER',
    });
    const projectInvites = await listProjectInvitations(profile.uid, 'demo_proj_payments');
    expect(projectInvites.some((i) => i.id === invited.id)).toBe(true);

    await revokeInvitation(profile, invited.token);
    const afterRevoke = await listProjectInvitations(profile.uid, 'demo_proj_payments');
    expect(afterRevoke.some((i) => i.id === invited.id)).toBe(false);

    // Role update & member removal
    await updateMemberRole(profile, 'demo_proj_payments', 'demo_member_priya', 'ADMINISTRATOR');
    const detailAfterRole = await getProjectDetails(profile.uid, 'demo_proj_payments');
    expect(
      detailAfterRole.members.find((m) => m.userId === 'demo_member_priya')?.role
    ).toBe('ADMINISTRATOR');

    await removeMember(profile, 'demo_proj_payments', 'demo_member_devon');
    const teamSummary = await listWorkspaceTeam(profile.uid);
    const devonInPayments = teamSummary.members
      .find((m) => m.userId === 'demo_member_devon')
      ?.projects.some((p) => p.projectId === 'demo_proj_payments');
    expect(Boolean(devonInPayments)).toBe(false);

    // Reset and test decline path
    resetDemoWorkspace();
    const freshProfile = getDemoProfile();
    const freshIncoming = await listIncomingInvitations(freshProfile.email);
    await declineInvitation(freshProfile, freshIncoming[0]!.token);
    const remainingIncoming = await listIncomingInvitations(freshProfile.email);
    expect(remainingIncoming).toHaveLength(0);
  });

  it('persists mutations in localStorage across reloads and resets cleanly', async () => {
    const { storageMap } = installMockWindow({ pathname: '/demo' });
    setDemoSessionStored(true);
    resetDemoWorkspace();

    const profile = getDemoProfile();
    await createProject(profile, {
      name: 'Persisted Reload Project',
      description: 'Should survive reload',
      status: 'PLANNING',
    });

    const updatedProfile = updateDemoProfileSettings({
      name: 'Taylor Demo Reviewer',
      themePreference: 'light',
      notifyOnAssign: false,
    });
    expect(updatedProfile.name).toBe('Taylor Demo Reviewer');
    expect(storageMap.get(DEMO_ACTIVE_STORAGE_KEY)).toBe('true');
    expect(storageMap.get(DEMO_WORKSPACE_STORAGE_KEY)).toContain('Persisted Reload Project');

    // Notifications mark read & mark all read
    const notifData = await getUserNotifications(updatedProfile);
    expect(notifData.unreadCount).toBeGreaterThan(0);
    const firstUnread = notifData.items.find((n) => !n.read);
    expect(firstUnread).toBeTruthy();
    await markNotificationRead(updatedProfile.uid, firstUnread!.id);
    await markAllNotificationsRead(updatedProfile.uid);
    const afterReadAll = await getUserNotifications(updatedProfile);
    expect(afterReadAll.unreadCount).toBe(0);

    // Simulate full page reload by clearing in-memory cache
    clearDemoMemoryCacheForTests();
    const reloadedProjects = await listUserProjects(DEMO_USER_ID, { q: 'Persisted Reload' });
    expect(reloadedProjects).toHaveLength(1);
    expect(getDemoProfile().name).toBe('Taylor Demo Reviewer');

    // Reset Demo restores pristine state
    resetDemoWorkspace();
    expect(getDemoProfile().name).toBe('Jordan Mercer');
    const afterResetProjects = await listUserProjects(DEMO_USER_ID, { q: 'Persisted Reload' });
    expect(afterResetProjects).toHaveLength(0);
  });

  it('falls back cleanly to in-memory workspace when localStorage throws in restricted incognito', async () => {
    installMockWindow({ throwOnStorage: true, pathname: '/demo' });
    clearDemoMemoryCacheForTests();
    setDemoSessionStored(true);

    const profile = getDemoProfile();
    const created = await createProject(profile, {
      name: 'Incognito Memory Fallback Project',
      description: 'Works without localStorage access',
      status: 'ACTIVE',
    });

    const projects = await listUserProjects(profile.uid, { q: 'Incognito Memory' });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
  });

  it('strictly blocks Firestore access paths while Demo Mode is active or when using demo UID', async () => {
    expect(() => assertNotDemoFirestoreLeak(DEMO_USER_ID)).toThrow(/Blocked Firestore access/);
    expect(() => assertNotDemoFirestoreLeak('any_real_uid')).toThrow(/Blocked Firestore access/);

    await expect(getAccessibleProjectsRaw('real_uid_during_demo')).rejects.toThrow(
      /Blocked Firestore access/
    );

    const fakeFirebaseUser = { uid: DEMO_USER_ID } as unknown as FirebaseUser;
    await expect(syncUserProfile(fakeFirebaseUser)).rejects.toThrow(/Blocked Firestore access/);
    await expect(
      updateUserProfileSettings(fakeFirebaseUser, { name: 'Blocked' })
    ).rejects.toThrow(/Blocked Firestore access/);

    // Notification dispatch is a safe no-op in Demo Mode
    await expect(
      sendProjectNotification({
        recipientUid: DEMO_USER_ID,
        actorUid: DEMO_USER_ID,
        projectId: 'demo_proj_payments',
        type: 'TASK_ASSIGNED',
        title: 'Test',
        message: 'Should not hit Firestore',
      })
    ).resolves.toBeUndefined();
  });
});

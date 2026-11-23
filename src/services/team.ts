import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AppError,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { canRemoveTargetMember } from '../lib/permissions';
import { isOverdue } from '../lib/utils';
import {
  acceptInvitationSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  type ProjectRole,
} from '../lib/validations';
import type { InvitationItem, UserProfile } from '../types/app';
import {
  addActivityToBatch,
  commitOperationsInChunks,
  generateSecureToken,
  nullableIso,
  requireProjectRole,
  timestampToIso,
} from './firestore-helpers';
import { getAccessibleProjectsRaw } from './projects';

export interface TeamMemberSummary {
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  projects: Array<{ projectId: string; projectName: string; role: string; joinedAt: string }>;
  taskStats: { total: number; completed: number; active: number; overdue: number };
  activityCount: number;
}

function mapInvitationDoc(id: string, data: Record<string, unknown>): InvitationItem {
  return {
    id,
    projectId: String(data.projectId ?? ''),
    projectName: String(data.projectName ?? 'DevTrack Project'),
    email: String(data.email ?? ''),
    role: String(data.role ?? 'MEMBER') as ProjectRole,
    token: String(data.token ?? id),
    status: String(data.status ?? 'PENDING'),
    expiresAt: timestampToIso(data.expiresAt),
    createdAt: timestampToIso(data.createdAt),
    invitedByName: String(data.invitedByName ?? 'Project Member'),
  };
}

function isActivePendingInvitation(data: Record<string, unknown>, nowMs: number): boolean {
  if (data.status !== 'PENDING') return false;
  const expiresIso = nullableIso(data.expiresAt);
  return !expiresIso || new Date(expiresIso).getTime() >= nowMs;
}

export async function listWorkspaceTeam(userId: string): Promise<{
  members: TeamMemberSummary[];
  invitations: InvitationItem[];
}> {
  const projects = await getAccessibleProjectsRaw(userId);
  const memberMap = new Map<string, TeamMemberSummary>();

  await Promise.all(
    projects.map(async (proj) => {
      const [membersSnap, tasksSnap, activitiesSnap] = await Promise.all([
        getDocs(collection(firestoreDb, 'projects', proj.id, 'members')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/members`)
        ),
        getDocs(collection(firestoreDb, 'projects', proj.id, 'tasks')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/tasks`)
        ),
        getDocs(collection(firestoreDb, 'projects', proj.id, 'activities')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `projects/${proj.id}/activities`)
        ),
      ]);

      for (const md of membersSnap.docs) {
        const m = md.data();
        const uid = String(m.userId ?? md.id);
        let summary = memberMap.get(uid);
        if (!summary) {
          summary = {
            userId: uid,
            name: String(m.name ?? 'Member'),
            email: String(m.email ?? ''),
            avatar: typeof m.avatar === 'string' ? m.avatar : null,
            projects: [],
            taskStats: { total: 0, completed: 0, active: 0, overdue: 0 },
            activityCount: 0,
          };
          memberMap.set(uid, summary);
        }
        summary.projects.push({
          projectId: proj.id,
          projectName: proj.name,
          role: String(m.role ?? 'MEMBER'),
          joinedAt: timestampToIso(m.joinedAt),
        });
      }

      for (const td of tasksSnap.docs) {
        const t = td.data();
        const assigneeId = typeof t.assigneeId === 'string' ? t.assigneeId : null;
        if (!assigneeId) continue;
        const summary = memberMap.get(assigneeId);
        if (!summary) continue;

        summary.taskStats.total += 1;
        const status = String(t.status ?? 'TODO');
        if (status === 'COMPLETED') {
          summary.taskStats.completed += 1;
        } else {
          summary.taskStats.active += 1;
        }
        if (isOverdue(nullableIso(t.dueDate), status)) {
          summary.taskStats.overdue += 1;
        }
      }

      for (const ad of activitiesSnap.docs) {
        const actorId = String(ad.data().actorId ?? '');
        const summary = memberMap.get(actorId);
        if (summary) {
          summary.activityCount += 1;
        }
      }
    })
  );

  // Outgoing pending invitations authored by or on projects owned by this user
  const [byOwnerSnap, byInviterSnap] = await Promise.all([
    getDocs(
      query(collection(firestoreDb, 'invitations'), where('projectOwnerId', '==', userId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations')),
    getDocs(
      query(collection(firestoreDb, 'invitations'), where('invitedById', '==', userId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations')),
  ]);

  const nowMs = Date.now();
  const invMap = new Map<string, InvitationItem>();
  for (const snap of [byOwnerSnap, byInviterSnap]) {
    for (const d of snap.docs) {
      const data = d.data();
      if (!isActivePendingInvitation(data, nowMs)) continue;
      invMap.set(d.id, mapInvitationDoc(d.id, data));
    }
  }

  return {
    members: Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    invitations: Array.from(invMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  };
}

export async function listProjectInvitations(
  userId: string,
  projectId: string
): Promise<InvitationItem[]> {
  await requireProjectRole(projectId, userId, ['OWNER', 'ADMINISTRATOR']);

  const [byOwnerSnap, byInviterSnap] = await Promise.all([
    getDocs(
      query(collection(firestoreDb, 'invitations'), where('projectOwnerId', '==', userId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations')),
    getDocs(
      query(collection(firestoreDb, 'invitations'), where('invitedById', '==', userId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations')),
  ]);

  const nowMs = Date.now();
  const seen = new Map<string, InvitationItem>();
  for (const snap of [byOwnerSnap, byInviterSnap]) {
    for (const d of snap.docs) {
      const data = d.data();
      if (String(data.projectId ?? '') !== projectId) continue;
      if (!isActivePendingInvitation(data, nowMs)) continue;
      seen.set(d.id, mapInvitationDoc(d.id, data));
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function listIncomingInvitations(userEmail: string): Promise<InvitationItem[]> {
  const email = userEmail.trim().toLowerCase();
  if (!email) return [];

  const snap = await getDocs(
    query(collection(firestoreDb, 'invitations'), where('email', '==', email))
  ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'invitations'));

  const nowMs = Date.now();
  return snap.docs
    .filter((d) => isActivePendingInvitation(d.data(), nowMs))
    .map((d) => mapInvitationDoc(d.id, d.data()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function inviteMember(
  actor: UserProfile,
  projectId: string,
  input: { email: string; role: 'ADMINISTRATOR' | 'MEMBER' }
): Promise<InvitationItem> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid invitation payload.');
  }

  const actorRole = await requireProjectRole(projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);
  if (parsed.data.role === 'ADMINISTRATOR' && actorRole !== 'OWNER') {
    throw new AppError(403, 'Only project owners can invite administrators.');
  }

  const [projSnap, membersSnap] = await Promise.all([
    getDoc(doc(firestoreDb, 'projects', projectId)).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `projects/${projectId}`)
    ),
    getDocs(collection(firestoreDb, 'projects', projectId, 'members')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/members`)
    ),
  ]);

  if (!projSnap.exists()) {
    throw new AppError(404, 'Project not found.');
  }

  const alreadyMember = membersSnap.docs.some(
    (d) => String(d.data().email ?? '').toLowerCase() === parsed.data.email
  );
  if (alreadyMember) {
    throw new AppError(409, 'This user is already a member of the project.');
  }

  const pd = projSnap.data();
  const projectName = String(pd.name ?? 'Project');
  const projectOwnerId = String(pd.ownerId ?? '');
  const token = generateSecureToken(24);
  const expiresAtDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invRef = doc(firestoreDb, 'invitations', token);
  const batch = writeBatch(firestoreDb);

  batch.set(invRef, {
    projectId,
    projectName: projectName.slice(0, 120),
    projectOwnerId,
    email: parsed.data.email,
    role: parsed.data.role,
    token,
    status: 'PENDING',
    invitedById: actor.uid,
    invitedByName: actor.name.slice(0, 80) || 'Member',
    expiresAt: Timestamp.fromDate(expiresAtDate),
    acceptedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    action: 'MEMBER_INVITED',
    resourceType: 'INVITATION',
    resourceName: parsed.data.email,
    details: `Invited ${parsed.data.email} as ${parsed.data.role}`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `invitations/${token}`);
  }

  const nowIso = new Date().toISOString();
  return {
    id: token,
    projectId,
    projectName,
    email: parsed.data.email,
    role: parsed.data.role,
    token,
    status: 'PENDING',
    expiresAt: expiresAtDate.toISOString(),
    createdAt: nowIso,
    invitedByName: actor.name,
  };
}

export async function acceptInvitation(
  actor: UserProfile,
  rawToken: string
): Promise<{ projectId: string }> {
  const parsed = acceptInvitationSchema.safeParse({ token: rawToken });
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invitation token is invalid.');
  }

  const token = parsed.data.token;
  const invRef = doc(firestoreDb, 'invitations', token);
  const invSnap = await getDoc(invRef).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `invitations/${token}`)
  );

  if (!invSnap.exists()) {
    throw new AppError(404, 'Invitation token was not found or is no longer accessible.');
  }

  const inv = invSnap.data();
  if (inv.status !== 'PENDING') {
    throw new AppError(400, `Invitation has already been ${String(inv.status).toLowerCase()}.`);
  }

  const expiresIso = nullableIso(inv.expiresAt);
  if (expiresIso && new Date(expiresIso).getTime() < Date.now()) {
    throw new AppError(400, 'This invitation token has expired.');
  }

  if (String(inv.email ?? '').toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new AppError(
      403,
      `This invitation was issued for ${String(inv.email)}. Sign in with that email to accept.`
    );
  }

  const projectId = String(inv.projectId ?? '');
  const projectName = String(inv.projectName ?? 'Project');
  const existingMember = await getDoc(
    doc(firestoreDb, 'projects', projectId, 'members', actor.uid)
  );
  if (existingMember.exists()) {
    throw new AppError(409, 'You are already a member of this project.');
  }

  const batch = writeBatch(firestoreDb);
  batch.set(doc(firestoreDb, 'projects', projectId, 'members', actor.uid), {
    projectId,
    userId: actor.uid,
    name: actor.name.slice(0, 80) || 'Member',
    email: actor.email,
    avatar: actor.avatar ?? null,
    role: inv.role === 'ADMINISTRATOR' ? 'ADMINISTRATOR' : 'MEMBER',
    inviteToken: token,
    joinedAt: serverTimestamp(),
  });

  batch.set(doc(firestoreDb, 'users', actor.uid, 'projectRefs', projectId), {
    projectId,
    userId: actor.uid,
    role: inv.role === 'ADMINISTRATOR' ? 'ADMINISTRATOR' : 'MEMBER',
    joinedAt: serverTimestamp(),
  });

  batch.update(invRef, {
    status: 'ACCEPTED',
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    action: 'MEMBER_JOINED',
    resourceType: 'MEMBER',
    resourceName: actor.name,
    details: `${actor.name} joined project "${projectName}"`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `invitations/${token}`);
  }

  return { projectId };
}

export async function declineInvitation(
  actor: UserProfile,
  rawToken: string
): Promise<void> {
  const token = rawToken.trim();
  const invRef = doc(firestoreDb, 'invitations', token);
  const invSnap = await getDoc(invRef).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `invitations/${token}`)
  );

  if (!invSnap.exists()) {
    throw new AppError(404, 'Invitation not found.');
  }
  const inv = invSnap.data();
  if (inv.status !== 'PENDING') {
    throw new AppError(400, 'Invitation is no longer pending.');
  }
  if (String(inv.email ?? '').toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new AppError(403, 'You can only decline invitations addressed to your email.');
  }

  try {
    await updateDoc(invRef, {
      status: 'DECLINED',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `invitations/${token}`);
  }
}

export async function revokeInvitation(
  actor: UserProfile,
  token: string
): Promise<void> {
  const invRef = doc(firestoreDb, 'invitations', token);
  const invSnap = await getDoc(invRef).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `invitations/${token}`)
  );

  if (!invSnap.exists()) {
    throw new AppError(404, 'Invitation not found.');
  }
  const inv = invSnap.data();
  const projectId = String(inv.projectId ?? '');
  await requireProjectRole(projectId, actor.uid, ['OWNER', 'ADMINISTRATOR']);

  if (inv.status !== 'PENDING') {
    throw new AppError(400, 'Only pending invitations can be revoked.');
  }

  try {
    await updateDoc(invRef, {
      status: 'REVOKED',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `invitations/${token}`);
  }
}

export async function updateMemberRole(
  actor: UserProfile,
  projectId: string,
  targetUserId: string,
  role: 'ADMINISTRATOR' | 'MEMBER'
): Promise<void> {
  const parsed = updateMemberRoleSchema.safeParse({ role });
  if (!parsed.success) {
    throw new AppError(400, 'Invalid member role.');
  }

  await requireProjectRole(projectId, actor.uid, ['OWNER']);

  const memberRef = doc(firestoreDb, 'projects', projectId, 'members', targetUserId);
  const memberSnap = await getDoc(memberRef).catch((err) =>
    handleFirestoreError(
      err,
      OperationType.GET,
      `projects/${projectId}/members/${targetUserId}`
    )
  );

  if (!memberSnap.exists()) {
    throw new AppError(404, 'Project member not found.');
  }
  const memberData = memberSnap.data();
  if (memberData.role === 'OWNER') {
    throw new AppError(403, 'Project owner role cannot be modified.');
  }

  const projSnap = await getDoc(doc(firestoreDb, 'projects', projectId));
  const projectName = String(projSnap.data()?.name ?? 'Project');

  const batch = writeBatch(firestoreDb);
  batch.update(memberRef, { role: parsed.data.role });
  batch.update(doc(firestoreDb, 'users', targetUserId, 'projectRefs', projectId), {
    role: parsed.data.role,
  });
  addActivityToBatch(batch, {
    actor,
    projectId,
    projectName,
    action: 'MEMBER_ROLE_UPDATED',
    resourceType: 'MEMBER',
    resourceName: String(memberData.name ?? 'Member'),
    details: `Changed ${String(memberData.name ?? 'member')} role to ${parsed.data.role}`,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `projects/${projectId}/members/${targetUserId}`
    );
  }
}

export async function removeMember(
  actor: UserProfile,
  projectId: string,
  targetUserId: string
): Promise<void> {
  const actorRole = await requireProjectRole(projectId, actor.uid);

  const memberRef = doc(firestoreDb, 'projects', projectId, 'members', targetUserId);
  const memberSnap = await getDoc(memberRef).catch((err) =>
    handleFirestoreError(
      err,
      OperationType.GET,
      `projects/${projectId}/members/${targetUserId}`
    )
  );

  if (!memberSnap.exists()) {
    throw new AppError(404, 'Project member not found.');
  }

  const targetData = memberSnap.data();
  const targetRole = String(targetData.role ?? 'MEMBER') as ProjectRole;
  if (!canRemoveTargetMember(actorRole, targetRole, actor.uid === targetUserId)) {
    throw new AppError(403, 'You do not have permission to remove this member.');
  }

  // Unassign any tasks assigned to the departing member before removing membership
  const assignedTasksSnap = await getDocs(
    query(
      collection(firestoreDb, 'projects', projectId, 'tasks'),
      where('assigneeId', '==', targetUserId)
    )
  ).catch((err) =>
    handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks`)
  );

  if (!assignedTasksSnap.empty) {
    await commitOperationsInChunks(
      assignedTasksSnap.docs.map(
        (td) => (b) =>
          b.update(td.ref, {
            assigneeId: null,
            updatedAt: serverTimestamp(),
          })
      )
    );
  }

  const projSnap = await getDoc(doc(firestoreDb, 'projects', projectId));
  const projectName = String(projSnap.data()?.name ?? 'Project');

  const batch = writeBatch(firestoreDb);
  batch.delete(memberRef);
  batch.delete(doc(firestoreDb, 'users', targetUserId, 'projectRefs', projectId));
  if (actor.uid !== targetUserId) {
    addActivityToBatch(batch, {
      actor,
      projectId,
      projectName,
      action: 'MEMBER_REMOVED',
      resourceType: 'MEMBER',
      resourceName: String(targetData.name ?? 'Member'),
      details: `Removed ${String(targetData.name ?? 'member')} from "${projectName}"`,
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `projects/${projectId}/members/${targetUserId}`
    );
  }
}

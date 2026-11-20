import crypto from 'crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/index.ts';
import {
  activityLogs,
  invitations,
  notifications,
  projectMembers,
  projects,
  tasks,
  users,
} from '../../db/schema.ts';
import type { ProjectRole } from '../../lib/validations.ts';
import { AppError } from '../errors.ts';
import { canRemoveTargetMember, requireProjectAccess } from '../permissions.ts';
import { getAccessibleProjectIds, logActivity } from './activity.ts';
import { createNotification } from './notifications.ts';

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function listWorkspaceTeam(userId: number) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) {
      return { members: [], invitations: [] };
    }

    const [memberRows, taskRows, activityRows, inviteRows] = await Promise.all([
      db
        .select({
          projectId: projectMembers.projectId,
          projectName: projects.name,
          userId: projectMembers.userId,
          role: projectMembers.role,
          joinedAt: projectMembers.joinedAt,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(inArray(projectMembers.projectId, accessibleIds))
        .orderBy(projectMembers.joinedAt),
      db
        .select({
          assigneeId: tasks.assigneeId,
          status: tasks.status,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(inArray(tasks.projectId, accessibleIds)),
      db
        .select({
          actorId: activityLogs.actorId,
          count: sql<number>`count(*)::int`,
        })
        .from(activityLogs)
        .where(inArray(activityLogs.projectId, accessibleIds))
        .groupBy(activityLogs.actorId),
      db
        .select({
          id: invitations.id,
          projectId: invitations.projectId,
          projectName: projects.name,
          email: invitations.email,
          role: invitations.role,
          token: invitations.token,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
          invitedByName: users.name,
        })
        .from(invitations)
        .innerJoin(projects, eq(invitations.projectId, projects.id))
        .innerJoin(users, eq(invitations.invitedById, users.id))
        .where(
          and(
            inArray(invitations.projectId, accessibleIds),
            eq(invitations.status, 'PENDING')
          )
        )
        .orderBy(desc(invitations.createdAt)),
    ]);

    const activityCountMap = new Map(activityRows.map((a) => [a.actorId, a.count]));
    const taskStatsByUser = new Map<
      number,
      { total: number; completed: number; active: number; overdue: number }
    >();
    const now = Date.now();
    for (const t of taskRows) {
      if (!t.assigneeId) continue;
      const entry = taskStatsByUser.get(t.assigneeId) ?? {
        total: 0,
        completed: 0,
        active: 0,
        overdue: 0,
      };
      entry.total += 1;
      if (t.status === 'COMPLETED') {
        entry.completed += 1;
      } else {
        entry.active += 1;
        if (t.dueDate && t.dueDate.getTime() < now) entry.overdue += 1;
      }
      taskStatsByUser.set(t.assigneeId, entry);
    }

    const grouped = new Map<
      number,
      {
        userId: number;
        name: string;
        email: string;
        avatar: string | null;
        projects: Array<{ projectId: number; projectName: string; role: string; joinedAt: Date }>;
        taskStats: { total: number; completed: number; active: number; overdue: number };
        activityCount: number;
      }
    >();

    for (const m of memberRows) {
      const existing = grouped.get(m.userId);
      if (existing) {
        existing.projects.push({
          projectId: m.projectId,
          projectName: m.projectName,
          role: m.role,
          joinedAt: m.joinedAt,
        });
      } else {
        grouped.set(m.userId, {
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatar: m.avatar,
          projects: [
            {
              projectId: m.projectId,
              projectName: m.projectName,
              role: m.role,
              joinedAt: m.joinedAt,
            },
          ],
          taskStats: taskStatsByUser.get(m.userId) ?? {
            total: 0,
            completed: 0,
            active: 0,
            overdue: 0,
          },
          activityCount: activityCountMap.get(m.userId) ?? 0,
        });
      }
    }

    return {
      members: Array.from(grouped.values()),
      invitations: inviteRows,
    };
  } catch (error) {
    console.error('Failed to list workspace team:', error);
    throw new AppError(500, 'Failed to load team directory.', { cause: error });
  }
}

export async function listProjectInvitations(projectId: number, userId: number) {
  try {
    await requireProjectAccess(projectId, userId, ['OWNER', 'ADMINISTRATOR']);

    return await db
      .select({
        id: invitations.id,
        projectId: invitations.projectId,
        email: invitations.email,
        role: invitations.role,
        token: invitations.token,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        invitedByName: users.name,
      })
      .from(invitations)
      .innerJoin(users, eq(invitations.invitedById, users.id))
      .where(eq(invitations.projectId, projectId))
      .orderBy(desc(invitations.createdAt));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to list project invitations:', error);
    throw new AppError(500, 'Failed to load invitations.', { cause: error });
  }
}

export async function listIncomingInvitations(
  userEmail: string,
  emailVerified: boolean
) {
  try {
    if (!emailVerified) {
      return [];
    }
    const cleanEmail = userEmail.trim().toLowerCase();
    return await db
      .select({
        id: invitations.id,
        projectId: invitations.projectId,
        projectName: projects.name,
        email: invitations.email,
        role: invitations.role,
        token: invitations.token,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        invitedByName: users.name,
      })
      .from(invitations)
      .innerJoin(projects, eq(invitations.projectId, projects.id))
      .innerJoin(users, eq(invitations.invitedById, users.id))
      .where(
        and(
          eq(invitations.email, cleanEmail),
          eq(invitations.status, 'PENDING'),
          gt(invitations.expiresAt, new Date())
        )
      )
      .orderBy(desc(invitations.createdAt));
  } catch (error) {
    console.error('Failed to list incoming invitations:', error);
    throw new AppError(500, 'Failed to load your invitations.', { cause: error });
  }
}

export async function inviteMember(
  projectId: number,
  actorUserId: number,
  input: { email: string; role: 'ADMINISTRATOR' | 'MEMBER'; baseUrl?: string }
) {
  try {
    const actorRole = await requireProjectAccess(projectId, actorUserId, [
      'OWNER',
      'ADMINISTRATOR',
    ]);

    if (input.role === 'ADMINISTRATOR' && actorRole !== 'OWNER') {
      throw new AppError(403, 'Only project owners can invite administrators.');
    }

    const cleanEmail = input.email.trim().toLowerCase();
    const [existingUser] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (existingUser) {
      const [alreadyMember] = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, existingUser.id)
          )
        )
        .limit(1);

      if (alreadyMember) {
        throw new AppError(409, 'This user is already a member of the project.');
      }
    }

    const [existingPending] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.projectId, projectId),
          eq(invitations.email, cleanEmail),
          eq(invitations.status, 'PENDING'),
          gt(invitations.expiresAt, new Date())
        )
      )
      .limit(1);

    if (existingPending) {
      throw new AppError(409, 'A pending invitation already exists for this email.');
    }

    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const projectName = project?.name ?? 'DevTrack Project';
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invitations)
        .values({
          projectId,
          email: cleanEmail,
          role: input.role,
          token,
          invitedById: actorUserId,
          status: 'PENDING',
          expiresAt,
        })
        .returning();

      await logActivity(tx, {
        actorId: actorUserId,
        projectId,
        action: 'MEMBER_INVITED',
        resourceType: 'INVITATION',
        resourceName: cleanEmail,
        details: `Invited ${cleanEmail} as ${input.role}`,
      });

      if (existingUser && existingUser.emailVerifiedAt) {
        await createNotification(tx, {
          userId: existingUser.id,
          type: 'PROJECT_INVITATION',
          title: 'Project invitation',
          message: `You were invited to join "${projectName}" as ${input.role}.`,
          link: `/team?invite=${token}`,
        });
      }

      return { invitation: created };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to invite member:', error);
    throw new AppError(500, 'Failed to create invitation.', { cause: error });
  }
}

export async function syncPendingInvitationNotificationsForUser(
  executor: DbOrTx,
  userId: number
): Promise<void> {
  const [user] = await executor
    .select({
      id: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      notifyOnInvite: users.notifyOnInvite,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.emailVerifiedAt || !user.notifyOnInvite) {
    return;
  }

  const cleanEmail = user.email.trim().toLowerCase();
  const pending = await executor
    .select({
      projectName: projects.name,
      role: invitations.role,
      token: invitations.token,
    })
    .from(invitations)
    .innerJoin(projects, eq(invitations.projectId, projects.id))
    .where(
      and(
        eq(invitations.email, cleanEmail),
        eq(invitations.status, 'PENDING'),
        gt(invitations.expiresAt, new Date())
      )
    );

  if (pending.length === 0) return;

  const existingNotifs = await executor
    .select({ link: notifications.link })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.type, 'PROJECT_INVITATION')
      )
    );
  const existingLinks = new Set(existingNotifs.map((n) => n.link));

  for (const inv of pending) {
    const link = `/team?invite=${inv.token}`;
    if (!existingLinks.has(link)) {
      await executor.insert(notifications).values({
        userId: user.id,
        type: 'PROJECT_INVITATION',
        title: 'Project invitation',
        message: `You were invited to join "${inv.projectName}" as ${inv.role}.`,
        link,
      });
    }
  }
}

export async function acceptInvitation(
  token: string,
  userId: number,
  userEmail: string,
  emailVerified: boolean
) {
  try {
    if (!emailVerified) {
      throw new AppError(
        403,
        'Please verify your email address before accepting project invitations.'
      );
    }

    return await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.token, token.trim()))
        .limit(1);

      if (!invite) {
        throw new AppError(404, 'Invitation token is invalid.');
      }
      if (invite.status !== 'PENDING') {
        throw new AppError(400, `This invitation has already been ${invite.status.toLowerCase()}.`);
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        await db
          .update(invitations)
          .set({ status: 'EXPIRED' })
          .where(eq(invitations.id, invite.id));
        throw new AppError(400, 'This invitation has expired.');
      }
      if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
        throw new AppError(
          403,
          `This invitation was issued to ${invite.email}. Sign in with that account to accept.`
        );
      }

      const [existingMember] = await tx
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, invite.projectId),
            eq(projectMembers.userId, userId)
          )
        )
        .limit(1);

      if (!existingMember) {
        await tx.insert(projectMembers).values({
          projectId: invite.projectId,
          userId,
          role: invite.role,
        });
      }

      const [updatedInvite] = await tx
        .update(invitations)
        .set({ status: 'ACCEPTED', acceptedAt: new Date() })
        .where(eq(invitations.id, invite.id))
        .returning();

      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, invite.projectId))
        .limit(1);

      await logActivity(tx, {
        actorId: userId,
        projectId: invite.projectId,
        action: 'MEMBER_JOINED',
        resourceType: 'MEMBER',
        resourceName: userEmail,
        details: `Joined "${project?.name ?? 'project'}" as ${invite.role}`,
      });

      return { invitation: updatedInvite, projectId: invite.projectId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to accept invitation:', error);
    throw new AppError(500, 'Failed to accept invitation.', { cause: error });
  }
}

export async function declineInvitation(
  token: string,
  userId: number,
  userEmail: string,
  emailVerified: boolean
) {
  try {
    if (!emailVerified) {
      throw new AppError(
        403,
        'Please verify your email address before responding to project invitations.'
      );
    }

    return await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.token, token.trim()))
        .limit(1);

      if (!invite) {
        throw new AppError(404, 'Invitation token is invalid.');
      }
      if (invite.status !== 'PENDING') {
        throw new AppError(400, `This invitation has already been ${invite.status.toLowerCase()}.`);
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        await db
          .update(invitations)
          .set({ status: 'EXPIRED' })
          .where(eq(invitations.id, invite.id));
        throw new AppError(400, 'This invitation has expired.');
      }
      if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
        throw new AppError(
          403,
          `This invitation was issued to ${invite.email}. Sign in with that account to decline.`
        );
      }

      const [updatedInvite] = await tx
        .update(invitations)
        .set({ status: 'DECLINED' })
        .where(eq(invitations.id, invite.id))
        .returning();

      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, invite.projectId))
        .limit(1);

      await logActivity(tx, {
        actorId: userId,
        projectId: invite.projectId,
        action: 'INVITATION_DECLINED',
        resourceType: 'INVITATION',
        resourceName: userEmail,
        details: `Declined invitation to "${project?.name ?? 'project'}"`,
      });

      return { invitation: updatedInvite };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to decline invitation:', error);
    throw new AppError(500, 'Failed to decline invitation.', { cause: error });
  }
}

export async function revokeInvitation(invitationId: number, userId: number) {
  try {
    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);

    if (!invite) throw new AppError(404, 'Invitation not found.');

    await requireProjectAccess(invite.projectId, userId, ['OWNER', 'ADMINISTRATOR']);

    const [updated] = await db
      .update(invitations)
      .set({ status: 'REVOKED' })
      .where(eq(invitations.id, invitationId))
      .returning();

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to revoke invitation:', error);
    throw new AppError(500, 'Failed to revoke invitation.', { cause: error });
  }
}

export async function updateMemberRole(
  projectId: number,
  targetUserId: number,
  actorUserId: number,
  newRole: 'ADMINISTRATOR' | 'MEMBER'
) {
  try {
    await requireProjectAccess(projectId, actorUserId, ['OWNER']);

    const [target] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, targetUserId)
        )
      )
      .limit(1);

    if (!target) throw new AppError(404, 'Project member not found.');
    if (target.role === 'OWNER') {
      throw new AppError(400, 'Project owner role cannot be changed.');
    }

    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectMembers)
        .set({ role: newRole })
        .where(eq(projectMembers.id, target.id))
        .returning();

      const [targetUser] = await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      await logActivity(tx, {
        actorId: actorUserId,
        projectId,
        action: 'MEMBER_ROLE_UPDATED',
        resourceType: 'MEMBER',
        resourceName: targetUser?.name ?? targetUser?.email ?? 'Member',
        details: `Changed role of ${targetUser?.name ?? 'member'} to ${newRole}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to update member role:', error);
    throw new AppError(500, 'Failed to update member role.', { cause: error });
  }
}

export async function removeMember(
  projectId: number,
  targetUserId: number,
  actorUserId: number
) {
  try {
    const actorRole = await requireProjectAccess(projectId, actorUserId);

    const [target] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, targetUserId)
        )
      )
      .limit(1);

    if (!target) throw new AppError(404, 'Project member not found.');

    const allowed = canRemoveTargetMember(
      actorRole,
      target.role as ProjectRole,
      actorUserId === targetUserId
    );
    if (!allowed) {
      throw new AppError(403, 'You do not have permission to remove this member.');
    }

    return await db.transaction(async (tx) => {
      const [targetUser] = await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      await tx.delete(projectMembers).where(eq(projectMembers.id, target.id));

      await tx
        .update(tasks)
        .set({ assigneeId: null, updatedAt: new Date() })
        .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, targetUserId)));

      await logActivity(tx, {
        actorId: actorUserId,
        projectId,
        action: 'MEMBER_REMOVED',
        resourceType: 'MEMBER',
        resourceName: targetUser?.name ?? targetUser?.email ?? 'Member',
        details: `Removed ${targetUser?.name ?? 'member'} from project`,
      });

      return { removedUserId: targetUserId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Failed to remove member:', error);
    throw new AppError(500, 'Failed to remove project member.', { cause: error });
  }
}

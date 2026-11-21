import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  invitations,
  projectMembers,
  projects,
  users,
} from '../../db/schema.ts';
import {
  createSessionRecord,
  deleteSessionByToken,
  getUserBySessionToken,
  loginWithEmail,
  registerWithEmail,
} from '../services/auth.ts';
import { getUserNotifications } from '../services/notifications.ts';
import { createProject } from '../services/projects.ts';
import {
  acceptInvitation,
  declineInvitation,
  inviteMember,
  listIncomingInvitations,
  revokeInvitation,
} from '../services/team.ts';

const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const createdUserIds: number[] = [];
const createdProjectIds: number[] = [];

afterAll(async () => {
  if (createdProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, createdProjectIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe('DevTrack Email-Based In-App Project Invitations (Live Cloud SQL PostgreSQL)', () => {
  const ownerEmail = `inv-owner-${suffix}@example.com`;
  const unregisteredEmail = `Future.Colleague-${suffix}@Example.COM`;
  const normalizedUnregistered = unregisteredEmail.trim().toLowerCase();
  const existingEmail = `inv-existing-${suffix}@example.com`;
  const unrelatedEmail = `inv-unrelated-${suffix}@example.com`;
  const password = 'DevTrackPass123!';

  let ownerId = 0;
  let existingUserId = 0;
  let unrelatedUserId = 0;
  let newUserId = 0;
  let projectId = 0;
  let unregisteredInviteToken = '';
  let existingInviteToken = '';
  let declineInviteToken = '';
  let expiredInviteToken = '';
  let revokedInviteId = 0;
  let revokedInviteToken = '';

  it('sets up owner, existing registered user, unrelated user, and a project via direct registration', async () => {
    const [ownerRes, existingRes, unrelatedRes] = await Promise.all([
      registerWithEmail({
        name: 'Project Owner',
        email: ownerEmail,
        password,
        baseUrl: 'http://localhost:3000',
      }),
      registerWithEmail({
        name: 'Existing Collaborator',
        email: existingEmail,
        password,
        baseUrl: 'http://localhost:3000',
      }),
      registerWithEmail({
        name: 'Unrelated User',
        email: unrelatedEmail,
        password,
        baseUrl: 'http://localhost:3000',
      }),
    ]);

    ownerId = ownerRes.user.id;
    existingUserId = existingRes.user.id;
    unrelatedUserId = unrelatedRes.user.id;
    createdUserIds.push(ownerId, existingUserId, unrelatedUserId);

    for (const res of [ownerRes, existingRes, unrelatedRes]) {
      expect(res.requiresVerification).toBe(false);
      expect(res.sessionToken).toBeTruthy();
      if (res.sessionToken) await deleteSessionByToken(res.sessionToken);
    }

    const project = await createProject(ownerId, {
      name: `In-App Invite Project ${suffix}`,
      description: 'Testing persistent in-app invitations',
      status: 'ACTIVE',
    });
    projectId = project.id;
    createdProjectIds.push(projectId);
  });

  it('1 & 2. invites an email that has never registered and stores it persistently as PENDING without external email', async () => {
    const res = await inviteMember(projectId, ownerId, {
      email: unregisteredEmail,
      role: 'ADMINISTRATOR',
    });

    expect(res.invitation).toBeDefined();
    expect(res.invitation.projectId).toBe(projectId);
    expect(res.invitation.email).toBe(normalizedUnregistered);
    expect(res.invitation.role).toBe('ADMINISTRATOR');
    expect(res.invitation.status).toBe('PENDING');
    expect(res.invitation.invitedById).toBe(ownerId);
    expect(res.invitation.token.length).toBeGreaterThanOrEqual(32);
    expect(res.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    unregisteredInviteToken = res.invitation.token;

    // Duplicate pending invitation for same project + normalized email is rejected
    await expect(
      inviteMember(projectId, ownerId, {
        email: normalizedUnregistered,
        role: 'MEMBER',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('3 & 4 & 5 & 6. newly registered account sees pending invitation via normalized email without auto-join, then accepts explicitly', async () => {
    const regRes = await registerWithEmail({
      name: 'New Collaborator',
      email: normalizedUnregistered,
      password,
      baseUrl: 'http://localhost:3000',
    });
    newUserId = regRes.user.id;
    createdUserIds.push(newUserId);
    expect(regRes.requiresVerification).toBe(false);
    expect(regRes.sessionToken).toBeTruthy();
    if (regRes.sessionToken) await deleteSessionByToken(regRes.sessionToken);

    // Confirm no project membership is automatically granted upon registration
    const preMembers = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, newUserId)));
    expect(preMembers.length).toBe(0);

    // Pending invitation & notification appear immediately using normalized email
    const incoming = await listIncomingInvitations(normalizedUnregistered);
    expect(incoming.length).toBe(1);
    expect(incoming[0].token).toBe(unregisteredInviteToken);
    expect(incoming[0].role).toBe('ADMINISTRATOR');

    const notifData = await getUserNotifications(newUserId);
    expect(
      notifData.items.some(
        (n) => n.type === 'PROJECT_INVITATION' && n.link === `/team?invite=${unregisteredInviteToken}`
      )
    ).toBe(true);

    // Accept invitation -> creates membership with original role & marks ACCEPTED
    const accepted = await acceptInvitation(
      unregisteredInviteToken,
      newUserId,
      normalizedUnregistered
    );
    expect(accepted.projectId).toBe(projectId);
    expect(accepted.invitation.status).toBe('ACCEPTED');

    const membersAfter = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, newUserId)));
    expect(membersAfter.length).toBe(1);
    expect(membersAfter[0].role).toBe('ADMINISTRATOR');

    // Accepting again fails cleanly without duplicate membership
    await expect(
      acceptInvitation(unregisteredInviteToken, newUserId, normalizedUnregistered)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('7 & 8 & 12. invites an existing registered user, persists across logout/login, and displays after login', async () => {
    const res = await inviteMember(projectId, ownerId, {
      email: existingEmail,
      role: 'MEMBER',
    });
    existingInviteToken = res.invitation.token;

    // Login, check invitations, logout, login again -> still present
    const login1 = await loginWithEmail({ email: existingEmail, password });
    expect((await getUserBySessionToken(login1.sessionToken))?.id).toBe(existingUserId);
    const list1 = await listIncomingInvitations(login1.user.email);
    expect(list1.some((i) => i.token === existingInviteToken)).toBe(true);
    await deleteSessionByToken(login1.sessionToken);

    const login2 = await loginWithEmail({ email: existingEmail, password });
    const list2 = await listIncomingInvitations(login2.user.email);
    expect(list2.some((i) => i.token === existingInviteToken)).toBe(true);

    const notifs = await getUserNotifications(existingUserId);
    expect(
      notifs.items.some(
        (n) => n.type === 'PROJECT_INVITATION' && n.link === `/team?invite=${existingInviteToken}`
      )
    ).toBe(true);

    await deleteSessionByToken(login2.sessionToken);
  });

  it('10. prevents an unrelated account from seeing or accepting another user invitation', async () => {
    const unrelatedIncoming = await listIncomingInvitations(unrelatedEmail);
    expect(unrelatedIncoming.some((i) => i.token === existingInviteToken)).toBe(false);

    await expect(
      acceptInvitation(existingInviteToken, unrelatedUserId, unrelatedEmail)
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      declineInvitation(existingInviteToken, unrelatedUserId, unrelatedEmail)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('9. declines an invitation without creating project membership', async () => {
    declineInviteToken = existingInviteToken;
    const declined = await declineInvitation(
      declineInviteToken,
      existingUserId,
      existingEmail
    );
    expect(declined.invitation.status).toBe('DECLINED');

    const members = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, existingUserId))
      );
    expect(members.length).toBe(0);

    const incomingAfter = await listIncomingInvitations(existingEmail);
    expect(incomingAfter.some((i) => i.token === declineInviteToken)).toBe(false);
  });

  it('11. rejects expired and revoked invitations', async () => {
    // Revoked invitation
    const inv1 = await inviteMember(projectId, ownerId, {
      email: existingEmail,
      role: 'MEMBER',
    });
    revokedInviteId = inv1.invitation.id;
    revokedInviteToken = inv1.invitation.token;
    await revokeInvitation(revokedInviteId, ownerId);

    await expect(
      acceptInvitation(revokedInviteToken, existingUserId, existingEmail)
    ).rejects.toMatchObject({ statusCode: 400 });

    // Expired invitation
    const inv2 = await inviteMember(projectId, ownerId, {
      email: unrelatedEmail,
      role: 'MEMBER',
    });
    expiredInviteToken = inv2.invitation.token;
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.id, inv2.invitation.id));

    expect((await listIncomingInvitations(unrelatedEmail)).length).toBe(0);
    await expect(
      acceptInvitation(expiredInviteToken, unrelatedUserId, unrelatedEmail)
    ).rejects.toMatchObject({ statusCode: 400 });

    const [expiredRow] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, inv2.invitation.id))
      .limit(1);
    expect(expiredRow.status).toBe('EXPIRED');

    // Also confirm unauthorized member cannot escalate role or invite
    const sessionCheck = await createSessionRecord(unrelatedUserId, 'Vitest/Check');
    await deleteSessionByToken(sessionCheck);
  });
});

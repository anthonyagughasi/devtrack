import { describe, expect, it } from 'vitest';
import {
  acceptInvitationSchema,
  commentSchema,
  createProjectSchema,
  createTaskSchema,
  inviteMemberSchema,
  moveTaskSchema,
  updateUserSettingsSchema,
} from '../../lib/validations.ts';
import {
  canDeleteProject,
  canEditProject,
  canManageAdministrators,
  canManageMembers,
  canManageTasks,
  canRemoveTargetMember,
} from '../permissions.ts';

describe('DevTrack RBAC Permissions', () => {
  it('enforces OWNER full control', () => {
    expect(canDeleteProject('OWNER')).toBe(true);
    expect(canManageAdministrators('OWNER')).toBe(true);
    expect(canManageMembers('OWNER')).toBe(true);
    expect(canEditProject('OWNER')).toBe(true);
    expect(canManageTasks('OWNER')).toBe(true);
  });

  it('enforces ADMINISTRATOR scope without project deletion or admin promotion', () => {
    expect(canDeleteProject('ADMINISTRATOR')).toBe(false);
    expect(canManageAdministrators('ADMINISTRATOR')).toBe(false);
    expect(canManageMembers('ADMINISTRATOR')).toBe(true);
    expect(canEditProject('ADMINISTRATOR')).toBe(true);
    expect(canManageTasks('ADMINISTRATOR')).toBe(true);
  });

  it('enforces MEMBER scope strictly to tasks and comments', () => {
    expect(canDeleteProject('MEMBER')).toBe(false);
    expect(canManageAdministrators('MEMBER')).toBe(false);
    expect(canManageMembers('MEMBER')).toBe(false);
    expect(canEditProject('MEMBER')).toBe(false);
    expect(canManageTasks('MEMBER')).toBe(true);
  });

  it('denies all permissions to non-members (null role)', () => {
    expect(canDeleteProject(null)).toBe(false);
    expect(canManageAdministrators(null)).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canEditProject(null)).toBe(false);
    expect(canManageTasks(null)).toBe(false);
  });

  it('prevents removing project OWNER and restricts ADMINISTRATOR from removing other admins', () => {
    expect(canRemoveTargetMember('OWNER', 'OWNER', true)).toBe(false);
    expect(canRemoveTargetMember('OWNER', 'ADMINISTRATOR', false)).toBe(true);
    expect(canRemoveTargetMember('ADMINISTRATOR', 'ADMINISTRATOR', false)).toBe(false);
    expect(canRemoveTargetMember('ADMINISTRATOR', 'MEMBER', false)).toBe(true);
    expect(canRemoveTargetMember('MEMBER', 'MEMBER', false)).toBe(false);
    expect(canRemoveTargetMember('MEMBER', 'MEMBER', true)).toBe(true);
  });
});

describe('DevTrack Zod Validation Schemas', () => {
  it('validates project creation payloads', () => {
    const valid = createProjectSchema.safeParse({
      name: 'Core Gateway',
      status: 'ACTIVE',
      description: 'API Gateway hardening',
    });
    expect(valid.success).toBe(true);

    const invalid = createProjectSchema.safeParse({ name: 'A' });
    expect(invalid.success).toBe(false);
  });

  it('validates task creation and Kanban move payloads', () => {
    const validTask = createTaskSchema.safeParse({
      projectId: 1,
      title: 'Implement RBAC tests',
      priority: 'HIGH',
      status: 'TODO',
    });
    expect(validTask.success).toBe(true);

    const validMove = moveTaskSchema.safeParse({
      status: 'IN_PROGRESS',
      position: 2,
    });
    expect(validMove.success).toBe(true);

    const badMove = moveTaskSchema.safeParse({
      status: 'INVALID_COL',
      position: -1,
    });
    expect(badMove.success).toBe(false);
  });

  it('validates comments, invitations, and user preferences', () => {
    expect(commentSchema.safeParse({ content: 'Looks solid' }).success).toBe(true);
    expect(commentSchema.safeParse({ content: '   ' }).success).toBe(false);

    const inv = inviteMemberSchema.safeParse({
      email: 'Engineer@Example.COM',
      role: 'MEMBER',
    });
    expect(inv.success).toBe(true);
    if (inv.success) {
      expect(inv.data.email).toBe('engineer@example.com');
    }

    expect(acceptInvitationSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(
      updateUserSettingsSchema.safeParse({ themePreference: 'dark', notifyOnAssign: false })
        .success
    ).toBe(true);
  });
});

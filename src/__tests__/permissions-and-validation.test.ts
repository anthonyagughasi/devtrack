import { describe, expect, it } from 'vitest';
import {
  canDeleteProject,
  canEditProject,
  canManageAdministrators,
  canManageMembers,
  canManageTasks,
  canRemoveTargetMember,
} from '../lib/permissions';
import {
  createProjectSchema,
  createTaskSchema,
  inviteMemberSchema,
  registerSchema,
  strongPasswordSchema,
  updateTaskSchema,
} from '../lib/validations';

describe('Project RBAC permission helpers', () => {
  it('enforces owner-only delete and administrator management', () => {
    expect(canDeleteProject('OWNER')).toBe(true);
    expect(canDeleteProject('ADMINISTRATOR')).toBe(false);
    expect(canDeleteProject('MEMBER')).toBe(false);
    expect(canDeleteProject(null)).toBe(false);

    expect(canManageAdministrators('OWNER')).toBe(true);
    expect(canManageAdministrators('ADMINISTRATOR')).toBe(false);
    expect(canManageAdministrators('MEMBER')).toBe(false);
  });

  it('allows both owner and administrator to edit project and invite/manage members', () => {
    expect(canEditProject('OWNER')).toBe(true);
    expect(canEditProject('ADMINISTRATOR')).toBe(true);
    expect(canEditProject('MEMBER')).toBe(false);

    expect(canManageMembers('OWNER')).toBe(true);
    expect(canManageMembers('ADMINISTRATOR')).toBe(true);
    expect(canManageMembers('MEMBER')).toBe(false);

    expect(canManageTasks('MEMBER')).toBe(true);
    expect(canManageTasks(null)).toBe(false);
  });

  it('restricts member removal properly', () => {
    expect(canRemoveTargetMember('OWNER', 'OWNER', true)).toBe(false);
    expect(canRemoveTargetMember('OWNER', 'ADMINISTRATOR', false)).toBe(true);
    expect(canRemoveTargetMember('ADMINISTRATOR', 'MEMBER', false)).toBe(true);
    expect(canRemoveTargetMember('ADMINISTRATOR', 'ADMINISTRATOR', false)).toBe(false);
    expect(canRemoveTargetMember('MEMBER', 'MEMBER', true)).toBe(true);
    expect(canRemoveTargetMember('MEMBER', 'MEMBER', false)).toBe(false);
  });
});

describe('Zod validation schemas for Firebase Firestore records', () => {
  it('validates project creation with defaults', () => {
    const parsed = createProjectSchema.parse({
      name: 'Cloud Firestore Migration',
    });
    expect(parsed.name).toBe('Cloud Firestore Migration');
    expect(parsed.status).toBe('PLANNING');
    expect(parsed.description).toBe('');
  });

  it('validates task creation and update with string IDs', () => {
    const created = createTaskSchema.parse({
      projectId: 'proj_abc123',
      title: 'Implement Firestore rules',
      assigneeId: 'uid_xyz789',
    });
    expect(created.projectId).toBe('proj_abc123');
    expect(created.assigneeId).toBe('uid_xyz789');
    expect(created.status).toBe('TODO');
    expect(created.priority).toBe('MEDIUM');

    const updated = updateTaskSchema.parse({
      status: 'COMPLETED',
      assigneeId: null,
      position: 2,
    });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.assigneeId).toBeNull();
    expect(updated.position).toBe(2);
  });

  it('lowercases invite emails and validates role enum', () => {
    const invite = inviteMemberSchema.parse({
      email: 'Engineer@Example.COM',
      role: 'ADMINISTRATOR',
    });
    expect(invite.email).toBe('engineer@example.com');
    expect(invite.role).toBe('ADMINISTRATOR');
  });

  it('enforces strong password rules and matching confirmation on registration', () => {
    expect(strongPasswordSchema.safeParse('weak').success).toBe(false);
    expect(strongPasswordSchema.safeParse('StrongPass1').success).toBe(true);

    const mismatch = registerSchema.safeParse({
      name: 'Alex Rivera',
      email: 'alex@example.com',
      password: 'StrongPass1',
      confirmPassword: 'DifferentPass1',
    });
    expect(mismatch.success).toBe(false);
  });
});

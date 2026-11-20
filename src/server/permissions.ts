import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { projectMembers, projects } from '../db/schema.ts';
import type { ProjectRole } from '../lib/validations.ts';
import { AppError } from './errors.ts';

export function canManageTasks(role: ProjectRole | null): boolean {
  return role === 'OWNER' || role === 'ADMINISTRATOR' || role === 'MEMBER';
}

export function canEditProject(role: ProjectRole | null): boolean {
  return role === 'OWNER' || role === 'ADMINISTRATOR';
}

export function canManageMembers(role: ProjectRole | null): boolean {
  return role === 'OWNER' || role === 'ADMINISTRATOR';
}

export function canManageAdministrators(role: ProjectRole | null): boolean {
  return role === 'OWNER';
}

export function canDeleteProject(role: ProjectRole | null): boolean {
  return role === 'OWNER';
}

export function canRemoveTargetMember(
  actorRole: ProjectRole,
  targetRole: ProjectRole,
  isSelf: boolean
): boolean {
  if (targetRole === 'OWNER') return false;
  if (isSelf) return true;
  if (actorRole === 'OWNER') return true;
  if (actorRole === 'ADMINISTRATOR') return targetRole === 'MEMBER';
  return false;
}

export async function getUserProjectRole(
  projectId: number,
  userId: number
): Promise<ProjectRole | null> {
  try {
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (membership) {
      return membership.role as ProjectRole;
    }

    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (project && project.ownerId === userId) {
      return 'OWNER';
    }

    return null;
  } catch (error) {
    console.error('Permission lookup failed:', error);
    throw new AppError(500, 'Failed to verify project permissions.', { cause: error });
  }
}

export async function requireProjectAccess(
  projectId: number,
  userId: number,
  allowedRoles: readonly ProjectRole[] = ['OWNER', 'ADMINISTRATOR', 'MEMBER']
): Promise<ProjectRole> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new AppError(404, 'Project not found.');
  }

  const role = await getUserProjectRole(projectId, userId);
  if (!role || !allowedRoles.includes(role)) {
    throw new AppError(403, 'You do not have permission to perform this action on this project.');
  }

  return role;
}

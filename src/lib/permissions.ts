import type { ProjectRole } from './validations';

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

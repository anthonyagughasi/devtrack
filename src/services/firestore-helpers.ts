import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type DocumentData,
  type WriteBatch,
} from 'firebase/firestore';
import {
  AppError,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import type { ProjectRole } from '../lib/validations';
import type { UserProfile } from '../types/app';

export function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      return fn().toISOString();
    }
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

export function nullableIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      return fn().toISOString();
    }
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function normalizeDateIsoInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function generateSecureToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requireProjectRole(
  projectId: string,
  userId: string,
  allowedRoles: readonly ProjectRole[] = ['OWNER', 'ADMINISTRATOR', 'MEMBER']
): Promise<ProjectRole> {
  const path = `projects/${projectId}/members/${userId}`;
  let snap;
  try {
    snap = await getDoc(doc(firestoreDb, 'projects', projectId, 'members', userId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!snap.exists()) {
    throw new AppError(403, 'You do not have access to this project.');
  }

  const role = String(snap.data().role ?? 'MEMBER') as ProjectRole;
  if (!allowedRoles.includes(role)) {
    throw new AppError(
      403,
      'You do not have permission to perform this action on this project.'
    );
  }
  return role;
}

export function addActivityToBatch(
  batch: WriteBatch,
  input: {
    actor: Pick<UserProfile, 'uid' | 'name' | 'avatar'>;
    projectId: string;
    projectName: string;
    taskId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceName?: string | null;
    details?: string | null;
  }
): void {
  const actRef = doc(
    firestoreDb,
    'projects',
    input.projectId,
    'activities',
    generateSecureToken(12)
  );
  batch.set(actRef, {
    actorId: input.actor.uid,
    actorName: input.actor.name.slice(0, 80) || 'Member',
    actorAvatar: input.actor.avatar ?? null,
    projectId: input.projectId,
    projectName: input.projectName.slice(0, 120) || 'Project',
    taskId: input.taskId ?? null,
    action: input.action.slice(0, 64),
    resourceType: input.resourceType ?? null,
    resourceName: input.resourceName ? input.resourceName.slice(0, 200) : null,
    details: input.details ? input.details.slice(0, 500) : null,
    createdAt: serverTimestamp(),
  });
}

export async function commitOperationsInChunks(
  operations: Array<(batch: WriteBatch) => void>
): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(firestoreDb);
    for (const op of chunk) {
      op(batch);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'batch');
    }
  }
}

export function rawTimestampOrNull(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      return Timestamp.fromDate(fn());
    }
  }
  return null;
}

export function mapDocFields<T extends DocumentData>(id: string, data: T): T & { id: string } {
  return { ...data, id };
}

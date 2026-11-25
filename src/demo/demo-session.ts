import type { UserProfile } from '../types/app';

export const DEMO_USER_ID = 'demo_recruiter_owner';
export const DEMO_USER_EMAIL = 'jordan.mercer@northstar-demo.dev';
export const DEMO_ACTIVE_STORAGE_KEY = 'devtrack_recruiter_demo_v1:active';
export const DEMO_WORKSPACE_STORAGE_KEY = 'devtrack_recruiter_demo_v1:workspace';

let memoryActiveFallback = false;

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota/incognito restriction errors; memory fallback still works
  }
}

function safeLocalStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function isDemoPath(pathname?: string): boolean {
  if (typeof window === 'undefined' && pathname === undefined) return false;
  const path = (pathname ?? window.location.pathname).replace(/\/+$/, '') || '/';
  return path === '/demo' || path.startsWith('/demo/');
}

export function isDemoSessionStored(): boolean {
  if (memoryActiveFallback) return true;
  if (isDemoPath()) return true;
  return safeLocalStorageGet(DEMO_ACTIVE_STORAGE_KEY) === 'true';
}

export function setDemoSessionStored(active: boolean): void {
  memoryActiveFallback = active;
  if (active) {
    safeLocalStorageSet(DEMO_ACTIVE_STORAGE_KEY, 'true');
  } else {
    safeLocalStorageRemove(DEMO_ACTIVE_STORAGE_KEY);
  }
}

export function isDemoUserId(userId: string | null | undefined): boolean {
  return userId === DEMO_USER_ID;
}

export function isDemoProfile(
  actor: Pick<UserProfile, 'uid'> | string | null | undefined
): boolean {
  if (!actor) return false;
  if (typeof actor === 'string') return actor === DEMO_USER_ID;
  return actor.uid === DEMO_USER_ID;
}

export function isDemoModeGuardTriggered(
  actorOrId?: Pick<UserProfile, 'uid'> | string | null
): boolean {
  return isDemoProfile(actorOrId) && isDemoSessionStored();
}

export function assertNotDemoFirestoreLeak(
  actorOrId?: Pick<UserProfile, 'uid'> | string | null
): void {
  if (isDemoProfile(actorOrId) || isDemoSessionStored()) {
    throw new Error('Blocked Firestore access during active Demo Mode.');
  }
}

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
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
import type { NotificationItem, UserProfile } from '../types/app';
import { generateSecureToken, nullableIso, timestampToIso } from './firestore-helpers';

export async function sendProjectNotification(input: {
  recipientUid: string;
  actorUid: string;
  projectId: string;
  type:
    | 'TASK_ASSIGNED'
    | 'TASK_UPDATED'
    | 'TASK_COMMENT'
    | 'PROJECT_INVITATION'
    | 'DEADLINE_APPROACHING';
  title: string;
  message: string;
  link?: string | null;
  notificationId?: string;
}): Promise<void> {
  if (!input.recipientUid || !input.projectId) return;
  const notifId = input.notificationId ?? generateSecureToken(12);
  const path = `users/${input.recipientUid}/notifications/${notifId}`;
  try {
    await setDoc(doc(firestoreDb, 'users', input.recipientUid, 'notifications', notifId), {
      userId: input.recipientUid,
      actorId: input.actorUid,
      projectId: input.projectId,
      type: input.type,
      title: input.title.slice(0, 160),
      message: input.message.slice(0, 500),
      link: input.link ? input.link.slice(0, 300) : null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Log structured context but do not fail primary task/comment mutation on notification error
    console.warn('Notification dispatch skipped:', err, path);
  }
}

async function syncPendingNotificationsForUser(profile: UserProfile): Promise<void> {
  const uid = profile.uid;
  const now = Date.now();
  const soon = now + 48 * 60 * 60 * 1000;
  const dayKey = new Date(now).toISOString().slice(0, 10);

  if (profile.notifyOnDeadline) {
    try {
      const refsSnap = await getDocs(collection(firestoreDb, 'users', uid, 'projectRefs'));
      for (const refDoc of refsSnap.docs) {
        const projectId = refDoc.id;
        try {
          const tasksSnap = await getDocs(
            query(
              collection(firestoreDb, 'projects', projectId, 'tasks'),
              where('assigneeId', '==', uid)
            )
          );
          for (const taskDoc of tasksSnap.docs) {
            const taskData = taskDoc.data();
            if (taskData.status === 'COMPLETED') continue;
            const dueIso = nullableIso(taskData.dueDate);
            if (!dueIso) continue;
            const dueMs = new Date(dueIso).getTime();
            if (dueMs >= now && dueMs <= soon) {
              const notifId = `deadline_${taskDoc.id}_${dayKey}`;
              const notifRef = doc(firestoreDb, 'users', uid, 'notifications', notifId);
              const existing = await getDoc(notifRef);
              if (!existing.exists()) {
                await setDoc(notifRef, {
                  userId: uid,
                  actorId: uid,
                  projectId,
                  type: 'DEADLINE_APPROACHING',
                  title: 'Upcoming deadline',
                  message: `"${String(taskData.title ?? 'Task')}" is due within 48 hours.`,
                  link: `/projects/${projectId}?task=${taskDoc.id}`,
                  read: false,
                  createdAt: serverTimestamp(),
                });
              }
            }
          }
        } catch {
          // Skip projects whose access was revoked
        }
      }
    } catch {
      // Non-fatal deadline sync failure
    }
  }

  if (profile.notifyOnInvite && profile.email) {
    try {
      const invitesSnap = await getDocs(
        query(
          collection(firestoreDb, 'invitations'),
          where('email', '==', profile.email.trim().toLowerCase())
        )
      );
      for (const invDoc of invitesSnap.docs) {
        const inv = invDoc.data();
        if (inv.status !== 'PENDING') continue;
        const expiresIso = nullableIso(inv.expiresAt);
        if (expiresIso && new Date(expiresIso).getTime() < now) continue;

        const notifId = `invite_${invDoc.id}`;
        const notifRef = doc(firestoreDb, 'users', uid, 'notifications', notifId);
        const existing = await getDoc(notifRef);
        if (!existing.exists()) {
          await setDoc(notifRef, {
            userId: uid,
            actorId: uid,
            projectId: String(inv.projectId ?? ''),
            type: 'PROJECT_INVITATION',
            title: 'Project invitation',
            message: `You were invited to join "${String(inv.projectName ?? 'DevTrack Project')}" as ${String(inv.role ?? 'MEMBER')}.`,
            link: `/team?invite=${invDoc.id}`,
            read: false,
            createdAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // Non-fatal invitation notification sync failure
    }
  }
}

export async function getUserNotifications(
  profile: UserProfile
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  await syncPendingNotificationsForUser(profile);

  const path = `users/${profile.uid}/notifications`;
  let snap;
  try {
    snap = await getDocs(collection(firestoreDb, 'users', profile.uid, 'notifications'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }

  const mapped: NotificationItem[] = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        userId: String(data.userId ?? profile.uid),
        projectId: typeof data.projectId === 'string' ? data.projectId : undefined,
        type: String(data.type ?? 'TASK_UPDATED'),
        title: String(data.title ?? ''),
        message: String(data.message ?? ''),
        link: typeof data.link === 'string' ? data.link : null,
        read: Boolean(data.read),
        createdAt: timestampToIso(data.createdAt),
      };
    })
    .filter((item) => {
      if (item.type === 'TASK_ASSIGNED' && !profile.notifyOnAssign) return false;
      if (item.type === 'TASK_COMMENT' && !profile.notifyOnComment) return false;
      if (item.type === 'PROJECT_INVITATION' && !profile.notifyOnInvite) return false;
      if (item.type === 'DEADLINE_APPROACHING' && !profile.notifyOnDeadline) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const items = mapped.slice(0, 40);
  const unreadCount = mapped.filter((n) => !n.read).length;
  return { items, unreadCount };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<void> {
  const path = `users/${userId}/notifications/${notificationId}`;
  const ref = doc(firestoreDb, 'users', userId, 'notifications', notificationId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!snap.exists()) {
    throw new AppError(404, 'Notification not found.');
  }

  try {
    await updateDoc(ref, { read: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const path = `users/${userId}/notifications`;
  let snap;
  try {
    snap = await getDocs(
      query(collection(firestoreDb, 'users', userId, 'notifications'), where('read', '==', false))
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }

  if (snap.empty) return;

  const batch = writeBatch(firestoreDb);
  for (const d of snap.docs) {
    batch.update(d.ref, { read: true });
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

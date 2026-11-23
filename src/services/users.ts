import type { User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AppError,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import type { UserProfile } from '../types/app';
import { timestampToIso } from './firestore-helpers';

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH = 340000;

function hasPasswordProvider(firebaseUser: FirebaseUser): boolean {
  return firebaseUser.providerData.some((p) => p.providerId === 'password');
}

function mapUserDoc(
  uid: string,
  data: Record<string, unknown>,
  firebaseUser: FirebaseUser
): UserProfile {
  return {
    id: uid,
    uid,
    name: String(data.name ?? firebaseUser.displayName ?? 'DevTrack User'),
    email: String(data.email ?? firebaseUser.email ?? '').toLowerCase(),
    avatar: typeof data.avatar === 'string' ? data.avatar : null,
    role: String(data.role ?? 'USER'),
    emailVerified: firebaseUser.emailVerified,
    hasPassword: Boolean(data.hasPassword) || hasPasswordProvider(firebaseUser),
    themePreference: data.themePreference === 'light' ? 'light' : 'dark',
    notifyOnAssign: data.notifyOnAssign !== false,
    notifyOnComment: data.notifyOnComment !== false,
    notifyOnInvite: data.notifyOnInvite !== false,
    notifyOnDeadline: data.notifyOnDeadline !== false,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function syncUserProfile(
  firebaseUser: FirebaseUser,
  overrides?: { displayName?: string; hasPassword?: boolean }
): Promise<UserProfile> {
  const uid = firebaseUser.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(firestoreDb, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  const email = (firebaseUser.email ?? '').trim().toLowerCase();
  const providerHasPassword = hasPasswordProvider(firebaseUser);

  if (!snap.exists()) {
    const name = (
      overrides?.displayName ||
      firebaseUser.displayName ||
      email.split('@')[0] ||
      'Developer'
    )
      .trim()
      .slice(0, 80);

    const payload = {
      uid,
      name,
      email,
      avatar: firebaseUser.photoURL ?? null,
      role: 'USER',
      hasPassword: overrides?.hasPassword ?? providerHasPassword,
      themePreference: 'dark',
      notifyOnAssign: true,
      notifyOnComment: true,
      notifyOnInvite: true,
      notifyOnDeadline: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(userRef, payload);
      const createdSnap = await getDoc(userRef);
      return mapUserDoc(uid, createdSnap.data() ?? payload, firebaseUser);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
  }

  const existing = snap.data();
  const desiredHasPassword =
    Boolean(existing.hasPassword) || Boolean(overrides?.hasPassword) || providerHasPassword;
  const desiredAvatar =
    existing.avatar === null && firebaseUser.photoURL ? firebaseUser.photoURL : existing.avatar;

  if (
    desiredHasPassword !== Boolean(existing.hasPassword) ||
    desiredAvatar !== existing.avatar
  ) {
    try {
      await updateDoc(userRef, {
        hasPassword: desiredHasPassword,
        avatar: desiredAvatar ?? null,
        updatedAt: serverTimestamp(),
      });
      const updatedSnap = await getDoc(userRef);
      return mapUserDoc(uid, updatedSnap.data() ?? existing, firebaseUser);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }
  }

  return mapUserDoc(uid, existing, firebaseUser);
}

async function syncMemberProfileAcrossProjects(
  uid: string,
  updates: { name?: string; avatar?: string | null }
): Promise<void> {
  if (updates.name === undefined && updates.avatar === undefined) return;

  const refsPath = `users/${uid}/projectRefs`;
  let refsSnap;
  try {
    refsSnap = await getDocs(collection(firestoreDb, 'users', uid, 'projectRefs'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, refsPath);
  }

  if (refsSnap.empty) return;

  const batch = writeBatch(firestoreDb);
  let pendingOps = 0;

  for (const refDoc of refsSnap.docs) {
    const projectId = refDoc.id;
    const memberRef = doc(firestoreDb, 'projects', projectId, 'members', uid);
    try {
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) continue;
      const memberPatch: Record<string, unknown> = {};
      if (updates.name !== undefined) memberPatch.name = updates.name;
      if (updates.avatar !== undefined) memberPatch.avatar = updates.avatar;
      batch.update(memberRef, memberPatch);
      pendingOps += 1;
    } catch {
      // Ignore stale project references if project was removed
    }
  }

  if (pendingOps > 0) {
    try {
      await batch.commit();
    } catch {
      // Non-fatal: primary user profile already persisted
    }
  }
}

export async function updateUserProfileSettings(
  firebaseUser: FirebaseUser,
  input: {
    name?: string;
    avatar?: string | null;
    hasPassword?: boolean;
    themePreference?: 'dark' | 'light';
    notifyOnAssign?: boolean;
    notifyOnComment?: boolean;
    notifyOnInvite?: boolean;
    notifyOnDeadline?: boolean;
  }
): Promise<UserProfile> {
  const uid = firebaseUser.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(firestoreDb, 'users', uid);

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 80);
  if (input.avatar !== undefined) patch.avatar = input.avatar;
  if (input.hasPassword !== undefined) patch.hasPassword = input.hasPassword;
  if (input.themePreference !== undefined) patch.themePreference = input.themePreference;
  if (input.notifyOnAssign !== undefined) patch.notifyOnAssign = input.notifyOnAssign;
  if (input.notifyOnComment !== undefined) patch.notifyOnComment = input.notifyOnComment;
  if (input.notifyOnInvite !== undefined) patch.notifyOnInvite = input.notifyOnInvite;
  if (input.notifyOnDeadline !== undefined) patch.notifyOnDeadline = input.notifyOnDeadline;

  try {
    await updateDoc(userRef, patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }

  await syncMemberProfileAcrossProjects(uid, {
    name: input.name !== undefined ? input.name.trim().slice(0, 80) : undefined,
    avatar: input.avatar,
  });

  return syncUserProfile(firebaseUser);
}

async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(objectUrl);
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new AppError(400, 'Browser image processing is unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/webp', 0.82);
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH || !dataUrl.startsWith('data:image/')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        }
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.55);
        }
        if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
          reject(new AppError(400, 'Image is too large after compression. Choose a smaller image.'));
          return;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new AppError(400, 'Unable to read the selected image file.'));
    };
    img.src = objectUrl;
  });
}

export async function uploadUserAvatarFile(
  firebaseUser: FirebaseUser,
  file: File
): Promise<UserProfile> {
  const normalizedType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (!ALLOWED_AVATAR_TYPES.has(normalizedType)) {
    throw new AppError(400, 'Please select a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new AppError(400, 'Profile picture must be 2 MB or smaller.');
  }

  const dataUrl = await compressImageToDataUrl(file);
  return updateUserProfileSettings(firebaseUser, { avatar: dataUrl });
}

export async function removeUserAvatar(firebaseUser: FirebaseUser): Promise<UserProfile> {
  return updateUserProfileSettings(firebaseUser, { avatar: null });
}

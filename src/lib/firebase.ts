import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import appletFirebaseConfig from '../../firebase-applet-config.json';

export const firebaseClientConfig: FirebaseOptions = {
  apiKey: appletFirebaseConfig.apiKey,
  authDomain: appletFirebaseConfig.authDomain,
  projectId: appletFirebaseConfig.projectId,
  storageBucket: appletFirebaseConfig.storageBucket,
  messagingSenderId: appletFirebaseConfig.messagingSenderId,
  appId: appletFirebaseConfig.appId,
};

export const firestoreDatabaseId = appletFirebaseConfig.firestoreDatabaseId;

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    firebaseClientConfig.apiKey &&
      firebaseClientConfig.authDomain &&
      firebaseClientConfig.projectId &&
      firebaseClientConfig.appId
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseClientConfig);

export const auth = getAuth(app);
if (typeof window !== 'undefined') {
  void setPersistence(auth, browserLocalPersistence).catch(() => undefined);
}

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const firestoreDb =
  firestoreDatabaseId && firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firestoreDatabaseId)
    : getFirestore(app);

export async function recordUserFirestoreSync(
  user: FirebaseUser,
  status: 'connected' | 'active' = 'active'
): Promise<void> {
  if (!user.uid || !user.emailVerified) {
    return;
  }

  try {
    await setDoc(
      doc(firestoreDb, 'user_sync', user.uid),
      {
        uid: user.uid,
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // Firestore user_sync is auxiliary; never block primary PostgreSQL workspace authentication
  }
}

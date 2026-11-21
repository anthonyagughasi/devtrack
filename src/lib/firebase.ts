import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import appletFirebaseConfig from '../../firebase-applet-config.json';

function readEnv(key: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key]?.trim();
  return value || undefined;
}

export const firebaseClientConfig: FirebaseOptions = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY') ?? appletFirebaseConfig.apiKey,
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN') ?? appletFirebaseConfig.authDomain,
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID') ?? appletFirebaseConfig.projectId,
  storageBucket:
    readEnv('VITE_FIREBASE_STORAGE_BUCKET') ?? appletFirebaseConfig.storageBucket,
  messagingSenderId:
    readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') ?? appletFirebaseConfig.messagingSenderId,
  appId: readEnv('VITE_FIREBASE_APP_ID') ?? appletFirebaseConfig.appId,
};

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

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import appletFirebaseConfig from '../../firebase-applet-config.json';
import { isDemoSessionStored } from '../demo/demo-session';

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

export const db = firestoreDb;

export class AppError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatClientError(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.startsWith('{') && error.message.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(error.message) as { error?: string };
        if (parsed.error?.toLowerCase().includes('permission')) {
          return 'You do not have permission to perform this action.';
        }
        return parsed.error || fallback;
      } catch {
        return fallback;
      }
    }
    return error.message || fallback;
  }
  return fallback;
}

async function testConnection(): Promise<void> {
  if (typeof window === 'undefined' || isDemoSessionStored()) return;
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

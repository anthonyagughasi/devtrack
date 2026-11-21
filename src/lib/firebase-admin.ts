import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import appletFirebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

function resolveProjectId(): string | undefined {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    appletFirebaseConfig.projectId?.trim() ||
    undefined
  );
}

function resolveServiceAccountCredential(): ServiceAccount | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as {
        project_id?: string;
        projectId?: string;
        client_email?: string;
        clientEmail?: string;
        private_key?: string;
        privateKey?: string;
      };
      const privateKey = (parsed.private_key ?? parsed.privateKey)?.replace(/\\n/g, '\n');
      const clientEmail = parsed.client_email ?? parsed.clientEmail;
      const projectId = parsed.project_id ?? parsed.projectId ?? resolveProjectId();
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey };
      }
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:', error);
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');
  const projectId = resolveProjectId();

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(resolveProjectId());
}

const projectId = resolveProjectId();
const serviceAccount = resolveServiceAccountCredential();

const adminApp = getApps().length
  ? getApp()
  : initializeApp(
      serviceAccount
        ? {
            credential: cert(serviceAccount),
            projectId: serviceAccount.projectId ?? projectId,
          }
        : {
            projectId,
          }
    );

export const adminAuth = getAuth(adminApp);

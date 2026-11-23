import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import appletFirebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const projectId = appletFirebaseConfig.projectId?.trim() || undefined;

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(projectId);
}

const adminApp = getApps().length
  ? getApp()
  : initializeApp(projectId ? { projectId } : {});

export const adminAuth = getAuth(adminApp);

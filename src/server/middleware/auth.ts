import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { db, ensureDatabaseReady } from '../../db/index.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  getUserBySessionToken,
  SESSION_COOKIE_NAME,
} from '../services/auth.ts';
import { syncPendingInvitationNotificationsForUser } from '../services/team.ts';
import { syncFirebaseUser, type UserRecord } from '../services/users.ts';

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  dbUser?: UserRecord;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await ensureDatabaseReady();
  } catch (error) {
    next(error);
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Authentication token missing.' });
      return;
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch (error) {
      console.error('Error verifying Firebase ID token:', error);
      res.status(401).json({ error: 'Invalid or expired authentication session.' });
      return;
    }

    try {
      req.firebaseUser = decoded;
      const { user, isNewUser } = await syncFirebaseUser({
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: Boolean(decoded.email_verified),
        name: decoded.name ?? null,
        avatar: decoded.picture ?? null,
        provider: decoded.firebase?.sign_in_provider ?? 'firebase',
      });
      if (isNewUser) {
        await syncPendingInvitationNotificationsForUser(db, user.id);
      }
      req.dbUser = user;
      next();
      return;
    } catch (error) {
      next(error);
      return;
    }
  }

  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof sessionCookie === 'string' && sessionCookie.trim()) {
    try {
      const sessionUser = await getUserBySessionToken(sessionCookie.trim());
      if (sessionUser) {
        req.dbUser = sessionUser;
        next();
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  res.status(401).json({ error: 'Authentication required.' });
};

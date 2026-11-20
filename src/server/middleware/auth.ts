import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  getUserBySessionToken,
  SESSION_COOKIE_NAME,
} from '../services/auth.ts';
import { getOrCreateUser, type UserRecord } from '../services/users.ts';

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  dbUser?: UserRecord;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
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

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

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
    req.dbUser = await getOrCreateUser(
      decoded.uid,
      decoded.email || `${decoded.uid}@users.devtrack.app`,
      decoded.name,
      decoded.picture ?? null,
      Boolean(decoded.email_verified)
    );
    next();
  } catch (error) {
    next(error);
  }
};

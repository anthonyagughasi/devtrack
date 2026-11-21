import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZodError } from 'zod';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  commentSchema,
  createProjectSchema,
  createTaskSchema,
  forgotPasswordSchema,
  inviteMemberSchema,
  loginSchema,
  moveTaskSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
  updateTaskSchema,
  updateUserSettingsSchema,
  verifyEmailSchema,
} from './src/lib/validations.ts';
import { isAppError } from './src/server/errors.ts';
import { requireAuth, type AuthRequest } from './src/server/middleware/auth.ts';
import { listAccessibleActivities } from './src/server/services/activity.ts';
import {
  SESSION_COOKIE_NAME,
  authenticateWithGoogleToken,
  changeUserPassword,
  deleteSessionByToken,
  isEmailVerificationEnforced,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from './src/server/services/auth.ts';
import { getDashboardAnalytics } from './src/server/services/dashboard.ts';
import {
  getResendEmailStatus,
  isEmailProviderConfigured,
  verifySmtpConnection,
} from './src/server/services/email.ts';
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './src/server/services/notifications.ts';
import {
  createProject,
  deleteProject,
  getProjectDetails,
  listUserProjects,
  seedStarterWorkspace,
  updateProject,
} from './src/server/services/projects.ts';
import {
  addTaskComment,
  createTask,
  deleteTask,
  deleteTaskComment,
  getTaskDetails,
  listUserTasks,
  moveTask,
  updateTask,
  updateTaskComment,
} from './src/server/services/tasks.ts';
import {
  acceptInvitation,
  declineInvitation,
  inviteMember,
  listIncomingInvitations,
  listProjectInvitations,
  listWorkspaceTeam,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from './src/server/services/team.ts';
import { updateUserAvatar, updateUserSettings } from './src/server/services/users.ts';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function detectImageMimeType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.oAuthClientId
  );
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return (
    req.secure ||
    proto === 'https' ||
    (process.env.APP_URL?.trim().startsWith('https://') ?? false)
  );
}

function getBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (configured && configured !== 'MY_APP_URL') {
    return configured;
  }
  const proto = isHttpsRequest(req) ? 'https' : req.protocol;
  return `${proto}://${req.get('host')}`;
}

function setSessionCookie(res: Response, req: Request, rawToken: string) {
  const isHttps = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

function clearSessionCookie(res: Response, req: Request) {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

function parseId(raw: string | string[] | undefined): number {
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(val);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid numeric identifier.');
  }
  return id;
}

function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication Configuration & Endpoints
app.get('/api/auth/config', (_req: Request, res: Response) => {
  res.json({
    emailConfigured: isEmailProviderConfigured(),
    googleConfigured: isGoogleOAuthConfigured(),
    emailVerificationEnforced: isEmailVerificationEnforced(),
  });
});

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.parse(req.body);
    const result = await registerWithEmail({
      name: parsed.name,
      email: parsed.email,
      password: parsed.password,
      baseUrl: getBaseUrl(req),
      userAgent: req.get('user-agent'),
    });

    if (result.sessionToken) {
      setSessionCookie(res, req, result.sessionToken);
    }

    res.status(201).json({
      user: result.user,
      requiresVerification: result.requiresVerification,
      emailConfigured: result.emailConfigured,
      message: result.message,
    });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.parse(req.body);
    const result = await loginWithEmail({
      email: parsed.email,
      password: parsed.password,
      userAgent: req.get('user-agent'),
    });
    setSessionCookie(res, req, result.sessionToken);
    res.json({ user: result.user });
  })
);

app.post(
  '/api/auth/google',
  asyncHandler(async (req, res) => {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({
        error:
          'Google Sign-In is not configured on this server. Add Firebase OAuth credentials in firebase-applet-config.json.',
      });
      return;
    }

    const authHeader = req.headers.authorization;
    const bodyToken =
      req.body && typeof req.body === 'object' && 'idToken' in req.body
        ? (req.body as { idToken?: unknown }).idToken
        : undefined;
    const rawToken =
      typeof bodyToken === 'string' && bodyToken.trim()
        ? bodyToken.trim()
        : authHeader?.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length).trim()
          : '';

    if (!rawToken) {
      res.status(400).json({ error: 'Google identity token is required.' });
      return;
    }

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(rawToken);
    } catch (error) {
      console.error('Google token verification failed:', error);
      res.status(401).json({ error: 'Invalid or expired Google sign-in token.' });
      return;
    }

    const result = await authenticateWithGoogleToken(
      decoded,
      req.get('user-agent')
    );
    setSessionCookie(res, req, result.sessionToken);
    res.json({ user: result.user });
  })
);

app.post(
  '/api/auth/logout',
  asyncHandler(async (req, res) => {
    const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof rawCookie === 'string' && rawCookie.trim()) {
      await deleteSessionByToken(rawCookie.trim());
    }
    clearSessionCookie(res, req);
    res.json({ success: true });
  })
);

app.post(
  '/api/auth/forgot-password',
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.parse(req.body);
    const result = await requestPasswordReset(parsed.email, getBaseUrl(req));
    if (!result.emailConfigured) {
      res.status(503).json({
        error: result.message,
        emailConfigured: false,
      });
      return;
    }
    res.json({
      message: result.message,
      emailConfigured: true,
    });
  })
);

app.post(
  '/api/auth/reset-password',
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.parse(req.body);
    await resetPasswordWithToken(parsed.token, parsed.password);
    clearSessionCookie(res, req);
    res.json({
      success: true,
      message: 'Your password has been reset. You can now sign in with your new password.',
    });
  })
);

app.post(
  '/api/auth/verify-email',
  asyncHandler(async (req, res) => {
    const parsed = verifyEmailSchema.parse(req.body);
    await verifyEmailWithToken(parsed.token);
    res.json({
      success: true,
      message: 'Your email address has been verified.',
    });
  })
);

app.post(
  '/api/auth/resend-verification',
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.parse(req.body);
    const result = await resendVerificationEmail(parsed.email, getBaseUrl(req));
    if (!result.emailConfigured) {
      res.status(503).json({
        error: result.message,
        emailConfigured: false,
      });
      return;
    }
    res.json({
      message: result.message,
      emailConfigured: true,
    });
  })
);

// Current User & Settings
app.get(
  '/api/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.dbUser });
  })
);

app.patch(
  '/api/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = updateUserSettingsSchema.parse(req.body);
    const updated = await updateUserSettings(req.dbUser!.id, parsed);
    res.json({ user: updated });
  })
);

app.patch(
  '/api/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.parse(req.body);
    await changeUserPassword(
      req.dbUser!.id,
      parsed.currentPassword,
      parsed.newPassword
    );
    res.json({
      success: true,
      message: 'Password updated successfully.',
    });
  })
);

app.post(
  '/api/me/avatar',
  requireAuth,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: MAX_AVATAR_BYTES,
  }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: 'Please upload a valid JPEG, PNG, or WebP image (up to 2 MB).',
      });
      return;
    }
    if (req.body.length > MAX_AVATAR_BYTES) {
      res.status(413).json({ error: 'Profile picture must be 2 MB or smaller.' });
      return;
    }
    const detectedMime = detectImageMimeType(req.body);
    if (!detectedMime) {
      res.status(400).json({
        error: 'Unsupported or invalid image format. Allowed formats: JPEG, PNG, WebP.',
      });
      return;
    }
    const dataUri = `data:${detectedMime};base64,${req.body.toString('base64')}`;
    const updated = await updateUserAvatar(req.dbUser!.id, dataUri);
    res.json({ user: updated });
  })
);

app.delete(
  '/api/me/avatar',
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = await updateUserAvatar(req.dbUser!.id, null);
    res.json({ user: updated });
  })
);

app.post(
  '/api/me/seed-workspace',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await seedStarterWorkspace(req.dbUser!.id);
    res.status(201).json(result);
  })
);

// Dashboard Analytics
app.get(
  '/api/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const daysParam = typeof req.query.days === 'string' ? Number(req.query.days) : 14;
    const days = Number.isFinite(daysParam) ? daysParam : 14;
    const analytics = await getDashboardAnalytics(req.dbUser!.id, days);
    res.json(analytics);
  })
);

// Projects
app.get(
  '/api/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await listUserProjects(req.dbUser!.id, { q, status });
    res.json({ projects: items });
  })
);

app.post(
  '/api/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createProjectSchema.parse(req.body);
    const project = await createProject(req.dbUser!.id, parsed);
    res.status(201).json({ project });
  })
);

app.get(
  '/api/projects/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const details = await getProjectDetails(projectId, req.dbUser!.id);
    res.json(details);
  })
);

app.patch(
  '/api/projects/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const parsed = updateProjectSchema.parse(req.body);
    const project = await updateProject(projectId, req.dbUser!.id, parsed);
    res.json({ project });
  })
);

app.delete(
  '/api/projects/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const result = await deleteProject(projectId, req.dbUser!.id);
    res.json(result);
  })
);

// Project Members & Invitations
app.get(
  '/api/projects/:id/invitations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const items = await listProjectInvitations(projectId, req.dbUser!.id);
    res.json({ invitations: items });
  })
);

app.post(
  '/api/projects/:id/invitations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const parsed = inviteMemberSchema.parse(req.body);
    const result = await inviteMember(projectId, req.dbUser!.id, {
      ...parsed,
      baseUrl: getBaseUrl(req),
    });
    res.status(201).json(result);
  })
);

app.get(
  '/api/invitations/email-status/:emailId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawId = Array.isArray(req.params.emailId)
      ? req.params.emailId[0]
      : req.params.emailId;
    if (!rawId || !/^[a-zA-Z0-9_-]{6,100}$/.test(rawId)) {
      res.status(400).json({ error: 'Invalid email tracking ID.' });
      return;
    }
    const status = await getResendEmailStatus(rawId);
    res.json(status);
  })
);

app.patch(
  '/api/projects/:id/members/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    const parsed = updateMemberRoleSchema.parse(req.body);
    const member = await updateMemberRole(
      projectId,
      targetUserId,
      req.dbUser!.id,
      parsed.role
    );
    res.json({ member });
  })
);

app.delete(
  '/api/projects/:id/members/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    const result = await removeMember(projectId, targetUserId, req.dbUser!.id);
    res.json(result);
  })
);

// Team & Invitations
app.get(
  '/api/team',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await listWorkspaceTeam(req.dbUser!.id);
    res.json(data);
  })
);

app.get(
  '/api/invitations/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await listIncomingInvitations(req.dbUser!.email);
    res.json({ invitations: items });
  })
);

app.post(
  '/api/invitations/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = acceptInvitationSchema.parse(req.body);
    const result = await acceptInvitation(
      parsed.token,
      req.dbUser!.id,
      req.dbUser!.email
    );
    res.json(result);
  })
);

app.post(
  '/api/invitations/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = acceptInvitationSchema.parse(req.body);
    const result = await declineInvitation(
      parsed.token,
      req.dbUser!.id,
      req.dbUser!.email
    );
    res.json(result);
  })
);

app.delete(
  '/api/invitations/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invitationId = parseId(req.params.id);
    const invitation = await revokeInvitation(invitationId, req.dbUser!.id);
    res.json({ invitation });
  })
);

// Tasks & Kanban
app.get(
  '/api/tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId !== 'ALL'
        ? parseId(req.query.projectId)
        : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;

    const items = await listUserTasks(req.dbUser!.id, {
      projectId,
      status,
      priority,
      assignee,
      q,
      sort,
    });
    res.json({ tasks: items });
  })
);

app.post(
  '/api/tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createTaskSchema.parse(req.body);
    const task = await createTask(req.dbUser!.id, parsed);
    res.status(201).json({ task });
  })
);

app.get(
  '/api/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const details = await getTaskDetails(taskId, req.dbUser!.id);
    res.json(details);
  })
);

app.patch(
  '/api/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = updateTaskSchema.parse(req.body);
    const task = await updateTask(taskId, req.dbUser!.id, parsed);
    res.json({ task });
  })
);

app.patch(
  '/api/tasks/:id/move',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = moveTaskSchema.parse(req.body);
    const task = await moveTask(taskId, req.dbUser!.id, parsed);
    res.json({ task });
  })
);

app.delete(
  '/api/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const result = await deleteTask(taskId, req.dbUser!.id);
    res.json(result);
  })
);

// Task Comments
app.post(
  '/api/tasks/:id/comments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = commentSchema.parse(req.body);
    const comment = await addTaskComment(taskId, req.dbUser!.id, parsed.content);
    res.status(201).json({ comment });
  })
);

app.patch(
  '/api/comments/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const commentId = parseId(req.params.id);
    const parsed = commentSchema.parse(req.body);
    const comment = await updateTaskComment(commentId, req.dbUser!.id, parsed.content);
    res.json({ comment });
  })
);

app.delete(
  '/api/comments/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const commentId = parseId(req.params.id);
    const result = await deleteTaskComment(commentId, req.dbUser!.id);
    res.json(result);
  })
);

// Activity Feed
app.get(
  '/api/activity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId !== 'ALL'
        ? parseId(req.query.projectId)
        : undefined;
    const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
    const feed = await listAccessibleActivities(req.dbUser!.id, {
      projectId,
      page,
      limit,
    });
    res.json(feed);
  })
);

// Notifications
app.get(
  '/api/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getUserNotifications(req.dbUser!.id);
    res.json(data);
  })
);

app.patch(
  '/api/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const notification = await markNotificationRead(req.dbUser!.id, id);
    res.json({ notification });
  })
);

app.post(
  '/api/notifications/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead(req.dbUser!.id);
    res.json({ success: true });
  })
);

// Global API Error Handler
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/')) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message || 'Validation failed.',
      issues: err.issues,
    });
    return;
  }

  if (isAppError(err)) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({ error: 'Uploaded file exceeds the 2 MB size limit.' });
    return;
  }

  if (err instanceof Error && err.message === 'Invalid numeric identifier.') {
    res.status(400).json({ error: err.message });
    return;
  }

  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`DevTrack server listening on http://0.0.0.0:${port}`);
    verifySmtpConnection()
      .then((status) => {
        console.log(
          `[EmailTransport] transport=${status.transport} verified=${status.verified} message="${status.message}"`
        );
      })
      .catch((err) => {
        console.error('[EmailTransport] Verification error:', err);
      });
  });
}

export { app };
export default app;

if (!process.env.VERCEL && !process.env.VITEST) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

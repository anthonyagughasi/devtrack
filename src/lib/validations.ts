import { z } from 'zod';

export const PROJECT_STATUSES = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
] as const;

export const PROJECT_ROLES = ['OWNER', 'ADMINISTRATOR', 'MEMBER'] as const;

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED'] as const;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(120),
  description: z.string().trim().max(2000).optional().default(''),
  status: z.enum(PROJECT_STATUSES).optional().default('PLANNING'),
  startDate: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
});

export const createTaskSchema = z.object({
  projectId: z.coerce.number().int().positive('Project is required'),
  title: z.string().trim().min(2, 'Task title must be at least 2 characters').max(200),
  description: z.string().trim().max(4000).optional().default(''),
  status: z.enum(TASK_STATUSES).optional().default('TODO'),
  priority: z.enum(TASK_PRIORITIES).optional().default('MEDIUM'),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2, 'Task title must be at least 2 characters').max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
});

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  position: z.coerce.number().int().min(0).default(0),
});

export const commentSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
  role: z.enum(['ADMINISTRATOR', 'MEMBER']).default('MEMBER'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['ADMINISTRATOR', 'MEMBER']),
});

export const updateUserSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Display name must be at least 2 characters').max(80).optional(),
  avatar: z.string().trim().max(500).nullable().optional(),
  themePreference: z.enum(['dark', 'light']).optional(),
  notifyOnAssign: z.boolean().optional(),
  notifyOnComment: z.boolean().optional(),
  notifyOnInvite: z.boolean().optional(),
  notifyOnDeadline: z.boolean().optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(8, 'Invitation token is required'),
});

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter')
  .regex(/[0-9]/, 'Password must include at least one number');

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(80),
    email: z.string().trim().email('Valid email address is required').toLowerCase(),
    password: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(16, 'Reset token is invalid'),
    password: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(16, 'Verification token is invalid'),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional().default(''),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });


import type { ProjectRole, ProjectStatus, TaskPriority, TaskStatus } from '../lib/validations';
import type {
  ActivityItem,
  NotificationItem,
  TaskCommentItem,
  UserProfile,
} from '../types/app';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-session';

export interface DemoProjectRecord {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  deadline: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoMemberRecord {
  projectId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  role: ProjectRole;
  joinedAt: string;
}

export interface DemoTaskRecord {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueDate: string | null;
  assigneeId: string | null;
  createdById: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoCommentRecord extends TaskCommentItem {
  projectId: string;
}

export interface DemoInvitationRecord {
  id: string;
  projectId: string;
  projectName: string;
  projectOwnerId: string;
  email: string;
  role: 'ADMINISTRATOR' | 'MEMBER';
  token: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  invitedById: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoWorkspaceState {
  version: number;
  profile: UserProfile;
  projects: DemoProjectRecord[];
  members: DemoMemberRecord[];
  tasks: DemoTaskRecord[];
  comments: DemoCommentRecord[];
  activities: ActivityItem[];
  notifications: NotificationItem[];
  invitations: DemoInvitationRecord[];
}

export const DEMO_TEAM_DIRECTORY = [
  {
    userId: DEMO_USER_ID,
    name: 'Jordan Mercer',
    email: DEMO_USER_EMAIL,
    avatar: null,
  },
  {
    userId: 'demo_member_elena',
    name: 'Elena Rostova',
    email: 'elena.rostova@northstar-demo.dev',
    avatar: null,
  },
  {
    userId: 'demo_member_marcus',
    name: 'Marcus Vance',
    email: 'marcus.vance@northstar-demo.dev',
    avatar: null,
  },
  {
    userId: 'demo_member_priya',
    name: 'Priya Nair',
    email: 'priya.nair@northstar-demo.dev',
    avatar: null,
  },
  {
    userId: 'demo_member_devon',
    name: 'Devon Brooks',
    email: 'devon.brooks@northstar-demo.dev',
    avatar: null,
  },
] as const;

export function createInitialDemoWorkspace(nowMs = Date.now()): DemoWorkspaceState {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const isoOffset = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();

  const profile: UserProfile = {
    id: DEMO_USER_ID,
    uid: DEMO_USER_ID,
    name: 'Jordan Mercer',
    email: DEMO_USER_EMAIL,
    avatar: null,
    role: 'USER',
    emailVerified: true,
    hasPassword: true,
    themePreference: 'dark',
    notifyOnAssign: true,
    notifyOnComment: true,
    notifyOnInvite: true,
    notifyOnDeadline: true,
    createdAt: isoOffset(-42 * dayMs),
    updatedAt: isoOffset(-2 * hourMs),
  };

  const projects: DemoProjectRecord[] = [
    {
      id: 'demo_proj_payments',
      name: 'PulsePay Ledger Migration',
      description:
        'Migrate multi-currency settlement pipelines to idempotent double-entry ledgers with automated webhook replay protection.',
      status: 'ACTIVE',
      startDate: isoOffset(-18 * dayMs),
      deadline: isoOffset(12 * dayMs),
      ownerId: DEMO_USER_ID,
      createdAt: isoOffset(-18 * dayMs),
      updatedAt: isoOffset(-25 * 60 * 1000),
    },
    {
      id: 'demo_proj_console',
      name: 'Developer Telemetry Console',
      description:
        'Unified distributed tracing UI, P99 latency anomaly alerts, and release health scorecards for platform squads.',
      status: 'ACTIVE',
      startDate: isoOffset(-11 * dayMs),
      deadline: isoOffset(21 * dayMs),
      ownerId: DEMO_USER_ID,
      createdAt: isoOffset(-11 * dayMs),
      updatedAt: isoOffset(-3 * hourMs),
    },
    {
      id: 'demo_proj_gateway',
      name: 'Edge Auth & Rate Limiter',
      description:
        'Zero-downtime JWKS rotation, adaptive token-bucket throttling, and regional WAF rules across edge POPs.',
      status: 'PLANNING',
      startDate: isoOffset(-4 * dayMs),
      deadline: isoOffset(34 * dayMs),
      ownerId: DEMO_USER_ID,
      createdAt: isoOffset(-4 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_proj_mobile',
      name: 'SDK v3 Release Stabilization',
      description:
        'TypeScript strict-mode client SDK, retry backoff jitter tuning, and automated contract verification suite.',
      status: 'COMPLETED',
      startDate: isoOffset(-30 * dayMs),
      deadline: isoOffset(-3 * dayMs),
      ownerId: DEMO_USER_ID,
      createdAt: isoOffset(-30 * dayMs),
      updatedAt: isoOffset(-3 * dayMs),
    },
    // Project waiting on incoming invitation acceptance in Team view
    {
      id: 'demo_proj_partner_portal',
      name: 'Partner Billing & Usage Portal',
      description:
        'Self-serve invoice exports, metered API quota charts, and webhook delivery diagnostics for enterprise partners.',
      status: 'ACTIVE',
      startDate: isoOffset(-9 * dayMs),
      deadline: isoOffset(19 * dayMs),
      ownerId: 'demo_member_elena',
      createdAt: isoOffset(-9 * dayMs),
      updatedAt: isoOffset(-5 * hourMs),
    },
  ];

  const [jordan, elena, marcus, priya, devon] = DEMO_TEAM_DIRECTORY;

  const members: DemoMemberRecord[] = [
    // Project 1: PulsePay
    {
      projectId: 'demo_proj_payments',
      userId: jordan.userId,
      name: jordan.name,
      email: jordan.email,
      avatar: jordan.avatar,
      role: 'OWNER',
      joinedAt: isoOffset(-18 * dayMs),
    },
    {
      projectId: 'demo_proj_payments',
      userId: elena.userId,
      name: elena.name,
      email: elena.email,
      avatar: elena.avatar,
      role: 'ADMINISTRATOR',
      joinedAt: isoOffset(-17 * dayMs),
    },
    {
      projectId: 'demo_proj_payments',
      userId: priya.userId,
      name: priya.name,
      email: priya.email,
      avatar: priya.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-15 * dayMs),
    },
    {
      projectId: 'demo_proj_payments',
      userId: devon.userId,
      name: devon.name,
      email: devon.email,
      avatar: devon.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-14 * dayMs),
    },

    // Project 2: Telemetry Console
    {
      projectId: 'demo_proj_console',
      userId: jordan.userId,
      name: jordan.name,
      email: jordan.email,
      avatar: jordan.avatar,
      role: 'OWNER',
      joinedAt: isoOffset(-11 * dayMs),
    },
    {
      projectId: 'demo_proj_console',
      userId: marcus.userId,
      name: marcus.name,
      email: marcus.email,
      avatar: marcus.avatar,
      role: 'ADMINISTRATOR',
      joinedAt: isoOffset(-10 * dayMs),
    },
    {
      projectId: 'demo_proj_console',
      userId: devon.userId,
      name: devon.name,
      email: devon.email,
      avatar: devon.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-8 * dayMs),
    },

    // Project 3: Edge Auth
    {
      projectId: 'demo_proj_gateway',
      userId: jordan.userId,
      name: jordan.name,
      email: jordan.email,
      avatar: jordan.avatar,
      role: 'OWNER',
      joinedAt: isoOffset(-4 * dayMs),
    },
    {
      projectId: 'demo_proj_gateway',
      userId: priya.userId,
      name: priya.name,
      email: priya.email,
      avatar: priya.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-3 * dayMs),
    },

    // Project 4: SDK v3
    {
      projectId: 'demo_proj_mobile',
      userId: jordan.userId,
      name: jordan.name,
      email: jordan.email,
      avatar: jordan.avatar,
      role: 'OWNER',
      joinedAt: isoOffset(-30 * dayMs),
    },
    {
      projectId: 'demo_proj_mobile',
      userId: marcus.userId,
      name: marcus.name,
      email: marcus.email,
      avatar: marcus.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-29 * dayMs),
    },
    {
      projectId: 'demo_proj_mobile',
      userId: elena.userId,
      name: elena.name,
      email: elena.email,
      avatar: elena.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-28 * dayMs),
    },

    // Project 5: Partner Portal (owned by Elena, Jordan invited)
    {
      projectId: 'demo_proj_partner_portal',
      userId: elena.userId,
      name: elena.name,
      email: elena.email,
      avatar: elena.avatar,
      role: 'OWNER',
      joinedAt: isoOffset(-9 * dayMs),
    },
    {
      projectId: 'demo_proj_partner_portal',
      userId: marcus.userId,
      name: marcus.name,
      email: marcus.email,
      avatar: marcus.avatar,
      role: 'MEMBER',
      joinedAt: isoOffset(-7 * dayMs),
    },
  ];

  const tasks: DemoTaskRecord[] = [
    {
      id: 'demo_task_idempotency',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Enforce 24h idempotency key locks on payout webhooks',
      description:
        'Reject duplicate settlement callbacks with deterministic replay responses and emit reconciliation metrics.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      position: 0,
      dueDate: isoOffset(1 * dayMs),
      assigneeId: jordan.userId,
      createdById: jordan.userId,
      completedAt: null,
      createdAt: isoOffset(-9 * dayMs),
      updatedAt: isoOffset(-40 * 60 * 1000),
    },
    {
      id: 'demo_task_reconcile_overdue',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Resolve FX rounding drift in EUR/GBP batch settlement',
      description:
        'Audit banker-rounding mismatch on sub-cent ledger splits before cutover to v2 settlement tables.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      position: 1,
      dueDate: isoOffset(-2 * dayMs), // Overdue
      assigneeId: elena.userId,
      createdById: jordan.userId,
      completedAt: null,
      createdAt: isoOffset(-10 * dayMs),
      updatedAt: isoOffset(-5 * hourMs),
    },
    {
      id: 'demo_task_dlq_alerts',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Configure dead-letter queue replay runbook & alerts',
      description:
        'Add PagerDuty escalation thresholds when webhook retry backlog exceeds 250 pending events.',
      status: 'TODO',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(4 * dayMs),
      assigneeId: priya.userId,
      createdById: elena.userId,
      completedAt: null,
      createdAt: isoOffset(-6 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_task_chaos_suite',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Run failover chaos test on replica read pool',
      description:
        'Simulate primary failover under 1,200 req/s synthetic checkout load and verify zero lost ledger writes.',
      status: 'TODO',
      priority: 'MEDIUM',
      position: 1,
      dueDate: isoOffset(8 * dayMs),
      assigneeId: devon.userId,
      createdById: jordan.userId,
      completedAt: null,
      createdAt: isoOffset(-3 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_task_schema_backfill',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Backfill historical settlement journal checksums',
      description:
        'Verify SHA-256 ledger digest continuity across Q1-Q3 historical partitions.',
      status: 'COMPLETED',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(-4 * dayMs),
      assigneeId: elena.userId,
      createdById: jordan.userId,
      completedAt: isoOffset(-4 * dayMs),
      createdAt: isoOffset(-12 * dayMs),
      updatedAt: isoOffset(-4 * dayMs),
    },
    {
      id: 'demo_task_shadow_read',
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      title: 'Enable shadow-read parity checker in staging',
      description:
        'Compare legacy ledger balances against new double-entry view for 48 hours without user impact.',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      position: 1,
      dueDate: isoOffset(-1 * dayMs),
      assigneeId: jordan.userId,
      createdById: jordan.userId,
      completedAt: isoOffset(-2 * dayMs),
      createdAt: isoOffset(-11 * dayMs),
      updatedAt: isoOffset(-2 * dayMs),
    },

    // Project 2: Telemetry Console
    {
      id: 'demo_task_trace_flamegraph',
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      title: 'Ship span waterfall zoom & keyboard navigation',
      description:
        'Allow engineers to scrub sub-millisecond gRPC spans and jump directly to error logs.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(2 * dayMs),
      assigneeId: marcus.userId,
      createdById: jordan.userId,
      completedAt: null,
      createdAt: isoOffset(-7 * dayMs),
      updatedAt: isoOffset(-3 * hourMs),
    },
    {
      id: 'demo_task_sla_regression',
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      title: 'Fix P99 aggregation query timeout on 30D window',
      description:
        'Switch rollup bucket interval to 6h for queries spanning more than 14 days.',
      status: 'TODO',
      priority: 'URGENT',
      position: 0,
      dueDate: isoOffset(-1 * dayMs), // Overdue
      assigneeId: jordan.userId,
      createdById: marcus.userId,
      completedAt: null,
      createdAt: isoOffset(-5 * dayMs),
      updatedAt: isoOffset(-6 * hourMs),
    },
    {
      id: 'demo_task_export_csv',
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      title: 'Add signed CSV export for incident postmortems',
      description:
        'Include filtered trace IDs, service versions, and latency percentiles in downloadable audit reports.',
      status: 'TODO',
      priority: 'LOW',
      position: 1,
      dueDate: isoOffset(11 * dayMs),
      assigneeId: null,
      createdById: devon.userId,
      completedAt: null,
      createdAt: isoOffset(-2 * dayMs),
      updatedAt: isoOffset(-12 * hourMs),
    },
    {
      id: 'demo_task_dark_palette',
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      title: 'Standardize high-contrast chart series tokens',
      description:
        'Ensure WCAG AA contrast across dark and light surfaces for status and error trend lines.',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      position: 0,
      dueDate: isoOffset(-3 * dayMs),
      assigneeId: marcus.userId,
      createdById: jordan.userId,
      completedAt: isoOffset(-3 * dayMs),
      createdAt: isoOffset(-8 * dayMs),
      updatedAt: isoOffset(-3 * dayMs),
    },

    // Project 3: Edge Auth
    {
      id: 'demo_task_jwks_rotation',
      projectId: 'demo_proj_gateway',
      projectName: 'Edge Auth & Rate Limiter',
      title: 'Design dual-key JWKS rotation grace period',
      description:
        'Support overlapping 24h signing key validity windows across all edge verification workers.',
      status: 'TODO',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(5 * dayMs),
      assigneeId: priya.userId,
      createdById: jordan.userId,
      completedAt: null,
      createdAt: isoOffset(-3 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_task_rate_headers',
      projectId: 'demo_proj_gateway',
      projectName: 'Edge Auth & Rate Limiter',
      title: 'Expose IETF RateLimit-* headers on API responses',
      description:
        'Emit remaining quota and reset window headers consistently across authenticated endpoints.',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      position: 0,
      dueDate: isoOffset(6 * dayMs),
      assigneeId: jordan.userId,
      createdById: priya.userId,
      completedAt: null,
      createdAt: isoOffset(-2 * dayMs),
      updatedAt: isoOffset(-8 * hourMs),
    },

    // Project 4: SDK v3 (All completed)
    {
      id: 'demo_task_sdk_types',
      projectId: 'demo_proj_mobile',
      projectName: 'SDK v3 Release Stabilization',
      title: 'Publish strict TypeScript definitions & ESM bundle',
      description:
        'Verify zero-dependency tree shaking across Vite, Next.js, and Node 22 runtimes.',
      status: 'COMPLETED',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(-6 * dayMs),
      assigneeId: marcus.userId,
      createdById: jordan.userId,
      completedAt: isoOffset(-6 * dayMs),
      createdAt: isoOffset(-13 * dayMs),
      updatedAt: isoOffset(-6 * dayMs),
    },
    {
      id: 'demo_task_sdk_backoff',
      projectId: 'demo_proj_mobile',
      projectName: 'SDK v3 Release Stabilization',
      title: 'Benchmark jittered exponential retry under 429 bursts',
      description:
        'Confirm retry ceiling caps at 3 attempts with full AbortSignal cancellation support.',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      position: 1,
      dueDate: isoOffset(-1 * dayMs),
      assigneeId: elena.userId,
      createdById: jordan.userId,
      completedAt: isoOffset(-1 * dayMs),
      createdAt: isoOffset(-7 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },

    // Project 5: Partner Portal (visible after accepting invite)
    {
      id: 'demo_task_partner_csv',
      projectId: 'demo_proj_partner_portal',
      projectName: 'Partner Billing & Usage Portal',
      title: 'Implement monthly usage breakdown PDF generator',
      description:
        'Generate itemized partner settlement statements with tax ID metadata.',
      status: 'TODO',
      priority: 'HIGH',
      position: 0,
      dueDate: isoOffset(7 * dayMs),
      assigneeId: marcus.userId,
      createdById: elena.userId,
      completedAt: null,
      createdAt: isoOffset(-4 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
  ];

  const comments: DemoCommentRecord[] = [
    {
      id: 'demo_comment_1',
      projectId: 'demo_proj_payments',
      taskId: 'demo_task_idempotency',
      authorId: elena.userId,
      authorName: elena.name,
      authorEmail: elena.email,
      authorAvatar: elena.avatar,
      content:
        'Confirmed Redis-backed lock TTL at 24h covers Stripe/Adyen delayed webhook retries without inflating key memory.',
      createdAt: isoOffset(-6 * hourMs),
      updatedAt: isoOffset(-6 * hourMs),
    },
    {
      id: 'demo_comment_2',
      projectId: 'demo_proj_payments',
      taskId: 'demo_task_idempotency',
      authorId: jordan.userId,
      authorName: jordan.name,
      authorEmail: jordan.email,
      authorAvatar: jordan.avatar,
      content:
        'Great — I added a deterministic 200 replay payload test so duplicate deliveries do not trigger downstream ledger postings.',
      createdAt: isoOffset(-90 * 60 * 1000),
      updatedAt: isoOffset(-90 * 60 * 1000),
    },
    {
      id: 'demo_comment_3',
      projectId: 'demo_proj_payments',
      taskId: 'demo_task_reconcile_overdue',
      authorId: devon.userId,
      authorName: devon.name,
      authorEmail: devon.email,
      authorAvatar: devon.avatar,
      content:
        'Reproduced the 1-cent rounding drift on batch #4082 (EUR -> GBP). Attaching test fixture to the QA harness.',
      createdAt: isoOffset(-14 * hourMs),
      updatedAt: isoOffset(-14 * hourMs),
    },
    {
      id: 'demo_comment_4',
      projectId: 'demo_proj_console',
      taskId: 'demo_task_trace_flamegraph',
      authorId: marcus.userId,
      authorName: marcus.name,
      authorEmail: marcus.email,
      authorAvatar: marcus.avatar,
      content:
        'Keyboard scrubbing ([ / ]) is wired up; polishing tooltip alignment for nested database spans.',
      createdAt: isoOffset(-4 * hourMs),
      updatedAt: isoOffset(-4 * hourMs),
    },
  ];

  const activities: ActivityItem[] = [
    {
      id: 'demo_act_1',
      actorId: jordan.userId,
      actorName: jordan.name,
      actorAvatar: jordan.avatar,
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      taskId: 'demo_task_idempotency',
      action: 'COMMENT_ADDED',
      resourceType: 'TASK',
      resourceName: 'Enforce 24h idempotency key locks on payout webhooks',
      details: 'Commented on "Enforce 24h idempotency key locks on payout webhooks"',
      createdAt: isoOffset(-90 * 60 * 1000),
    },
    {
      id: 'demo_act_2',
      actorId: marcus.userId,
      actorName: marcus.name,
      actorAvatar: marcus.avatar,
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      taskId: 'demo_task_trace_flamegraph',
      action: 'TASK_UPDATED',
      resourceType: 'TASK',
      resourceName: 'Ship span waterfall zoom & keyboard navigation',
      details: 'Updated task "Ship span waterfall zoom & keyboard navigation"',
      createdAt: isoOffset(-3 * hourMs),
    },
    {
      id: 'demo_act_3',
      actorId: elena.userId,
      actorName: elena.name,
      actorAvatar: elena.avatar,
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      taskId: 'demo_task_reconcile_overdue',
      action: 'TASK_UPDATED',
      resourceType: 'TASK',
      resourceName: 'Resolve FX rounding drift in EUR/GBP batch settlement',
      details: 'Updated task "Resolve FX rounding drift in EUR/GBP batch settlement"',
      createdAt: isoOffset(-5 * hourMs),
    },
    {
      id: 'demo_act_4',
      actorId: priya.userId,
      actorName: priya.name,
      actorAvatar: priya.avatar,
      projectId: 'demo_proj_gateway',
      projectName: 'Edge Auth & Rate Limiter',
      taskId: 'demo_task_rate_headers',
      action: 'TASK_MOVED',
      resourceType: 'TASK',
      resourceName: 'Expose IETF RateLimit-* headers on API responses',
      details: 'Moved "Expose IETF RateLimit-* headers on API responses" to IN PROGRESS',
      createdAt: isoOffset(-8 * hourMs),
    },
    {
      id: 'demo_act_5',
      actorId: elena.userId,
      actorName: elena.name,
      actorAvatar: elena.avatar,
      projectId: 'demo_proj_mobile',
      projectName: 'SDK v3 Release Stabilization',
      taskId: 'demo_task_sdk_backoff',
      action: 'TASK_COMPLETED',
      resourceType: 'TASK',
      resourceName: 'Benchmark jittered exponential retry under 429 bursts',
      details: 'Completed task "Benchmark jittered exponential retry under 429 bursts"',
      createdAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_act_6',
      actorId: jordan.userId,
      actorName: jordan.name,
      actorAvatar: jordan.avatar,
      projectId: 'demo_proj_payments',
      projectName: 'PulsePay Ledger Migration',
      taskId: 'demo_task_shadow_read',
      action: 'TASK_COMPLETED',
      resourceType: 'TASK',
      resourceName: 'Enable shadow-read parity checker in staging',
      details: 'Completed task "Enable shadow-read parity checker in staging"',
      createdAt: isoOffset(-2 * dayMs),
    },
    {
      id: 'demo_act_7',
      actorId: marcus.userId,
      actorName: marcus.name,
      actorAvatar: marcus.avatar,
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      taskId: 'demo_task_dark_palette',
      action: 'TASK_COMPLETED',
      resourceType: 'TASK',
      resourceName: 'Standardize high-contrast chart series tokens',
      details: 'Completed task "Standardize high-contrast chart series tokens"',
      createdAt: isoOffset(-3 * dayMs),
    },
    {
      id: 'demo_act_8',
      actorId: jordan.userId,
      actorName: jordan.name,
      actorAvatar: jordan.avatar,
      projectId: 'demo_proj_gateway',
      projectName: 'Edge Auth & Rate Limiter',
      taskId: null,
      action: 'PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceName: 'Edge Auth & Rate Limiter',
      details: 'Created project "Edge Auth & Rate Limiter"',
      createdAt: isoOffset(-4 * dayMs),
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 'demo_notif_1',
      userId: DEMO_USER_ID,
      projectId: 'demo_proj_payments',
      type: 'DEADLINE_APPROACHING',
      title: 'Upcoming deadline',
      message: '"Enforce 24h idempotency key locks on payout webhooks" is due within 24 hours.',
      link: '/projects/demo_proj_payments?task=demo_task_idempotency',
      read: false,
      createdAt: isoOffset(-45 * 60 * 1000),
    },
    {
      id: 'demo_notif_2',
      userId: DEMO_USER_ID,
      projectId: 'demo_proj_partner_portal',
      type: 'PROJECT_INVITATION',
      title: 'Project invitation',
      message: 'Elena Rostova invited you to join "Partner Billing & Usage Portal" as ADMINISTRATOR.',
      link: '/team',
      read: false,
      createdAt: isoOffset(-2 * hourMs),
    },
    {
      id: 'demo_notif_3',
      userId: DEMO_USER_ID,
      projectId: 'demo_proj_console',
      type: 'TASK_ASSIGNED',
      title: 'Task assigned to you',
      message: 'Marcus Vance assigned you "Fix P99 aggregation query timeout on 30D window".',
      link: '/projects/demo_proj_console?task=demo_task_sla_regression',
      read: true,
      createdAt: isoOffset(-1 * dayMs),
    },
    {
      id: 'demo_notif_4',
      userId: DEMO_USER_ID,
      projectId: 'demo_proj_payments',
      type: 'TASK_COMMENT',
      title: 'New comment on "Enforce 24h idempotency key locks"',
      message: 'Elena Rostova: Confirmed Redis-backed lock TTL at 24h covers delayed retries.',
      link: '/projects/demo_proj_payments?task=demo_task_idempotency',
      read: true,
      createdAt: isoOffset(-6 * hourMs),
    },
  ];

  const invitations: DemoInvitationRecord[] = [
    {
      id: 'demo_invite_partner_billing_token_001',
      projectId: 'demo_proj_partner_portal',
      projectName: 'Partner Billing & Usage Portal',
      projectOwnerId: elena.userId,
      email: DEMO_USER_EMAIL,
      role: 'ADMINISTRATOR',
      token: 'demo_invite_partner_billing_token_001',
      status: 'PENDING',
      invitedById: elena.userId,
      invitedByName: elena.name,
      expiresAt: isoOffset(6 * dayMs),
      acceptedAt: null,
      createdAt: isoOffset(-2 * hourMs),
      updatedAt: isoOffset(-2 * hourMs),
    },
    {
      id: 'demo_invite_outgoing_sam_chen_002',
      projectId: 'demo_proj_console',
      projectName: 'Developer Telemetry Console',
      projectOwnerId: DEMO_USER_ID,
      email: 'sam.chen@northstar-demo.dev',
      role: 'MEMBER',
      token: 'demo_invite_outgoing_sam_chen_002',
      status: 'PENDING',
      invitedById: DEMO_USER_ID,
      invitedByName: jordan.name,
      expiresAt: isoOffset(5 * dayMs),
      acceptedAt: null,
      createdAt: isoOffset(-1 * dayMs),
      updatedAt: isoOffset(-1 * dayMs),
    },
  ];

  return {
    version: 1,
    profile,
    projects,
    members,
    tasks,
    comments,
    activities,
    notifications,
    invitations,
  };
}

import type { ProjectRole, ProjectStatus, TaskPriority, TaskStatus } from '../lib/validations';

export interface UserProfile {
  id: number;
  uid: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  emailVerified: boolean;
  hasPassword: boolean;
  themePreference: 'dark' | 'light';
  notifyOnAssign: boolean;
  notifyOnComment: boolean;
  notifyOnInvite: boolean;
  notifyOnDeadline: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  deadline: string | null;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
  owner: UserSummary;
  role: ProjectRole;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  progress: number;
  memberCount: number;
  members: Array<{
    userId: number;
    role: string;
    name: string;
    email: string;
    avatar: string | null;
  }>;
}

export interface TaskItem {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueDate: string | null;
  projectId: number;
  projectName?: string;
  assigneeId: number | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignee: UserSummary | null;
  createdBy: UserSummary | null;
  commentCount?: number;
}

export interface TaskCommentItem {
  id: number;
  taskId: number;
  authorId: number;
  authorName: string;
  authorEmail: string;
  authorAvatar: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: number;
  actorId: number;
  actorName: string;
  actorEmail?: string;
  actorAvatar: string | null;
  projectId?: number | null;
  projectName?: string | null;
  taskId?: number | null;
  action: string;
  resourceType?: string;
  resourceName?: string;
  details: string | null;
  createdAt: string;
}

export interface ProjectMemberItem {
  id: number;
  userId: number;
  role: ProjectRole;
  joinedAt: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface InvitationItem {
  id: number;
  projectId: number;
  projectName?: string;
  email: string;
  role: ProjectRole;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
}

export interface NotificationItem {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface DashboardAnalytics {
  summary: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
  };
  tasksByStatus: Array<{ name: string; status: string; count: number }>;
  tasksByPriority: Array<{ name: string; priority: string; count: number }>;
  projectProgress: Array<{
    id: number;
    name: string;
    fullName: string;
    status: string;
    progress: number;
    totalTasks: number;
    completedTasks: number;
  }>;
  completionTrend: Array<{
    date: string;
    label: string;
    completed: number;
    created: number;
  }>;
  teamWorkload: Array<{
    userId: number;
    name: string;
    email: string;
    avatar: string | null;
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
  }>;
  recentActivity: ActivityItem[];
  myTasks: Array<{
    id: number;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: number;
    projectName: string;
  }>;
  upcomingDeadlines: Array<{
    id: number;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: number;
    projectName: string;
  }>;
  overdueTaskList: Array<{
    id: number;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: number;
    projectName: string;
  }>;
  activeProjects: Array<{
    id: number;
    name: string;
    status: ProjectStatus;
    deadline: string | null;
    totalTasks: number;
    completedTasks: number;
    progress: number;
  }>;
}

import type { ProjectRole, ProjectStatus, TaskPriority, TaskStatus } from '../lib/validations';

export interface UserProfile {
  id: string;
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
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  deadline: string | null;
  ownerId: string;
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
    userId: string;
    role: string;
    name: string;
    email: string;
    avatar: string | null;
  }>;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueDate: string | null;
  projectId: string;
  projectName?: string;
  assigneeId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignee: UserSummary | null;
  createdBy: UserSummary | null;
  commentCount?: number;
}

export interface TaskCommentItem {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  authorAvatar: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail?: string;
  actorAvatar: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  action: string;
  resourceType?: string;
  resourceName?: string;
  details: string | null;
  createdAt: string;
}

export interface ProjectMemberItem {
  id: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface InvitationItem {
  id: string;
  projectId: string;
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
  id: string;
  userId: string;
  projectId?: string;
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
    id: string;
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
    userId: string;
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
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: string;
    projectName: string;
  }>;
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: string;
    projectName: string;
  }>;
  overdueTaskList: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    projectId: string;
    projectName: string;
  }>;
  activeProjects: Array<{
    id: string;
    name: string;
    status: ProjectStatus;
    deadline: string | null;
    totalTasks: number;
    completedTasks: number;
    progress: number;
  }>;
}

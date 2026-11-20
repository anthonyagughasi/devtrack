import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Copy,
  Edit2,
  MailPlus,
  Plus,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatDate, formatRelativeTime, isOverdue } from '../../lib/utils';
import type { ProjectRole, ProjectStatus, TaskStatus } from '../../lib/validations';
import type {
  ActivityItem,
  InvitationItem,
  ProjectMemberItem,
  TaskItem,
} from '../../types/app';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskModal } from '../tasks/TaskModal';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { ProjectStatusText, TaskPriorityText } from '../ui/StatusText';
import { ProjectFormModal } from './ProjectFormModal';

interface ProjectDetailData {
  project: {
    id: number;
    name: string;
    description: string;
    status: ProjectStatus;
    startDate: string | null;
    deadline: string | null;
    ownerId: number;
    owner: { id: number; name: string; email: string; avatar: string | null };
    role: ProjectRole;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    todoTasks: number;
    overdueTasks: number;
    progress: number;
  };
  members: ProjectMemberItem[];
  tasks: TaskItem[];
  activities: ActivityItem[];
}

interface ProjectDetailViewProps {
  projectId: number;
  initialTaskId?: number;
  onBack: () => void;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function ProjectDetailView({
  projectId,
  initialTaskId,
  onBack,
  refreshTrigger,
  onDataChanged,
}: ProjectDetailViewProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(initialTaskId ?? null);
  const [defaultTaskStatus, setDefaultTaskStatus] = useState<TaskStatus>('TODO');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'MEMBER' | 'ADMINISTRATOR'>('MEMBER');
  const [inviting, setInviting] = useState(false);

  const [removingMember, setRemovingMember] = useState<ProjectMemberItem | null>(null);

  const loadProject = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ProjectDetailData>(`/api/projects/${projectId}`);
      setData(res);

      if (res.project.role === 'OWNER' || res.project.role === 'ADMINISTRATOR') {
        const invRes = await apiFetch<{ invitations: InvitationItem[] }>(
          `/api/projects/${projectId}/invitations`
        );
        setInvitations(invRes.invitations.filter((i) => i.status === 'PENDING'));
      } else {
        setInvitations([]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load project.', 'error');
      onBack();
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast, onBack]);

  useEffect(() => {
    loadProject();
  }, [loadProject, refreshTrigger]);

  useEffect(() => {
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
      setTaskModalOpen(true);
    }
  }, [initialTaskId]);

  const handleDeleteProject = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      showToast('Project deleted.', 'success');
      setDeleteOpen(false);
      onDataChanged();
      onBack();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete project.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    const recipient = inviteEmail.trim();
    try {
      const res = await apiFetch<{
        invitation: InvitationItem;
      }>(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: recipient, role: inviteRole }),
      });

      if (!res || !res.invitation) {
        throw new Error('Failed to create invitation.');
      }

      const statusMsg =
        "Invitation created. It will appear in the recipient's DevTrack account when they register or sign in.";

      showToast(statusMsg, 'success');
      setInviteEmail('');
      setInviteOpen(false);
      setInvitations((prev) => [res.invitation, ...prev]);
      loadProject();
      onDataChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to create invitation.';
      setInviteError(msg);
      showToast(msg, 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      showToast('Invitation token copied to clipboard.', 'success');
    } catch {
      showToast('Unable to copy automatically. Select the token manually.', 'info');
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    try {
      await apiFetch(`/api/invitations/${inviteId}`, { method: 'DELETE' });
      setInvitations((prev) => prev.filter((i) => i.id !== inviteId));
      showToast('Invitation revoked.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to revoke invitation.', 'error');
    }
  };

  const handleRoleChange = async (userId: number, role: 'ADMINISTRATOR' | 'MEMBER') => {
    try {
      await apiFetch(`/api/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      showToast('Member role updated.', 'success');
      loadProject();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update role.', 'error');
    }
  };

  const handleRemoveMember = async () => {
    if (!removingMember) return;
    try {
      await apiFetch(`/api/projects/${projectId}/members/${removingMember.userId}`, {
        method: 'DELETE',
      });
      showToast(`Removed ${removingMember.name} from project.`, 'success');
      setRemovingMember(null);
      loadProject();
      onDataChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove member.', 'error');
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const { project, members, tasks, activities } = data;
  const canEdit = project.role === 'OWNER' || project.role === 'ADMINISTRATOR';
  const canDelete = project.role === 'OWNER';
  const canManageAdmins = project.role === 'OWNER';

  const upcomingDeadlines = tasks
    .filter((t) => t.status !== 'COMPLETED' && t.dueDate)
    .sort(
      (a, b) =>
        new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
    )
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Projects</span>
        </button>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setInviteOpen(true)}>
              <MailPlus className="h-3.5 w-3.5" />
              <span>Invite Member</span>
            </Button>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <Edit2 className="h-3.5 w-3.5" />
              <span>Edit</span>
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </Button>
          )}
        </div>
      </div>

      {/* Project Summary Header */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {project.name}
              </h2>
              <ProjectStatusText status={project.status} />
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {project.description || 'No project description added.'}
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-neutral-500 dark:text-neutral-400">
              <span>Owner: {project.owner.name}</span>
              <span aria-hidden="true">·</span>
              <span>Your Role: {project.role}</span>
              {project.startDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Start: {formatDate(project.startDate)}</span>
                </>
              )}
              {project.deadline && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Deadline: {formatDate(project.deadline)}</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:min-w-[380px]">
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-[#0D0F14]">
              <div className="text-[11px] text-neutral-500">Progress</div>
              <div className="font-mono text-lg font-semibold mt-0.5 tabular-nums">
                {project.progress}%
              </div>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-[#0D0F14]">
              <div className="text-[11px] text-neutral-500">Total Tasks</div>
              <div className="font-mono text-lg font-semibold mt-0.5 tabular-nums">
                {project.totalTasks}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-[#0D0F14]">
              <div className="text-[11px] text-neutral-500">Completed</div>
              <div className="font-mono text-lg font-semibold text-emerald-500 mt-0.5 tabular-nums">
                {project.completedTasks}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-[#0D0F14]">
              <div className="text-[11px] text-neutral-500">Overdue</div>
              <div className="font-mono text-lg font-semibold text-red-500 mt-0.5 tabular-nums">
                {project.overdueTasks}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 h-2 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* Persistent Project Kanban Board */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Project Task Board</h3>
          <Button
            size="sm"
            onClick={() => {
              setSelectedTaskId(null);
              setDefaultTaskStatus('TODO');
              setTaskModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Task</span>
          </Button>
        </div>

        <KanbanBoard
          tasks={tasks}
          onTasksChange={(updated) => {
            setData((prev) => (prev ? { ...prev, tasks: updated } : prev));
            loadProject();
            onDataChanged();
          }}
          onSelectTask={(id) => {
            setSelectedTaskId(id);
            setTaskModalOpen(true);
          }}
          onAddTask={(status) => {
            setSelectedTaskId(null);
            setDefaultTaskStatus(status);
            setTaskModalOpen(true);
          }}
        />
      </section>

      {/* Secondary Operational Row: Members, Upcoming Deadlines, Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team Members */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-neutral-400" />
              <span>Team Members ({members.length})</span>
            </h3>
            {canEdit && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                + Invite
              </button>
            )}
          </div>

          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={m.avatar} name={m.name} size="sm" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{m.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {canManageAdmins && m.role !== 'OWNER' ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        handleRoleChange(
                          m.userId,
                          e.target.value as 'ADMINISTRATOR' | 'MEMBER'
                        )
                      }
                      aria-label={`Role for ${m.name}`}
                      className="h-7 rounded border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 text-[11px]"
                    >
                      <option value="ADMINISTRATOR">Administrator</option>
                      <option value="MEMBER">Member</option>
                    </select>
                  ) : (
                    <span className="text-[11px] font-mono text-neutral-500">
                      {m.role}
                    </span>
                  )}

                  {m.role !== 'OWNER' &&
                    (project.role === 'OWNER' ||
                      (project.role === 'ADMINISTRATOR' && m.role === 'MEMBER') ||
                      m.userId === profile?.id) && (
                      <button
                        type="button"
                        onClick={() => setRemovingMember(m)}
                        title="Remove member"
                        aria-label={`Remove ${m.name}`}
                        className="p-1 text-neutral-400 hover:text-red-500 cursor-pointer"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>

          {invitations.length > 0 && (
            <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800/70 space-y-2">
              <div className="text-[11px] font-semibold text-neutral-500">
                Pending Invitations
              </div>
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2 text-xs py-1"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{inv.email}</div>
                    <div className="text-[11px] text-neutral-500">
                      {inv.role} · Expires {formatDate(inv.expiresAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyToken(inv.token)}
                      title="Copy invite token"
                      className="p-1 text-neutral-400 hover:text-blue-400 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv.id)}
                      title="Revoke invitation"
                      className="p-1 text-neutral-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-neutral-400" />
            <span>Upcoming Deadlines</span>
          </h3>

          {upcomingDeadlines.length === 0 ? (
            <p className="text-xs text-neutral-500">No active tasks with due dates.</p>
          ) : (
            <div className="space-y-3">
              {upcomingDeadlines.map((t) => {
                const overdue = isOverdue(t.dueDate, t.status);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTaskId(t.id);
                      setTaskModalOpen(true);
                    }}
                    className="w-full text-left flex items-center justify-between gap-3 py-1.5 hover:bg-neutral-50 dark:hover:bg-[#161922] rounded-md px-2 -mx-2 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{t.title}</div>
                      <div className="mt-0.5">
                        <TaskPriorityText priority={t.priority} />
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[11px] shrink-0 tabular-nums inline-flex items-center gap-1 ${
                        overdue ? 'text-red-500 font-medium' : 'text-neutral-500'
                      }`}
                    >
                      {overdue && <AlertTriangle className="h-3 w-3" />}
                      {formatDate(t.dueDate)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Project Activity */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold">Recent Activity</h3>
          {activities.length === 0 ? (
            <p className="text-xs text-neutral-500">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {activities.map((act) => (
                <div
                  key={act.id}
                  className="flex items-start gap-2.5 text-xs pb-2.5 border-b border-neutral-100 dark:border-neutral-800/60 last:border-0"
                >
                  <Avatar src={act.actorAvatar} name={act.actorName} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-neutral-800 dark:text-neutral-200 leading-snug">
                      <span className="font-semibold">{act.actorName}</span>{' '}
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {act.details ?? act.action}
                      </span>
                    </p>
                    <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
                      {formatRelativeTime(act.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <ProjectFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialProject={project}
        onSaved={() => {
          loadProject();
          onDataChanged();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteProject}
        title="Delete project"
        description={`Delete "${project.name}" and all tasks, comments, and team memberships?`}
        confirmLabel="Delete project"
        loading={deleting}
      />

      <ConfirmDialog
        open={Boolean(removingMember)}
        onClose={() => setRemovingMember(null)}
        onConfirm={handleRemoveMember}
        title="Remove project member"
        description={`Remove ${removingMember?.name ?? 'this user'} from "${project.name}"? Their assigned tasks will become unassigned.`}
        confirmLabel="Remove member"
      />

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Team Member"
        subtitle={`Generate a single-use invitation token for ${project.name}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Collaborator Email
            </label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Project Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as 'MEMBER' | 'ADMINISTRATOR')
              }
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="MEMBER">Member — Work on tasks & comment</option>
              {canManageAdmins && (
                <option value="ADMINISTRATOR">
                  Administrator — Edit project & invite members
                </option>
              )}
            </select>
          </div>

          {inviteError && (
            <p className="text-xs text-red-500 leading-relaxed">{inviteError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setInviteError(null);
                setInviteOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={inviting}>
              Send Invitation
            </Button>
          </div>
        </form>
      </Modal>

      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false);
          setSelectedTaskId(null);
        }}
        taskId={selectedTaskId}
        defaultProjectId={project.id}
        defaultStatus={defaultTaskStatus}
        members={members}
        onSaved={() => {
          loadProject();
          onDataChanged();
        }}
      />
    </div>
  );
}

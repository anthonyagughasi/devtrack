import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Calendar,
  Edit2,
  MessageSquare,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatDate, formatRelativeTime, isOverdue } from '../../lib/utils';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/validations';
import type { ActivityItem, TaskCommentItem, TaskItem } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';

const taskFormSchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(200),
  description: z.string().max(4000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string(),
  assigneeId: z.string(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

interface MemberOption {
  userId: number;
  name: string;
  email: string;
  avatar: string | null;
}

interface ProjectOption {
  id: number;
  name: string;
  members?: MemberOption[];
}

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  taskId?: number | null;
  defaultProjectId?: number;
  defaultStatus?: TaskStatus;
  projects?: ProjectOption[];
  members?: MemberOption[];
  onSaved: () => void;
}

export function TaskModal({
  open,
  onClose,
  taskId,
  defaultProjectId,
  defaultStatus = 'TODO',
  projects = [],
  members = [],
  onSaved,
}: TaskModalProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isEdit = Boolean(taskId);

  const [loadingDetails, setLoadingDetails] = useState(false);
  const [taskMeta, setTaskMeta] = useState<TaskItem | null>(null);
  const [comments, setComments] = useState<TaskCommentItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [projectMembers, setProjectMembers] = useState<MemberOption[]>(members);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      projectId: String(defaultProjectId ?? projects[0]?.id ?? ''),
      title: '',
      description: '',
      status: defaultStatus,
      priority: 'MEDIUM',
      dueDate: '',
      assigneeId: '',
    },
  });

  const selectedProjectId = watch('projectId');

  useEffect(() => {
    if (!open) return;

    if (!taskId) {
      setTaskMeta(null);
      setComments([]);
      setActivities([]);
      const pId = defaultProjectId ?? (projects[0]?.id || 0);
      const selectedProj = projects.find((p) => p.id === pId);
      setProjectMembers(members.length > 0 ? members : selectedProj?.members ?? []);
      reset({
        projectId: pId ? String(pId) : '',
        title: '',
        description: '',
        status: defaultStatus,
        priority: 'MEDIUM',
        dueDate: '',
        assigneeId: '',
      });
      return;
    }

    let cancelled = false;
    setLoadingDetails(true);
    apiFetch<{
      task: TaskItem;
      comments: TaskCommentItem[];
      activities: ActivityItem[];
      projectMembers: MemberOption[];
    }>(`/api/tasks/${taskId}`)
      .then((data) => {
        if (cancelled) return;
        setTaskMeta(data.task);
        setComments(data.comments);
        setActivities(data.activities);
        setProjectMembers(data.projectMembers);
        reset({
          projectId: String(data.task.projectId),
          title: data.task.title,
          description: data.task.description ?? '',
          status: data.task.status as TaskStatus,
          priority: data.task.priority as TaskPriority,
          dueDate: data.task.dueDate
            ? new Date(data.task.dueDate).toISOString().slice(0, 10)
            : '',
          assigneeId: data.task.assigneeId ? String(data.task.assigneeId) : '',
        });
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : 'Failed to load task.', 'error');
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, taskId, defaultProjectId, defaultStatus]);

  useEffect(() => {
    if (!isEdit && projects.length > 0 && selectedProjectId) {
      const proj = projects.find((p) => p.id === Number(selectedProjectId));
      if (proj?.members) {
        setProjectMembers(proj.members);
      }
    }
  }, [selectedProjectId, projects, isEdit]);

  const onSubmit = async (values: TaskFormValues) => {
    setSubmitting(true);
    try {
      const payload = {
        projectId: Number(values.projectId),
        title: values.title,
        description: values.description || '',
        status: values.status,
        priority: values.priority,
        dueDate: values.dueDate ? new Date(`${values.dueDate}T12:00:00Z`).toISOString() : null,
        assigneeId: values.assigneeId ? Number(values.assigneeId) : null,
      };

      if (isEdit && taskId) {
        await apiFetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Task updated.', 'success');
      } else {
        await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Task created.', 'success');
      }

      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save task.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!taskId) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      showToast('Task deleted.', 'success');
      setConfirmDeleteOpen(false);
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete task.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const { comment } = await apiFetch<{ comment: TaskCommentItem }>(
        `/api/tasks/${taskId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ content: newComment.trim() }),
        }
      );
      setComments((prev) => [...prev, comment]);
      setNewComment('');
      showToast('Comment posted.', 'success');
      onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to post comment.', 'error');
    } finally {
      setPostingComment(false);
    }
  };

  const handleSaveCommentEdit = async (commentId: number) => {
    if (!editingCommentText.trim()) return;
    try {
      await apiFetch(`/api/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: editingCommentText.trim() }),
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, content: editingCommentText.trim() } : c
        )
      );
      setEditingCommentId(null);
      setEditingCommentText('');
      showToast('Comment updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update comment.', 'error');
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    try {
      await apiFetch(`/api/comments/${commentId}`, { method: 'DELETE' });
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      showToast('Comment deleted.', 'success');
      onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete comment.', 'error');
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? taskMeta?.title || 'Task Details' : 'Create Task'}
        subtitle={
          isEdit && taskMeta
            ? `${taskMeta.projectName ?? 'Project'} · Created by ${taskMeta.createdBy?.name ?? 'Member'} · ${formatDate(taskMeta.createdAt)}`
            : 'Add a deliverable to your project board'
        }
        maxWidthClass="max-w-3xl"
      >
        {loadingDetails ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {isEdit && taskMeta && isOverdue(taskMeta.dueDate, taskMeta.status) && (
              <div className="flex items-center gap-2 text-xs text-red-500 border border-red-500/30 bg-red-500/5 rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  This task is overdue (due {formatDate(taskMeta.dueDate)}).
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {!isEdit && projects.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                    Project
                  </label>
                  <select
                    {...register('projectId')}
                    className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {errors.projectId && (
                    <p className="text-xs text-red-500 mt-1">{errors.projectId.message}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                  Task Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Harden API rate limit middleware"
                  {...register('title')}
                  className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.title && (
                  <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Acceptance criteria, technical context, or implementation notes..."
                  {...register('description')}
                  className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                    Status
                  </label>
                  <select
                    {...register('status')}
                    className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="TODO">To Do</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                    Priority
                  </label>
                  <select
                    {...register('priority')}
                    className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> Assignee
                    </span>
                  </label>
                  <select
                    {...register('assigneeId')}
                    className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {projectMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Due Date
                    </span>
                  </label>
                  <input
                    type="date"
                    {...register('dueDate')}
                    className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800/80">
                <div>
                  {isEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete task</span>
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={submitting}>
                    {isEdit ? 'Save changes' : 'Create task'}
                  </Button>
                </div>
              </div>
            </form>

            {isEdit && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 border-t border-neutral-200 dark:border-neutral-800/80">
                {/* Comments Thread */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Comments ({comments.length})</span>
                  </div>

                  <form onSubmit={handleAddComment} className="flex gap-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="flex-1 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      loading={postingComment}
                      disabled={!newComment.trim()}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Post</span>
                    </Button>
                  </form>

                  <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                    {comments.length === 0 ? (
                      <p className="text-xs text-neutral-500">
                        No comments yet. Start the discussion above.
                      </p>
                    ) : (
                      comments.map((comment) => {
                        const isMine = profile?.id === comment.authorId;
                        return (
                          <div
                            key={comment.id}
                            className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800/80 bg-neutral-50/70 dark:bg-[#0D0F14]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar
                                  src={comment.authorAvatar}
                                  name={comment.authorName}
                                  size="xs"
                                />
                                <span className="text-xs font-semibold truncate">
                                  {comment.authorName}
                                </span>
                                <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
                                  {formatRelativeTime(comment.createdAt)}
                                </span>
                              </div>
                              {isMine && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId(comment.id);
                                      setEditingCommentText(comment.content);
                                    }}
                                    aria-label="Edit comment"
                                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteComment(comment.id)}
                                    aria-label="Delete comment"
                                    className="p-1 text-neutral-400 hover:text-red-500 cursor-pointer"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {editingCommentId === comment.id ? (
                              <div className="mt-2 flex gap-2">
                                <input
                                  type="text"
                                  value={editingCommentText}
                                  onChange={(e) => setEditingCommentText(e.target.value)}
                                  className="flex-1 h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#111318] px-2.5 text-xs"
                                />
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveCommentEdit(comment.id)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingCommentId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-700 dark:text-neutral-300 mt-1.5 leading-relaxed whitespace-pre-wrap">
                                {comment.content}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Task Activity History */}
                <div className="lg:col-span-5 space-y-3">
                  <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                    Task History
                  </h4>
                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {activities.length === 0 ? (
                      <p className="text-xs text-neutral-500">No recorded updates yet.</p>
                    ) : (
                      activities.map((act) => (
                        <div key={act.id} className="text-xs border-b border-neutral-100 dark:border-neutral-800/60 pb-2">
                          <div className="text-neutral-800 dark:text-neutral-200">
                            <span className="font-medium">{act.actorName}</span>{' '}
                            <span className="text-neutral-500 dark:text-neutral-400">
                              {act.details ?? act.action}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-neutral-400 mt-0.5 tabular-nums">
                            {formatRelativeTime(act.createdAt)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDeleteTask}
        title="Delete task"
        description={`Are you sure you want to permanently delete "${taskMeta?.title ?? 'this task'}"?`}
        confirmLabel="Delete task"
        loading={deleting}
      />
    </>
  );
}

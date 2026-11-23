import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Calendar,
  Edit2,
  FolderKanban,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatClientError } from '../../lib/firebase';
import { cn, formatDate } from '../../lib/utils';
import {
  deleteProject,
  listUserProjects,
  updateProject,
} from '../../services/projects';
import type { ProjectSummary } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { ProjectStatusText } from '../ui/StatusText';
import { ProjectFormModal } from './ProjectFormModal';

interface ProjectsViewProps {
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  refreshTrigger: number;
  onDataChanged: () => void;
}

const STATUS_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PLANNING', label: 'Planning' },
  { id: 'ON_HOLD', label: 'On Hold' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'ARCHIVED', label: 'Archived' },
];

export function ProjectsView({
  onSelectProject,
  onNewProject,
  refreshTrigger,
  onDataChanged,
}: ProjectsViewProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadProjects = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const list = await listUserProjects(profile.uid, {
        q: search.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      setProjects(list);
    } catch (err) {
      showToast(formatClientError(err, 'Failed to load projects.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [profile, search, statusFilter, showToast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects, refreshTrigger]);

  const handleArchive = async (project: ProjectSummary) => {
    if (!profile) return;
    try {
      const nextStatus = project.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
      await updateProject(profile, project.id, { status: nextStatus });
      showToast(
        nextStatus === 'ARCHIVED' ? 'Project archived.' : 'Project restored.',
        'success'
      );
      loadProjects();
      onDataChanged();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to update project.'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deletingProject || !profile) return;
    setDeleting(true);
    try {
      await deleteProject(profile, deletingProject.id);
      showToast('Project deleted.', 'success');
      setDeletingProject(null);
      loadProjects();
      onDataChanged();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to delete project.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">My Projects</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Progress percentages are calculated dynamically from persisted task completions.
          </p>
        </div>
        <Button size="sm" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5" />
          <span>New Project</span>
        </Button>
      </div>

      {/* Search & Status Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative w-full lg:w-80">
          <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full h-9 pl-8 pr-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={search || statusFilter !== 'ALL' ? 'No matching projects' : 'No projects yet'}
          description={
            search || statusFilter !== 'ALL'
              ? 'Adjust your search query or status filter.'
              : 'Create your first engineering project to track tasks, collaborators, and velocity.'
          }
          action={
            <Button size="sm" onClick={onNewProject}>
              <Plus className="h-3.5 w-3.5" />
              <span>Create Project</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => {
            const canEdit = project.role === 'OWNER' || project.role === 'ADMINISTRATOR';
            const canDelete = project.role === 'OWNER';

            return (
              <div
                key={project.id}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 flex flex-col justify-between transition-colors hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className="text-left font-display text-base font-semibold text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer line-clamp-1"
                    >
                      {project.name}
                    </button>
                    <ProjectStatusText status={project.status} />
                  </div>

                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 line-clamp-2 min-h-[32px] leading-relaxed">
                    {project.description || 'No description provided.'}
                  </p>

                  {/* Dynamic Progress */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-neutral-500 dark:text-neutral-400">
                        Progress
                      </span>
                      <span className="font-mono font-medium text-neutral-800 dark:text-neutral-200 tabular-nums">
                        {project.completedTasks}/{project.totalTasks} tasks · {project.progress}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3.5 border-t border-neutral-100 dark:border-neutral-800/70 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-3 text-neutral-500 dark:text-neutral-400 min-w-0">
                    <div className="flex items-center -space-x-1.5">
                      {project.members.slice(0, 3).map((m) => (
                        <Avatar key={m.userId} src={m.avatar} name={m.name} size="xs" />
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Users className="h-3 w-3" />
                      {project.memberCount}
                    </span>
                    {project.overdueTasks > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-500 font-mono tabular-nums">
                        <AlertTriangle className="h-3 w-3" />
                        {project.overdueTasks}
                      </span>
                    )}
                    {project.deadline && (
                      <span className="hidden sm:inline-flex items-center gap-1 font-mono tabular-nums truncate">
                        <Calendar className="h-3 w-3" />
                        {formatDate(project.deadline)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingProject(project)}
                          title="Edit project"
                          aria-label={`Edit ${project.name}`}
                          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchive(project)}
                          title={project.status === 'ARCHIVED' ? 'Restore project' : 'Archive project'}
                          aria-label={`Archive ${project.name}`}
                          className="p-1.5 rounded-md text-neutral-400 hover:text-amber-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => setDeletingProject(project)}
                        title="Delete project"
                        aria-label={`Delete ${project.name}`}
                        className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProjectFormModal
        open={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        initialProject={editingProject}
        onSaved={() => {
          loadProjects();
          onDataChanged();
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingProject)}
        onClose={() => setDeletingProject(null)}
        onConfirm={handleDelete}
        title="Delete project"
        description={`Permanently delete "${deletingProject?.name ?? ''}" and all of its tasks, comments, and invitations? This action cannot be undone.`}
        confirmLabel="Delete project"
        loading={deleting}
      />
    </div>
  );
}

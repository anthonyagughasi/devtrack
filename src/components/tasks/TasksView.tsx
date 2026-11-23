import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckSquare,
  Kanban,
  List,
  Plus,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatClientError } from '../../lib/firebase';
import { cn, formatDate, isOverdue } from '../../lib/utils';
import type { TaskStatus } from '../../lib/validations';
import { listUserProjects } from '../../services/projects';
import { listUserTasks, updateTask } from '../../services/tasks';
import type { ProjectSummary, TaskItem } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TaskPriorityText } from '../ui/StatusText';
import { KanbanBoard } from './KanbanBoard';
import { TaskModal } from './TaskModal';

interface TasksViewProps {
  onNewProject: () => void;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function TasksView({
  onNewProject,
  refreshTrigger,
  onDataChanged,
}: TasksViewProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('position');

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<string | undefined>(
    undefined
  );
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('TODO');

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [tasksList, projectsList] = await Promise.all([
        listUserTasks(profile.uid, {
          projectId: projectFilter !== 'ALL' ? projectFilter : undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          priority: priorityFilter !== 'ALL' ? priorityFilter : undefined,
          assignee: assigneeFilter !== 'ALL' ? assigneeFilter : undefined,
          q: search.trim() || undefined,
          sort: sortBy,
        }),
        listUserProjects(profile.uid),
      ]);
      setTasks(tasksList);
      setProjects(projectsList);
    } catch (err) {
      showToast(formatClientError(err, 'Failed to load tasks.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [
    profile,
    projectFilter,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    search,
    sortBy,
    showToast,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleOpenCreate = (status: TaskStatus = 'TODO') => {
    if (projects.length === 0) {
      showToast('Create a project first before adding tasks.', 'info');
      onNewProject();
      return;
    }
    setSelectedTaskId(null);
    setSelectedTaskProjectId(
      projectFilter !== 'ALL' ? projectFilter : projects[0]?.id
    );
    setDefaultStatus(status);
    setModalOpen(true);
  };

  const handleStatusQuickChange = async (
    taskId: string,
    projectId: string,
    status: TaskStatus
  ) => {
    if (!profile) return;
    try {
      await updateTask(profile, taskId, { status }, projectId);
      showToast('Task status updated.', 'success');
      loadData();
      onDataChanged();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to update task.'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Tasks & Kanban Board
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Drag cards between columns or switch to table view to triage assignments and deadlines.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center p-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318]">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                viewMode === 'kanban'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              )}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span>Board</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span>List</span>
            </button>
          </div>

          <Button size="sm" onClick={() => handleOpenCreate('TODO')}>
            <Plus className="h-3.5 w-3.5" />
            <span>New Task</span>
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <div className="relative lg:col-span-2">
          <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks by title or notes..."
            className="w-full h-9 pl-8 pr-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Priorities</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>

        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">Everyone</option>
          <option value="ME">Assigned to Me</option>
          <option value="UNASSIGNED">Unassigned</option>
        </select>

        <select
          value={viewMode === 'list' ? `${statusFilter}:${sortBy}` : sortBy}
          onChange={(e) => {
            if (viewMode === 'list' && e.target.value.includes(':')) {
              const [st, so] = e.target.value.split(':');
              setStatusFilter(st);
              setSortBy(so);
            } else {
              setSortBy(e.target.value);
            }
          }}
          className="h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {viewMode === 'list' ? (
            <>
              <option value="ALL:position">All Statuses · Board Order</option>
              <option value="ALL:dueDate">All Statuses · Due Date</option>
              <option value="ALL:priority">All Statuses · Priority</option>
              <option value="TODO:dueDate">To Do · Due Date</option>
              <option value="IN_PROGRESS:dueDate">In Progress · Due Date</option>
              <option value="COMPLETED:dueDate">Completed · Due Date</option>
            </>
          ) : (
            <>
              <option value="position">Sort: Board Order</option>
              <option value="dueDate">Sort: Due Date</option>
              <option value="priority">Sort: Priority</option>
            </>
          )}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No projects available yet"
          description="Create your first project to organize tasks on the Kanban board."
          action={
            <Button size="sm" onClick={onNewProject}>
              <Plus className="h-3.5 w-3.5" />
              <span>Create First Project</span>
            </Button>
          }
        />
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          tasks={tasks}
          onTasksChange={(updated) => {
            setTasks(updated);
            onDataChanged();
          }}
          onSelectTask={(id) => {
            const matched = tasks.find((t) => t.id === id);
            setSelectedTaskId(id);
            setSelectedTaskProjectId(matched?.projectId);
            setModalOpen(true);
          }}
          onAddTask={(status) => handleOpenCreate(status)}
          showProjectName
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No matching tasks"
          description="Try clearing a filter or create a new task."
          action={
            <Button size="sm" onClick={() => handleOpenCreate('TODO')}>
              <Plus className="h-3.5 w-3.5" />
              <span>Create Task</span>
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-500">
                <th className="py-3 px-4">Task</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Assignee</th>
                <th className="py-3 px-4 text-right">Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/60 text-sm">
              {tasks.map((task) => {
                const overdue = isOverdue(task.dueDate, task.status);
                return (
                  <tr
                    key={task.id}
                    className="hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors"
                  >
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(task.id);
                          setSelectedTaskProjectId(task.projectId);
                          setModalOpen(true);
                        }}
                        className="font-medium text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 text-left cursor-pointer"
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-xs text-neutral-500 dark:text-neutral-400">
                      {task.projectName}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={task.status}
                        onChange={(e) =>
                          handleStatusQuickChange(
                            task.id,
                            task.projectId,
                            e.target.value as TaskStatus
                          )
                        }
                        aria-label={`Change status for ${task.title}`}
                        className="h-7 rounded border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="TODO">To Do</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <TaskPriorityText priority={task.priority} />
                    </td>
                    <td className="py-3 px-4">
                      {task.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar
                            src={task.assignee.avatar}
                            name={task.assignee.name}
                            size="xs"
                          />
                          <span className="text-xs text-neutral-700 dark:text-neutral-300">
                            {task.assignee.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-400">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                      {task.dueDate ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            overdue ? 'text-red-500 font-medium' : 'text-neutral-500'
                          )}
                        >
                          {overdue ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <Calendar className="h-3 w-3" />
                          )}
                          {formatDate(task.dueDate)}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        taskId={selectedTaskId}
        defaultProjectId={
          selectedTaskProjectId ??
          (projectFilter !== 'ALL' ? projectFilter : projects[0]?.id)
        }
        defaultStatus={defaultStatus}
        projects={projects}
        onSaved={() => {
          loadData();
          onDataChanged();
        }}
      />
    </div>
  );
}

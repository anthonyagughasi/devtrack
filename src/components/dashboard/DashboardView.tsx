import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  FolderKanban,
  Plus,
  Sparkles,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { cn, formatDate, formatRelativeTime } from '../../lib/utils';
import type { DashboardAnalytics } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { DashboardSkeleton } from '../ui/Skeleton';
import { ProjectStatusText, TaskPriorityText, TaskStatusText } from '../ui/StatusText';

interface DashboardViewProps {
  onNewProject: () => void;
  onOpenProject: (projectId: number, taskId?: number) => void;
  refreshTrigger: number;
  onDataChanged: () => void;
}

const RANGE_OPTIONS = [
  { days: 7, label: '7D' },
  { days: 14, label: '14D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
];

export function DashboardView({
  onNewProject,
  onOpenProject,
  refreshTrigger,
  onDataChanged,
}: DashboardViewProps) {
  const { showToast } = useToast();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardAnalytics>(`/api/dashboard?days=${days}`);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard, refreshTrigger]);

  const handleSeedStarter = async () => {
    setSeeding(true);
    try {
      await apiFetch('/api/me/seed-workspace', { method: 'POST' });
      showToast('Starter engineering workspace created.', 'success');
      onDataChanged();
      loadDashboard();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to create starter workspace.',
        'error'
      );
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Unable to load dashboard analytics"
        description={error}
        action={
          <Button size="sm" onClick={loadDashboard}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data) return null;

  if (data.summary.totalProjects === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={FolderKanban}
          title="Your engineering workspace is empty"
          description="Create your first project or load a starter engineering workspace to explore Kanban boards, task velocity, and team insights."
          action={
            <>
              <Button size="sm" onClick={onNewProject}>
                <Plus className="h-3.5 w-3.5" />
                <span>Create First Project</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSeedStarter}
                loading={seeding}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Load Starter Workspace</span>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const { summary } = data;

  const kpis = [
    { label: 'Total Projects', value: summary.totalProjects, accent: 'text-neutral-900 dark:text-white' },
    { label: 'Active Projects', value: summary.activeProjects, accent: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Completed Projects', value: summary.completedProjects, accent: 'text-blue-600 dark:text-blue-400' },
    { label: 'Total Tasks', value: summary.totalTasks, accent: 'text-neutral-900 dark:text-white' },
    { label: 'Completed Tasks', value: summary.completedTasks, accent: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Overdue Tasks', value: summary.overdueTasks, accent: summary.overdueTasks > 0 ? 'text-red-500' : 'text-neutral-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Workspace Overview
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Live metrics aggregated across projects you collaborate on.
          </p>
        </div>

        <div className="inline-flex items-center p-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] self-start">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setDays(opt.days)}
              className={cn(
                'px-3 py-1 rounded-md font-mono text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                days === opt.days
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 6 KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-4"
          >
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {kpi.label}
            </div>
            <div className={cn('font-mono text-2xl font-semibold mt-1.5 tabular-nums', kpi.accent)}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completion Trend */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-semibold">Task Completion Trend</h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Created vs. completed deliverables over the last {days} days
              </p>
            </div>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.completionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111318',
                    borderColor: '#262626',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f5f5f5',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="created"
                  name="Created"
                  stroke="#525252"
                  fill="rgba(82,82,82,0.18)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  name="Completed"
                  stroke="#2563EB"
                  fill="rgba(37,99,235,0.22)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Progress Chart */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5">
          <div className="mb-4">
            <h3 className="font-display text-sm font-semibold">Project Progress (%)</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Completion percentage computed from project tasks
            </p>
          </div>
          {data.projectProgress.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-neutral-500">
              No active projects to display.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.projectProgress} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#737373' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 11, fill: '#a3a3a3' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111318',
                      borderColor: '#262626',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f5f5f5',
                    }}
                  />
                  <Bar
                    dataKey="progress"
                    name="Completion %"
                    fill="#2563EB"
                    radius={[0, 4, 4, 0]}
                    barSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Tasks by Status */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5">
          <div className="mb-4">
            <h3 className="font-display text-sm font-semibold">Tasks by Status</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Current board distribution across workflow stages
            </p>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.tasksByStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111318',
                    borderColor: '#262626',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f5f5f5',
                  }}
                />
                <Bar dataKey="count" name="Tasks" fill="#16A34A" radius={[4, 4, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tasks by Priority */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5">
          <div className="mb-4">
            <h3 className="font-display text-sm font-semibold">Tasks by Priority</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Urgency breakdown across accessible deliverables
            </p>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.tasksByPriority}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111318',
                    borderColor: '#262626',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f5f5f5',
                  }}
                />
                <Bar dataKey="count" name="Tasks" fill="#D97706" radius={[4, 4, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Operational Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Assigned Tasks */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold">My Assigned Tasks</h3>
          {data.myTasks.length === 0 ? (
            <p className="text-xs text-neutral-500">No open tasks assigned to you.</p>
          ) : (
            <div className="space-y-2.5">
              {data.myTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenProject(t.projectId, t.id)}
                  className="w-full text-left p-2.5 -mx-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors cursor-pointer"
                >
                  <div className="text-xs font-medium truncate">{t.title}</div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-500">
                    <span className="truncate">{t.projectName}</span>
                    <span aria-hidden="true">·</span>
                    <TaskStatusText status={t.status} />
                    <span aria-hidden="true">·</span>
                    <TaskPriorityText priority={t.priority} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines & Overdue */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-neutral-400" />
            <span>Deadlines & Overdue</span>
          </h3>
          {data.overdueTaskList.length === 0 && data.upcomingDeadlines.length === 0 ? (
            <p className="text-xs text-neutral-500">No urgent or overdue deadlines.</p>
          ) : (
            <div className="space-y-2.5">
              {data.overdueTaskList.map((t) => (
                <button
                  key={`od-${t.id}`}
                  type="button"
                  onClick={() => onOpenProject(t.projectId, t.id)}
                  className="w-full text-left flex items-center justify-between gap-2 p-2 -mx-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{t.title}</div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {t.projectName}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-red-500 font-medium shrink-0 inline-flex items-center gap-1 tabular-nums">
                    <AlertTriangle className="h-3 w-3" />
                    {formatDate(t.dueDate)}
                  </span>
                </button>
              ))}
              {data.upcomingDeadlines.map((t) => (
                <button
                  key={`up-${t.id}`}
                  type="button"
                  onClick={() => onOpenProject(t.projectId, t.id)}
                  className="w-full text-left flex items-center justify-between gap-2 p-2 -mx-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{t.title}</div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {t.projectName}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-amber-500 shrink-0 tabular-nums">
                    {formatDate(t.dueDate)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active Projects & Team Workload */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold mb-3">Active Projects</h3>
            {data.activeProjects.length === 0 ? (
              <p className="text-xs text-neutral-500">No projects currently in Active status.</p>
            ) : (
              <div className="space-y-3">
                {data.activeProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    className="w-full text-left block hover:bg-neutral-50 dark:hover:bg-[#161922] p-2 -mx-2 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="font-mono text-neutral-500 tabular-nums shrink-0">
                        {p.progress}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${p.progress}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800/70">
            <h3 className="font-display text-sm font-semibold mb-3">Team Workload</h3>
            {data.teamWorkload.length === 0 ? (
              <p className="text-xs text-neutral-500">No team assignments yet.</p>
            ) : (
              <div className="space-y-2.5">
                {data.teamWorkload.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar src={member.avatar} name={member.name} size="xs" />
                      <span className="truncate font-medium">{member.name}</span>
                    </div>
                    <span className="font-mono text-[11px] text-neutral-500 shrink-0 tabular-nums">
                      {member.inProgress} active · {member.completed} done
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity Strip */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5">
        <h3 className="font-display text-sm font-semibold mb-4">Recent Activity</h3>
        {data.recentActivity.length === 0 ? (
          <p className="text-xs text-neutral-500">No recent activity recorded.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recentActivity.slice(0, 6).map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-2.5 text-xs pb-3 border-b border-neutral-100 dark:border-neutral-800/60"
              >
                <Avatar src={act.actorAvatar} name={act.actorName} size="xs" />
                <div className="min-w-0">
                  <div className="text-neutral-800 dark:text-neutral-200 leading-snug">
                    <span className="font-semibold">{act.actorName}</span>{' '}
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {act.details ?? act.action}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-neutral-400 mt-1 tabular-nums">
                    {act.projectName ? `${act.projectName} · ` : ''}
                    {formatRelativeTime(act.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

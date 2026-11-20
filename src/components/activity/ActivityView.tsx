import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatDate, formatRelativeTime } from '../../lib/utils';
import type { ActivityItem, ProjectSummary } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface ActivityViewProps {
  onOpenProject: (projectId: number) => void;
  refreshTrigger: number;
}

export function ActivityView({ onOpenProject, refreshTrigger }: ActivityViewProps) {
  const { showToast } = useToast();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (projectFilter !== 'ALL') params.set('projectId', projectFilter);

      const [actRes, projRes] = await Promise.all([
        apiFetch<{
          items: ActivityItem[];
          total: number;
          page: number;
          totalPages: number;
        }>(`/api/activity?${params.toString()}`),
        apiFetch<{ projects: ProjectSummary[] }>('/api/projects'),
      ]);
      setItems(actRes.items);
      setTotal(actRes.total);
      setTotalPages(actRes.totalPages);
      setProjects(projRes.projects);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load activity.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, projectFilter, showToast]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity, refreshTrigger]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Activity Feed
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Chronological log of project and task updates across your workspace ({total} events).
          </p>
        </div>

        <select
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 self-start"
        >
          <option value="ALL">All Accessible Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity recorded yet"
          description="Project creations, task updates, comments, and team membership changes will appear here chronologically."
        />
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {items.map((item) => (
            <div
              key={item.id}
              className="px-5 py-4 flex items-start justify-between gap-4 hover:bg-neutral-50/70 dark:hover:bg-[#161922]/60 transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <Avatar src={item.actorAvatar} name={item.actorName} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-800 dark:text-neutral-200 leading-snug">
                    <span className="font-semibold">{item.actorName}</span>{' '}
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {item.details ?? item.action}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500">
                    <span className="font-mono text-[11px]">{item.action}</span>
                    {item.projectId && item.projectName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => onOpenProject(item.projectId!)}
                          className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {item.projectName}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-mono text-xs text-neutral-500 tabular-nums">
                  {formatRelativeTime(item.createdAt)}
                </div>
                <div className="font-mono text-[11px] text-neutral-400 tabular-nums hidden sm:block">
                  {formatDate(item.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="font-mono text-xs text-neutral-500 tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Previous</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

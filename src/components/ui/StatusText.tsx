import React from 'react';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Circle,
  Clock,
  Flame,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ProjectStatus, TaskPriority, TaskStatus } from '../../lib/validations';

export function ProjectStatusText({ status }: { status: ProjectStatus | string }) {
  const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    PLANNING: { label: 'Planning', color: 'text-neutral-500 dark:text-neutral-400', Icon: Circle },
    ACTIVE: { label: 'Active', color: 'text-emerald-600 dark:text-emerald-400', Icon: PlayCircle },
    ON_HOLD: { label: 'On Hold', color: 'text-amber-600 dark:text-amber-400', Icon: PauseCircle },
    COMPLETED: { label: 'Completed', color: 'text-blue-600 dark:text-blue-400', Icon: CheckCircle2 },
    ARCHIVED: { label: 'Archived', color: 'text-neutral-500 dark:text-neutral-500', Icon: Archive },
  };
  const cfg = map[status] ?? map.PLANNING;
  const Icon = cfg.Icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', cfg.color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{cfg.label}</span>
    </span>
  );
}

export function TaskStatusText({ status }: { status: TaskStatus | string }) {
  const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    TODO: { label: 'To Do', color: 'text-neutral-500 dark:text-neutral-400', Icon: Circle },
    IN_PROGRESS: { label: 'In Progress', color: 'text-amber-600 dark:text-amber-400', Icon: Clock },
    COMPLETED: { label: 'Completed', color: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  };
  const cfg = map[status] ?? map.TODO;
  const Icon = cfg.Icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', cfg.color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{cfg.label}</span>
    </span>
  );
}

export function TaskPriorityText({ priority }: { priority: TaskPriority | string }) {
  const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    LOW: { label: 'Low', color: 'text-neutral-500 dark:text-neutral-400', Icon: ArrowDown },
    MEDIUM: { label: 'Medium', color: 'text-blue-600 dark:text-blue-400', Icon: ArrowRight },
    HIGH: { label: 'High', color: 'text-amber-600 dark:text-amber-400', Icon: ArrowUp },
    URGENT: { label: 'Urgent', color: 'text-red-600 dark:text-red-400', Icon: Flame },
  };
  const cfg = map[priority] ?? map.MEDIUM;
  const Icon = cfg.Icon;

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap', cfg.color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{cfg.label}</span>
    </span>
  );
}

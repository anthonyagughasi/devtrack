import React, { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, Calendar, GripVertical, MessageSquare, Plus } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { cn, formatDate, isOverdue } from '../../lib/utils';
import type { TaskStatus } from '../../lib/validations';
import type { TaskItem } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { TaskPriorityText } from '../ui/StatusText';

const COLUMNS: Array<{ id: TaskStatus; title: string }> = [
  { id: 'TODO', title: 'To Do' },
  { id: 'IN_PROGRESS', title: 'In Progress' },
  { id: 'COMPLETED', title: 'Completed' },
];

interface KanbanBoardProps {
  tasks: TaskItem[];
  onTasksChange: (tasks: TaskItem[]) => void;
  onSelectTask: (taskId: number) => void;
  onAddTask: (status: TaskStatus) => void;
  showProjectName?: boolean;
}

function SortableTaskCard({
  task,
  onSelectTask,
  showProjectName,
  isOverlay = false,
}: {
  task: TaskItem;
  onSelectTask: (taskId: number) => void;
  showProjectName?: boolean;
  isOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `task-${task.id}`,
    data: { type: 'task', task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group rounded-lg border border-neutral-200 dark:border-neutral-800/90 bg-white dark:bg-[#111318] p-3.5 transition-colors hover:border-neutral-300 dark:hover:border-neutral-700',
        isDragging && 'opacity-40',
        isOverlay && 'shadow-2xl border-blue-500/60 cursor-grabbing'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectTask(task.id)}
          className="text-left text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors leading-snug flex-1 cursor-pointer"
        >
          {task.title}
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${task.title}`}
          className="p-1 -mr-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-grab active:cursor-grabbing touch-none shrink-0"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      {showProjectName && task.projectName && (
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 truncate">
          {task.projectName}
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-neutral-100 dark:border-neutral-800/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <TaskPriorityText priority={task.priority} />
          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums whitespace-nowrap',
                overdue
                  ? 'text-red-500 font-medium'
                  : 'text-neutral-500 dark:text-neutral-400'
              )}
            >
              {overdue ? (
                <AlertTriangle className="h-3 w-3 shrink-0" />
              ) : (
                <Calendar className="h-3 w-3 shrink-0" />
              )}
              <span>{formatDate(task.dueDate)}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(task.commentCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-500 tabular-nums">
              <MessageSquare className="h-3 w-3" />
              <span>{task.commentCount}</span>
            </span>
          )}
          {task.assignee && (
            <Avatar
              src={task.assignee.avatar}
              name={task.assignee.name}
              size="xs"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({
  id,
  title,
  tasks,
  onSelectTask,
  onAddTask,
  showProjectName,
}: {
  id: TaskStatus;
  title: string;
  tasks: TaskItem[];
  onSelectTask: (taskId: number) => void;
  onAddTask: (status: TaskStatus) => void;
  showProjectName?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${id}`,
    data: { type: 'column', status: id },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-neutral-100/60 dark:bg-[#0D0F14] min-h-[380px] transition-colors',
        isOver && 'border-blue-500/60 bg-blue-50/30 dark:bg-blue-950/10'
      )}
    >
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            {title}
          </h3>
          <span className="font-mono text-xs text-neutral-500 tabular-nums">
            {tasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAddTask(id)}
          aria-label={`Add task to ${title}`}
          className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/70 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-2.5 flex-1">
        <SortableContext
          items={tasks.map((t) => `task-${t.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onSelectTask={onSelectTask}
              showProjectName={showProjectName}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="h-24 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-800 flex items-center justify-center text-xs text-neutral-400">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({
  tasks,
  onTasksChange,
  onSelectTask,
  onAddTask,
  showProjectName = false,
}: KanbanBoardProps) {
  const { showToast } = useToast();
  const [boardTasks, setBoardTasks] = useState<TaskItem[]>(tasks);
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [snapshotTasks, setSnapshotTasks] = useState<TaskItem[]>(tasks);

  useEffect(() => {
    setBoardTasks(tasks);
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findContainer = (id: string): TaskStatus | null => {
    if (id.startsWith('col-')) {
      return id.replace('col-', '') as TaskStatus;
    }
    if (id.startsWith('task-')) {
      const taskId = Number(id.replace('task-', ''));
      const found = boardTasks.find((t) => t.id === taskId);
      return (found?.status as TaskStatus) ?? null;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setSnapshotTasks(boardTasks);
    const idStr = String(event.active.id);
    const taskId = Number(idStr.replace('task-', ''));
    const found = boardTasks.find((t) => t.id === taskId) ?? null;
    setActiveTask(found);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeStatus = findContainer(activeId);
    const overStatus = findContainer(overId);
    if (!activeStatus || !overStatus || activeStatus === overStatus) return;

    const activeTaskId = Number(activeId.replace('task-', ''));
    setBoardTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: overStatus } : t))
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) {
      setBoardTasks(snapshotTasks);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeTaskId = Number(activeId.replace('task-', ''));
    const targetStatus = findContainer(overId);

    if (!targetStatus) {
      setBoardTasks(snapshotTasks);
      return;
    }

    const columnTasks = boardTasks.filter((t) => t.status === targetStatus);
    const oldIndex = columnTasks.findIndex((t) => t.id === activeTaskId);
    let newIndex = columnTasks.length - 1;

    if (overId.startsWith('task-')) {
      const overTaskId = Number(overId.replace('task-', ''));
      const idx = columnTasks.findIndex((t) => t.id === overTaskId);
      if (idx !== -1) newIndex = idx;
    }

    let nextColumnTasks = columnTasks;
    if (oldIndex !== -1 && oldIndex !== newIndex) {
      nextColumnTasks = arrayMove(columnTasks, oldIndex, newIndex);
    }

    const finalPosition = Math.max(
      0,
      nextColumnTasks.findIndex((t) => t.id === activeTaskId)
    );

    const updatedTasks = boardTasks.map((t) => {
      if (t.status !== targetStatus) return t;
      const idx = nextColumnTasks.findIndex((item) => item.id === t.id);
      return {
        ...t,
        status: targetStatus,
        position: idx !== -1 ? idx : t.position,
      };
    });

    setBoardTasks(updatedTasks);
    onTasksChange(updatedTasks);

    const prevTask = snapshotTasks.find((t) => t.id === activeTaskId);
    const movedChanged =
      !prevTask ||
      prevTask.status !== targetStatus ||
      prevTask.position !== finalPosition;

    if (!movedChanged) return;

    try {
      await apiFetch(`/api/tasks/${activeTaskId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: targetStatus,
          position: finalPosition,
        }),
      });
    } catch (err) {
      // Revert optimistic update on server failure
      setBoardTasks(snapshotTasks);
      onTasksChange(snapshotTasks);
      showToast(
        err instanceof Error
          ? err.message
          : 'Failed to save task position. Reverted change.',
        'error'
      );
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = boardTasks
            .filter((t) => t.status === col.id)
            .sort((a, b) => a.position - b.position);

          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              tasks={colTasks}
              onSelectTask={onSelectTask}
              onAddTask={onAddTask}
              showProjectName={showProjectName}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <SortableTaskCard
            task={activeTask}
            onSelectTask={() => {}}
            showProjectName={showProjectName}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

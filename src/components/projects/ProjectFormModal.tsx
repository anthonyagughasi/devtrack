import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatClientError } from '../../lib/firebase';
import { PROJECT_STATUSES, type ProjectStatus } from '../../lib/validations';
import { createProject, updateProject } from '../../services/projects';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const projectFormSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(120),
  description: z.string().max(2000),
  status: z.enum(PROJECT_STATUSES),
  startDate: z.string(),
  deadline: z.string(),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

interface ProjectFormModalProps {
  open: boolean;
  onClose: () => void;
  initialProject?: {
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    startDate: string | null;
    deadline: string | null;
  } | null;
  onSaved: (projectId: string) => void;
}

export function ProjectFormModal({
  open,
  onClose,
  initialProject,
  onSaved,
}: ProjectFormModalProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(initialProject);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: '',
      description: '',
      status: 'PLANNING',
      startDate: '',
      deadline: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    if (initialProject) {
      reset({
        name: initialProject.name,
        description: initialProject.description ?? '',
        status: initialProject.status,
        startDate: initialProject.startDate
          ? new Date(initialProject.startDate).toISOString().slice(0, 10)
          : '',
        deadline: initialProject.deadline
          ? new Date(initialProject.deadline).toISOString().slice(0, 10)
          : '',
      });
    } else {
      reset({
        name: '',
        description: '',
        status: 'ACTIVE',
        startDate: new Date().toISOString().slice(0, 10),
        deadline: '',
      });
    }
  }, [open, initialProject, reset]);

  const onSubmit = async (values: ProjectFormValues) => {
    if (!profile) return;
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        description: values.description || '',
        status: values.status,
        startDate: values.startDate
          ? new Date(`${values.startDate}T12:00:00Z`).toISOString()
          : null,
        deadline: values.deadline
          ? new Date(`${values.deadline}T12:00:00Z`).toISOString()
          : null,
      };

      if (isEdit && initialProject) {
        const res = await updateProject(profile, initialProject.id, payload);
        showToast('Project updated.', 'success');
        onSaved(res.id);
      } else {
        const res = await createProject(profile, payload);
        showToast('Project created.', 'success');
        onSaved(res.id);
      }
      onClose();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to save project.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Project' : 'New Project'}
      subtitle={
        isEdit
          ? 'Update scope, timeline, and lifecycle status'
          : 'Create a shared workspace project for your team'
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            placeholder="e.g. Distributed Payment Gateway"
            {...register('name')}
            className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.name && (
            <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
            Description
          </label>
          <textarea
            rows={3}
            placeholder="Technical goals, deliverables, or architectural scope..."
            {...register('description')}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Status
            </label>
            <select
              {...register('status')}
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              {...register('startDate')}
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Deadline
            </label>
            <input
              type="date"
              {...register('deadline')}
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-800/80">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save Project' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

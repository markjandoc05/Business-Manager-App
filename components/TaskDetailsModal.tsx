'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/core';
import { ModalHeader } from '@/components/ModalCloseButton';
import { getDashboardRecordHref } from '@/lib/dashboard-record-navigation';
import { formatTaskDueDate, getTaskDisplayState } from '@/lib/task-utils';
import type { Task } from '@/types';

export function TaskDetailsModal({ task, relatedName, timezone, onClose }: {
  task: Task; relatedName?: string; timezone?: string; onClose: () => void;
}) {
  const state = getTaskDisplayState(task);
  return <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Task details">
    <div className="app-modal-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-5 overflow-y-auto rounded-2xl bg-white p-4 sm:p-6">
      <ModalHeader title={task.title} subtitle={task.type || 'Follow-up'} onClose={onClose} />
      <div className="flex flex-wrap gap-2">
        <Badge variant={state === 'Completed' ? 'green' : state === 'Overdue' ? 'red' : 'blue'}>{state}</Badge>
        <Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'gray'}>{task.priority} Priority</Badge>
        {task.archived && <Badge variant="gray">Archived</Badge>}
      </div>
      <dl className="space-y-4 text-sm">
        <div><dt className="text-[var(--app-muted)]">Description</dt><dd className="mt-1 whitespace-pre-wrap break-words text-[var(--app-text)]">{task.description || 'No description provided.'}</dd></div>
        <div><dt className="text-[var(--app-muted)]">Due date</dt><dd className="mt-1 text-[var(--app-text)]">{formatTaskDueDate(task.dueDate, timezone)}</dd></div>
        <div><dt className="text-[var(--app-muted)]">Assigned to</dt><dd className="mt-1 break-words text-[var(--app-text)]">{task.assignedToName || task.assignedTo || 'Unassigned'}</dd></div>
        <div><dt className="text-[var(--app-muted)]">Related record</dt><dd className="mt-1">
          {task.relatedTo ? <Link href={getDashboardRecordHref(task.relatedTo.type, task.relatedTo.id)} className="inline-flex min-h-11 items-center break-words rounded-lg text-[var(--app-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]">{relatedName || `Open ${task.relatedTo.type}`}</Link> : <span className="text-[var(--app-text)]">General task</span>}
        </dd></div>
      </dl>
    </div>
  </div>;
}

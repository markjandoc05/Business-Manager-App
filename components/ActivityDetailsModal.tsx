'use client';

import { ModalHeader } from '@/components/ModalCloseButton';
import { formatTaskDueDate } from '@/lib/task-utils';
import type { Activity } from '@/types';

export function ActivityDetailsModal({ activity, recordedBy, timezone, onClose }: {
  activity: Activity; recordedBy?: string; timezone?: string; onClose: () => void;
}) {
  return <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Activity details">
    <div className="app-modal-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-5 overflow-y-auto rounded-2xl bg-white p-4 sm:p-6">
      <ModalHeader title="Activity details" onClose={onClose} />
      <p className="whitespace-pre-wrap break-words text-sm text-[var(--app-text)]">{activity.description}</p>
      <dl className="space-y-4 text-sm">
        <div><dt className="text-[var(--app-muted)]">Event</dt><dd className="mt-1 capitalize text-[var(--app-text)]">{activity.type.replaceAll('_', ' ').toLowerCase()}</dd></div>
        <div><dt className="text-[var(--app-muted)]">Recorded on</dt><dd className="mt-1 text-[var(--app-text)]">{formatTaskDueDate(activity.createdAt || activity.timestamp, timezone)}</dd></div>
        {recordedBy && <div><dt className="text-[var(--app-muted)]">Recorded by</dt><dd className="mt-1 break-words text-[var(--app-text)]">{recordedBy}</dd></div>}
        {activity.entityType && <div><dt className="text-[var(--app-muted)]">Related to</dt><dd className="mt-1 text-[var(--app-text)]">{activity.entityType === 'Settings' ? 'Workspace settings' : activity.entityType}</dd></div>}
        {activity.meta && <div><dt className="text-[var(--app-muted)]">Details</dt><dd className="mt-1 whitespace-pre-wrap break-words text-[var(--app-text)]">{activity.meta}</dd></div>}
      </dl>
    </div>
  </div>;
}

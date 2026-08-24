'use client';

import { Badge } from '@/components/ui/core';
import { IconActionButton } from '@/components/IconActionButton';
import { Archive, Check, RotateCcw } from 'lucide-react';
import { formatTaskDueDate, getTaskDisplayState } from '@/lib/task-utils';
import type { Task } from '@/types';

export function TaskCard({ task, now, timezone, canManage, busy, onToggle, onArchive }: { task: Task; now?: number; timezone?: string; canManage: boolean; busy?: boolean; onToggle: (taskId: string) => void; onArchive?: (taskId: string) => void }) {
  const state = getTaskDisplayState(task, now);
  const stateVariant = state === 'Completed' ? 'green' : state === 'Overdue' ? 'red' : state === 'Scheduled' ? 'blue' : 'gray';
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={`truncate text-sm font-medium ${state === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{task.title}</p><Badge variant={stateVariant}>{state}</Badge></div><p className="mt-1 text-xs text-slate-500">Due {formatTaskDueDate(task.dueDate, timezone)} • {task.priority} Priority{task.assignedToName ? ` • Assigned to ${task.assignedToName}` : ''}</p>{task.description && <p className="mt-1 truncate text-xs text-slate-400">{task.description}</p>}</div><div className="flex shrink-0 items-center gap-1">{canManage && <IconActionButton icon={state === 'Completed' ? <RotateCcw size={15} /> : <Check size={15} />} label={state === 'Completed' ? 'Reopen Task' : 'Complete Task'} disabled={busy} onClick={() => onToggle(task.id)} variant={state === 'Completed' ? 'default' : 'success'} />}{canManage && onArchive && <IconActionButton icon={<Archive size={15} />} label="Archive Task" disabled={busy} onClick={() => onArchive(task.id)} variant="default" />}</div></div>;
}

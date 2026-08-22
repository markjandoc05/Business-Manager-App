import type { Task } from '@/types';

export type TaskDisplayState = 'Scheduled' | 'Overdue' | 'Completed' | 'Pending';

export function getTaskDisplayState(task: Task, now = Date.now()): TaskDisplayState {
  if (task.status === 'Completed') return 'Completed';
  const dueTime = Date.parse(task.dueDate);
  if (!Number.isFinite(dueTime)) return 'Pending';
  return dueTime > now ? 'Scheduled' : 'Overdue';
}

export function formatTaskDueDate(value: string, timezone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No valid due date';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) });
}

export function formatCompactDateTime(value: string, timezone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No valid date';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timezone ? { timeZone: timezone } : {}) });
}

export function sortOpenTasks(tasks: Task[], now = Date.now()) {
  return [...tasks].sort((left, right) => {
    const leftTime = Date.parse(left.dueDate);
    const rightTime = Date.parse(right.dueDate);
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (!leftValid || !rightValid) return leftValid ? -1 : rightValid ? 1 : 0;
    const leftOverdue = leftTime <= now;
    const rightOverdue = rightTime <= now;
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    return leftOverdue ? leftTime - rightTime : leftTime - rightTime;
  });
}

export function getNextFollowUp(tasks: Task[], now = Date.now()) {
  const validPending = tasks.filter((task) => task.status === 'Pending' && Number.isFinite(Date.parse(task.dueDate)));
  const upcoming = validPending.filter((task) => Date.parse(task.dueDate) > now).sort((left, right) => Date.parse(left.dueDate) - Date.parse(right.dueDate));
  const overdue = validPending.filter((task) => Date.parse(task.dueDate) <= now).sort((left, right) => Date.parse(right.dueDate) - Date.parse(left.dueDate));
  return upcoming[0] || overdue[0];
}

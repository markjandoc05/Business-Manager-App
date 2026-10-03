'use client';

import { MobileNavigationTabs } from '@/components/MobileNavigationTabs';
import { ResponsiveTable } from '@/components/ResponsiveTable';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { ModalHeader } from '@/components/ModalCloseButton';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { canManageTasks } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Task } from '@/types';
import { Archive, Check, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getDefaultAssignment } from '@/lib/ownership';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { IconActionButton } from '@/components/IconActionButton';
import { LoadedListStatus } from '@/components/LoadedListStatus';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { getTaskCalendarBucket } from '@/lib/task-utils';
import { getTaskById } from '@/lib/repositories/tasks';
import { useRecordDetails } from '@/hooks/use-record-details';
import { TaskDetailsModal } from '@/components/TaskDetailsModal';
import { RecordDetailsStatusDialog } from '@/components/RecordDetailsStatusDialog';
import { getDashboardRecordHref } from '@/lib/dashboard-record-navigation';

type TaskTab = 'Today' | 'Upcoming' | 'Overdue' | 'Completed' | 'Follow-ups' | 'All';
type TaskForm = Omit<Task, 'id' | 'status'>;
const emptyForm: TaskForm = { title: '', description: '', type: 'Follow-up', dueDate: '', priority: 'Medium', assignedToUid: '', assignedToName: '', relatedTo: undefined };

function toDateTimeInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
function currentDateTimeInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
function formatTaskDueDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, 'MMM d, yyyy h:mm a') : 'No valid due date';
}
function relatedValue(relatedTo?: Task['relatedTo']) { return relatedTo ? `${relatedTo.type}:${relatedTo.id}` : ''; }
function parseRelated(value: string): Task['relatedTo'] {
  if (!value) return undefined;
  const separator = value.indexOf(':');
  if (separator < 1) return undefined;
  return { type: value.slice(0, separator) as NonNullable<Task['relatedTo']>['type'], id: value.slice(separator + 1) };
}

export default function TasksPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { tasks, tasksLoading, tasksError, refreshTasks, loadMoreTasks, tasksHasMore, addTask, updateTask, completeTask, archiveTask, archivedTasks, loadArchivedRecords, loadMoreArchivedTasks, archivedTasksHasMore, restoreTask, permanentlyDeleteTask, leads, clients, deals, users, usersLoading, settings } = useApp();
  const { membership, canWrite, currentOrganizationId, ready: workspaceReady } = useWorkspace();
  const canManage = canManageTasks(membership) && canWrite;
  const canCreateTask = canWrite && (canManage || membership?.role === 'USER');
  const [activeTab, setActiveTab] = useState<TaskTab>('Today');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const selectedTaskId = searchParams.get('taskId');
  const taskDetails = useRecordDetails({ recordId: selectedTaskId, records: tasks, user, organizationId: currentOrganizationId, ready: workspaceReady, loadRecord: getTaskById });
  const closeTaskDetails = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('taskId');
    router.replace(`/tasks${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const displayedError = actionError || tasksError;
  const canActOnTask = (task: Task) => canManage || (membership?.role === 'USER' && task.assignedToUid === user?.uid);

  const getTaskFilters = useCallback(() => {
    const status = activeTab === 'Completed' ? 'Completed' : activeTab === 'All' || activeTab === 'Follow-ups' ? 'All' : 'Pending';
    const due = activeTab === 'Today' || activeTab === 'Upcoming' || activeTab === 'Overdue' ? activeTab : 'All';
    return { status, due, type: activeTab === 'Follow-ups' ? 'Follow-up' : 'All' } as const;
  }, [activeTab]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchParams.get('taskId')) setActiveTab('All');
      if (searchParams.get('action') === 'create' && canCreateTask) {
        setEditingTask(null);
        setForm({ ...emptyForm, dueDate: currentDateTimeInput(), ...(user ? getDefaultAssignment(user) : {}) });
        setActionError(null);
        setShowModal(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canCreateTask, searchParams, user]);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const completed = task.status === 'Completed';
    const bucket = getTaskCalendarBucket(task.dueDate, new Date(currentTime));
    if (bucket === 'Invalid') return activeTab === 'All' || (activeTab === 'Completed' && completed);
    switch (activeTab) {
      case 'Today': return bucket === 'Today' && !completed;
      case 'Upcoming': return bucket === 'Upcoming' && !completed;
      case 'Overdue': return bucket === 'Overdue' && !completed;
      case 'Completed': return completed;
      default: return true;
    }
  }), [activeTab, currentTime, tasks]);

  const getRelatedName = (task: Task) => {
    if (!task.relatedTo) return 'General';
    const name = task.relatedTo.type === 'Lead' ? leads.find((lead) => lead.id === task.relatedTo?.id)?.name
      : task.relatedTo.type === 'Client' ? clients.find((client) => client.id === task.relatedTo?.id)?.name
        : deals.find((deal) => deal.id === task.relatedTo?.id)?.title;
    return name ? `${task.relatedTo.type}: ${name}` : `Open ${task.relatedTo.type}`;
  };

  const openCreate = () => { setEditingTask(null); setForm({ ...emptyForm, dueDate: currentDateTimeInput(), ...(user ? getDefaultAssignment(user) : {}) }); setActionError(null); setShowModal(true); };
  const openEdit = (task: Task) => { setEditingTask(task); setForm({ title: task.title, description: task.description || '', type: task.type || 'Follow-up', dueDate: toDateTimeInput(task.dueDate), priority: task.priority, assignedToUid: task.assignedToUid || task.assignedTo || '', assignedToName: task.assignedToName || task.assignedTo || '', relatedTo: task.relatedTo }); setActionError(null); setShowModal(true); };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateTask || !form.title.trim() || !form.dueDate) return;
    setSaving(true); setActionError(null);
    try { if (editingTask) await updateTask(editingTask.id, form); else await addTask(form); setShowModal(false); }
    catch (error) { console.error('Unable to save task', error); setActionError(userFacingErrorMessage(error, 'Unable to save the task. Please try again.')); }
    finally { setSaving(false); }
  };

  const handleComplete = async (task: Task) => {
    if (!canActOnTask(task) || busyTaskId) return;
    setBusyTaskId(task.id); setActionError(null);
    try { await completeTask(task.id); }
    catch (error) { console.error('Unable to update task status', error); setActionError(userFacingErrorMessage(error, 'Unable to update the task. Please try again.')); }
    finally { setBusyTaskId(null); }
  };

  const handleArchive = async (task: Task) => {
    if (!canActOnTask(task) || busyTaskId) return;
    setConfirmAction({ kind: 'archive', id: task.id, name: task.title });
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || confirmBusy) return;
    setConfirmBusy(true); setActionError(null);
    try {
      if (confirmAction.kind === 'archive') await archiveTask(confirmAction.id);
      else if (confirmAction.kind === 'restore') await restoreTask(confirmAction.id);
      else await permanentlyDeleteTask(confirmAction.id);
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete task lifecycle action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to complete the task action. Please try again.'));
    } finally { setConfirmBusy(false); }
  };

  const tabs: TaskTab[] = ['Today', 'Upcoming', 'Overdue', 'Completed', 'Follow-ups', 'All'];
  useEffect(() => {
    void refreshTasks(getTaskFilters());
  }, [getTaskFilters, refreshTasks]);
  return <div className="tasks-list-layout space-y-6">
    {displayedError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{displayedError}</p>}
    <PageHeader title="Tasks & Follow-ups" subtitle="Track operational follow-ups and due dates." actions={<><Button variant="outline" onClick={() => void refreshTasks(getTaskFilters())} disabled={tasksLoading} aria-label="Refresh tasks"><RefreshCw size={16} /> Refresh</Button><Button variant="outline" onClick={() => { const next = !showArchived; setShowArchived(next); if (next && archivedTasks.length === 0) void loadArchivedRecords(); }} aria-label={showArchived ? 'Show active tasks' : 'Show archived tasks'}><Archive size={16} /><span className="hidden md:inline">{showArchived ? 'Active Tasks' : 'Archived Tasks'}</span><span className="md:hidden">{showArchived ? 'Active' : 'Archive'}</span></Button>{canCreateTask && <Button onClick={openCreate} className="gap-2"><Plus size={18} /> Add Task</Button>}</>} />
    <MobileNavigationTabs activeKey={activeTab} className="task-tabs flex gap-6 border-b border-[var(--app-border)]" aria-label="Task views">{tabs.map((tab) => <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)} className={`border-b-2 pb-3 text-sm font-semibold ${activeTab === tab ? 'border-[var(--app-primary)] text-[var(--app-primary)]' : 'border-transparent text-[var(--app-muted)]'}`}>{tab}</button>)}</MobileNavigationTabs>
    {!showArchived && <Card className="overflow-hidden p-0">{tasksLoading ? <p className="p-10 text-center text-sm text-[var(--app-muted)]">Loading tasks…</p> : filteredTasks.length === 0 ? <p className="p-10 text-center text-sm text-[var(--app-muted)]">{tasksError ? 'Tasks could not be loaded.' : <>No tasks yet.<span className="mt-1 block text-xs font-normal text-[var(--app-tertiary)]">Add a task to track your next action.</span></>}</p> : <div className="overflow-x-auto"><ResponsiveTable columns={["Task", "Related", "Assigned to", "Due date", "Priority", "Status", "Actions"]} primaryColumn={0} summaryColumns={[3, 4, 5]} actionColumn={6} className="w-full min-w-[950px] text-left"><thead><tr className="border-b bg-[var(--app-surface-subtle)]"><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Task</th><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Related</th><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Assigned To</th><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Due Date</th><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Priority</th><th className="px-6 py-4 text-xs font-bold uppercase text-[var(--app-muted)]">Status</th><th className="px-6 py-4 text-right text-xs font-bold uppercase text-[var(--app-muted)]">Action</th></tr></thead><tbody className="divide-y divide-[var(--app-border-subtle)]">{filteredTasks.map((task) => { const dueTime = Date.parse(task.dueDate); const validDueDate = Number.isFinite(dueTime); const label = task.status === 'Completed' ? 'Completed' : validDueDate ? dueTime > currentTime ? 'Scheduled' : 'Overdue' : 'Pending'; return <tr key={task.id} className={selectedTaskId === task.id ? 'bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-surface-subtle)]'}><td className="px-6 py-4"><Link href={getDashboardRecordHref('Task', task.id)} className="inline-flex min-h-11 items-center rounded-lg font-semibold text-[var(--app-text)] hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]">{task.title}</Link><div className="text-xs text-[var(--app-muted)]">{task.description || '—'}</div></td><td className="px-6 py-4 text-sm text-[var(--app-muted)]">{getRelatedName(task)}</td><td className="px-6 py-4 text-sm text-[var(--app-muted)]">{task.assignedToName || task.assignedTo || 'Unassigned'}</td><td className="px-6 py-4 text-sm text-[var(--app-muted)]">{formatTaskDueDate(task.dueDate)}</td><td className="px-6 py-4"><Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'gray'}>{task.priority}</Badge></td><td className="px-6 py-4"><Badge variant={label === 'Completed' ? 'green' : label === 'Overdue' ? 'red' : 'blue'}>{label}</Badge></td><td className="px-6 py-4"><div className="flex justify-end gap-2">{canActOnTask(task) && <>{task.status !== 'Completed' && <IconActionButton icon={<Check size={15} />} label="Complete Task" variant="success" disabled={busyTaskId === task.id} onClick={() => void handleComplete(task)} />}{task.status === 'Completed' && <IconActionButton icon={<RotateCcw size={15} />} label="Reopen Task" disabled={busyTaskId === task.id} onClick={() => void handleComplete(task)} />}</>}{canActOnTask(task) && <><IconActionButton icon={<Pencil size={15} />} label="Edit Task" onClick={() => openEdit(task)} /><IconActionButton icon={<Trash2 size={15} />} label="Archive Task" variant="danger" disabled={busyTaskId === task.id} onClick={() => void handleArchive(task)} /></>}</div></td></tr>; })}</tbody></ResponsiveTable></div>}</Card>}
    {!showArchived && tasks.length > 0 && <LoadedListStatus loadedCount={tasks.length} visibleCount={filteredTasks.length} hasMore={tasksHasMore} noun="tasks" />}
    {!showArchived && tasksHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreTasks()} disabled={tasksLoading}>{tasksLoading ? 'Loading…' : 'Load More Tasks'}</Button></div>}
    {showArchived && <Card className="p-0"><div className="border-b bg-[var(--app-surface-subtle)] px-6 py-3 text-sm font-semibold text-[var(--app-text)]">Archived Tasks</div>{archivedTasks.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">No archived tasks.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{archivedTasks.map((task) => <div key={task.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-[var(--app-text)]">{task.title}</p><p className="text-sm text-[var(--app-muted)]">{formatTaskDueDate(task.dueDate)} · {task.status}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Task" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: task.id, name: task.title })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Delete Task permanently" variant="danger" onClick={() => setConfirmAction({ kind: "delete", id: task.id, name: task.title })} />}</div></div>)}</div>}{archivedTasksHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreArchivedTasks()}>Load More</Button></div>}</Card>}
    {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This task will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This task will be restored to the active list.' : 'This action cannot be undone. This archived task will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
    {selectedTaskId && (taskDetails.record
      ? <TaskDetailsModal task={taskDetails.record} relatedName={getRelatedName(taskDetails.record)} timezone={settings.timezone} onClose={closeTaskDetails} />
      : <RecordDetailsStatusDialog title="Task details" error={taskDetails.error} onClose={closeTaskDetails} onRetry={taskDetails.reload} />)}
    {showModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Task form"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><ModalHeader title={editingTask ? 'Edit Task' : 'Add Task'} onClose={() => setShowModal(false)} /><TaskFields form={form} setForm={setForm} leads={leads} clients={clients} deals={deals} users={users} usersLoading={usersLoading} canAssign={canManage && users.length > 1} /><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingTask ? 'Update Task' : 'Save Task'}</Button></div></form></div>}
  </div>;
}

function TaskFields({ form, setForm, leads, clients, deals, users, usersLoading, canAssign }: { form: TaskForm; setForm: React.Dispatch<React.SetStateAction<TaskForm>>; leads: { id: string; name: string }[]; clients: { id: string; name: string }[]; deals: { id: string; title: string }[]; users: { uid: string; name: string; role: string }[]; usersLoading: boolean; canAssign: boolean }) {
  const update = (values: Partial<TaskForm>) => setForm((current) => ({ ...current, ...values }));
  return <>
    <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Title<input required className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" value={form.title} onChange={(event) => update({ title: event.target.value })} /></label>
    <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Description<textarea className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" rows={3} value={form.description || ''} onChange={(event) => update({ description: event.target.value })} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Schedule Date &amp; Time<input required type="datetime-local" className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" value={toDateTimeInput(form.dueDate)} onChange={(event) => update({ dueDate: event.target.value })} /></label>
      <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Priority<select className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" value={form.priority} onChange={(event) => update({ priority: event.target.value as Task['priority'] })}><option>Low</option><option>Medium</option><option>High</option></select></label>
    </div>
    {canAssign ? <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Assigned To<select className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" value={form.assignedToUid} disabled={usersLoading} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); update({ assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{form.assignedToUid && !users.some((item) => item.uid === form.assignedToUid) && <option value={form.assignedToUid}>{form.assignedToName || 'Legacy assignee'}</option>}{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></label> : <div className="text-xs font-bold uppercase text-[var(--app-muted)]">Assigned To<div className="mt-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-4 py-2 text-sm font-normal normal-case text-[var(--app-text)]">{form.assignedToName || 'You'}</div></div>}
    <label className="block space-y-2 text-xs font-bold uppercase text-[var(--app-muted)]">Related Record<select className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm font-normal normal-case" value={relatedValue(form.relatedTo)} onChange={(event) => update({ relatedTo: parseRelated(event.target.value) })}><option value="">General task</option><optgroup label="Leads">{leads.map((lead) => <option key={`Lead:${lead.id}`} value={`Lead:${lead.id}`}>{lead.name}</option>)}</optgroup><optgroup label="Clients">{clients.map((client) => <option key={`Client:${client.id}`} value={`Client:${client.id}`}>{client.name}</option>)}</optgroup><optgroup label="Deals">{deals.map((deal) => <option key={`Deal:${deal.id}`} value={`Deal:${deal.id}`}>{deal.title}</option>)}</optgroup></select></label>
  </>;
}

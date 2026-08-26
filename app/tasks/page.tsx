'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { canManageTasks } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Task } from '@/types';
import { Check, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { format, isFuture, isPast, isToday } from 'date-fns';
import { getDefaultAssignment } from '@/lib/ownership';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { IconActionButton } from '@/components/IconActionButton';

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
  const { user } = useAuth();
  const { tasks, tasksLoading, tasksError, refreshTasks, loadMoreTasks, tasksHasMore, addTask, updateTask, completeTask, archiveTask, archivedTasks, loadArchivedRecords, loadMoreArchivedTasks, archivedTasksHasMore, restoreTask, permanentlyDeleteTask, leads, clients, deals, users, usersLoading } = useApp();
  const { membership, canWrite } = useWorkspace();
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

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
      const taskId = searchParams.get('taskId');
      const selectedTask = taskId ? tasks.find((task) => task.id === taskId) : undefined;
      setSelectedTaskId(selectedTask?.id || null);
      if (selectedTask) setActiveTab('All');
      if (searchParams.get('action') === 'create' && canCreateTask) {
        setEditingTask(null);
        setForm({ ...emptyForm, dueDate: currentDateTimeInput(), ...(user ? getDefaultAssignment(user) : {}) });
        setActionError(null);
        setShowModal(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canCreateTask, searchParams, tasks, user]);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const dueDate = new Date(task.dueDate);
    const completed = task.status === 'Completed';
    if (!Number.isFinite(dueDate.getTime())) return activeTab === 'All' || (activeTab === 'Completed' && completed);
    switch (activeTab) {
      case 'Today': return isToday(dueDate) && !completed;
      case 'Upcoming': return isFuture(dueDate) && !completed;
      case 'Overdue': return isPast(dueDate) && !completed && !isToday(dueDate);
      case 'Completed': return completed;
      default: return true;
    }
  }), [activeTab, tasks]);

  const getRelatedName = (task: Task) => {
    if (!task.relatedTo) return 'General';
    if (task.relatedTo.type === 'Lead') return `Lead: ${leads.find((lead) => lead.id === task.relatedTo?.id)?.name || 'Unknown'}`;
    if (task.relatedTo.type === 'Client') return `Client: ${clients.find((client) => client.id === task.relatedTo?.id)?.name || 'Unknown'}`;
    return `Deal: ${deals.find((deal) => deal.id === task.relatedTo?.id)?.title || 'Unknown'}`;
  };

  const openCreate = () => { setEditingTask(null); setForm({ ...emptyForm, dueDate: currentDateTimeInput(), ...(user ? getDefaultAssignment(user) : {}) }); setActionError(null); setShowModal(true); };
  const openEdit = (task: Task) => { setEditingTask(task); setForm({ title: task.title, description: task.description || '', type: task.type || 'Follow-up', dueDate: toDateTimeInput(task.dueDate), priority: task.priority, assignedToUid: task.assignedToUid || task.assignedTo || '', assignedToName: task.assignedToName || task.assignedTo || '', relatedTo: task.relatedTo }); setActionError(null); setShowModal(true); };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateTask || !form.title.trim() || !form.dueDate) return;
    setSaving(true); setActionError(null);
    try { if (editingTask) await updateTask(editingTask.id, form); else await addTask(form); setShowModal(false); }
    catch (error) { console.error('Unable to save task', error); setActionError(error instanceof Error ? error.message : 'Unable to save the task. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleComplete = async (task: Task) => {
    if (!canActOnTask(task) || busyTaskId) return;
    setBusyTaskId(task.id); setActionError(null);
    try { await completeTask(task.id); }
    catch (error) { console.error('Unable to update task status', error); setActionError(error instanceof Error ? error.message : 'Unable to update the task. Please try again.'); }
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
      setActionError(error instanceof Error ? error.message : 'Unable to complete the task action. Please try again.');
    } finally { setConfirmBusy(false); }
  };

  const tabs: TaskTab[] = ['Today', 'Upcoming', 'Overdue', 'Completed', 'Follow-ups', 'All'];
  useEffect(() => {
    void refreshTasks(getTaskFilters());
  }, [getTaskFilters, refreshTasks]);
  return <div className="space-y-6">
    {displayedError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{displayedError}</p>}
    <PageHeader title="Tasks & Follow-ups" subtitle="Track operational follow-ups and due dates." actions={<><Button variant="outline" onClick={() => void refreshTasks(getTaskFilters())} disabled={tasksLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button><Button variant="outline" onClick={() => { const next = !showArchived; setShowArchived(next); if (next && archivedTasks.length === 0) void loadArchivedRecords(); }}>{showArchived ? 'Active Tasks' : 'Archived Tasks'}</Button>{canCreateTask && <Button onClick={openCreate} className="gap-2"><Plus size={18} /> Add Task</Button>}</>} />
    <div className="flex gap-6 border-b border-slate-200">{tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`border-b-2 pb-3 text-sm font-semibold ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{tab}</button>)}</div>
    <Card className="overflow-hidden p-0">{tasksLoading ? <p className="p-10 text-center text-sm text-slate-500">Loading tasks…</p> : filteredTasks.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{tasksError ? 'Tasks could not be loaded.' : <>No tasks yet.<span className="mt-1 block text-xs font-normal text-slate-400">Add a task to track your next action.</span></>}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left"><thead><tr className="border-b bg-slate-50"><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Task</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Related</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Assigned To</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Due Date</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Priority</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Status</th><th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredTasks.map((task) => { const dueTime = Date.parse(task.dueDate); const validDueDate = Number.isFinite(dueTime); const label = task.status === 'Completed' ? 'Completed' : validDueDate ? dueTime > currentTime ? 'Scheduled' : 'Overdue' : 'Pending'; return <tr key={task.id} className={selectedTaskId === task.id ? 'bg-blue-50 hover:bg-blue-50' : 'hover:bg-slate-50'}><td className="px-6 py-4"><div className="font-semibold text-slate-900">{task.title}</div><div className="text-xs text-slate-500">{task.description || '—'}</div></td><td className="px-6 py-4 text-sm text-slate-600">{getRelatedName(task)}</td><td className="px-6 py-4 text-sm text-slate-600">{task.assignedToName || task.assignedTo || 'Unassigned'}</td><td className="px-6 py-4 text-sm text-slate-600">{formatTaskDueDate(task.dueDate)}</td><td className="px-6 py-4"><Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'gray'}>{task.priority}</Badge></td><td className="px-6 py-4"><Badge variant={label === 'Completed' ? 'green' : label === 'Overdue' ? 'red' : 'blue'}>{label}</Badge></td><td className="px-6 py-4"><div className="flex justify-end gap-2">{canActOnTask(task) && <>{task.status !== 'Completed' && <IconActionButton icon={<Check size={15} />} label="Complete Task" variant="success" disabled={busyTaskId === task.id} onClick={() => void handleComplete(task)} />}{task.status === 'Completed' && <IconActionButton icon={<RotateCcw size={15} />} label="Reopen Task" disabled={busyTaskId === task.id} onClick={() => void handleComplete(task)} />}</>}{canActOnTask(task) && <><IconActionButton icon={<Pencil size={15} />} label="Edit Task" onClick={() => openEdit(task)} /><IconActionButton icon={<Trash2 size={15} />} label="Archive Task" variant="danger" disabled={busyTaskId === task.id} onClick={() => void handleArchive(task)} /></>}</div></td></tr>; })}</tbody></table></div>}</Card>
    {tasksHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreTasks()} disabled={tasksLoading}>{tasksLoading ? 'Loading…' : 'Load More Tasks'}</Button></div>}
    {showArchived && <Card className="p-0"><div className="border-b bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700">Archived Tasks</div>{archivedTasks.length === 0 ? <p className="p-6 text-sm text-slate-500">No archived tasks.</p> : <div className="divide-y divide-slate-100">{archivedTasks.map((task) => <div key={task.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-slate-900">{task.title}</p><p className="text-sm text-slate-500">{formatTaskDueDate(task.dueDate)} · {task.status}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Task" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: task.id, name: task.title })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Delete Task permanently" variant="danger" onClick={() => setConfirmAction({ kind: "delete", id: task.id, name: task.title })} />}</div></div>)}</div>}{archivedTasksHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreArchivedTasks()}>Load More</Button></div>}</Card>}
    {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This task will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This task will be restored to the active list.' : 'This action cannot be undone. This archived task will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
    {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">{editingTask ? 'Edit Task' : 'Add Task'}</h3><TaskFields form={form} setForm={setForm} leads={leads} clients={clients} deals={deals} users={users} usersLoading={usersLoading} canAssign={canManage && users.length > 1} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingTask ? 'Update Task' : 'Save Task'}</Button></div></form></div>}
  </div>;
}

function TaskFields({ form, setForm, leads, clients, deals, users, usersLoading, canAssign }: { form: TaskForm; setForm: React.Dispatch<React.SetStateAction<TaskForm>>; leads: { id: string; name: string }[]; clients: { id: string; name: string }[]; deals: { id: string; title: string }[]; users: { uid: string; name: string; role: string }[]; usersLoading: boolean; canAssign: boolean }) {
  const update = (values: Partial<TaskForm>) => setForm((current) => ({ ...current, ...values }));
  return <><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Title</label><input required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.title} onChange={(event) => update({ title: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Description</label><textarea className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" rows={3} value={form.description || ''} onChange={(event) => update({ description: event.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Schedule Date &amp; Time</label><input required type="datetime-local" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={toDateTimeInput(form.dueDate)} onChange={(event) => update({ dueDate: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Priority</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.priority} onChange={(event) => update({ priority: event.target.value as Task['priority'] })}><option>Low</option><option>Medium</option><option>High</option></select></div></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Assigned To</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.assignedToUid} disabled={usersLoading} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); update({ assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{form.assignedToUid && !users.some((item) => item.uid === form.assignedToUid) && <option value={form.assignedToUid}>{form.assignedToName || "Legacy assignee"}</option>}{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Related Record</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={relatedValue(form.relatedTo)} onChange={(event) => update({ relatedTo: parseRelated(event.target.value) })}><option value="">General task</option><optgroup label="Leads">{leads.map((lead) => <option key={`Lead:${lead.id}`} value={`Lead:${lead.id}`}>{lead.name}</option>)}</optgroup><optgroup label="Clients">{clients.map((client) => <option key={`Client:${client.id}`} value={`Client:${client.id}`}>{client.name}</option>)}</optgroup><optgroup label="Deals">{deals.map((deal) => <option key={`Deal:${deal.id}`} value={`Deal:${deal.id}`}>{deal.title}</option>)}</optgroup></select></div></>;
}

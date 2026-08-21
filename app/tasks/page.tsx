'use client';

import React, { useMemo, useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { canManageTasks } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Task } from '@/types';
import { Archive, Edit, Plus, RefreshCw } from 'lucide-react';
import { format, isFuture, isPast, isToday } from 'date-fns';
import { getDefaultAssignment } from '@/lib/ownership';

type TaskTab = 'Today' | 'Upcoming' | 'Overdue' | 'Completed' | 'All';
type TaskForm = Omit<Task, 'id' | 'status'>;
const emptyForm: TaskForm = { title: '', description: '', dueDate: '', priority: 'Medium', assignedToUid: '', assignedToName: '', relatedTo: undefined };

function toDateInput(value?: string) { return value ? value.slice(0, 10) : ''; }
function relatedValue(relatedTo?: Task['relatedTo']) { return relatedTo ? `${relatedTo.type}:${relatedTo.id}` : ''; }
function parseRelated(value: string): Task['relatedTo'] {
  if (!value) return undefined;
  const separator = value.indexOf(':');
  if (separator < 1) return undefined;
  return { type: value.slice(0, separator) as NonNullable<Task['relatedTo']>['type'], id: value.slice(separator + 1) };
}

export default function TasksPage() {
  const { user } = useAuth();
  const { tasks, tasksLoading, tasksError, refreshTasks, addTask, updateTask, completeTask, archiveTask, leads, clients, deals, users, usersLoading } = useApp();
  const { membership } = useWorkspace();
  const canManage = canManageTasks(membership);
  const [activeTab, setActiveTab] = useState<TaskTab>('Today');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const displayedError = actionError || tasksError;
  const canActOnTask = (task: Task) => canManage || (membership?.role === 'USER' && task.assignedToUid === user?.uid);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const dueDate = new Date(task.dueDate);
    const completed = task.status === 'Completed';
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

  const openCreate = () => { setEditingTask(null); setForm({ ...emptyForm, dueDate: new Date().toISOString().slice(0, 10), ...(user ? getDefaultAssignment(user) : {}) }); setActionError(null); setShowModal(true); };
  const openEdit = (task: Task) => { setEditingTask(task); setForm({ title: task.title, description: task.description || '', dueDate: toDateInput(task.dueDate), priority: task.priority, assignedToUid: task.assignedToUid || task.assignedTo || '', assignedToName: task.assignedToName || task.assignedTo || '', relatedTo: task.relatedTo }); setActionError(null); setShowModal(true); };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.title.trim() || !form.dueDate) return;
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
    setBusyTaskId(task.id); setActionError(null);
    try { await archiveTask(task.id); }
    catch (error) { console.error('Unable to archive task', error); setActionError(error instanceof Error ? error.message : 'Unable to archive the task. Please try again.'); }
    finally { setBusyTaskId(null); }
  };

  const tabs: TaskTab[] = ['Today', 'Upcoming', 'Overdue', 'Completed', 'All'];
  return <div className="space-y-6">
    {displayedError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{displayedError}</p>}
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold text-slate-900">Tasks & Follow-ups</h2><p className="text-sm text-slate-500">Track operational follow-ups and due dates.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void refreshTasks()} disabled={tasksLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>{canManage && <Button onClick={openCreate} className="gap-2"><Plus size={18} /> Add Task</Button>}</div></div>
    <div className="flex gap-6 border-b border-slate-200">{tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`border-b-2 pb-3 text-sm font-semibold ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{tab}</button>)}</div>
    <Card className="overflow-hidden p-0">{tasksLoading ? <p className="p-10 text-center text-sm text-slate-500">Loading tasks…</p> : filteredTasks.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{tasksError ? 'Tasks could not be loaded.' : 'No tasks found.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left"><thead><tr className="border-b bg-slate-50"><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Task</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Related</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Assigned To</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Due Date</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Priority</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Status</th><th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredTasks.map((task) => <tr key={task.id} className="hover:bg-slate-50"><td className="px-6 py-4"><div className="font-semibold text-slate-900">{task.title}</div><div className="text-xs text-slate-500">{task.description || '—'}</div></td><td className="px-6 py-4 text-sm text-slate-600">{getRelatedName(task)}</td><td className="px-6 py-4 text-sm text-slate-600">{task.assignedToName || task.assignedTo || 'Unassigned'}</td><td className="px-6 py-4 text-sm text-slate-600">{format(new Date(task.dueDate), 'MMM d, yyyy')}</td><td className="px-6 py-4"><Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'gray'}>{task.priority}</Badge></td><td className="px-6 py-4"><Badge variant={task.status === 'Completed' ? 'green' : 'blue'}>{task.status}</Badge></td><td className="px-6 py-4"><div className="flex justify-end gap-2">{canActOnTask(task) && task.status !== 'Completed' && <Button size="sm" variant="outline" disabled={busyTaskId === task.id} onClick={() => void handleComplete(task)}>Complete</Button>}{canActOnTask(task) && <><Button size="sm" variant="outline" onClick={() => openEdit(task)} className="gap-1"><Edit size={14} /> Edit</Button><Button size="sm" variant="outline" disabled={busyTaskId === task.id} onClick={() => void handleArchive(task)} className="gap-1 text-red-600"><Archive size={14} /> Archive</Button></>}</div></td></tr>)}</tbody></table></div>}</Card>
    {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">{editingTask ? 'Edit Task' : 'Add Task'}</h3><TaskFields form={form} setForm={setForm} leads={leads} clients={clients} deals={deals} users={users} usersLoading={usersLoading} canAssign={canManage && users.length > 1} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingTask ? 'Update Task' : 'Save Task'}</Button></div></form></div>}
  </div>;
}

function TaskFields({ form, setForm, leads, clients, deals, users, usersLoading, canAssign }: { form: TaskForm; setForm: React.Dispatch<React.SetStateAction<TaskForm>>; leads: { id: string; name: string }[]; clients: { id: string; name: string }[]; deals: { id: string; title: string }[]; users: { uid: string; name: string; role: string }[]; usersLoading: boolean; canAssign: boolean }) {
  const update = (values: Partial<TaskForm>) => setForm((current) => ({ ...current, ...values }));
  return <><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Title</label><input required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.title} onChange={(event) => update({ title: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Description</label><textarea className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" rows={3} value={form.description || ''} onChange={(event) => update({ description: event.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Due Date</label><input required type="date" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={toDateInput(form.dueDate)} onChange={(event) => update({ dueDate: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Priority</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.priority} onChange={(event) => update({ priority: event.target.value as Task['priority'] })}><option>Low</option><option>Medium</option><option>High</option></select></div></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Assigned To</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.assignedToUid} disabled={usersLoading} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); update({ assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{form.assignedToUid && !users.some((item) => item.uid === form.assignedToUid) && <option value={form.assignedToUid}>{form.assignedToName || "Legacy assignee"}</option>}{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Related Record</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={relatedValue(form.relatedTo)} onChange={(event) => update({ relatedTo: parseRelated(event.target.value) })}><option value="">General task</option><optgroup label="Leads">{leads.map((lead) => <option key={`Lead:${lead.id}`} value={`Lead:${lead.id}`}>{lead.name}</option>)}</optgroup><optgroup label="Clients">{clients.map((client) => <option key={`Client:${client.id}`} value={`Client:${client.id}`}>{client.name}</option>)}</optgroup><optgroup label="Deals">{deals.map((deal) => <option key={`Deal:${deal.id}`} value={`Deal:${deal.id}`}>{deal.title}</option>)}</optgroup></select></div></>;
}

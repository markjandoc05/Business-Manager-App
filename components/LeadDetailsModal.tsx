'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, NotebookPen, Phone } from 'lucide-react';
import { Button, Card, Badge } from '@/components/ui/core';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { TaskCard } from '@/components/TaskCard';
import { completeLeadTimelineActivity, createLeadTimelineEntry, listLeadTimeline, type LeadTimelineCursor } from '@/lib/repositories/leadTimeline';
import type { AppUser } from '@/types/auth';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import type { Lead, LeadActivityType, LeadTimelineEntry, Task } from '@/types';

const activityTypes: LeadActivityType[] = ['Call', 'Email', 'Meeting', 'Follow-up', 'Message', 'Other'];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown date';
}

function currentDateTimeValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function LeadDetailsModal({ lead, user, organizationId, canWrite, tasks, tasksLoading, tasksError, onLoadTasks, onAddTask, onCompleteTask, timezone, onClose }: { lead: Lead; user: AppUser; organizationId: string; canWrite: boolean; tasks: Task[]; tasksLoading: boolean; tasksError: string | null; onLoadTasks: (leadId: string) => Promise<void>; onAddTask: (task: { title: string; description: string; type: 'Follow-up'; dueDate: string; priority: 'Medium'; relatedTo: { type: 'Lead'; id: string } }) => Promise<void>; onCompleteTask: (taskId: string) => Promise<void>; timezone?: string; onClose: () => void }) {
  const [entries, setEntries] = useState<LeadTimelineEntry[]>([]);
  const [cursor, setCursor] = useState<LeadTimelineCursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formType, setFormType] = useState<'ACTIVITY' | 'NOTE' | null>(null);
  const [activityType, setActivityType] = useState<LeadActivityType>('Call');
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(currentDateTimeValue);
  const [saving, setSaving] = useState(false);
  const [completingEntryId, setCompletingEntryId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLeadTimeline(user, organizationId, lead.id)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setCursor(result.nextCursor);
        setHasMore(result.nextCursor !== null);
      })
      .catch((loadError) => {
        console.error('Unable to load lead timeline', loadError);
        if (!cancelled) setError('Unable to load activity and notes. Please try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lead.id, organizationId, user]);

  useEffect(() => {
    void onLoadTasks(lead.id);
  }, [lead.id, onLoadTasks]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listLeadTimeline(user, organizationId, lead.id, cursor);
      setEntries((current) => [...current, ...result.entries]);
      setCursor(result.nextCursor);
      setHasMore(result.nextCursor !== null);
    } catch (loadError) {
      console.error('Unable to load more lead timeline entries', loadError);
      setError('Unable to load more timeline entries. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const closeForm = () => {
    setFormType(null);
    setContent('');
    setActivityType('Call');
    setOccurredAt(currentDateTimeValue());
  };

  const saveEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!formType || saving || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (formType === 'ACTIVITY' && activityIsScheduled) {
        await onAddTask({ title: content.trim(), description: '', type: 'Follow-up', dueDate: new Date(occurredAt).toISOString(), priority: 'Medium', relatedTo: { type: 'Lead', id: lead.id } });
        closeForm();
        return;
      }
      const entry = await createLeadTimelineEntry(user, organizationId, lead.id, {
        entryType: formType,
        ...(formType === 'ACTIVITY' ? { activityType } : {}),
        content,
        occurredAt: formType === 'ACTIVITY' ? new Date(occurredAt) : new Date(),
      });
      setEntries((current) => [entry, ...current]);
      closeForm();
    } catch (saveError) {
      console.error('Unable to save lead timeline entry', saveError);
      setError(userFacingErrorMessage(saveError, 'Unable to save the timeline entry. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const activityIsScheduled = formType === 'ACTIVITY' && Number.isFinite(new Date(occurredAt).getTime()) && new Date(occurredAt).getTime() > currentTime;

  const leadTasks = tasks.filter((task) => task.relatedTo?.type === 'Lead' && task.relatedTo.id === lead.id && !task.archived);
  const openTasks = leadTasks.filter((task) => task.status === 'Pending');
  const completedTasks = leadTasks.filter((task) => task.status === 'Completed');
  const completeTask = async (taskId: string) => {
    if (completingTaskId) return;
    setCompletingTaskId(taskId);
    setError(null);
    try {
      await onCompleteTask(taskId);
    } catch (completionError) {
      console.error('Unable to complete Lead task', completionError);
      setError(userFacingErrorMessage(completionError, 'Unable to update the task. Please try again.'));
    } finally {
      setCompletingTaskId(null);
    }
  };

  const completeActivity = async (entry: LeadTimelineEntry) => {
    if (completingEntryId) return;
    setCompletingEntryId(entry.id);
    setError(null);
    try {
      const completed = await completeLeadTimelineActivity(user, organizationId, lead.id, entry.id);
      setEntries((current) => current.map((item) => item.id === completed.id ? completed : item));
    } catch (completionError) {
      console.error('Unable to complete lead activity', completionError);
      setError(userFacingErrorMessage(completionError, 'Unable to mark the activity complete. Please try again.'));
    } finally {
      setCompletingEntryId(null);
    }
  };

  return <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label={`Lead details for ${lead.name}`}>
    <Card className="app-modal-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-0">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--app-border)] p-4 sm:p-5">
        <div className="min-w-0"><h3 className="break-words text-xl font-bold text-[var(--app-text)]">{lead.name}</h3><p className="text-sm text-[var(--app-muted)]">Lead Details</p></div>
        <ModalCloseButton onClose={onClose} />
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--app-surface-subtle)] p-4 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-[var(--app-muted)]">Status</p><Badge variant={lead.status === 'Lost' ? 'red' : lead.status === 'Client' ? 'green' : 'blue'}>{lead.status === 'Client' ? 'Converted' : lead.status}</Badge></div>
          <div><p className="text-xs text-[var(--app-muted)]">Company</p><p className="font-medium text-[var(--app-text)]">{lead.company || '-'}</p></div>
          <div><p className="text-xs text-[var(--app-muted)]">Email</p><p className="truncate font-medium text-[var(--app-text)]">{lead.email}</p></div>
          <div><p className="text-xs text-[var(--app-muted)]">Phone</p><p className="font-medium text-[var(--app-text)]">{lead.phone || '-'}</p></div>
        </div>

        <section aria-labelledby="lead-activity-notes-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 id="lead-activity-notes-heading" className="text-lg font-bold text-[var(--app-text)]">Activity &amp; Notes</h4><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!canWrite} onClick={() => setFormType('ACTIVITY')} className="gap-1"><Phone size={14} /> + Add Activity</Button><Button size="sm" variant="outline" disabled={!canWrite} onClick={() => setFormType('NOTE')} className="gap-1"><NotebookPen size={14} /> + Add Note</Button></div></div>
          {error && <p className="mb-3 rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
          {formType && <form onSubmit={saveEntry} className="mb-4 space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-accent-soft)]/50 p-4">
            {formType === 'ACTIVITY' && <><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium text-[var(--app-text)]">Activity Type<select className="mt-1 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 font-normal" value={activityType} onChange={(event) => setActivityType(event.target.value as LeadActivityType)}>{activityTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="space-y-1 text-sm font-medium text-[var(--app-text)]">Activity Date &amp; Time<input type="datetime-local" className="mt-1 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 font-normal" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label></div><p className="text-xs font-medium text-[var(--app-muted)]">{activityIsScheduled ? 'This activity will be scheduled.' : 'This activity will be logged as completed.'}</p></>}
            <label className="block space-y-1 text-sm font-medium text-[var(--app-text)]">{formType === 'ACTIVITY' ? 'Short Description' : 'Note'}<textarea className="mt-1 min-h-20 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 font-normal" value={content} onChange={(event) => setContent(event.target.value)} placeholder={formType === 'ACTIVITY' ? 'What happened?' : 'Write a note...'} required /></label>
            <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={closeForm}>Cancel</Button><Button type="submit" size="sm" disabled={saving || !content.trim()}>{saving ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving…</> : 'Save'}</Button></div>
          </form>}
          {loading ? <p className="py-8 text-center text-sm text-[var(--app-muted)]">Loading timeline…</p> : entries.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">No activity or notes yet.</p> : <div className="space-y-3">{entries.map((entry) => { const scheduled = entry.entryType === 'ACTIVITY' && entry.activityStatus === 'SCHEDULED'; const overdue = scheduled && new Date(entry.occurredAt).getTime() <= currentTime; const completed = entry.entryType === 'ACTIVITY' && entry.activityStatus === 'COMPLETED'; return <div key={entry.id} className="rounded-xl border border-[var(--app-border)] p-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{entry.entryType === 'ACTIVITY' ? entry.activityType : entry.entryType}</span>{scheduled && <Badge variant={overdue ? 'red' : 'blue'}>{overdue ? 'Overdue' : 'Scheduled'}</Badge>}{completed && <Badge variant="green">Completed</Badge>}<span className="text-xs text-[var(--app-tertiary)]">{overdue ? `Was scheduled for ${formatDate(entry.occurredAt)}` : scheduled ? `Scheduled for ${formatDate(entry.occurredAt)}` : formatDate(entry.occurredAt)}</span></div><p className="mt-2 text-sm text-[var(--app-text)]">{entry.content}</p><p className="mt-2 text-xs text-[var(--app-muted)]">{entry.createdByName}</p>{scheduled && <Button size="sm" variant="outline" className="mt-3" disabled={!canWrite || completingEntryId === entry.id} onClick={() => void completeActivity(entry)}>{completingEntryId === entry.id ? 'Completing…' : 'Mark Complete'}</Button>}</div>; })}</div>}
          {hasMore && <div className="mt-4 text-center"><Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load More'}</Button></div>}
        </section>

        <section aria-labelledby="lead-tasks-heading">
          <div className="mb-3 flex items-center justify-between gap-2"><div><h4 id="lead-tasks-heading" className="text-lg font-bold text-[var(--app-text)]">Tasks</h4><p className="text-xs text-[var(--app-muted)]">Related to: this Lead</p></div><span className="text-xs text-[var(--app-muted)]">{openTasks.length} Open</span></div>
          {tasksError && <p className="mb-3 rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{tasksError}</p>}
          {tasksLoading ? <p className="py-8 text-center text-sm text-[var(--app-muted)]">Loading tasks…</p> : openTasks.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">No open tasks for this lead.</p> : <div className="space-y-2">{openTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} timezone={timezone} canManage={canWrite} busy={completingTaskId === task.id} onToggle={(taskId) => void completeTask(taskId)} />)}</div>}
          {completedTasks.length > 0 && <details className="mt-5 rounded-xl border border-[var(--app-border-subtle)] p-3"><summary className="cursor-pointer text-sm font-semibold text-[var(--app-muted)]">Completed ({completedTasks.length})</summary><div className="mt-3 space-y-2">{completedTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} timezone={timezone} canManage={canWrite} busy={completingTaskId === task.id} onToggle={(taskId) => void completeTask(taskId)} />)}</div></details>}
        </section>
      </div>
    </Card>
  </div>;
}

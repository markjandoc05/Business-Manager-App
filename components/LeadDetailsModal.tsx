'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, NotebookPen, Phone, X } from 'lucide-react';
import { Button, Card, Badge } from '@/components/ui/core';
import { createLeadTimelineEntry, listLeadTimeline, type LeadTimelineCursor } from '@/lib/repositories/leadTimeline';
import type { AppUser } from '@/types/auth';
import type { Lead, LeadActivityType, LeadTimelineEntry } from '@/types';

const activityTypes: LeadActivityType[] = ['Call', 'Email', 'Meeting', 'Follow-up', 'Message', 'Other'];

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function currentDateTimeValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function LeadDetailsModal({ lead, user, organizationId, onClose }: { lead: Lead; user: AppUser; organizationId: string; onClose: () => void }) {
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
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the timeline entry. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Lead details for ${lead.name}`}>
    <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-0">
      <div className="flex items-start justify-between border-b border-slate-200 p-5">
        <div><h3 className="text-xl font-bold text-slate-900">{lead.name}</h3><p className="text-sm text-slate-500">Lead Details</p></div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close lead details"><X size={18} /></Button>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">Status</p><Badge variant={lead.status === 'Lost' ? 'red' : lead.status === 'Client' ? 'green' : 'blue'}>{lead.status === 'Client' ? 'Converted' : lead.status}</Badge></div>
          <div><p className="text-xs text-slate-500">Company</p><p className="font-medium text-slate-900">{lead.company || '-'}</p></div>
          <div><p className="text-xs text-slate-500">Email</p><p className="truncate font-medium text-slate-900">{lead.email}</p></div>
          <div><p className="text-xs text-slate-500">Phone</p><p className="font-medium text-slate-900">{lead.phone || '-'}</p></div>
        </div>

        <section aria-labelledby="lead-activity-notes-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 id="lead-activity-notes-heading" className="text-lg font-bold text-slate-900">Activity &amp; Notes</h4><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setFormType('ACTIVITY')} className="gap-1"><Phone size={14} /> + Add Activity</Button><Button size="sm" variant="outline" onClick={() => setFormType('NOTE')} className="gap-1"><NotebookPen size={14} /> + Add Note</Button></div></div>
          {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
          {formType && <form onSubmit={saveEntry} className="mb-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            {formType === 'ACTIVITY' && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium text-slate-700">Activity Type<select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" value={activityType} onChange={(event) => setActivityType(event.target.value as LeadActivityType)}>{activityTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="space-y-1 text-sm font-medium text-slate-700">Date/Time<input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label></div>}
            <label className="block space-y-1 text-sm font-medium text-slate-700">{formType === 'ACTIVITY' ? 'Short Description' : 'Note'}<textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" value={content} onChange={(event) => setContent(event.target.value)} placeholder={formType === 'ACTIVITY' ? 'What happened?' : 'Write a note...'} required /></label>
            <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={closeForm}>Cancel</Button><Button type="submit" size="sm" disabled={saving || !content.trim()}>{saving ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving…</> : 'Save'}</Button></div>
          </form>}
          {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading timeline…</p> : entries.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No activity or notes yet.</p> : <div className="space-y-3">{entries.map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{entry.entryType === 'ACTIVITY' ? entry.activityType : entry.entryType}</span><span className="text-xs text-slate-400">{formatDate(entry.occurredAt)}</span></div><p className="mt-2 text-sm text-slate-800">{entry.content}</p><p className="mt-2 text-xs text-slate-500">{entry.createdByName}</p></div>)}</div>}
          {hasMore && <div className="mt-4 text-center"><Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load More'}</Button></div>}
        </section>
      </div>
    </Card>
  </div>;
}

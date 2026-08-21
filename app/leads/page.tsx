'use client';

import React, { useEffect, useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { Search, Filter, Plus, Mail, Phone, Edit, Archive, RefreshCw, UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageLeads } from '@/lib/permissions';
import { archiveLead, convertLeadToClient, createLead, listLeads, updateLead, updateLeadStatus } from '@/lib/repositories/leads';
import type { Lead, LeadStatus } from '@/types';

const statuses: LeadStatus[] = ['New', 'Follow-up', 'Opportunity', 'Client', 'Lost'];

type LeadForm = { name: string; email: string; phone: string; company: string; source: string; assignedTo: string };
const emptyForm: LeadForm = { name: '', email: '', phone: '', company: '', source: 'Website', assignedTo: '' };

export default function LeadsPage() {
  const { user } = useAuth();
  const canManage = canManageLeads(user);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [editForm, setEditForm] = useState<LeadForm>(emptyForm);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const loadedLeads = await listLeads(user);
        if (!cancelled) setLeads(loadedLeads);
      } catch (loadError) {
        console.error('Unable to load leads', loadError);
        if (!cancelled) setError('Unable to load leads. Please check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [user]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try { setLeads(await listLeads(user)); }
    catch (loadError) { console.error('Unable to refresh leads', loadError); setError('Unable to refresh leads. Please try again.'); }
    finally { setLoading(false); }
  };

  const visibleLeads = leads.filter((lead) => !lead.archived);
  const filteredLeads = visibleLeads.filter((lead) => lead.name.toLowerCase().includes(searchTerm.toLowerCase()) || lead.email.toLowerCase().includes(searchTerm.toLowerCase()) || lead.company?.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canManage || !form.name || !form.email) return;
    setSaving(true); setError(null);
    try { const lead = await createLead(user, form); setLeads((current) => [lead, ...current]); setForm(emptyForm); setShowAddModal(false); }
    catch (saveError) { console.error('Unable to create lead', saveError); setError('Unable to save the lead. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canManage || !selectedLead) return;
    setSaving(true); setError(null);
    try {
      await updateLead(user, selectedLead.id, editForm);
      setLeads((current) => current.map((lead) => lead.id === selectedLead.id ? { ...lead, ...editForm, updatedAt: new Date().toISOString() } : lead));
      setShowEditModal(false);
    } catch (saveError) { console.error('Unable to update lead', saveError); setError('Unable to update the lead. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (lead: Lead, status: LeadStatus) => {
    if (!user || !canManage || busyLeadId || status === lead.status) return;
    setBusyLeadId(lead.id); setError(null);
    try {
      if (status === 'Client') {
        const result = await convertLeadToClient(user, lead);
        setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status: 'Client', convertedClientId: result.clientId, updatedAt: new Date().toISOString() } : item));
      } else {
        await updateLeadStatus(user, lead, status);
        setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
      }
    } catch (statusError) { console.error('Unable to update lead status', statusError); setError(status === 'Client' ? 'Unable to convert the lead. It may already have been converted.' : 'Unable to update the lead status. Please try again.'); }
    finally { setBusyLeadId(null); }
  };

  const handleArchive = async (lead: Lead) => {
    if (!user || !canManage || busyLeadId) return;
    setBusyLeadId(lead.id); setError(null);
    try { await archiveLead(user, lead.id); setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, archived: true, updatedAt: new Date().toISOString() } : item)); }
    catch (archiveError) { console.error('Unable to archive lead', archiveError); setError('Unable to archive the lead. Please try again.'); }
    finally { setBusyLeadId(null); }
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-bold tracking-tight text-slate-900">Leads</h2><p className="text-sm text-slate-500">Manage prospects and conversion status.</p></div>{canManage && <Button onClick={() => setShowAddModal(true)} className="gap-2"><Plus size={18} /> Add New Lead</Button>}</div>
      <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><input type="text" placeholder="Search leads..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div><div className="flex gap-2"><Button variant="outline" className="gap-2"><Filter size={18} /> Filter</Button><Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2"><RefreshCw size={16} /> Refresh</Button></div></Card>
      <Card className="overflow-hidden p-0">
        {loading ? <p className="p-10 text-center text-sm text-slate-500">Loading leads…</p> : filteredLeads.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{error ? 'Leads could not be loaded.' : 'No active leads found.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left"><thead><tr className="border-b border-slate-200 bg-slate-50"><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Lead Name</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Status</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Company</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Source</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Created</th><th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLeads.map((lead) => <tr key={lead.id} className="transition-colors hover:bg-slate-50"><td className="px-6 py-4"><p className="font-semibold text-slate-900">{lead.name}</p><div className="mt-1 flex items-center gap-3"><span className="flex items-center gap-1 text-xs text-slate-500"><Mail size={12} /> {lead.email}</span><span className="flex items-center gap-1 text-xs text-slate-500"><Phone size={12} /> {lead.phone}</span></div></td><td className="px-6 py-4"><select aria-label={`Status for ${lead.name}`} value={lead.status} disabled={!canManage || busyLeadId === lead.id || lead.status === 'Client'} onChange={(event) => void handleStatusChange(lead, event.target.value as LeadStatus)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100">{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></td><td className="px-6 py-4 text-sm text-slate-600">{lead.company || '-'}</td><td className="px-6 py-4 text-sm text-slate-600">{lead.source}</td><td className="px-6 py-4 text-sm text-slate-600">{new Date(lead.createdAt).toLocaleDateString()}</td><td className="px-6 py-4 text-right"><div className="flex justify-end gap-2">{canManage && <><Button size="sm" variant="outline" onClick={() => { setSelectedLead(lead); setEditForm({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company || '', source: lead.source, assignedTo: lead.assignedTo || '' }); setShowEditModal(true); }} className="gap-1"><Edit size={14} /> Edit</Button><Button size="sm" variant="outline" disabled={busyLeadId === lead.id} onClick={() => void handleArchive(lead)} className="gap-1 text-red-600"><Archive size={14} /> Archive</Button></>}{lead.status !== 'Client' && canManage && <Button size="sm" onClick={() => void handleStatusChange(lead, 'Client')} className="gap-1"><UserPlus size={14} /> Convert</Button>}</div></td></tr>)}</tbody></table></div>}
      </Card>
      {showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Add New Lead</h3><LeadFields form={form} setForm={setForm} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Lead'}</Button></div></form></div>}
      {showEditModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleEdit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Edit Lead</h3><LeadFields form={editForm} setForm={setEditForm} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update Lead'}</Button></div></form></div>}
    </div>
  );
}

function LeadFields({ form, setForm }: { form: LeadForm; setForm: React.Dispatch<React.SetStateAction<LeadForm>> }) {
  return <><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Full Name</label><input type="text" required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Email</label><input type="email" required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Phone</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Company</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Source</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></div></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Assigned To</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} /></div></>;
}

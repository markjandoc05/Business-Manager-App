'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { Search, Filter, Plus, Mail, Phone, Edit, Archive, RefreshCw, UserPlus, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canManageLeads } from '@/lib/permissions';
import { archiveLead, createLead, updateLead, updateLeadStatus } from '@/lib/repositories/leads';
import type { Lead, LeadStatus } from '@/types';
import { getDefaultAssignment } from '@/lib/ownership';
import { LeadDetailsModal } from '@/components/LeadDetailsModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { useWorkspace } from '@/context/WorkspaceContext';

const statuses: LeadStatus[] = ['New', 'Follow-up', 'Opportunity', 'Lost'];

type LeadForm = { name: string; email: string; phone: string; company: string; source: string; assignedToUid: string; assignedToName: string };
const emptyForm: LeadForm = { name: '', email: '', phone: '', company: '', source: 'Website', assignedToUid: '', assignedToName: '' };

export default function LeadsPage() {
  const { user } = useAuth();
  const { leads, leadsLoading, leadsError, refreshLeads, convertLeadToClient, users, usersLoading, settings, archivedLeads, loadArchivedRecords, restoreLead, permanentlyDeleteLead } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganizationId, loading: workspaceLoading, ready: workspaceReady, membership } = useWorkspace();
  const canManage = canManageLeads(membership);
  const canEditLead = (lead: Lead) => canManage || (membership?.role === 'USER' && lead.assignedToUid === user?.uid);
  const loading = leadsLoading;
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [editForm, setEditForm] = useState<LeadForm>(emptyForm);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError || leadsError;
  const [saving, setSaving] = useState(false);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'All'>('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [leadView, setLeadView] = useState<'All' | 'Active' | 'Converted' | 'Lost'>('All');
  const [showDetails, setShowDetails] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const openedQueryLeadRef = useRef<string | null>(null);

  useEffect(() => {
    if (leadsLoading) return;
    const timer = window.setTimeout(() => {
      const leadId = searchParams.get('leadId');
      if (!leadId) {
        openedQueryLeadRef.current = null;
        setShowDetails(false);
        return;
      }
      const lead = leads.find((item) => item.id === leadId);
      if (!lead) {
        openedQueryLeadRef.current = null;
        setShowDetails(false);
        return;
      }
      if (openedQueryLeadRef.current === leadId && showDetails) return;
      openedQueryLeadRef.current = leadId;
      setSelectedLead(lead);
      setShowDetails(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [leads, leadsLoading, searchParams, showDetails]);

  const openCreate = () => {
    if (!user || !workspaceReady || !currentOrganizationId) {
      setActionError(workspaceLoading ? 'Workspace is still loading. Please wait a moment and try again.' : 'No active organization is available. Please contact an administrator.');
      return;
    }
    setForm({ ...emptyForm, ...getDefaultAssignment(user) });
    setShowAddModal(true);
  };

  useEffect(() => {
    if (searchParams.get('action') !== 'create') return;
    const timer = window.setTimeout(() => {
      if (!user || !workspaceReady || !currentOrganizationId) {
        setActionError(workspaceLoading ? 'Workspace is still loading. Please wait a moment and try again.' : 'No active organization is available. Please contact an administrator.');
        return;
      }
      setForm({ ...emptyForm, ...getDefaultAssignment(user) });
      setShowAddModal(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentOrganizationId, searchParams, user, workspaceLoading, workspaceReady]);

  const refresh = async () => {
    setActionError(null);
    await refreshLeads();
  };

  const visibleLeads = leads.filter((lead) => !lead.archived);
  const activeSources = settings.leadSources.filter((source) => source.isActive).map((source) => source.name);
  const filteredLeads = visibleLeads.filter((lead) => {
    const query = searchTerm.toLowerCase();
    const matchesView = leadView === 'Active' ? ['New', 'Follow-up', 'Opportunity'].includes(lead.status) : leadView === 'Converted' ? lead.status === 'Client' : leadView === 'Lost' ? lead.status === 'Lost' : true;
    return matchesView && (!query || [lead.name, lead.email, lead.phone, lead.company || ''].some((value) => value.toLowerCase().includes(query)))
      && (statusFilter === 'All' || lead.status === statusFilter)
      && (sourceFilter === 'All' || lead.source === sourceFilter);
  });
  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archivedLeads.length === 0) void loadArchivedRecords();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canManage || !form.name || !form.email) return;
    if (workspaceLoading) { setActionError('Workspace is still loading. Please wait a moment and try again.'); return; }
    if (!workspaceReady || !currentOrganizationId) { setActionError('No active organization is available. Please contact an administrator.'); return; }
    setSaving(true); setActionError(null);
    try { await createLead(user, currentOrganizationId, form); await refreshLeads(); setForm({ ...emptyForm, ...getDefaultAssignment(user) }); setShowAddModal(false); }
    catch (saveError) { console.error('Unable to create lead', saveError); setActionError('Unable to save the lead. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !currentOrganizationId || !selectedLead || !canEditLead(selectedLead)) return;
    setSaving(true); setActionError(null);
    try {
      await updateLead(user, currentOrganizationId, selectedLead.id, editForm);
      await refreshLeads();
      setShowEditModal(false);
    } catch (saveError) { console.error('Unable to update lead', saveError); setActionError('Unable to update the lead. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (lead: Lead, status: LeadStatus) => {
    if (!user || !currentOrganizationId || !canEditLead(lead) || busyLeadId || status === lead.status) return;
    setBusyLeadId(lead.id); setActionError(null);
    try {
      if (status === 'Client') {
        await convertLeadToClient(lead.id);
      } else {
        await updateLeadStatus(user, currentOrganizationId, lead, status);
        await refreshLeads();
      }
    } catch (statusError) { console.error('Unable to update lead status', statusError); setActionError(status === 'Client' ? 'Unable to convert the lead. It may already have been converted.' : 'Unable to update the lead status. Please try again.'); }
    finally { setBusyLeadId(null); }
  };

  const handleArchive = async (lead: Lead) => {
    if (!user || !currentOrganizationId || !canEditLead(lead) || busyLeadId) return;
    setConfirmAction({ kind: 'archive', id: lead.id, name: lead.name });
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || confirmBusy || !user || !currentOrganizationId) return;
    setConfirmBusy(true);
    setActionError(null);
    try {
      if (confirmAction.kind === 'archive') {
        await archiveLead(user, currentOrganizationId, confirmAction.id);
        await refreshLeads();
      } else if (confirmAction.kind === 'restore') {
        await restoreLead(confirmAction.id);
      } else {
        await permanentlyDeleteLead(confirmAction.id);
      }
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete lead lifecycle action', error);
      setActionError(error instanceof Error ? error.message : 'Unable to complete the lead action. Please try again.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const openConvertedClient = (lead: Lead) => {
    if (lead.convertedClientId) router.push(`/clients?clientId=${encodeURIComponent(lead.convertedClientId)}`);
  };

  const openDetails = (lead: Lead) => {
    setSelectedLead(lead);
    setShowDetails(true);
  };

  const closeDetails = () => {
    setShowDetails(false);
    if (searchParams.get('leadId')) router.replace('/leads', { scroll: false });
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <PageHeader title="Leads & Prospects" subtitle="Track potential customers and sales opportunities." actions={<>{<Button variant="outline" onClick={toggleArchived}>{showArchived ? 'Active Leads' : 'Archived Leads'}</Button>}{canManage && <Button disabled={!workspaceReady} onClick={openCreate} className="gap-2"><Plus size={18} /> Add Lead</Button>}</>} />
      <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><input type="text" placeholder="Search leads..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div><div className="flex flex-wrap gap-2"><select aria-label="Lead view" className="rounded-lg border px-3 py-2 text-sm" value={leadView} onChange={(event) => setLeadView(event.target.value as typeof leadView)}><option>All</option><option>Active</option><option>Converted</option><option>Lost</option></select><Button variant="outline" onClick={() => setShowFilters((current) => !current)} className="gap-2"><Filter size={18} /> Filter</Button><Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2"><RefreshCw size={16} /> Refresh</Button></div>{showFilters && <div className="flex flex-wrap gap-2"><select className="rounded-lg border px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LeadStatus | 'All')}><option value="All">All statuses</option>{[...statuses, 'Client' as const].map((status) => <option key={status} value={status}>{status}</option>)}</select><select className="rounded-lg border px-3 py-2 text-sm" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="All">All sources</option>{activeSources.map((source) => <option key={source} value={source}>{source}</option>)}</select></div>}</Card>
      <Card className="overflow-hidden p-0">
        {(!workspaceReady || leadsLoading) ? <p className="p-10 text-center text-sm text-slate-500">{workspaceLoading ? 'Workspace is still loading…' : currentOrganizationId ? 'Loading leads…' : 'No active organization is available for Leads.'}</p> : filteredLeads.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{error ? 'Leads could not be loaded.' : searchTerm || leadView !== 'All' || statusFilter !== 'All' || sourceFilter !== 'All' ? 'No leads match your search or filters.' : 'No leads found.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left"><thead><tr className="border-b border-slate-200 bg-slate-50"><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Lead Name</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Status</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Company</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Source</th><th className="px-6 py-4 text-xs font-bold uppercase text-slate-500">Created</th><th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLeads.map((lead) => <tr key={lead.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select')) openDetails(lead); }} className="cursor-pointer transition-colors hover:bg-slate-50"><td className="px-6 py-4"><p className="font-semibold text-slate-900">{lead.name}</p><div className="mt-1 flex items-center gap-3"><span className="flex items-center gap-1 text-xs text-slate-500"><Mail size={12} /> {lead.email}</span><span className="flex items-center gap-1 text-xs text-slate-500"><Phone size={12} /> {lead.phone}</span><span className="text-xs text-slate-400">Assigned: {lead.assignedToName || lead.assignedTo || "Unassigned"}</span></div></td><td className="px-6 py-4">{lead.status === 'Client' ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Converted</span> : <select aria-label={`Status for ${lead.name}`} value={lead.status} disabled={!canEditLead(lead) || busyLeadId === lead.id} onChange={(event) => void handleStatusChange(lead, event.target.value as LeadStatus)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100">{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>}</td><td className="px-6 py-4 text-sm text-slate-600">{lead.company || '-'}</td><td className="px-6 py-4 text-sm text-slate-600">{lead.source}</td><td className="px-6 py-4 text-sm text-slate-600">{new Date(lead.createdAt).toLocaleDateString()}</td><td className="px-6 py-4 text-right"><div className="flex justify-end gap-2">{canEditLead(lead) && lead.status !== 'Client' && <Button size="sm" variant="outline" onClick={() => { setSelectedLead(lead); setEditForm({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company || '', source: lead.source, assignedToUid: lead.assignedToUid || lead.assignedTo || '', assignedToName: lead.assignedToName || lead.assignedTo || '' }); setShowEditModal(true); }} className="gap-1"><Edit size={14} /> Edit</Button>}{canEditLead(lead) && <Button size="sm" variant="outline" disabled={busyLeadId === lead.id} onClick={() => void handleArchive(lead)} className="gap-1 text-red-600"><Archive size={14} /> Archive</Button>}{lead.status === 'Client' && lead.convertedClientId && <Button size="sm" onClick={() => openConvertedClient(lead)} className="gap-1"><ExternalLink size={14} /> View Client</Button>}{lead.status !== 'Client' && canManage && <Button size="sm" onClick={() => void handleStatusChange(lead, 'Client')} className="gap-1"><UserPlus size={14} /> Convert</Button>}</div></td></tr>)}</tbody></table></div>}
      </Card>
      {showArchived && <Card className="p-0"><div className="border-b bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700">Archived Leads</div>{archivedLeads.length === 0 ? <p className="p-6 text-sm text-slate-500">No archived leads.</p> : <div className="divide-y divide-slate-100">{archivedLeads.map((lead) => <div key={lead.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-slate-900">{lead.name}</p><p className="text-sm text-slate-500">{lead.company || lead.email}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setConfirmAction({ kind: 'restore', id: lead.id, name: lead.name })}>Restore</Button>{canManage && <Button size="sm" variant="outline" className="text-red-600" onClick={() => setConfirmAction({ kind: 'delete', id: lead.id, name: lead.name })}>Delete permanently</Button>}</div></div>)}</div>}</Card>}
      {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This lead will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This lead will be restored to the active list.' : 'This action cannot be undone. This archived lead will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
      {leadView !== 'Active' && filteredLeads.some((lead) => lead.status === 'Client') && <Card className="p-4"><div className="space-y-2">{filteredLeads.filter((lead) => lead.status === 'Client').map((lead) => <div key={lead.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3"><div><p className="font-semibold text-slate-900">{lead.name}</p><p className="text-xs text-slate-500">{lead.convertedClientId ? 'Converted Client' : 'Converted — Client link unavailable'}</p></div><Button size="sm" onClick={() => openConvertedClient(lead)} disabled={!lead.convertedClientId}>View Client</Button></div>)}</div></Card>}
      {showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Add New Lead</h3><LeadFields form={form} setForm={setForm} users={users} usersLoading={usersLoading} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Lead'}</Button></div></form></div>}
      {showEditModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleEdit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Edit Lead</h3><LeadFields form={editForm} setForm={setEditForm} users={users} usersLoading={usersLoading} /><div className="flex justify-end gap-3 pt-4"><Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update Lead'}</Button></div></form></div>}
      {showDetails && selectedLead && user && currentOrganizationId && <LeadDetailsModal key={selectedLead.id} lead={selectedLead} user={user} organizationId={currentOrganizationId} onClose={closeDetails} />}
    </div>
  );
}

function LeadFields({ form, setForm, users, usersLoading, canAssign = users.length > 1 }: { form: LeadForm; setForm: React.Dispatch<React.SetStateAction<LeadForm>>; users: { uid: string; name: string; role: string }[]; usersLoading: boolean; canAssign?: boolean }) {
  const updateAssignee = (uid: string) => {
    const assignee = users.find((item) => item.uid === uid);
    setForm({ ...form, assignedToUid: uid, assignedToName: assignee?.name || '' });
  };
  return <><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Full Name</label><input type="text" required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Email</label><input type="email" required className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Phone</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Company</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Source</label><input type="text" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></div></div>{canAssign && <div className="space-y-2"><label className="text-xs font-bold uppercase text-slate-500">Assigned To</label><select className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" value={form.assignedToUid} disabled={usersLoading} onChange={(event) => updateAssignee(event.target.value)}>{form.assignedToUid && !users.some((item) => item.uid === form.assignedToUid) && <option value={form.assignedToUid}>{form.assignedToName || "Legacy assignee"}</option>}{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></div>}</>;
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { MobileQuickActionMenu } from '@/components/MobileQuickActionMenu';
import { ModalHeader } from '@/components/ModalCloseButton';
import { Search, Filter, Plus, Mail, Phone, Edit, Archive, RefreshCw, UserPlus, ExternalLink, RotateCcw, Trash2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canManageLeads } from '@/lib/permissions';
import { getLeadById } from '@/lib/repositories/leads';
import type { Lead, LeadStatus, Settings } from '@/types';
import { getDefaultAssignment } from '@/lib/ownership';
import { LeadDetailsModal } from '@/components/LeadDetailsModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { useWorkspace } from '@/context/WorkspaceContext';
import { IconActionButton } from '@/components/IconActionButton';
import { getLifecycleDecision } from '@/lib/repositories/lifecycle';
import type { LifecycleDecision } from '@/lib/record-lifecycle';
import { classifyLeads } from '@/lib/lead-lifecycle';
import { previewBulkLifecycle } from '@/lib/repositories/lifecycle';
import type { BulkLifecycleAction, BulkLifecycleResult } from '@/lib/repositories/lifecycle';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { TablePagination } from '@/components/TablePagination';
import { SortableColumnHeader } from '@/components/SortableColumnHeader';
import { compareNumber, compareText, type SortDirection } from '@/lib/table-sorting';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';

const statuses: LeadStatus[] = ['New', 'Follow-up', 'Opportunity', 'Lost'];
type LeadColumn = 'select' | 'name' | 'company' | 'contact' | 'source' | 'status' | 'action';
type LeadSortKey = Exclude<LeadColumn, 'select' | 'action'>;
type LeadSort = { key: LeadSortKey; direction: SortDirection } | null;

type LeadForm = { name: string; email: string; phone: string; company: string; source: string; assignedToUid: string; assignedToName: string };
const emptyForm: LeadForm = { name: '', email: '', phone: '', company: '', source: '', assignedToUid: '', assignedToName: '' };

export default function LeadsPage() {
  const { user } = useAuth();
  const { leads, leadsLoading, leadsError, refreshLeads, loadMoreLeads, leadsHasMore, convertLeadToClient, addLead, updateLead, updateLeadStatus, archiveLead, trashLead, addTask, leadTasks, leadTasksLoading, leadTasksError, loadLeadTasks, completeTask, users, usersLoading, settings, settingsLoading, settingsError, archivedLeads, trashedLeads, loadArchivedRecords, loadTrashRecords, loadMoreArchivedLeads, loadMoreTrashedLeads, archivedLeadsHasMore, trashedLeadsHasMore, restoreLead, permanentlyDeleteLead, executeBulkLifecycleAction } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganizationId, loading: workspaceLoading, ready: workspaceReady, membership, canWrite } = useWorkspace();
  const canManage = canManageLeads(membership) && canWrite;
  const canEditLead = (lead: Lead) => canWrite && (canManageLeads(membership) || (membership?.role === 'USER' && lead.assignedToUid === user?.uid));
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
  const [showTrash, setShowTrash] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'trash' | 'restore' | 'delete'; id: string; name: string; decision?: LifecycleDecision } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [trashDecisions, setTrashDecisions] = useState<Record<string, LifecycleDecision>>({});
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkLeadAction, setBulkLeadAction] = useState<BulkLifecycleAction | ''>('');
  const [bulkLeadBusy, setBulkLeadBusy] = useState(false);
  const [bulkLeadConfirmation, setBulkLeadConfirmation] = useState<{ action: BulkLifecycleAction; ids: string[]; results: BulkLifecycleResult[] } | null>(null);
  const [leadPage, setLeadPage] = useState(1);
  const [leadPageSize, setLeadPageSize] = useState(25);
  const [leadSort, setLeadSort] = useState<LeadSort>(null);
  const leadLookupRequestRef = useRef(0);

  useEffect(() => {
    const leadId = searchParams.get('leadId');
    if (!leadId) {
      const timer = window.setTimeout(() => {
        setShowDetails(false);
        setSelectedLead(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!user || !workspaceReady || !currentOrganizationId || leadsLoading) return;
    const lead = leads.find((item) => item.id === leadId);
    if (lead) {
      const timer = window.setTimeout(() => {
        setSelectedLead(lead);
        setShowDetails(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    const requestId = ++leadLookupRequestRef.current;
    const resetTimer = window.setTimeout(() => {
      setShowDetails(false);
      setSelectedLead(null);
    }, 0);
    void getLeadById(user, currentOrganizationId, leadId)
      .then((loadedLead) => {
        if (cancelled || requestId !== leadLookupRequestRef.current) return;
        setSelectedLead(loadedLead);
        setShowDetails(true);
      })
      .catch((loadError) => {
        if (cancelled || requestId !== leadLookupRequestRef.current) return;
        console.error('Unable to open lead', loadError);
        setActionError('Unable to open this lead. Please try again.');
        router.replace('/leads', { scroll: false });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(resetTimer);
    };
  }, [currentOrganizationId, leads, leadsLoading, router, searchParams, user, workspaceReady]);

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

  useEffect(() => {
    if (showArchived || showTrash || !workspaceReady || !currentOrganizationId) return;
    const timer = window.setTimeout(() => void refreshLeads({ view: leadView, status: statusFilter, source: sourceFilter, search: searchTerm }, leadPageSize), searchTerm.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [currentOrganizationId, leadPageSize, leadView, refreshLeads, searchTerm, showArchived, showTrash, sourceFilter, statusFilter, workspaceReady]);

  const refresh = async () => {
    setActionError(null);
    await refreshLeads();
  };

  const visibleLeads = useMemo(() => classifyLeads(leads).active, [leads]);
  const displayedArchivedLeads = useMemo(() => classifyLeads(archivedLeads).archived, [archivedLeads]);
  const displayedTrashedLeads = useMemo(() => classifyLeads(trashedLeads).trashed, [trashedLeads]);
  const configuredLeadSources = new Map(settings.leadSources.map((source) => [source.name.trim(), source]));
  const leadSourceOptions = useMemo(() => {
    const names = new Set<string>();
    settings.leadSources.forEach((source) => { if (source.name.trim()) names.add(source.name.trim()); });
    [...leads, ...archivedLeads, ...trashedLeads].forEach((lead) => { if (lead.source.trim()) names.add(lead.source.trim()); });
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [archivedLeads, leads, settings.leadSources, trashedLeads]);
  const filteredLeads = useMemo(() => visibleLeads.filter((lead) => {
    const query = searchTerm.toLowerCase();
    const matchesView = leadView === 'Active' ? ['New', 'Follow-up', 'Opportunity'].includes(lead.status) : leadView === 'Converted' ? lead.status === 'Client' : leadView === 'Lost' ? lead.status === 'Lost' : true;
    return matchesView
      && (statusFilter === 'All' || lead.status === statusFilter)
      && (sourceFilter === 'All' || lead.source === sourceFilter);
  }), [leadView, searchTerm, sourceFilter, statusFilter, visibleLeads]);
  const sortedFilteredLeads = useMemo(() => {
    if (!leadSort) return filteredLeads;
    const sorted = [...filteredLeads];
    sorted.sort((left, right) => {
      switch (leadSort.key) {
        case 'name': return compareText(left.name, right.name, leadSort.direction);
        case 'company': return compareText(left.company, right.company, leadSort.direction);
        case 'contact': return compareText(left.email || left.phone, right.email || right.phone, leadSort.direction);
        case 'source': return compareText(left.source, right.source, leadSort.direction);
        case 'status': {
          const statusOrder = [...statuses, 'Client' as const];
          const leftIndex = statusOrder.indexOf(left.status);
          const rightIndex = statusOrder.indexOf(right.status);
          return compareNumber(leftIndex < 0 ? null : leftIndex, rightIndex < 0 ? null : rightIndex, leadSort.direction);
        }
      }
    });
    return sorted;
  }, [filteredLeads, leadSort]);
  const selectableLeadRows = showArchived ? displayedArchivedLeads : showTrash ? displayedTrashedLeads : filteredLeads;
  const leadPageCount = Math.max(1, Math.ceil(filteredLeads.length / leadPageSize));
  const safeLeadPage = Math.min(leadPage, leadPageCount);
  const currentPageLeadRows = showArchived || showTrash ? selectableLeadRows : sortedFilteredLeads.slice((safeLeadPage - 1) * leadPageSize, safeLeadPage * leadPageSize);
  const selectedMatchingLeadIds = selectableLeadRows.filter((lead) => selectedLeadIds.has(lead.id)).map((lead) => lead.id);
  const selectedVisibleLeadIds = currentPageLeadRows.filter((lead) => selectedLeadIds.has(lead.id)).map((lead) => lead.id);
  const allVisibleLeadsSelected = currentPageLeadRows.length > 0 && selectedVisibleLeadIds.length === currentPageLeadRows.length;
  const someVisibleLeadsSelected = selectedVisibleLeadIds.length > 0 && !allVisibleLeadsSelected;
  const leadBulkActions = showTrash
    ? [{ value: 'restore', label: 'Restore' }, { value: 'permanent-delete', label: 'Delete permanently' }]
    : showArchived
      ? [{ value: 'restore', label: 'Restore' }, { value: 'trash', label: 'Move to Trash' }]
      : [{ value: 'archive', label: 'Archive' }, { value: 'trash', label: 'Move to Trash' }];
  const bulkLeadBlocked = bulkLeadConfirmation?.results.filter((result) => !result.ok || result.decision?.outcome === 'BLOCKED').length || 0;
  const bulkLeadAffected = bulkLeadConfirmation?.results.reduce((total, result) => total + Object.values(result.decision?.cleanupRecords || {}).reduce((sum, count) => sum + count, 0), 0) || 0;
  const bulkLeadPreviewDescription = bulkLeadConfirmation
    ? bulkLeadConfirmation.results.map((result) => {
      const name = [...leads, ...displayedArchivedLeads, ...displayedTrashedLeads].find((lead) => lead.id === result.id)?.name || result.id;
      const cleanup = Object.entries(result.decision?.cleanupRecords || {}).map(([label, count]) => `${count} ${label}`).join(', ');
      return `${name}: ${result.ok ? cleanup || 'no eligible related records' : result.error || 'unavailable'}.`;
    }).join(' ')
    : '';
  const toggleArchived = () => {
    const next = !showArchived;
    setLeadPage(1);
    setShowArchived(next);
    setShowTrash(false);
    setSelectedLeadIds(new Set());
    setBulkLeadAction('');
    if (next && displayedArchivedLeads.length === 0) void loadArchivedRecords();
  };

  const toggleTrash = () => {
    const next = !showTrash;
    setLeadPage(1);
    setShowTrash(next);
    setShowArchived(false);
    setSelectedLeadIds(new Set());
    setBulkLeadAction('');
    if (next && displayedTrashedLeads.length === 0) void loadTrashRecords();
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const toggleAllVisibleLeads = () => {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (allVisibleLeadsSelected) currentPageLeadRows.forEach((lead) => next.delete(lead.id));
      else currentPageLeadRows.forEach((lead) => next.add(lead.id));
      return next;
    });
  };

  const selectAllMatchingLeads = () => setSelectedLeadIds((current) => new Set([...current, ...selectableLeadRows.map((lead) => lead.id)]));

  const resetLeadTableContext = () => {
    setLeadPage(1);
    setSelectedLeadIds(new Set());
  };
  const handleLeadSearchChange = (value: string) => { resetLeadTableContext(); setSearchTerm(value); };
  const handleLeadViewChange = (value: typeof leadView) => { resetLeadTableContext(); setLeadView(value); };
  const handleLeadStatusFilterChange = (value: LeadStatus | 'All') => { resetLeadTableContext(); setStatusFilter(value); };
  const handleLeadSourceFilterChange = (value: string) => { resetLeadTableContext(); setSourceFilter(value); };
  const handleLeadSort = (key: LeadSortKey) => {
    setLeadSort((current) => current?.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
    setLeadPage(1);
  };
  const runBulkLeadPreview = async () => {
    if (!user || !currentOrganizationId || !bulkLeadAction || selectedLeadIds.size === 0) return;
    setBulkLeadBusy(true);
    setActionError(null);
    try {
      const ids = selectedMatchingLeadIds;
      const results = await previewBulkLifecycle(user, currentOrganizationId, 'Lead', bulkLeadAction, ids);
      setBulkLeadConfirmation({ action: bulkLeadAction, ids, results });
    } catch (error) {
      console.error('Unable to preview bulk Lead action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to preview the bulk Lead action. Please try again.'));
    } finally {
      setBulkLeadBusy(false);
    }
  };

  const executeBulkLeadAction = async () => {
    if (!bulkLeadConfirmation || bulkLeadBusy) return;
    setBulkLeadBusy(true);
    setActionError(null);
    try {
      const results = await executeBulkLifecycleAction('Lead', bulkLeadConfirmation.action, bulkLeadConfirmation.ids);
      const failed = results.filter((result) => !result.ok);
      const succeeded = results.filter((result) => result.ok);
      setSelectedLeadIds((current) => new Set([...current].filter((id) => failed.some((result) => result.id === id))));
      setBulkLeadConfirmation(null);
      if (failed.length > 0) setActionError(`${succeeded.length} Lead${succeeded.length === 1 ? '' : 's'} processed. ${failed.length} failed: ${failed.map((result) => result.error || result.id).join(' ')}`);
    } catch (error) {
      console.error('Unable to execute bulk Lead action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to complete the bulk Lead action. Please try again.'));
    } finally {
      setBulkLeadBusy(false);
      setBulkLeadAction('');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canManage || !form.name || !form.email) return;
    if (workspaceLoading) { setActionError('Workspace is still loading. Please wait a moment and try again.'); return; }
    if (!workspaceReady || !currentOrganizationId) { setActionError('No active organization is available. Please contact an administrator.'); return; }
    setSaving(true); setActionError(null);
    try { await addLead(form); await refreshLeads(); setForm({ ...emptyForm, ...getDefaultAssignment(user) }); setShowAddModal(false); }
    catch (saveError) { console.error('Unable to create lead', saveError); setActionError('Unable to save the lead. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !currentOrganizationId || !selectedLead || !canEditLead(selectedLead)) return;
    setSaving(true); setActionError(null);
    try {
      await updateLead(selectedLead.id, editForm);
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
        await updateLeadStatus(lead, status);
        await refreshLeads();
      }
    } catch (statusError) {
      console.error('Unable to update lead status', statusError);
      if (status === 'Client') {
        const code = (statusError as { code?: string }).code;
        setActionError(code === 'already-converted'
          ? 'This lead has already been converted to a client.'
          : code === 'permission-denied'
            ? 'You do not have permission to convert this lead.'
            : 'Unable to convert the lead. Please try again.');
      } else {
        setActionError('Unable to update the lead status. Please try again.');
      }
    }
    finally { setBusyLeadId(null); }
  };

  const handleArchive = async (lead: Lead) => {
    if (!user || !currentOrganizationId || !canEditLead(lead) || busyLeadId) return;
    setBusyLeadId(lead.id);
    setActionError(null);
    try {
      const decision = await getLifecycleDecision(user, currentOrganizationId, 'Lead', 'archive', lead.id);
      if (decision.outcome === 'BLOCKED') { setActionError(`${decision.reason} ${decision.recommendedAction}`); return; }
      setConfirmAction({ kind: 'archive', id: lead.id, name: lead.name, decision });
    } catch (error) {
      console.error('Unable to evaluate lead archive', error);
      setActionError(userFacingErrorMessage(error, 'Unable to evaluate lead archive. Please try again.'));
    } finally {
      setBusyLeadId(null);
    }
  };

  const handleTrash = async (lead: Lead) => {
    if (!user || !currentOrganizationId || !canEditLead(lead) || busyLeadId) return;
    setBusyLeadId(lead.id);
    setActionError(null);
    try {
      const decision = await getLifecycleDecision(user, currentOrganizationId, 'Lead', 'trash', lead.id);
      if (decision.outcome === 'BLOCKED') { setActionError(`${decision.reason} ${decision.recommendedAction}`); return; }
      setConfirmAction({ kind: 'trash', id: lead.id, name: lead.name, decision });
    } catch (error) {
      console.error('Unable to evaluate lead trash', error);
      setActionError(userFacingErrorMessage(error, 'Unable to evaluate lead trash. Please try again.'));
    } finally {
      setBusyLeadId(null);
    }
  };

  const handlePermanentDelete = async (lead: Lead) => {
    if (!user || !currentOrganizationId || !canManage || busyLeadId) return;
    setBusyLeadId(lead.id);
    setActionError(null);
    try {
      const decision = await getLifecycleDecision(user, currentOrganizationId, 'Lead', 'permanent-delete', lead.id);
      setTrashDecisions((current) => ({ ...current, [lead.id]: decision }));
      setConfirmAction({ kind: 'delete', id: lead.id, name: lead.name, decision });
    } catch (error) {
      console.error('Unable to evaluate lead deletion', error);
      setActionError(userFacingErrorMessage(error, 'Unable to evaluate lead deletion. Please try again.'));
    } finally {
      setBusyLeadId(null);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || confirmBusy || !user || !currentOrganizationId) return;
    const actionLeadId = confirmAction.id;
    setConfirmBusy(true);
    setBusyLeadId(actionLeadId);
    setActionError(null);
    try {
      if (confirmAction.kind === 'archive') {
        await archiveLead(confirmAction.id);
      } else if (confirmAction.kind === 'trash') {
        await trashLead(confirmAction.id);
      } else if (confirmAction.kind === 'restore') {
        await restoreLead(confirmAction.id);
      } else if (confirmAction.decision?.outcome !== 'BLOCKED') {
        await permanentlyDeleteLead(confirmAction.id);
      }
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete lead lifecycle action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to complete the lead action. Please try again.'));
    } finally {
      setBusyLeadId(null);
      setConfirmBusy(false);
    }
  };

  const openConvertedClient = (lead: Lead) => {
    if (lead.convertedClientId) router.push(`/clients?clientId=${encodeURIComponent(lead.convertedClientId)}`);
  };

  const openDetails = (lead: Lead) => {
    setSelectedLead(lead);
    setShowDetails(true);
    router.push(`/leads?leadId=${encodeURIComponent(lead.id)}`, { scroll: false });
  };

  const closeDetails = () => {
    setShowDetails(false);
    if (searchParams.get('leadId')) router.replace('/leads', { scroll: false });
  };

  return (
    <div className={`space-y-6 ${selectedMatchingLeadIds.length > 0 ? 'pb-24' : ''}`}>
      {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
      <PageHeader title="Leads & Prospects" subtitle="Track potential customers and sales opportunities." actions={<>{<Button variant="outline" onClick={toggleArchived}>{showArchived ? 'Active Leads' : 'Archived Leads'}</Button>}<Button variant="outline" onClick={toggleTrash}>{showTrash ? 'Active Leads' : 'Trash'}</Button>{canManage && <Button disabled={!workspaceReady} onClick={openCreate} className="gap-2"><Plus size={18} /> Add Lead</Button>}</>} mobileQuickActions={<MobileQuickActionMenu items={[{ label: 'Add Lead', onSelect: openCreate, disabled: !canManage || !workspaceReady }, { label: 'Archived', onSelect: toggleArchived }, { label: 'Trash', onSelect: toggleTrash }]} />} />
      <Card className="page-filter-panel flex flex-col gap-4 p-4 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" size={20} /><input type="text" placeholder="Search leads..." className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" value={searchTerm} onChange={(event) => handleLeadSearchChange(event.target.value)} /></div><div className="flex flex-wrap gap-2"><select aria-label="Lead view" className="h-9 rounded-lg border border-[var(--app-border)] bg-white px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]/50" value={leadView} onChange={(event) => handleLeadViewChange(event.target.value as typeof leadView)}><option>All</option><option>Active</option><option>Converted</option><option>Lost</option></select><Button variant="outline" onClick={() => setShowFilters((current) => !current)} className="gap-2"><Filter size={18} /> Filter</Button><Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2"><RefreshCw size={16} /> Refresh</Button></div>{showFilters && <div className="flex flex-wrap gap-2"><select className="h-9 rounded-lg border border-[var(--app-border)] bg-white px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]/50" value={statusFilter} onChange={(event) => handleLeadStatusFilterChange(event.target.value as LeadStatus | 'All')}><option value="All">All statuses</option>{[...statuses, 'Client' as const].map((status) => <option key={status} value={status}>{status}</option>)}</select><select className="h-9 rounded-lg border border-[var(--app-border)] bg-white px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]/50" value={sourceFilter} onChange={(event) => handleLeadSourceFilterChange(event.target.value)}><option value="All">All sources</option>{leadSourceOptions.map((source) => <option key={source} value={source}>{source}{configuredLeadSources.get(source)?.isActive === false ? ' (Inactive)' : ''}</option>)}</select></div>}</Card>
      {canManage && <BulkActionToolbar selectedCount={selectedMatchingLeadIds.length} matchingCount={selectableLeadRows.length} action={bulkLeadAction} actions={leadBulkActions} processing={bulkLeadBusy} onSelectAllMatching={selectAllMatchingLeads} onActionChange={(action) => setBulkLeadAction(action as BulkLifecycleAction)} onApply={() => void runBulkLeadPreview()} onClear={() => setSelectedLeadIds(new Set())} />}
      <Card className="overflow-hidden rounded-xl border border-[var(--app-border)]/80 bg-white p-0 shadow-none">
        {(!workspaceReady || leadsLoading) ? <p className="flex min-h-[220px] items-center justify-center p-10 text-center text-sm text-[var(--app-muted)]">{workspaceLoading ? 'Workspace is still loading…' : currentOrganizationId ? 'Loading leads…' : 'No active organization is available for Leads.'}</p> : filteredLeads.length === 0 ? <p className="p-10 text-center text-sm text-[var(--app-muted)]">{error ? 'Leads could not be loaded.' : searchTerm || leadView !== 'All' || statusFilter !== 'All' || sourceFilter !== 'All' ? 'No leads match your search or filters.' : <>No leads yet.<span className="mt-1 block text-xs font-normal text-[var(--app-tertiary)]">Add your first lead to start tracking prospects.</span></>}</p> : <div className="overflow-x-auto overscroll-x-contain"><table className="leads-data-table w-full min-w-[900px] xl:min-w-0 table-fixed border-separate border-spacing-0 text-left"><colgroup><col style={{ width: '3%' }} /><col style={{ width: '20%' }} /><col style={{ width: '18%' }} /><col style={{ width: '24%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /><col style={{ width: '10%' }} /></colgroup><thead className="bg-[var(--app-surface-subtle)]"><tr className="border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)]"><th scope="col" className="w-10 px-2 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" checked={allVisibleLeadsSelected} ref={(element) => { if (element) element.indeterminate = someVisibleLeadsSelected; }} onChange={toggleAllVisibleLeads} aria-checked={someVisibleLeadsSelected ? "mixed" : allVisibleLeadsSelected} aria-label="Select all visible Leads" /></th><SortableColumnHeader label="Lead Name" direction={leadSort?.key === 'name' ? leadSort.direction : undefined} onSort={() => handleLeadSort('name')} fullWidth /><SortableColumnHeader label="Company" direction={leadSort?.key === 'company' ? leadSort.direction : undefined} onSort={() => handleLeadSort('company')} fullWidth /><SortableColumnHeader label="Contact" direction={leadSort?.key === 'contact' ? leadSort.direction : undefined} onSort={() => handleLeadSort('contact')} fullWidth /><SortableColumnHeader label="Source" direction={leadSort?.key === 'source' ? leadSort.direction : undefined} onSort={() => handleLeadSort('source')} fullWidth /><SortableColumnHeader label="Status" direction={leadSort?.key === 'status' ? leadSort.direction : undefined} onSort={() => handleLeadSort('status')} fullWidth /><th scope="col" className="whitespace-nowrap px-4 py-4 text-right text-xs font-bold uppercase text-[var(--app-muted)]"><span>Action</span></th></tr></thead><tbody className="divide-y divide-[var(--app-border)]/80">{currentPageLeadRows.map((lead) => <tr key={lead.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select,input')) openDetails(lead); }} className={`cursor-pointer transition-colors hover:bg-[var(--app-surface-subtle)]/80 ${selectedLeadIds.has(lead.id) ? 'bg-[var(--app-accent-soft)]/40' : ''}`}><td className="w-10 px-2 py-2.5 align-middle"><input type="checkbox" checked={selectedLeadIds.has(lead.id)} onChange={() => toggleLeadSelection(lead.id)} aria-label={`Select ${lead.name}`} className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" /></td><td className="min-w-0 px-4 py-2.5 align-middle"><p className="line-clamp-2 break-words font-normal leading-5 text-[var(--app-text)]">{lead.name}</p></td><td className="min-w-0 px-4 py-2.5 align-middle text-sm leading-5 text-[var(--app-muted)]"><span className="line-clamp-2 break-words">{lead.company || '—'}</span></td><td className="min-w-0 pl-4 pr-2 py-2.5 align-middle text-xs leading-4 text-[var(--app-muted)]"><div className="flex min-w-0 items-center gap-1"><Mail className="shrink-0" size={12} /><span className="truncate">{lead.email}</span></div><div className="mt-0 flex min-w-0 items-center gap-1"><Phone className="shrink-0" size={12} /><span className="truncate">{lead.phone || '—'}</span></div></td><td className="min-w-0 pl-2 pr-4 py-2.5 align-middle text-sm text-[var(--app-muted)]"><span className="block truncate">{lead.source || '—'}</span></td><td className="px-4 py-2.5 align-middle">{lead.status === 'Client' ? <span className="inline-flex rounded-full bg-[var(--app-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--app-primary)]">Converted</span> : <select aria-label={`Status for ${lead.name}`} value={lead.status} disabled={!canEditLead(lead) || busyLeadId === lead.id} onChange={(event) => void handleStatusChange(lead, event.target.value as LeadStatus)} className="h-8 min-w-[100px] max-w-[124px] rounded-lg border border-[var(--app-border)] bg-white px-2 py-1 text-xs font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]/50 disabled:cursor-not-allowed disabled:bg-[var(--app-surface-subtle)]">{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>}</td><td className="whitespace-nowrap px-4 py-2.5 text-right align-middle"><div className="flex justify-end gap-0.5">{canEditLead(lead) && lead.status !== 'Client' && <IconActionButton icon={<Edit size={15} />} label="Edit Lead" onClick={() => { setSelectedLead(lead); setEditForm({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company || "", source: lead.source, assignedToUid: lead.assignedToUid || lead.assignedTo || "", assignedToName: lead.assignedToName || "" }); setShowEditModal(true); }} />}{canEditLead(lead) && <IconActionButton icon={<Archive size={15} />} label="Archive Lead" variant="danger" disabled={busyLeadId === lead.id} onClick={() => void handleArchive(lead)} />}{lead.status === 'Client' && lead.convertedClientId && <IconActionButton icon={<ExternalLink size={15} />} label="View Client" variant="primary" onClick={() => openConvertedClient(lead)} />}{lead.status !== 'Client' && canManage && <IconActionButton icon={<UserPlus size={15} />} label="Convert to Client" variant="success" onClick={() => void handleStatusChange(lead, "Client")} />}</div></td></tr>)}</tbody></table></div>}
        {!showArchived && !showTrash && <TablePagination page={safeLeadPage} pageSize={leadPageSize} totalCount={filteredLeads.length} hasMore={leadsHasMore} onPageChange={setLeadPage} onPageSizeChange={(nextPageSize) => { setLeadPageSize(nextPageSize); setLeadPage(1); }} />}
      </Card>
      {!showArchived && !showTrash && leadsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreLeads()} disabled={leadsLoading}>{leadsLoading ? 'Loading…' : 'Load More Leads'}</Button></div>}
      {showArchived && <Card className="p-0"><div className="border-b bg-[var(--app-surface-subtle)] px-6 py-3 text-sm font-semibold text-[var(--app-text)]">Archived Leads</div>{displayedArchivedLeads.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">No archived leads.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{displayedArchivedLeads.map((lead) => <div key={lead.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-[var(--app-text)]">{lead.name}</p><p className="text-sm text-[var(--app-muted)]">{lead.company || lead.email}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Lead" variant="success" disabled={busyLeadId === lead.id} onClick={() => setConfirmAction({ kind: "restore", id: lead.id, name: lead.name })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Move Lead to Trash" variant="danger" disabled={busyLeadId === lead.id} onClick={() => void handleTrash(lead)} />}</div></div>)}</div>}{archivedLeadsHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreArchivedLeads()}>Load More</Button></div>}</Card>}
      {showTrash && <Card className="p-0"><div className="border-b bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] px-6 py-3 text-sm font-semibold text-[var(--app-danger)]">Lead Trash</div>{displayedTrashedLeads.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">Trash is empty.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{displayedTrashedLeads.map((lead) => { const decision = trashDecisions[lead.id]; const blocked = decision?.outcome === 'BLOCKED'; const blockers = decision ? Object.entries(decision.blockingRecords).map(([label, count]) => `${count} ${label}`).join(', ') : ''; return <div key={lead.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-[var(--app-text)]">{lead.name}</p><p className={`text-sm ${blocked ? 'text-[var(--app-danger)]' : 'text-[var(--app-muted)]'}`}>{blocked ? `Deletion blocked — ${blockers}.` : decision?.outcome === 'ALLOWED_WITH_WARNING' ? 'Ready to delete with cleanup warning.' : 'Deletion status will be checked before confirmation.'}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Lead from Trash" variant="success" disabled={busyLeadId === lead.id} onClick={() => setConfirmAction({ kind: "restore", id: lead.id, name: lead.name })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label={blocked ? 'View deletion block' : decision ? 'Delete Lead permanently' : 'Check deletion'} variant="danger" disabled={busyLeadId === lead.id} onClick={() => void handlePermanentDelete(lead)} />}</div></div>; })}</div>}{trashedLeadsHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreTrashedLeads()}>Load More</Button></div>}</Card>}
      {confirmAction && <ConfirmActionDialog open title={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED' ? 'Permanent deletion blocked' : `${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'trash' ? 'Move to Trash' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.decision ? `${confirmAction.decision.reason} ${Object.entries(confirmAction.decision.blockingRecords).map(([label, count]) => `Blocking: ${count} ${label}`).join(', ')} ${Object.entries(confirmAction.decision.cleanupRecords).map(([label, count]) => `${count} ${label}`).join(', ')} ${Object.entries(confirmAction.decision.preservedRecords).map(([label, value]) => `${label}${typeof value === 'number' ? ` (${value})` : ` “${value}”`}`).join(', ')} ${confirmAction.decision.recommendedAction}` : confirmAction.kind === 'restore' ? 'This lead will be restored to the active list without changing related record state.' : 'This action cannot be undone.'} confirmLabel={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED' ? 'Unavailable' : confirmBusy ? confirmAction.kind === 'archive' ? 'Archiving' : confirmAction.kind === 'trash' ? 'Moving to Trash' : confirmAction.kind === 'restore' ? 'Restoring' : 'Deleting' : confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'trash' ? 'Move to Trash' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} confirmDisabled={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED'} variant={confirmAction.kind === 'delete' || confirmAction.kind === 'trash' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
      {bulkLeadConfirmation && <ConfirmActionDialog open title={(bulkLeadConfirmation.action === 'permanent-delete' ? 'Permanently delete' : bulkLeadConfirmation.action === 'restore' ? 'Restore' : bulkLeadConfirmation.action === 'trash' ? 'Move to Trash' : 'Archive') + ' ' + bulkLeadConfirmation.ids.length + ' Leads?'} description={'Preview: ' + (bulkLeadConfirmation.ids.length - bulkLeadBlocked) + ' ready, ' + bulkLeadBlocked + ' blocked or unavailable. ' + bulkLeadPreviewDescription + (bulkLeadConfirmation.action === 'permanent-delete' && bulkLeadAffected > 0 ? ` Total eligible related records: ${bulkLeadAffected}.` : '')} confirmLabel={bulkLeadConfirmation.action === 'permanent-delete' ? 'Delete Permanently' : bulkLeadConfirmation.action === 'restore' ? 'Restore' : bulkLeadConfirmation.action === 'trash' ? 'Move to Trash' : 'Archive'} variant={bulkLeadConfirmation.action === 'permanent-delete' || bulkLeadConfirmation.action === 'trash' ? 'danger' : bulkLeadConfirmation.action === 'archive' ? 'warning' : 'default'} loading={bulkLeadBusy} onCancel={() => setBulkLeadConfirmation(null)} onConfirm={() => void executeBulkLeadAction()} />}
      {showAddModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Add Lead dialog"><form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><ModalHeader title="Add New Lead" onClose={() => setShowAddModal(false)} /><LeadFields form={form} setForm={setForm} users={users} usersLoading={usersLoading} leadSources={settings.leadSources} settingsLoading={settingsLoading} settingsError={settingsError} /><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Lead'}</Button></div></form></div>}
      {showEditModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Edit Lead dialog"><form onSubmit={handleEdit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><ModalHeader title="Edit Lead" onClose={() => setShowEditModal(false)} /><LeadFields form={editForm} setForm={setEditForm} users={users} usersLoading={usersLoading} leadSources={settings.leadSources} settingsLoading={settingsLoading} settingsError={settingsError} isEdit /><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update Lead'}</Button></div></form></div>}
      {showDetails && selectedLead && user && currentOrganizationId && <LeadDetailsModal key={selectedLead.id} lead={selectedLead} user={user} organizationId={currentOrganizationId} canWrite={canWrite} tasks={leadTasks} tasksLoading={leadTasksLoading} tasksError={leadTasksError} onLoadTasks={loadLeadTasks} onAddTask={async (task) => { await addTask(task); await loadLeadTasks(selectedLead.id); }} onCompleteTask={completeTask} timezone={settings.timezone} onClose={closeDetails} />}
    </div>
  );
}

function LeadFields({ form, setForm, users, usersLoading, leadSources, settingsLoading, settingsError, isEdit = false, canAssign = users.length > 1 }: { form: LeadForm; setForm: React.Dispatch<React.SetStateAction<LeadForm>>; users: { uid: string; name: string; role: string }[]; usersLoading: boolean; leadSources: Settings['leadSources']; settingsLoading: boolean; settingsError: string | null; isEdit?: boolean; canAssign?: boolean }) {
  const updateAssignee = (uid: string) => {
    const assignee = users.find((item) => item.uid === uid);
    setForm({ ...form, assignedToUid: uid, assignedToName: assignee?.name || '' });
  };
  const activeSources = leadSources
    .filter((source) => source.isActive && source.name.trim())
    .map((source) => source.name.trim());
  const currentSource = form.source.trim();
  const currentSourceIsInactive = isEdit && Boolean(currentSource) && !activeSources.some((source) => source === currentSource);
  const sourcePlaceholder = settingsLoading
    ? 'Loading lead sources…'
    : settingsError
      ? 'Unable to load Lead Sources'
      : activeSources.length === 0
        ? 'No active Lead Sources available.'
        : 'Select lead source';
  return <><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Full Name</label><input type="text" required className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Email</label><input type="email" required className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Phone</label><input type="text" className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Company</label><input type="text" className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Source</label><div className="relative"><select className="w-full appearance-none rounded-xl border border-[var(--app-border)] px-4 py-2 pr-10 text-sm" value={form.source} disabled={settingsLoading || Boolean(settingsError) || activeSources.length === 0} onChange={(event) => setForm({ ...form, source: event.target.value })}><option value="">{sourcePlaceholder}</option>{currentSourceIsInactive && <option value={currentSource}>{currentSource} (Inactive)</option>}{activeSources.map((source) => <option key={source} value={source}>{source}</option>)}</select><ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" /></div>{settingsError && <p className="text-xs text-[var(--app-danger)]">Unable to load Lead Sources.</p>}</div></div>{canAssign && <div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Assigned To</label><select className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={form.assignedToUid} disabled={usersLoading} onChange={(event) => updateAssignee(event.target.value)}>{form.assignedToUid && !users.some((item) => item.uid === form.assignedToUid) && <option value={form.assignedToUid}>{form.assignedToName || "Legacy assignee"}</option>}{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></div>}</>;
}

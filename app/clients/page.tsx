'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { 
  Search, 
  Plus, 
  Mail, 
  Phone, 
  Building2, 
  Calendar, 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  ArrowLeft, 
  UserCheck, 
  Edit,
  Briefcase,
  ExternalLink,
  Filter,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients, canManageDeals, canManageTasks } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import { getActiveDealCreationStages, getDealProbability, getDefaultDealCreationStage } from '@/lib/deal-workflow';
import { DealDetailsModal } from '@/components/DealDetailsModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { TaskCard } from '@/components/TaskCard';
import { formatCompactDateTime, formatTaskDueDate, getNextFollowUp, sortOpenTasks } from '@/lib/task-utils';
import { getDefaultAssignment } from '@/lib/ownership';
import { IconActionButton } from '@/components/IconActionButton';
import { MoneyInput } from '@/components/MoneyInput';
import { countClientTabRecords, type ClientTabCounts } from '@/lib/repositories/clientCounts';
import { getClientDocumentSizeError } from '@/lib/client-documents';
import { Archive, Download, FileText, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
function currentDateTimeValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toDateTimeInput(value?: string) {
  if (!value || !isValidDate(value)) return currentDateTimeValue();
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function isValidDate(value: string) {
  return Number.isFinite(Date.parse(value));
}

function formatClientSince(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Unknown date';
}

function formatDocumentSize(value: number | string) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type ClientQuickFilter = 'All' | 'Active Deals' | 'No Active Deals' | 'Follow-up Due' | 'No Follow-up';

export default function ClientsPage() {
  const searchParams = useSearchParams();
  const { 
    clients,
    clientsLoading,
    clientsError,
    users,
    usersLoading,
    clientNotes,
    archivedClientNotes,
    clientNotesLoading,
    clientNotesError,
    loadClientNotes,
    loadArchivedClientNotes,
    loadMoreClientNotes,
    clientNotesHasMore,
    clientDocuments,
    archivedClientDocuments,
    clientDocumentsLoading,
    clientDocumentsError,
    loadClientDocuments,
    loadArchivedClientDocuments,
    loadMoreClientDocuments,
    clientDocumentsHasMore,
    uploadDocument,
    refreshClients,
    loadMoreClients,
    clientsHasMore,
    deals, 
    leads,
    tasks, 
    activities, 
    refreshActivities,
    refreshDeals,
    refreshLeads,
    refreshTasks,
    settings, 
    addDeal, 
    updateDeal,
    addTask, 
    addNote, 
    archiveClientNote,
    restoreClientNote,
    permanentlyDeleteClientNote,
    archiveClientDocument,
    restoreClientDocument,
    permanentlyDeleteClientDocument,
    completeTask,
    addClient: addClientToApp,
    updateClient: updateClientInApp,
    archiveClient: archiveClientInApp,
    archivedClients,
    archivedDeals,
    archivedTasks,
    loadArchivedRecords,
    loadMoreArchivedClients,
    archivedClientsHasMore,
    restoreClient,
    permanentlyDeleteClient,
    archiveDeal,
    restoreDeal,
    permanentlyDeleteDeal,
    archiveTask,
    restoreTask,
    permanentlyDeleteTask,
  } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, canWrite } = useWorkspace();
  const canManage = canManageClients(membership) && canWrite;
  const canManageDeal = canManageDeals(membership) && canWrite;
  const canManageTask = canManageTasks(membership) && canWrite;
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [detailConfirmAction, setDetailConfirmAction] = useState<{ entity: 'Deal' | 'Task' | 'Note' | 'Document'; kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [detailConfirmBusy, setDetailConfirmBusy] = useState(false);
  const [showArchivedDeals, setShowArchivedDeals] = useState(false);
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);
  const [showArchivedDocuments, setShowArchivedDocuments] = useState(false);
  const notesLoadedForClientRef = useRef<string | null>(null);
  const documentsLoadedForClientRef = useRef<string | null>(null);
  const activitiesLoadedForOrganizationRef = useRef<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [clientQuickFilter, setClientQuickFilter] = useState<ClientQuickFilter>('All');
  const [showClientFilters, setShowClientFilters] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('');
  const [clientSinceFrom, setClientSinceFrom] = useState('');
  const [clientSinceTo, setClientSinceTo] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => searchParams.get('clientId'));
  const [activeTab, setActiveTab] = useState<'overview' | 'deals' | 'tasks' | 'activity' | 'notes' | 'documents'>('overview');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddDealModal, setShowAddDealModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [clientTabCounts, setClientTabCounts] = useState<{ clientId: string; counts: ClientTabCounts } | null>(null);
  const [clientTabCountsLoading, setClientTabCountsLoading] = useState(false);
  const [clientTabCountsError, setClientTabCountsError] = useState<string | null>(null);
  const clientTabCountsRequestRef = useRef(0);
  const currentOrganizationForCountsRef = useRef(currentOrganizationId);

  // Form states
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const dealCreationStages = getActiveDealCreationStages(settings.pipelineStages);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const [dealForm, setDealForm] = useState({ title: '', productServiceName: '', value: 0, stage: defaultDealStage, expectedCloseDate: '', notes: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High', description: '' });
  const [noteForm, setNoteForm] = useState({ content: '' });
  const [currentTime] = useState(() => Date.now());
  const previousOrganizationId = useRef(currentOrganizationId);

  // Selected client computed data
  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedClientSourceLeadId = selectedClient?.sourceLeadId;

  useEffect(() => {
    currentOrganizationForCountsRef.current = currentOrganizationId;
  }, [currentOrganizationId]);

  const loadClientTabCounts = useCallback(async (clientId: string, sourceLeadId?: string) => {
    if (!user || !currentOrganizationId) return;
    const requestId = ++clientTabCountsRequestRef.current;
    const organizationId = currentOrganizationId;
    setClientTabCounts(null);
    setClientTabCountsLoading(true);
    setClientTabCountsError(null);
    try {
      const counts = await countClientTabRecords(user, organizationId, clientId, sourceLeadId);
      if (requestId === clientTabCountsRequestRef.current && organizationId === currentOrganizationForCountsRef.current) {
        setClientTabCounts({ clientId, counts });
      }
    } catch (error) {
      console.error('Unable to load Client tab counts', error);
      if (requestId === clientTabCountsRequestRef.current && organizationId === currentOrganizationForCountsRef.current) {
        setClientTabCountsError('Unable to load Client record counts.');
      }
    } finally {
      if (requestId === clientTabCountsRequestRef.current) setClientTabCountsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const displayedClientTabCounts = clientTabCounts?.clientId === selectedClientId ? clientTabCounts.counts : null;

  const refreshSelectedClientTabCounts = () => {
    if (selectedClientId) void loadClientTabCounts(selectedClientId, selectedClientSourceLeadId);
  };

  useEffect(() => {
    if (!selectedClientId || !selectedClient) {
      clientTabCountsRequestRef.current += 1;
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadClientTabCounts(selectedClientId, selectedClientSourceLeadId);
    });
    return () => {
      cancelled = true;
      clientTabCountsRequestRef.current += 1;
    };
  }, [loadClientTabCounts, selectedClient, selectedClientId, selectedClientSourceLeadId]);

  const openAddClient = () => {
    if (!user) return;
    setClientForm({ name: '', email: '', phone: '', company: '', ...getDefaultAssignment(user) });
    setShowAddModal(true);
  };

  useEffect(() => {
    if (previousOrganizationId.current && previousOrganizationId.current !== currentOrganizationId) {
      setSelectedClientId(null);
      setSelectedDealId(null);
      setActiveTab('overview');
    }
    previousOrganizationId.current = currentOrganizationId;
  }, [currentOrganizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const queryClientId = searchParams.get('clientId');
      const queryTab = searchParams.get('tab');
      setSelectedClientId(queryClientId);
      if (searchParams.get('action') === 'create' && user) {
        setClientForm({ name: '', email: '', phone: '', company: '', ...getDefaultAssignment(user) });
        setShowAddModal(true);
      }
      if (queryTab === 'tasks' || queryTab === 'deals' || queryTab === 'activity' || queryTab === 'notes' || queryTab === 'documents' || queryTab === 'overview') {
        setActiveTab(queryTab);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, user]);

  useEffect(() => {
    if (!selectedClientId) {
      notesLoadedForClientRef.current = null;
      return;
    }
    if (activeTab === 'notes' && notesLoadedForClientRef.current !== selectedClientId) {
      notesLoadedForClientRef.current = selectedClientId;
      void loadClientNotes(selectedClientId);
    }
  }, [activeTab, loadClientNotes, selectedClientId]);

  useEffect(() => {
    if (clientNotesError) notesLoadedForClientRef.current = null;
  }, [clientNotesError]);

  useEffect(() => {
    if (!selectedClientId) return;
    void Promise.all([refreshDeals(), refreshTasks(), refreshLeads()]);
  }, [refreshDeals, refreshLeads, refreshTasks, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || activeTab !== 'activity' || !currentOrganizationId) return;
    if (activitiesLoadedForOrganizationRef.current === currentOrganizationId) return;
    activitiesLoadedForOrganizationRef.current = currentOrganizationId;
    void refreshActivities();
  }, [activeTab, currentOrganizationId, refreshActivities, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      documentsLoadedForClientRef.current = null;
      return;
    }
    if (activeTab === 'documents' && documentsLoadedForClientRef.current !== selectedClientId) {
      documentsLoadedForClientRef.current = selectedClientId;
      void loadClientDocuments(selectedClientId);
    }
  }, [activeTab, loadClientDocuments, selectedClientId]);

  useEffect(() => {
    if (clientDocumentsError) documentsLoadedForClientRef.current = null;
  }, [clientDocumentsError]);

  useEffect(() => {
    if (!selectedClientId) return;
    if (showArchivedNotes) void loadArchivedClientNotes(selectedClientId);
  }, [loadArchivedClientNotes, selectedClientId, showArchivedNotes]);

  useEffect(() => {
    if (!selectedClientId) return;
    if (showArchivedDocuments) void loadArchivedClientDocuments(selectedClientId);
  }, [loadArchivedClientDocuments, selectedClientId, showArchivedDocuments]);

  const handleDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedClientId || documentSaving) return;
    const sizeError = getClientDocumentSizeError(file.size);
    if (sizeError) {
      setActionError(sizeError);
      return;
    }
    setDocumentSaving(true);
    setActionError(null);
    try {
      await uploadDocument(selectedClientId, file);
      refreshSelectedClientTabCounts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to upload the document. Please try again.');
    } finally {
      setDocumentSaving(false);
    }
  };

  const clientDeals = selectedClientId ? deals.filter(d => d.clientId === selectedClientId) : [];
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;
  const activeDealsCount = clientDeals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost').length;
  const totalSalesValue = clientDeals.filter(d => d.status === 'Won').reduce((sum, d) => sum + d.value, 0);
  const activePipelineDeals = clientDeals.filter((deal) => ['New', 'Qualified', 'Proposal', 'Negotiation'].includes(deal.stage));
  const activePipelineValue = activePipelineDeals.reduce((sum, deal) => sum + deal.value, 0);
  const weightedForecast = activePipelineDeals.reduce((sum, deal) => sum + deal.value * getDealProbability(deal.stage) / 100, 0);
  const wonValue = clientDeals.filter((deal) => deal.status === 'Won').reduce((sum, deal) => sum + deal.value, 0);

  // Next follow up task
  const clientTasks = selectedClientId ? tasks.filter(t => t.relatedTo?.type === 'Client' && t.relatedTo.id === selectedClientId && t.status === 'Pending') : [];
  const nextTask = getNextFollowUp(clientTasks, currentTime);
  const nextFollowUp = nextTask ? `${Date.parse(nextTask.dueDate) <= currentTime ? 'Overdue: ' : ''}${new Date(nextTask.dueDate).toLocaleString()}` : 'No pending follow-ups';

  const visibleClients = clients.filter(client => client.status !== 'ARCHIVED');
  const clientRows = useMemo(() => visibleClients.map((client) => {
    const clientDeals = deals.filter((deal) => deal.clientId === client.id);
    const activeDeals = clientDeals.filter((deal) => deal.stage !== 'Won' && deal.stage !== 'Lost').length;
    const totalSales = clientDeals.filter((deal) => deal.status === 'Won').reduce((sum, deal) => sum + deal.value, 0);
    const pendingFollowUps = tasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === client.id && task.status === 'Pending');
    const nextClientTask = getNextFollowUp(pendingFollowUps, currentTime);
    const nextFollowUpIsOverdue = Boolean(nextClientTask && Date.parse(nextClientTask.dueDate) <= currentTime);
    return {
      client,
      activeDeals,
      totalSales,
      hasFollowUp: Boolean(nextClientTask),
      nextFollowUp: nextClientTask ? `${nextFollowUpIsOverdue ? 'Overdue: ' : 'Scheduled for '}${new Date(nextClientTask.dueDate).toLocaleString()}` : 'No pending follow-ups',
      nextFollowUpIsOverdue,
    };
  }), [currentTime, deals, tasks, visibleClients]);

  const filteredClientRows = clientRows.filter(({ client, activeDeals, hasFollowUp }) => {
    const query = searchTerm.trim().toLowerCase();
    const companyQuery = companyFilter.trim().toLowerCase();
    const createdAt = Date.parse(client.createdAt);
    const fromTime = clientSinceFrom ? Date.parse(`${clientSinceFrom}T00:00:00`) : Number.NEGATIVE_INFINITY;
    const toTime = clientSinceTo ? Date.parse(`${clientSinceTo}T23:59:59.999`) : Number.POSITIVE_INFINITY;
    const matchesSearch = !query || [client.name, client.company || '', client.email].some((value) => value.toLowerCase().includes(query));
    const matchesCompany = !companyQuery || (client.company || '').toLowerCase().includes(companyQuery);
    const matchesDate = (!clientSinceFrom && !clientSinceTo) || (Number.isFinite(createdAt) && createdAt >= fromTime && createdAt <= toTime);
    const matchesQuickFilter = clientQuickFilter === 'All'
      || (clientQuickFilter === 'Active Deals' && activeDeals > 0)
      || (clientQuickFilter === 'No Active Deals' && activeDeals === 0)
      || (clientQuickFilter === 'Follow-up Due' && hasFollowUp)
      || (clientQuickFilter === 'No Follow-up' && !hasFollowUp);
    return matchesSearch && matchesCompany && matchesDate && matchesQuickFilter;
  });

  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archivedClients.length === 0) void loadArchivedRecords();
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email || !canManage) return;
    setSavingClient(true);
    setActionError(null);
    try {
      await addClientToApp(clientForm);
      setClientForm({ name: '', email: '', phone: '', company: '', ...(user ? getDefaultAssignment(user) : { assignedToUid: '', assignedToName: '' }) });
      setShowAddModal(false);
    } catch (error) {
      console.error('Unable to create client', error);
      setActionError('Unable to save the client. Please try again.');
    } finally {
      setSavingClient(false);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !canManage) return;
    setSavingClient(true);
    setActionError(null);
    try {
      await updateClientInApp(selectedClient.id, editClientForm);
      setShowEditModal(false);
    } catch (error) {
      console.error('Unable to update client', error);
      setActionError('Unable to update the client. Please try again.');
    } finally {
      setSavingClient(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || confirmBusy) return;
    setConfirmBusy(true);
    setActionError(null);
    try {
      if (confirmAction.kind === 'archive') {
        await archiveClientInApp(confirmAction.id);
        setSelectedClientId(null);
      } else if (confirmAction.kind === 'restore') {
        await restoreClient(confirmAction.id);
      } else {
        await permanentlyDeleteClient(confirmAction.id);
      }
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete client lifecycle action', error);
      setActionError(error instanceof Error ? error.message : 'Unable to complete the client action. Please try again.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const executeDetailConfirmedAction = async () => {
    if (!detailConfirmAction || detailConfirmBusy || !selectedClientId) return;
    const documentAction = detailConfirmAction.entity === 'Document' ? detailConfirmAction.kind : null;
    setDetailConfirmBusy(true);
    setActionError(null);
    try {
      const { entity, kind, id } = detailConfirmAction;
      if (entity === 'Deal') {
        if (kind === 'archive') await archiveDeal(id);
        else if (kind === 'restore') await restoreDeal(id);
        else await permanentlyDeleteDeal(id);
        await loadArchivedRecords();
        await refreshDeals();
      } else if (entity === 'Task') {
        if (kind === 'archive') await archiveTask(id);
        else if (kind === 'restore') await restoreTask(id);
        else await permanentlyDeleteTask(id);
        await loadArchivedRecords();
        await refreshTasks();
      } else if (entity === 'Note') {
        if (kind === 'archive') await archiveClientNote(selectedClientId, id);
        else if (kind === 'restore') await restoreClientNote(selectedClientId, id);
        else await permanentlyDeleteClientNote(selectedClientId, id);
        await loadClientNotes(selectedClientId);
        await loadArchivedClientNotes(selectedClientId);
      } else {
        if (kind === 'archive') await archiveClientDocument(selectedClientId, id);
        else if (kind === 'restore') await restoreClientDocument(selectedClientId, id);
        else await permanentlyDeleteClientDocument(selectedClientId, id);
        await loadClientDocuments(selectedClientId);
        await loadArchivedClientDocuments(selectedClientId);
      }
      refreshSelectedClientTabCounts();
      setDetailConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete Client record lifecycle action', error);
      setActionError(
        documentAction === 'archive'
          ? 'Unable to archive the document. Please try again.'
          : documentAction === 'restore'
            ? 'Unable to restore the document. Please try again.'
            : documentAction === 'delete'
              ? 'Unable to permanently delete the document. Please try again.'
              : error instanceof Error
                ? error.message
                : 'Unable to complete the record action. Please try again.',
      );
    } finally {
      setDetailConfirmBusy(false);
    }
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !dealForm.title.trim()) return;
    if (!Number.isFinite(dealForm.value) || dealForm.value < 0) { setActionError('Deal value must be zero or greater.'); return; }
    if (!defaultDealStage) { setActionError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    if (!dealCreationStages.some((stage) => stage.name === dealForm.stage)) { setActionError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    setSavingClient(true);
    setActionError(null);
    try {
      await addDeal({
        title: dealForm.title,
        clientId: selectedClientId,
        productServiceName: dealForm.productServiceName,
        value: Number(dealForm.value),
        stage: dealForm.stage,
        expectedCloseDate: dealForm.expectedCloseDate,
        notes: dealForm.notes,
      });
      refreshSelectedClientTabCounts();
      setDealForm({ title: '', productServiceName: '', value: 0, stage: defaultDealStage, expectedCloseDate: '', notes: '' });
      setShowAddDealModal(false);
    } catch (error) {
      console.error('Unable to create deal', error);
      setActionError('Unable to create the deal. Please try again.');
    } finally {
      setSavingClient(false);
    }
  };

  const openAddDeal = () => {
    if (!defaultDealStage) {
      setActionError('No active sales stage is available. Please configure your Pipeline settings.');
      return;
    }
    setDealForm((current) => ({ ...current, stage: defaultDealStage, ...(user ? getDefaultAssignment(user) : {}) }));
    setShowAddDealModal(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !taskForm.title || !taskForm.dueDate || !canManageTask) return;
    setSavingTask(true);
    setActionError(null);
    try {
      await addTask({
        title: taskForm.title,
        description: taskForm.description,
        type: 'Follow-up',
        dueDate: taskForm.dueDate,
        priority: taskForm.priority,
        relatedTo: { type: 'Client', id: selectedClientId }
      });
      refreshSelectedClientTabCounts();
      setTaskForm({ title: '', dueDate: currentDateTimeValue(), priority: 'Medium', description: '' });
      setShowAddTaskModal(false);
    } catch (error) {
      console.error('Unable to create client task', error);
      setActionError('Unable to save the task. Please try again.');
    } finally {
      setSavingTask(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    await completeTask(taskId);
    refreshSelectedClientTabCounts();
  };

  const openAddTask = () => {
    setTaskForm((current) => ({ ...current, dueDate: toDateTimeInput(current.dueDate) }));
    setShowAddTaskModal(true);
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !noteForm.content) return;
    try {
      await addNote(selectedClientId, noteForm.content);
      refreshSelectedClientTabCounts();
      setNoteForm({ content: '' });
      setShowAddNoteModal(false);
    } catch (error) {
      console.error('Unable to save client note', error);
      setActionError('Unable to save the note. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      {(actionError || clientsError) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{actionError || clientsError}</p>}
      {/* If Client is Selected, Show Client Profile */}
      {selectedClient ? (
        <div className="space-y-6">
          {/* Back Button & Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" onClick={() => setSelectedClientId(null)} className="-ml-2 mb-2 w-fit gap-2 px-2 text-slate-500">
                <ArrowLeft size={16} /> Back to Clients
              </Button>
              <h2 className="break-words text-2xl font-bold tracking-tight text-slate-900">{selectedClient.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{selectedClient.company ? `${selectedClient.company} • ` : ''}Client since {formatClientSince(selectedClient.createdAt)}</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {canManage && <Button variant="outline" onClick={() => {
                setEditClientForm({
                  name: selectedClient.name,
                  email: selectedClient.email,
                  phone: selectedClient.phone,
                  company: selectedClient.company || '',
                  assignedToUid: selectedClient.assignedToUid || selectedClient.assignedTo || '',
                  assignedToName: selectedClient.assignedToName || selectedClient.assignedTo || ''
                });
                setShowEditModal(true);
              }} className="gap-2">
                <Edit size={16} /> Edit Client
              </Button>}
              {canManage && <Button variant="warning" onClick={() => setConfirmAction({ kind: 'archive', id: selectedClient.id, name: selectedClient.name })} className="gap-2">
                Archive Client
              </Button>}
              {canManageDeal && <Button onClick={openAddDeal} className="gap-2">
                <Plus size={16} /> Add Deal
              </Button>}
            </div>
          </div>

          {/* Client Summary Banner */}
          <Card className="grid gap-4 border-slate-200 bg-white p-4 md:grid-cols-4">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Company & Contact</p>
              <p className="text-base font-semibold text-slate-900">{selectedClient.company || 'Independent'}</p>
              <p className="text-xs text-slate-500">{selectedClient.email} • {selectedClient.phone}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Total Sales / Deals</p>
              <p className="text-base font-semibold text-emerald-700">{formatCurrency(totalSalesValue, settings.currency)}</p>
              <p className="text-xs text-slate-500">{activeDealsCount} Active Deals / {clientDeals.length} Total</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assigned To</p>
              <p className="text-base font-semibold text-slate-900">{selectedClient.assignedToName || selectedClient.assignedTo || 'Unassigned'}</p>
              <p className="text-xs text-slate-500">Client Since: {new Date(selectedClient.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Next Follow-up</p>
              <p className="text-sm font-medium text-amber-700">{nextFollowUp}</p>
              {canManageTask && <Button size="sm" variant="outline" onClick={openAddTask} className="mt-2 text-xs">
                + Add Task
              </Button>}
            </div>
          </Card>

          {/* Profile Navigation Tabs */}
          <div className="flex border-b border-slate-200 gap-6" aria-busy={clientTabCountsLoading}>
            {[
              { id: 'overview', label: 'Overview' },
                { id: 'deals', label: `Deals (${displayedClientTabCounts ? displayedClientTabCounts.deals : '—'})` },
                { id: 'tasks', label: `Tasks (${displayedClientTabCounts ? displayedClientTabCounts.tasks : '—'})` },
                { id: 'activity', label: `Activity Log (${displayedClientTabCounts ? displayedClientTabCounts.activities : '—'})` },
                { id: 'notes', label: `Notes (${displayedClientTabCounts ? displayedClientTabCounts.notes : '—'})` },
                { id: 'documents', label: `Documents (${displayedClientTabCounts ? displayedClientTabCounts.documents : '—'})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-3 font-semibold text-sm transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {clientTabCountsError && <p className="text-xs text-slate-500" role="status">Client record counts are temporarily unavailable.</p>}

          {/* Tab Content */}
          <div className="space-y-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <Card className="space-y-4">
                  <h3 className="font-bold text-slate-900">Deals Overview</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Open Deals</p><p className="mt-1 text-lg font-bold text-slate-900">{activePipelineDeals.length}</p><p className="text-xs text-slate-500">Deals in progress</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Potential Sales</p><p className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(activePipelineValue, settings.currency)}</p><p className="text-xs text-slate-500">Total value of open deals</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Expected Sales</p><p className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(weightedForecast, settings.currency)}</p><p className="text-xs text-slate-500">Based on deal probability</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Won Sales</p><p className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(wonValue, settings.currency)}</p><p className="text-xs text-slate-500">Successfully closed deals</p></div>
                  </div>
                </Card>
                <Card className="space-y-4">
                  <h3 className="font-bold text-slate-900">Recent Notes</h3>
                  <div className="space-y-3">
                    {clientNotesLoading ? <p className="text-xs text-slate-400">Loading notes…</p> : clientNotesError ? <p className="text-xs text-red-600">{clientNotesError}</p> : clientNotes.map(note => (
                      <div key={note.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                        <p className="text-sm text-slate-800">{note.content}</p>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>By {note.author}</span>
                          <span>{new Date(note.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                    {!clientNotesLoading && !clientNotesError && clientNotes.length === 0 && (
                      <p className="text-xs text-slate-400">No notes recorded yet.</p>
                    )}
                  {canManage && <Button variant="outline" size="sm" onClick={() => setShowAddNoteModal(true)} className="w-full gap-2 mt-2">
                    <Plus size={14} /> Add Note
                    </Button>}
                  </div>
                </Card>

              </div>
            )}

            {activeTab === 'deals' && (
              <div className="space-y-4">
                <Card className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-900">Client Deals</h3><div className="flex flex-wrap gap-2">{canManageDeal && <Button size="sm" onClick={openAddDeal} className="gap-2"><Plus size={14} /> Add Deal</Button>}<Button size="sm" variant="outline" onClick={() => { setShowArchivedDeals((current) => !current); if (!showArchivedDeals) void loadArchivedRecords(); }}>{showArchivedDeals ? 'Active Deals' : 'Archived Deals'}</Button></div></div>
                  {clientDeals.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center"><p className="text-sm text-slate-500">No deals recorded for this client.</p>{canManageDeal && <Button size="sm" onClick={openAddDeal} className="mt-3">Add Deal</Button>}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-slate-200"><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Deal</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Product / Service</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Stage</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Prob.</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Value</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Expected Close</th><th className="px-3 py-3 text-xs font-bold uppercase text-slate-500">Tasks</th><th className="px-3 py-3 text-right text-xs font-bold uppercase text-slate-500">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">
                  {clientDeals.map(deal => {
                    const openTaskCount = tasks.filter((task) => task.relatedTo?.type === 'Deal' && task.relatedTo.id === deal.id && task.status === 'Pending').length;
                    return (
                    <tr key={deal.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select')) setSelectedDealId(deal.id); }} className="cursor-pointer transition-colors hover:bg-slate-50"><td className="px-3 py-3"><button type="button" onClick={() => setSelectedDealId(deal.id)} className="font-semibold text-slate-900 hover:text-blue-600">{deal.title}</button></td><td className="px-3 py-3 text-sm text-slate-600">{deal.productServiceName || '—'}</td><td className="px-3 py-3"><Badge variant={deal.stage === 'Won' ? 'green' : deal.stage === 'Lost' ? 'red' : 'purple'}>{deal.stage}</Badge></td><td className="px-3 py-3 text-sm text-slate-600">{getDealProbability(deal.stage)}%</td><td className="px-3 py-3 text-sm font-bold text-slate-900">{formatCurrency(deal.value, settings.currency)}</td><td className="px-3 py-3 text-sm text-slate-600">{deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}</td><td className="px-3 py-3 text-sm text-slate-600">{openTaskCount > 0 ? `${openTaskCount} ${openTaskCount === 1 ? 'Task' : 'Tasks'}` : '—'}</td><td className="px-3 py-3 text-right">{canManageDeal && <IconActionButton icon={<Archive size={15} />} label="Archive Deal" onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'archive', id: deal.id, name: deal.title })} />}</td></tr>
                    );
                  })}
                  </tbody></table></div>}
                  {showArchivedDeals && <div className="space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived Deals</p>{archivedDeals.filter((deal) => deal.clientId === selectedClientId).length === 0 ? <p className="text-sm text-slate-500">No archived deals.</p> : archivedDeals.filter((deal) => deal.clientId === selectedClientId).map((deal) => <div key={deal.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-700">{deal.title}</p><p className="text-xs text-slate-500">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div>{canManageDeal && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Deal" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'restore', id: deal.id, name: deal.title })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Deal permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'delete', id: deal.id, name: deal.title })} /></div>}</div>)}</div>}
                </Card>
              </div>
            )}

            {activeTab === 'tasks' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Client Tasks & Follow-ups</h3>
                  <div className="flex flex-wrap gap-2">{canManageTask && <Button size="sm" onClick={openAddTask} className="gap-2"><Plus size={14} /> Add Task</Button>}<Button size="sm" variant="outline" onClick={() => { setShowArchivedTasks((current) => !current); if (!showArchivedTasks) void loadArchivedRecords(); }}>{showArchivedTasks ? 'Active Tasks' : 'Archived Tasks'}</Button></div>
                </div>
                {(() => {
                  const clientTasks = tasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId);
                  const openTasks = sortOpenTasks(clientTasks.filter((task) => task.status === 'Pending'), currentTime);
                  const completedTasks = clientTasks.filter((task) => task.status === 'Completed').sort((left, right) => (right.updatedAt || right.dueDate).localeCompare(left.updatedAt || left.dueDate));
                  const nextFollowUp = getNextFollowUp(clientTasks, currentTime);
                  return <>
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{openTasks.length} Open Tasks</p>{nextFollowUp && <p className="text-xs text-slate-500">Next: {nextFollowUp.title}</p>}</div>
                    <div className="space-y-3">
                      {openTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} canManage={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid)} onToggle={(taskId) => void handleCompleteTask(taskId)} onArchive={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? (taskId) => setDetailConfirmAction({ entity: 'Task', kind: 'archive', id: taskId, name: task.title }) : undefined} />)}
                      {openTasks.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No open tasks for this client.</p>}
                    </div>
                    {completedTasks.length > 0 && <details className="rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-600">Completed ({completedTasks.length})</summary><div className="mt-3 space-y-3">{completedTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} canManage={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid)} onToggle={(taskId) => void handleCompleteTask(taskId)} onArchive={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? (taskId) => setDetailConfirmAction({ entity: 'Task', kind: 'archive', id: taskId, name: task.title }) : undefined} />)}</div></details>}
                    {showArchivedTasks && <div className="space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived Tasks</p>{archivedTasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId).length === 0 ? <p className="text-sm text-slate-500">No archived tasks.</p> : archivedTasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId).map((task) => { const taskCanManage = canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid); return <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-700">{task.title}</p><p className="text-xs text-slate-500">{task.status} · {formatTaskDueDate(task.dueDate, settings.timezone)}</p></div>{taskCanManage && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Task" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Task', kind: 'restore', id: task.id, name: task.title })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Task permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Task', kind: 'delete', id: task.id, name: task.title })} /></div>}</div>; })}</div>}
                  </>;
                })()}
              </Card>
            )}

            {activeTab === 'activity' && (
              <Card className="space-y-4">
                <h3 className="font-bold text-slate-900">Activity History</h3>
                <div className="space-y-3">
                  {activities.filter((activity) => (
                    (activity.entityType === 'Client' && activity.entityId === selectedClientId)
                    || (activity.entityType === 'Lead' && activity.entityId === selectedClient.sourceLeadId)
                    || activity.metadata?.clientId === selectedClientId
                  )).map(act => (
                    <div key={act.id} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{act.description}</p>
                        <span className="text-[10px] text-slate-400">Created by {act.createdBy || 'Unknown user'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {activeTab === 'notes' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Client Notes</h3>
                  <div className="flex flex-wrap gap-2">{canManage && <Button size="sm" onClick={() => setShowAddNoteModal(true)} className="gap-2"><Plus size={14} /> Add Note</Button>}<Button size="sm" variant="outline" onClick={() => setShowArchivedNotes((current) => !current)}>{showArchivedNotes ? 'Active Notes' : 'Archived Notes'}</Button></div>
                </div>
                <div className="space-y-3">
                  {clientNotesLoading ? <p className="text-xs text-slate-400">Loading notes…</p> : clientNotesError ? <p className="text-xs text-red-600">{clientNotesError}</p> : clientNotes.map(note => (
                    <div key={note.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="min-w-0 space-y-2"><p className="text-sm text-slate-800">{note.content}</p><div className="flex justify-between gap-3 text-xs text-slate-400">
                        <span>Author: {note.author}</span>
                        <span>{new Date(note.createdAt).toLocaleString()}</span>
                      </div></div>{canManage && <IconActionButton icon={<Archive size={15} />} label="Archive Note" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'archive', id: note.id, name: note.content.slice(0, 40) || 'Note' })} />}</div>
                  ))}
                  {!clientNotesLoading && clientNotesHasMore && <div className="text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientNotes()} disabled={clientNotesLoading}>Load More</Button></div>}
                  {showArchivedNotes && <div className="space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived Notes</p>{archivedClientNotes.filter((note) => note.clientId === selectedClientId).length === 0 ? <p className="text-sm text-slate-500">No archived notes.</p> : archivedClientNotes.filter((note) => note.clientId === selectedClientId).map((note) => <div key={note.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="min-w-0 text-sm text-slate-700">{note.content}</p>{canManage && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Note" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'restore', id: note.id, name: note.content.slice(0, 40) || 'Note' })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Note permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'delete', id: note.id, name: note.content.slice(0, 40) || 'Note' })} /></div>}</div>)}</div>}
                </div>
              </Card>
            )}

            {activeTab === 'documents' && (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">Client Documents</h3>
                    <p className="text-xs text-slate-500">Secure files stored for this client.</p>
                    <p className="text-xs text-slate-400">Maximum file size: 1 MB</p>
                  </div>
                  <div className="flex flex-wrap gap-2">{canManage && !selectedClient.archived && <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 ${documentSaving ? 'pointer-events-none opacity-60' : ''}`}>
                    <Upload size={14} /> {documentSaving ? 'Uploading…' : 'Upload document'}
                    <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png" disabled={documentSaving} onChange={(event) => void handleDocumentUpload(event)} />
                  </label>}<Button size="sm" variant="outline" onClick={() => setShowArchivedDocuments((current) => !current)}>{showArchivedDocuments ? 'Active Documents' : 'Archived Documents'}</Button></div>
                </div>
                {clientDocumentsLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading documents…</p> : clientDocumentsError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{clientDocumentsError}</p> : clientDocuments.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No documents uploaded yet.</p> : <><div className="divide-y divide-slate-100 rounded-lg border border-slate-200">{clientDocuments.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="flex min-w-0 items-center gap-3"><FileText size={18} className="shrink-0 text-slate-400" /><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{document.name}</p><p className="text-xs text-slate-500">{formatDocumentSize(document.size)} · {document.mimeType} · {formatCompactDateTime(document.uploadedAt, settings.timezone)} · {document.uploadedByName || document.uploadedBy || 'Unknown user'}</p></div></div><div className="flex shrink-0 gap-1">{document.downloadURL && <IconActionButton icon={<Download size={15} />} label={`Download ${document.name}`} variant="primary" onClick={() => window.open(document.downloadURL, '_blank', 'noopener,noreferrer')} />}{canManage && <IconActionButton icon={<Archive size={15} />} label="Archive Document" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'archive', id: document.id, name: document.name })} />}</div></div>)}</div>{clientDocumentsHasMore && <div className="pt-2 text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientDocuments()} disabled={clientDocumentsLoading}>Load More</Button></div>}</>}
                {showArchivedDocuments && <div className="space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived Documents</p>{archivedClientDocuments.filter((document) => document.clientId === selectedClientId).length === 0 ? <p className="text-sm text-slate-500">No archived documents.</p> : archivedClientDocuments.filter((document) => document.clientId === selectedClientId).map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex min-w-0 items-center gap-3"><FileText size={18} className="shrink-0 text-slate-400" /><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-700">{document.name}</p><p className="text-xs text-slate-500">{formatDocumentSize(document.size)} · {document.mimeType} · {formatCompactDateTime(document.uploadedAt, settings.timezone)}</p></div></div><div className="flex shrink-0 gap-1">{document.downloadURL && <IconActionButton icon={<Download size={15} />} label={`Download ${document.name}`} variant="primary" onClick={() => window.open(document.downloadURL, '_blank', 'noopener,noreferrer')} />}{canManage && <><IconActionButton icon={<RotateCcw size={15} />} label="Restore Document" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'restore', id: document.id, name: document.name })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Document permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'delete', id: document.id, name: document.name })} /></>}</div></div>)}</div>}
              </Card>
            )}

          </div>
        </div>
      ) : (
        /* Client List View */
        <div className="space-y-6">
          <PageHeader title="Clients" subtitle="Manage customer accounts and relationships." actions={<>{<Button variant="outline" onClick={toggleArchived}>{showArchived ? 'Active Clients' : 'Archived Clients'}</Button>}{canManage && <Button onClick={openAddClient} className="gap-2"><Plus size={18} /> Add Client</Button>}</>} />

          <Card className="flex flex-col gap-4 p-4 md:flex-row md:flex-wrap md:items-center">
            <div className="relative min-w-0 flex-1 md:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="Search clients by name, company, or email..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Client quick filter" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={clientQuickFilter} onChange={(event) => setClientQuickFilter(event.target.value as ClientQuickFilter)}>
                <option>All</option>
                <option>Active Deals</option>
                <option>No Active Deals</option>
                <option>Follow-up Due</option>
                <option>No Follow-up</option>
              </select>
              <Button variant="outline" onClick={() => setShowClientFilters((current) => !current)} className="gap-2"><Filter size={18} /> Filter</Button>
              <Button variant="outline" onClick={() => void refreshClients()} disabled={clientsLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>
            </div>
            {showClientFilters && <div className="flex w-full flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-slate-500">Company<input type="text" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} placeholder="Filter by company" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">Client since<input type="date" value={clientSinceFrom} onChange={(event) => setClientSinceFrom(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">Through<input type="date" value={clientSinceTo} onChange={(event) => setClientSinceTo(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
              <Button variant="ghost" onClick={() => { setClientQuickFilter('All'); setCompanyFilter(''); setClientSinceFrom(''); setClientSinceTo(''); }}>Clear filters</Button>
            </div>}
          </Card>

          {showArchived && <Card className="p-0"><div className="border-b bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700">Archived Clients</div>{archivedClients.length === 0 ? <p className="p-6 text-sm text-slate-500">No archived clients.</p> : <div className="divide-y divide-slate-100">{archivedClients.map((client) => <div key={client.id} className="flex items-center justify-between px-6 py-4"><div><p className="font-semibold text-slate-900">{client.name}</p><p className="text-sm text-slate-500">{client.company || client.email}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Client" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: client.id, name: client.name })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Client permanently" variant="danger" onClick={() => setConfirmAction({ kind: "delete", id: client.id, name: client.name })} /></div></div>)}</div>}{archivedClientsHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreArchivedClients()}>Load More</Button></div>}</Card>}

          {/* Client Table */}
          <Card className="p-0 overflow-hidden">
            {clientsLoading ? <p className="p-10 text-center text-sm text-slate-500">Loading clients…</p> : filteredClientRows.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{clientsError ? 'Clients could not be loaded.' : <>No clients yet.<span className="mt-1 block text-xs font-normal text-slate-400">Convert a lead or add a client to get started.</span></>}</p> : <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Client</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Company</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Contact</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Client Since</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Active Deals</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Total Sales</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Next Follow-up</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredClientRows.map(({ client, activeDeals, totalSales, nextFollowUp: nextFU, nextFollowUpIsOverdue }) => {
                    return (
                      <tr key={client.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select')) setSelectedClientId(client.id); }} className="cursor-pointer transition-colors hover:bg-slate-50">
                        <td className="px-6 py-4 font-semibold text-slate-900">
                          <button onClick={() => setSelectedClientId(client.id)} className="hover:text-blue-600 text-left">
                            {client.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{client.company || 'Private'}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          <div className="flex items-center gap-1"><Mail size={12}/> {client.email}</div>
                          <div className="flex items-center gap-1 mt-0.5"><Phone size={12}/> {client.phone}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{new Date(client.createdAt).toLocaleDateString()}</td>
                        <td className="px-6 py-4">
                          {activeDeals > 0 ? <Badge variant="purple">{activeDeals} Active</Badge> : <span className="text-sm text-slate-500">0</span>}
                        </td>
                        <td className={`px-6 py-4 text-sm font-semibold ${totalSales > 0 ? 'text-green-600' : 'text-slate-500'}`}>{formatCurrency(totalSales, settings.currency)}</td>
                        <td className={`px-6 py-4 text-xs ${nextFollowUpIsOverdue ? 'font-medium text-amber-700' : nextFU === 'No pending follow-ups' ? 'text-slate-400' : 'text-slate-500'}`}>{nextFU}</td>
                        <td className="px-6 py-4 text-right">
                          <IconActionButton icon={<ExternalLink size={15} />} label="View Client" variant="primary" onClick={() => setSelectedClientId(client.id)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
          </Card>
          {!showArchived && clientsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreClients()} disabled={clientsLoading}>{clientsLoading ? 'Loading…' : 'Load More Clients'}</Button></div>}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleCreateClient} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Add New Client</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Client Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={clientForm.name}
                  onChange={e => setClientForm({...clientForm, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                  <input 
                    type="email" 
                    required 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={clientForm.email}
                    onChange={e => setClientForm({...clientForm, email: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={clientForm.phone}
                    onChange={e => setClientForm({...clientForm, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={clientForm.company}
                    onChange={e => setClientForm({...clientForm, company: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Assigned To</label>
                  <select className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm" value={clientForm.assignedToUid} disabled={usersLoading} onChange={e => { const assignee = users.find(item => item.uid === e.target.value); setClientForm({ ...clientForm, assignedToUid: e.target.value, assignedToName: assignee?.name || '' }); }}>
                    <option value="">Unassigned</option>
                    {users.map(item => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient}>{savingClient ? 'Saving…' : 'Save Client'}</Button>
              </div>
            </form>
          </div>
        )}

        {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={selectedClient?.name} leadName={leads.find((lead) => lead.id === selectedDeal.leadId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canWrite={canWrite} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid && canWrite)} canAssign={canManage} saving={savingClient} tasks={tasks} canAddTask={canManageTask} onAddTask={async (task) => { await addTask(task); refreshSelectedClientTabCounts(); }} onCompleteTask={handleCompleteTask} currentUser={user} onClose={() => setSelectedDealId(null)} onSave={async (input) => { setSavingClient(true); try { await updateDeal(selectedDeal.id, input); refreshSelectedClientTabCounts(); } finally { setSavingClient(false); } }} />}

        {showEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleUpdateClient} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Edit Client</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Client Name</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={editClientForm.name}
                  onChange={e => setEditClientForm({...editClientForm, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                  <input 
                    type="email" 
                    required 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={editClientForm.email}
                    onChange={e => setEditClientForm({...editClientForm, email: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={editClientForm.phone}
                    onChange={e => setEditClientForm({...editClientForm, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={editClientForm.company}
                    onChange={e => setEditClientForm({...editClientForm, company: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Assigned To</label>
                  <select className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm" value={editClientForm.assignedToUid} disabled={usersLoading} onChange={e => { const assignee = users.find(item => item.uid === e.target.value); setEditClientForm({ ...editClientForm, assignedToUid: e.target.value, assignedToName: assignee?.name || '' }); }}>
                    <option value="">Unassigned</option>
                    {editClientForm.assignedToUid && !users.some(item => item.uid === editClientForm.assignedToUid) && <option value={editClientForm.assignedToUid}>{editClientForm.assignedToName || 'Legacy assignee'}</option>}
                    {users.map(item => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient}>{savingClient ? 'Saving…' : 'Update Client'}</Button>
              </div>
            </form>
          </div>
        )}

        {showAddDealModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleCreateDeal} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Add Deal for Client</h3>
              <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-bold uppercase text-slate-500">Client</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedClient?.name || 'Client'}</p></div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Deal Title</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={dealForm.title}
                  onChange={e => setDealForm({...dealForm, title: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Product / Service (Optional)</label>
                <input type="text" className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm" value={dealForm.productServiceName} onChange={e => setDealForm({...dealForm, productServiceName: e.target.value})} placeholder="e.g. Website Development" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Deal Value</label>
                  <MoneyInput
                    aria-label="Deal value"
                    value={dealForm.value}
                    currency={settings.currency}
                    required
                    className="px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    onChange={value => setDealForm({...dealForm, value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Stage</label>
                  <select 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    value={dealForm.stage}
                    onChange={e => setDealForm({...dealForm, stage: e.target.value})}
                  >
                    {dealCreationStages.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                  <p className="text-xs font-semibold text-blue-600">{getDealProbability(dealForm.stage)}% Probability</p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Expected Close Date</label>
                <input 
                  type="date" 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={dealForm.expectedCloseDate}
                  onChange={e => setDealForm({...dealForm, expectedCloseDate: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Notes (Optional)</label>
                <textarea rows={3} className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm" value={dealForm.notes} onChange={e => setDealForm({...dealForm, notes: e.target.value})} placeholder="Short context about this deal" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddDealModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient || !defaultDealStage}>{savingClient ? 'Saving…' : 'Create Deal'}</Button>
              </div>
            </form>
          </div>
        )}

        {showAddTaskModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleCreateTask} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Add Task & Follow-up</h3>
              <p className="text-sm text-slate-500">Related to: {selectedClient?.name || 'Client'}</p>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Task Title</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={taskForm.title}
                  onChange={e => setTaskForm({...taskForm, title: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Schedule Date &amp; Time</label>
                  <input 
                    type="datetime-local"
                    required 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={taskForm.dueDate}
                    onChange={e => setTaskForm({...taskForm, dueDate: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Priority</label>
                  <select 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    value={taskForm.priority}
                    onChange={e => setTaskForm({...taskForm, priority: e.target.value as any})}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>
              <p className="text-xs font-medium text-slate-600">{Date.parse(taskForm.dueDate) > currentTime ? 'This task will be scheduled.' : 'This task is due now or overdue.'}</p>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                <textarea 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  rows={3}
                  value={taskForm.description}
                  onChange={e => setTaskForm({...taskForm, description: e.target.value})}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddTaskModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingTask}>{savingTask ? 'Saving…' : 'Create Task'}</Button>
              </div>
            </form>
          </div>
        )}

        {showAddNoteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleCreateNote} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Add Note</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Note Content</label>
                <textarea 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  rows={4}
                  value={noteForm.content}
                  onChange={e => setNoteForm({...noteForm, content: e.target.value})}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddNoteModal(false)}>Cancel</Button>
                <Button type="submit">Save Note</Button>
              </div>
            </form>
          </div>
        )}

      </AnimatePresence>
      {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This client will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This client will be restored to the active list.' : 'This action cannot be undone. This archived client will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
      {detailConfirmAction && <ConfirmActionDialog open title={`${detailConfirmAction.kind === 'archive' ? 'Archive' : detailConfirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${detailConfirmAction.name}”${detailConfirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={detailConfirmAction.kind === 'archive' ? `This ${detailConfirmAction.entity.toLowerCase()} will be moved to Archived and can be restored later.` : detailConfirmAction.kind === 'restore' ? `This ${detailConfirmAction.entity.toLowerCase()} will be restored to the active list.` : `This action cannot be undone. This archived ${detailConfirmAction.entity.toLowerCase()} will be permanently deleted.`} confirmLabel={detailConfirmAction.kind === 'archive' ? 'Archive' : detailConfirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={detailConfirmAction.kind === 'delete' ? 'danger' : detailConfirmAction.kind === 'archive' ? 'warning' : 'default'} loading={detailConfirmBusy} onCancel={() => setDetailConfirmAction(null)} onConfirm={() => void executeDetailConfirmedAction()} />}
    </div>
  );
}

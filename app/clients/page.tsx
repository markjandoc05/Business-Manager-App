'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { MobileQuickActionMenu } from '@/components/MobileQuickActionMenu';
import { ModalCloseButton, ModalHeader } from '@/components/ModalCloseButton';
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
import { canManageClients, canManageDeals, canManageSales, canManageTasks } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import { DEAL_ACTIVE_STAGES, getDealCreationStages, getDealProbability, getDefaultDealCreationStage } from '@/lib/deal-workflow';
import { DealDetailsModal } from '@/components/DealDetailsModal';
import { DealCatalogItemsField } from '@/components/DealCatalogItemsField';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { TaskCard } from '@/components/TaskCard';
import { formatCompactDateTime, formatTaskDueDate, getNextFollowUp, sortOpenTasks } from '@/lib/task-utils';
import { getDefaultAssignment } from '@/lib/ownership';
import { IconActionButton } from '@/components/IconActionButton';
import { getLifecycleDecision } from '@/lib/repositories/lifecycle';
import type { LifecycleDecision } from '@/lib/record-lifecycle';
import { previewBulkLifecycle } from '@/lib/repositories/lifecycle';
import type { BulkLifecycleAction, BulkLifecycleResult } from '@/lib/repositories/lifecycle';
import { BulkActionToolbar } from '@/components/BulkActionToolbar';
import { TablePagination } from '@/components/TablePagination';
import { SortableColumnHeader } from '@/components/SortableColumnHeader';
import { compareDate, compareNumber, compareText, type SortDirection } from '@/lib/table-sorting';
import { MoneyInput } from '@/components/MoneyInput';
import { getDealProductServiceName, getDealValue } from '@/lib/deal-items';
import type { ClientTabCounts } from '@/lib/repositories/clientCounts';
import { listActivitiesForClientPage } from '@/lib/repositories/activities';
import { activityBelongsToClient } from '@/lib/activity-history';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { getClientDocumentSizeError } from '@/lib/client-documents';
import { createSale, getActiveSaleForDeal, listClientSalesPage, getClientSalesSummary, type CreateSaleInput } from '@/lib/repositories/sales';
import { RecordSaleModal, SaleDetailsModal } from '@/components/SaleRecordModal';
import { Archive, Download, FileText, ReceiptText, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { Activity, Client, Deal, DealLineItem, Sale, Task } from '@/types';
type ClientColumn = 'select' | 'client' | 'company' | 'contact' | 'clientSince' | 'activeDeals' | 'totalSales' | 'action';
type ClientSortKey = Exclude<ClientColumn, 'select' | 'action'>;
type ClientSort = { key: ClientSortKey; direction: SortDirection } | null;
type ClientDealForm = { title: string; value: number; items: DealLineItem[]; stage: string; expectedCloseDate: string; notes: string; lossReason: string };
const CLIENT_SALES_LOAD_ERROR = 'Unable to load Client Sales History. Please try again.';
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
    dealsLoading,
    dealsError,
    leads,
    tasks,
    tasksLoading,
    refreshDeals,
    refreshLeads,
    refreshTasks,
    settings, 
    addDeal, 
    updateDeal,
    addTask, 
    updateTask,
    addNote, 
    updateNote,
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
    trashedClients,
    archivedDeals,
    archivedTasks,
    loadArchivedRecords,
    loadTrashRecords,
    loadMoreArchivedClients,
    loadMoreTrashedClients,
    archivedClientsHasMore,
    trashedClientsHasMore,
    restoreClient,
    trashClient,
    permanentlyDeleteClient,
    archiveDeal,
    restoreDeal,
    permanentlyDeleteDeal,
    archiveTask,
    restoreTask,
    permanentlyDeleteTask,
    executeBulkLifecycleAction: executeBulkLifecycleInApp,
  } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, canWrite } = useWorkspace();
  const canManage = canManageClients(membership) && canWrite;
  const canManageDeal = canManageDeals(membership) && canWrite;
  const canManageSale = canManageSales(membership) && canWrite;
  const canManageTask = canManageTasks(membership) && canWrite;
  const canCreateTask = canWrite && (canManageTask || membership?.role === 'USER');
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [savingDeal, setSavingDeal] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'trash' | 'restore' | 'delete'; id: string; name: string; decision?: LifecycleDecision } | null>(null);
  const [trashDecisions, setTrashDecisions] = useState<Record<string, LifecycleDecision>>({});
  const [detailConfirmAction, setDetailConfirmAction] = useState<{ entity: 'Deal' | 'Task' | 'Note' | 'Document'; kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [detailConfirmBusy, setDetailConfirmBusy] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkClientAction, setBulkClientAction] = useState<BulkLifecycleAction | ''>('');
  const [bulkClientBusy, setBulkClientBusy] = useState(false);
  const [bulkClientConfirmation, setBulkClientConfirmation] = useState<{ action: BulkLifecycleAction; ids: string[]; results: BulkLifecycleResult[] } | null>(null);
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(25);
  const [clientSort, setClientSort] = useState<ClientSort>(null);
  const [showArchivedDeals, setShowArchivedDeals] = useState(false);
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);
  const [showArchivedDocuments, setShowArchivedDocuments] = useState(false);
  const notesLoadedForClientRef = useRef<string | null>(null);
  const archivedNotesLoadedForClientRef = useRef<string | null>(null);
  const documentsLoadedForClientRef = useRef<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [clientQuickFilter, setClientQuickFilter] = useState<ClientQuickFilter>('All');
  const [showClientFilters, setShowClientFilters] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('');
  const [clientSinceFrom, setClientSinceFrom] = useState('');
  const [clientSinceTo, setClientSinceTo] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => searchParams.get('clientId'));
  const [activeTab, setActiveTab] = useState<'overview' | 'deals' | 'tasks' | 'activity' | 'notes' | 'documents' | 'sales'>('overview');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddDealModal, setShowAddDealModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [recordSaleDealId, setRecordSaleDealId] = useState<string | null>(null);
  const [dealSaleActionId, setDealSaleActionId] = useState<string | null>(null);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({ title: '', description: '', type: 'Follow-up' as 'Task' | 'Follow-up', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High', assignedToUid: '', assignedToName: '' });
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [clientTabCounts, setClientTabCounts] = useState<{ clientId: string; counts: ClientTabCounts } | null>(null);
  const [clientTabCountsLoading, setClientTabCountsLoading] = useState(false);
  const [clientTabCountsError, setClientTabCountsError] = useState<string | null>(null);
  const [clientActivities, setClientActivities] = useState<Activity[]>([]);
  const [clientActivitiesLoading, setClientActivitiesLoading] = useState(false);
  const [clientActivitiesError, setClientActivitiesError] = useState<string | null>(null);
  const [clientSales, setClientSales] = useState<Sale[]>([]);
  const [clientSalesCursor, setClientSalesCursor] = useState<import('@/lib/repositories/pagination').FirestoreCursor>(null);
  const [clientSalesHasMore, setClientSalesHasMore] = useState(false);
  const [clientSalesLoading, setClientSalesLoading] = useState(false);
  const [clientSalesError, setClientSalesError] = useState<string | null>(null);
  const [clientSalesTotal, setClientSalesTotal] = useState(0);
  const [selectedClientSale, setSelectedClientSale] = useState<Sale | null>(null);
  const [clientSalesSourceFilter, setClientSalesSourceFilter] = useState<'ALL' | 'DEAL' | 'CLIENT'>('ALL');
  const [clientSalesPaymentFilter, setClientSalesPaymentFilter] = useState<'ALL' | Sale['paymentStatus']>('ALL');
  const [clientSalesLifecycleFilter, setClientSalesLifecycleFilter] = useState<'ALL' | 'ACTIVE' | 'VOIDED'>('ALL');
  const [clientDealSearch, setClientDealSearch] = useState('');
  const [clientDealStageFilter, setClientDealStageFilter] = useState('ALL');
  const [clientTaskStatusFilter, setClientTaskStatusFilter] = useState('ALL');
  const [clientTaskPriorityFilter, setClientTaskPriorityFilter] = useState('ALL');
  const [clientDealsPage, setClientDealsPage] = useState(1);
  const [clientTasksPage, setClientTasksPage] = useState(1);
  const [clientActivitiesCursor, setClientActivitiesCursor] = useState<import('@/lib/repositories/pagination').FirestoreCursor>(null);
  const [clientActivitiesHasMore, setClientActivitiesHasMore] = useState(false);
  const clientActivitiesRequestRef = useRef(0);
  const [clientNotesPage, setClientNotesPage] = useState(1);
  const [clientDocumentsPage, setClientDocumentsPage] = useState(1);
  const [clientSalesReloadToken, setClientSalesReloadToken] = useState(0);
  const [activityReloadToken, setActivityReloadToken] = useState(0);
  const [activityFilter, setActivityFilter] = useState<'All' | 'Deals' | 'Tasks' | 'Notes'>('All');
  const clientTabCountsRequestRef = useRef(0);
  const currentOrganizationForCountsRef = useRef(currentOrganizationId);

  // Form states
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const dealCreationStages = getDealCreationStages(settings.pipelineStages);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const [dealForm, setDealForm] = useState<ClientDealForm>({ title: '', value: 0, items: [], stage: defaultDealStage, expectedCloseDate: '', notes: '', lossReason: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High', description: '' });
  const [noteForm, setNoteForm] = useState({ content: '' });
  const [currentTime] = useState(() => Date.now());
  const previousOrganizationId = useRef(currentOrganizationId);

  // Selected client computed data
  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedClientSourceLeadId = selectedClient?.sourceLeadId;
  const refreshClientActivity = useCallback(() => setActivityReloadToken((current) => current + 1), []);

  useEffect(() => {
    currentOrganizationForCountsRef.current = currentOrganizationId;
  }, [currentOrganizationId]);

  const loadClientTabCounts = useCallback(async (_clientId?: string, _sourceLeadId?: string) => undefined, []);

  const displayedClientTabCounts = clientTabCounts?.clientId === selectedClientId ? clientTabCounts.counts : null;

  const refreshSelectedClientTabCounts = () => {
    if (selectedClientId) void loadClientTabCounts(selectedClientId, selectedClientSourceLeadId);
  };

  const adjustSelectedClientTabCounts = useCallback((changes: Partial<ClientTabCounts>) => {
    setClientTabCounts((current) => current && current.clientId === selectedClientId
      ? { ...current, counts: { ...current.counts, ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, Math.max(0, (current.counts[key as keyof ClientTabCounts] || 0) + Number(value))])) } }
      : current);
  }, [selectedClientId]);

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
      if (queryTab === 'tasks' || queryTab === 'deals' || queryTab === 'activity' || queryTab === 'notes' || queryTab === 'documents' || queryTab === 'sales' || queryTab === 'overview') {
        setActiveTab(queryTab);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, user]);

  useEffect(() => {
    if (!selectedClientId) {
      notesLoadedForClientRef.current = null;
      archivedNotesLoadedForClientRef.current = null;
      return;
    }
    if (activeTab === 'notes' && notesLoadedForClientRef.current !== selectedClientId) {
      notesLoadedForClientRef.current = selectedClientId;
      void loadClientNotes(selectedClientId);
    }
  }, [activeTab, loadClientNotes, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || !user || !currentOrganizationId) return;
    let cancelled = false;
    setClientSalesLoading(true);
    setClientSalesError(null);
    setClientSales([]);
    setClientSalesCursor(null);
    setClientSalesHasMore(false);
    void Promise.all([
      getClientSalesSummary(user, currentOrganizationId, selectedClientId),
      activeTab === 'sales' ? listClientSalesPage(user, currentOrganizationId, selectedClientId, null, undefined, {
        source: clientSalesSourceFilter === 'ALL' ? undefined : clientSalesSourceFilter,
        paymentStatus: clientSalesPaymentFilter === 'ALL' ? undefined : clientSalesPaymentFilter,
        status: clientSalesLifecycleFilter === 'ALL' ? undefined : clientSalesLifecycleFilter,
      }) : Promise.resolve(null),
    ]).then(([summary, page]) => {
      if (cancelled) return;
      setClientSalesTotal(summary.total);
      if (page) { setClientSales(page.items); setClientSalesCursor(page.nextCursor); setClientSalesHasMore(page.hasMore); }
    }).catch((loadError) => {
      console.error('Unable to load Client Sales History', loadError);
      if (!cancelled) setClientSalesError(CLIENT_SALES_LOAD_ERROR);
    })
      .finally(() => { if (!cancelled) setClientSalesLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, clientSalesLifecycleFilter, clientSalesPaymentFilter, clientSalesReloadToken, clientSalesSourceFilter, currentOrganizationId, selectedClientId, user]);

  const loadMoreClientSales = async () => {
    if (!selectedClientId || !user || !currentOrganizationId || !clientSalesCursor || clientSalesLoading) return;
    setClientSalesLoading(true);
    try { const page = await listClientSalesPage(user, currentOrganizationId, selectedClientId, clientSalesCursor, undefined, { source: clientSalesSourceFilter === 'ALL' ? undefined : clientSalesSourceFilter, paymentStatus: clientSalesPaymentFilter === 'ALL' ? undefined : clientSalesPaymentFilter, status: clientSalesLifecycleFilter === 'ALL' ? undefined : clientSalesLifecycleFilter }); setClientSales((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]); setClientSalesCursor(page.nextCursor); setClientSalesHasMore(page.hasMore); }
    catch (loadError) { console.error('Unable to load more Client Sales History', loadError); setClientSalesError(CLIENT_SALES_LOAD_ERROR); }
    finally { setClientSalesLoading(false); }
  };


  useEffect(() => {
    if (clientNotesError) notesLoadedForClientRef.current = null;
  }, [clientNotesError]);

  useEffect(() => {
    if (!selectedClientId) return;
    void Promise.all([refreshDeals(), refreshTasks()]);
  }, [refreshDeals, refreshTasks, selectedClientId]);

  useEffect(() => {
    if (!selectedDealId || !currentOrganizationId) return;
    void refreshLeads();
  }, [currentOrganizationId, refreshLeads, selectedDealId]);

  useEffect(() => {
    if (!selectedClientId || activeTab !== 'activity' || !currentOrganizationId) {
      return;
    }
    let cancelled = false;
    const requestId = ++clientActivitiesRequestRef.current;
    setClientActivities([]);
    setClientActivitiesCursor(null);
    setClientActivitiesHasMore(false);
    queueMicrotask(() => {
      if (cancelled) return;
      setClientActivitiesLoading(true);
      setClientActivitiesError(null);
      void listActivitiesForClientPage(user, currentOrganizationId, selectedClientId, selectedClientSourceLeadId)
        .then((page) => { if (!cancelled && requestId === clientActivitiesRequestRef.current) { setClientActivities(page.items); setClientActivitiesCursor(page.nextCursor); setClientActivitiesHasMore(page.hasMore); } })
        .catch((error) => {
          console.error('Unable to load selected Client activities', error);
          if (!cancelled && requestId === clientActivitiesRequestRef.current) setClientActivitiesError(userFacingErrorMessage(error, 'Unable to load activity history.'));
        })
        .finally(() => { if (!cancelled && requestId === clientActivitiesRequestRef.current) setClientActivitiesLoading(false); });
    });
    return () => { cancelled = true; clientActivitiesRequestRef.current += 1; };
  }, [activeTab, activityReloadToken, currentOrganizationId, selectedClientId, selectedClientSourceLeadId, user]);

  const loadMoreClientActivities = async () => {
    if (!selectedClientId || activeTab !== 'activity' || !currentOrganizationId || !clientActivitiesCursor || clientActivitiesLoading) return;
    const requestId = ++clientActivitiesRequestRef.current;
    const organizationId = currentOrganizationId;
    const clientId = selectedClientId;
    setClientActivitiesLoading(true);
    try {
      const page = await listActivitiesForClientPage(user, organizationId, clientId, selectedClientSourceLeadId, clientActivitiesCursor);
      if (requestId !== clientActivitiesRequestRef.current || organizationId !== currentOrganizationId || clientId !== selectedClientId) return;
      setClientActivities((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setClientActivitiesCursor(page.nextCursor);
      setClientActivitiesHasMore(page.hasMore);
    } catch (error) {
      console.error('Unable to load more Client activities', error);
      if (requestId === clientActivitiesRequestRef.current) setClientActivitiesError(userFacingErrorMessage(error, 'Unable to load activity history.'));
    } finally {
      if (requestId === clientActivitiesRequestRef.current) setClientActivitiesLoading(false);
    }
  };

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
    if (showArchivedNotes && archivedNotesLoadedForClientRef.current !== selectedClientId) {
      archivedNotesLoadedForClientRef.current = selectedClientId;
      void loadArchivedClientNotes(selectedClientId);
    }
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
      setActionError(userFacingErrorMessage(error, 'Unable to upload the document. Please try again.'));
    } finally {
      setDocumentSaving(false);
    }
  };

  const dealsByClientId = useMemo(() => {
    const grouped = new Map<string, typeof deals>();
    deals.forEach((deal) => grouped.set(deal.clientId, [...(grouped.get(deal.clientId) || []), deal]));
    return grouped;
  }, [deals]);
  const pendingClientTasksByClientId = useMemo(() => {
    const grouped = new Map<string, typeof tasks>();
    tasks.forEach((task) => {
      if (task.relatedTo?.type !== 'Client' || task.status !== 'Pending') return;
      const clientId = task.relatedTo.id;
      grouped.set(clientId, [...(grouped.get(clientId) || []), task]);
    });
    return grouped;
  }, [tasks]);
  const clientDeals = useMemo(() => selectedClientId ? dealsByClientId.get(selectedClientId) || [] : [], [dealsByClientId, selectedClientId]);
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;
  const openDealSale = async (deal: Deal) => {
    if (!user || !currentOrganizationId || deal.status !== 'Won' || !canManageSale || dealSaleActionId) return;
    setDealSaleActionId(deal.id);
    try {
      const existingSale = await getActiveSaleForDeal(user, currentOrganizationId, deal.id);
      if (existingSale) setSelectedClientSale(existingSale);
      else setRecordSaleDealId(deal.id);
    } catch (saleError) {
      setActionError(userFacingErrorMessage(saleError, 'Unable to check the Deal Sale.'));
    } finally {
      setDealSaleActionId(null);
    }
  };
  const submitClientDealSale = async (input: CreateSaleInput) => {
    if (!user || !currentOrganizationId) return;
    await createSale(user, currentOrganizationId, input);
    setRecordSaleDealId(null);
  };
  const pendingDealTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tasks.forEach((task) => {
      if (task.relatedTo?.type !== 'Deal' || task.status !== 'Pending') return;
      counts.set(task.relatedTo.id, (counts.get(task.relatedTo.id) || 0) + 1);
    });
    return counts;
  }, [tasks]);
  const activeDealsCount = clientDeals.filter((deal) => DEAL_ACTIVE_STAGES.includes(deal.stage as typeof DEAL_ACTIVE_STAGES[number])).length;
  const totalSalesValue = clientSalesTotal;
  const activePipelineDeals = clientDeals.filter((deal) => DEAL_ACTIVE_STAGES.includes(deal.stage as typeof DEAL_ACTIVE_STAGES[number]));
  const activePipelineValue = activePipelineDeals.reduce((sum, deal) => sum + deal.value, 0);
  const weightedForecast = activePipelineDeals.reduce((sum, deal) => sum + deal.value * getDealProbability(deal.stage) / 100, 0);
  const wonValue = clientDeals.filter((deal) => deal.status === 'Won').reduce((sum, deal) => sum + deal.value, 0);

  // Next follow up task
  const selectedClientTasks = useMemo(() => selectedClientId ? tasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId) : [], [selectedClientId, tasks]);
  const clientTasks = useMemo(() => selectedClientTasks.filter((task) => task.status === 'Pending'), [selectedClientTasks]);
  const openClientTasks = useMemo(() => sortOpenTasks(clientTasks, currentTime), [clientTasks, currentTime]);
  const visibleClientSales = clientSales.filter((sale) => (clientSalesSourceFilter === 'ALL' || sale.source === clientSalesSourceFilter) && (clientSalesPaymentFilter === 'ALL' || sale.paymentStatus === clientSalesPaymentFilter) && (clientSalesLifecycleFilter === 'ALL' || sale.status === clientSalesLifecycleFilter));
  const visibleClientDeals = clientDeals.filter((deal) => (!clientDealSearch.trim() || `${deal.title} ${deal.productServiceName || ''}`.toLowerCase().includes(clientDealSearch.trim().toLowerCase())) && (clientDealStageFilter === 'ALL' || deal.stage === clientDealStageFilter));
  const visibleOpenClientTasks = openClientTasks.filter((task) => (clientTaskStatusFilter === 'ALL' || task.status === clientTaskStatusFilter) && (clientTaskPriorityFilter === 'ALL' || task.priority === clientTaskPriorityFilter));
  const clientDetailPageSize = 10;
  const pagedClientDeals = visibleClientDeals.slice(0, clientDealsPage * clientDetailPageSize);
  const pagedClientTasks = visibleOpenClientTasks.slice(0, clientTasksPage * clientDetailPageSize);
  const completedClientTasks = useMemo(() => selectedClientTasks.filter((task) => task.status === 'Completed').sort((left, right) => (right.updatedAt || right.dueDate).localeCompare(left.updatedAt || left.dueDate)), [selectedClientTasks]);
  const nextTask = getNextFollowUp(clientTasks, currentTime);
  const nextFollowUp = nextTask ? `${Date.parse(nextTask.dueDate) <= currentTime ? 'Overdue: ' : ''}${new Date(nextTask.dueDate).toLocaleString()}` : 'No pending follow-ups';

  const visibleClients = clients.filter(client => client.status !== 'ARCHIVED' && !client.trashed);
  const clientRows = useMemo(() => visibleClients.map((client) => {
    const clientDeals = dealsByClientId.get(client.id) || [];
    const activeDeals = clientDeals.filter((deal) => DEAL_ACTIVE_STAGES.includes(deal.stage as typeof DEAL_ACTIVE_STAGES[number])).length;
    const totalSales = clientDeals.filter((deal) => deal.status === 'Won').reduce((sum, deal) => sum + deal.value, 0);
    const pendingFollowUps = pendingClientTasksByClientId.get(client.id) || [];
    const nextClientTask = getNextFollowUp(pendingFollowUps, currentTime);
    const nextFollowUpIsOverdue = Boolean(nextClientTask && Date.parse(nextClientTask.dueDate) <= currentTime);
    return {
      client,
      activeDeals,
      totalSales,
      hasFollowUp: Boolean(nextClientTask),
      nextFollowUp: nextClientTask ? `${nextFollowUpIsOverdue ? 'Overdue · ' : ''}${formatCompactDateTime(nextClientTask.dueDate, settings.timezone)}` : '—',
      nextFollowUpIsOverdue,
    };
  }), [currentTime, dealsByClientId, pendingClientTasksByClientId, settings.timezone, visibleClients]);

  const filteredClientRows = useMemo(() => clientRows.filter(({ client, activeDeals, hasFollowUp }) => {
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
  }), [clientQuickFilter, clientRows, clientSinceFrom, clientSinceTo, companyFilter, searchTerm]);
  useEffect(() => {
    if (showArchived || showTrash || !currentOrganizationId || !user) return;
    const timer = window.setTimeout(() => void refreshClients(undefined, searchTerm, clientPageSize), searchTerm.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [clientPageSize, currentOrganizationId, refreshClients, searchTerm, showArchived, showTrash, user]);
  const sortedClientRows = useMemo(() => {
    if (!clientSort) return filteredClientRows;
    const sorted = [...filteredClientRows];
    sorted.sort((left, right) => {
      switch (clientSort.key) {
        case 'client': return compareText(left.client.name, right.client.name, clientSort.direction);
        case 'company': return compareText(left.client.company, right.client.company, clientSort.direction);
        case 'contact': return compareText(left.client.email || left.client.phone, right.client.email || right.client.phone, clientSort.direction);
        case 'clientSince': return compareDate(left.client.createdAt, right.client.createdAt, clientSort.direction);
        case 'activeDeals': return compareNumber(left.activeDeals, right.activeDeals, clientSort.direction);
        case 'totalSales': return compareNumber(left.totalSales, right.totalSales, clientSort.direction);
      }
    });
    return sorted;
  }, [clientSort, filteredClientRows]);
  const selectableClientRows = showArchived
    ? archivedClients
    : showTrash
      ? trashedClients
      : filteredClientRows.map(({ client }) => client);
  const clientPageCount = Math.max(1, Math.ceil(filteredClientRows.length / clientPageSize));
  const safeClientPage = Math.min(clientPage, clientPageCount);
  const currentPageClients = showArchived || showTrash ? selectableClientRows : sortedClientRows.slice((safeClientPage - 1) * clientPageSize, safeClientPage * clientPageSize).map(({ client }) => client);
  const selectedMatchingClientIds = selectableClientRows.filter((client) => selectedClientIds.has(client.id)).map((client) => client.id);
  const selectedVisibleClientIds = currentPageClients.filter((client) => selectedClientIds.has(client.id)).map((client) => client.id);
  const allVisibleClientsSelected = currentPageClients.length > 0 && selectedVisibleClientIds.length === currentPageClients.length;
  const someVisibleClientsSelected = selectedVisibleClientIds.length > 0 && !allVisibleClientsSelected;
  const clientBulkActions = showTrash
    ? [{ value: 'restore', label: 'Restore' }, { value: 'permanent-delete', label: 'Delete permanently' }]
    : showArchived
      ? [{ value: 'restore', label: 'Restore' }, { value: 'trash', label: 'Move to Trash' }]
      : [{ value: 'archive', label: 'Archive' }, { value: 'trash', label: 'Move to Trash' }];
  const bulkClientBlocked = bulkClientConfirmation?.results.filter((result) => !result.ok || result.decision?.outcome === 'BLOCKED').length || 0;
  const bulkClientAffected = bulkClientConfirmation?.results.reduce((total, result) => total + Object.values(result.decision?.cleanupRecords || {}).reduce((sum, count) => sum + count, 0), 0) || 0;
  const bulkClientPreviewDescription = bulkClientConfirmation
    ? bulkClientConfirmation.results.map((result) => {
      const name = [...clients, ...archivedClients, ...trashedClients].find((client) => client.id === result.id)?.name || result.id;
      const cleanup = Object.entries(result.decision?.cleanupRecords || {}).map(([label, count]) => `${count} ${label}`).join(', ');
      return `${name}: ${result.ok ? cleanup || 'no eligible related records' : result.error || 'unavailable'}.`;
    }).join(' ')
    : '';

  const toggleClientSelection = (clientId: string) => setSelectedClientIds((current) => {
    const next = new Set(current);
    if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
    return next;
  });
  const toggleAllVisibleClients = () => setSelectedClientIds((current) => {
    const next = new Set(current);
    if (allVisibleClientsSelected) currentPageClients.forEach((client) => next.delete(client.id));
    else currentPageClients.forEach((client) => next.add(client.id));
    return next;
  });
  const selectAllMatchingClients = () => setSelectedClientIds((current) => new Set([...current, ...selectableClientRows.map((client) => client.id)]));
  const resetClientTableContext = () => {
    setClientPage(1);
    setSelectedClientIds(new Set());
  };
  const handleClientSearchChange = (value: string) => { resetClientTableContext(); setSearchTerm(value); };
  const handleClientQuickFilterChange = (value: ClientQuickFilter) => { resetClientTableContext(); setClientQuickFilter(value); };
  const handleCompanyFilterChange = (value: string) => { resetClientTableContext(); setCompanyFilter(value); };
  const handleClientSinceFromChange = (value: string) => { resetClientTableContext(); setClientSinceFrom(value); };
  const handleClientSinceToChange = (value: string) => { resetClientTableContext(); setClientSinceTo(value); };
  const clearClientTableFilters = () => {
    resetClientTableContext();
    setClientQuickFilter('All');
    setCompanyFilter('');
    setClientSinceFrom('');
    setClientSinceTo('');
  };
  const handleClientSort = (key: ClientSortKey) => {
    setClientSort((current) => current?.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
    setClientPage(1);
  };
  const runBulkClientPreview = async () => {
    if (!user || !currentOrganizationId || !bulkClientAction || selectedMatchingClientIds.length === 0) return;
    setBulkClientBusy(true);
    setActionError(null);
    try {
      const results = await previewBulkLifecycle(user, currentOrganizationId, 'Client', bulkClientAction, selectedMatchingClientIds);
      setBulkClientConfirmation({ action: bulkClientAction, ids: selectedMatchingClientIds, results });
    } catch (error) {
      console.error('Unable to preview bulk Client action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to preview the bulk Client action. Please try again.'));
    } finally {
      setBulkClientBusy(false);
    }
  };

  const executeBulkClientAction = async () => {
    if (!bulkClientConfirmation || bulkClientBusy) return;
    setBulkClientBusy(true);
    setActionError(null);
    try {
      const results = await executeBulkLifecycleInApp('Client', bulkClientConfirmation.action, bulkClientConfirmation.ids);
      const failed = results.filter((result) => !result.ok);
      const succeeded = results.filter((result) => result.ok);
      setSelectedClientIds((current) => new Set([...current].filter((id) => failed.some((result) => result.id === id))));
      setBulkClientConfirmation(null);
      if (failed.length > 0) setActionError(`${succeeded.length} Client${succeeded.length === 1 ? '' : 's'} processed. ${failed.length} failed: ${failed.map((result) => result.error || result.id).join(' ')}`);
    } catch (error) {
      console.error('Unable to execute bulk Client action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to complete the bulk Client action. Please try again.'));
    } finally {
      setBulkClientBusy(false);
      setBulkClientAction('');
    }
  };

  const toggleArchived = () => {
    const next = !showArchived;
    setClientPage(1);
    setShowArchived(next);
    setShowTrash(false);
    setSelectedClientIds(new Set());
    setBulkClientAction('');
    if (next && archivedClients.length === 0) void loadArchivedRecords();
  };

  const toggleTrash = () => {
    const next = !showTrash;
    setClientPage(1);
    setShowTrash(next);
    setShowArchived(false);
    setSelectedClientIds(new Set());
    setBulkClientAction('');
    if (next && trashedClients.length === 0) void loadTrashRecords();
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
      refreshClientActivity();
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
      } else if (confirmAction.kind === 'trash') {
        await trashClient(confirmAction.id);
        setSelectedClientId(null);
      } else if (confirmAction.kind === 'restore') {
        await restoreClient(confirmAction.id);
      } else if (confirmAction.decision?.outcome !== 'BLOCKED') {
        await permanentlyDeleteClient(confirmAction.id);
      }
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete client lifecycle action', error);
      setActionError(userFacingErrorMessage(error, 'Unable to complete the client action. Please try again.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const requestClientLifecycleAction = async (kind: 'archive' | 'trash', client: Client) => {
    if (!user || !currentOrganizationId || !canManage) return;
    const decision = await getLifecycleDecision(user, currentOrganizationId, 'Client', kind, client.id);
    if (decision.outcome === 'BLOCKED') { setActionError(`${decision.reason} ${decision.recommendedAction}`); return; }
    setConfirmAction({ kind, id: client.id, name: client.name, decision });
  };

  const handlePermanentDelete = async (client: Client) => {
    if (!user || !currentOrganizationId || !canManage || confirmBusy) return;
    setConfirmBusy(true);
    setActionError(null);
    try {
      const decision = await getLifecycleDecision(user, currentOrganizationId, 'Client', 'permanent-delete', client.id);
      setTrashDecisions((current) => ({ ...current, [client.id]: decision }));
      setConfirmAction({ kind: 'delete', id: client.id, name: client.name, decision });
    } catch (error) {
      console.error('Unable to evaluate client deletion', error);
      setActionError(userFacingErrorMessage(error, 'Unable to evaluate client deletion. Please try again.'));
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
        if (kind === 'archive') adjustSelectedClientTabCounts({ deals: -1 });
        else if (kind === 'restore') adjustSelectedClientTabCounts({ deals: 1 });
      } else if (entity === 'Task') {
        if (kind === 'archive') await archiveTask(id);
        else if (kind === 'restore') await restoreTask(id);
        else await permanentlyDeleteTask(id);
        if (kind === 'archive') adjustSelectedClientTabCounts({ tasks: -1 });
        else if (kind === 'restore') adjustSelectedClientTabCounts({ tasks: 1 });
      } else if (entity === 'Note') {
        if (kind === 'archive') await archiveClientNote(selectedClientId, id);
        else if (kind === 'restore') await restoreClientNote(selectedClientId, id);
        else await permanentlyDeleteClientNote(selectedClientId, id);
        if (kind === 'archive') adjustSelectedClientTabCounts({ notes: -1 });
        else if (kind === 'restore') adjustSelectedClientTabCounts({ notes: 1 });
      } else {
        if (kind === 'archive') await archiveClientDocument(selectedClientId, id);
        else if (kind === 'restore') await restoreClientDocument(selectedClientId, id);
        else await permanentlyDeleteClientDocument(selectedClientId, id);
        await loadClientDocuments(selectedClientId);
        await loadArchivedClientDocuments(selectedClientId);
      }
      if (entity === 'Document') refreshSelectedClientTabCounts();
      if (entity !== 'Document') refreshClientActivity();
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
              : userFacingErrorMessage(error, 'Unable to complete the record action. Please try again.'),
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
    setSavingDeal(true);
    setActionError(null);
    try {
      await addDeal({
        title: dealForm.title,
        clientId: selectedClientId,
        value: Number(dealForm.value),
        items: dealForm.items,
        stage: dealForm.stage,
        expectedCloseDate: dealForm.expectedCloseDate,
        notes: dealForm.notes,
        lossReason: dealForm.lossReason,
      });
      adjustSelectedClientTabCounts({ deals: 1 });
      refreshClientActivity();
      setDealForm({ title: '', value: 0, items: [], stage: defaultDealStage, expectedCloseDate: '', notes: '', lossReason: '' });
      setShowAddDealModal(false);
    } catch (error) {
      console.error('Unable to create deal', error);
      setActionError('Unable to create the deal. Please try again.');
    } finally {
      setSavingDeal(false);
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
    if (!selectedClientId || !taskForm.title || !taskForm.dueDate || !canCreateTask) return;
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
      adjustSelectedClientTabCounts({ tasks: 1 });
      refreshClientActivity();
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
    if (busyTaskId) return;
    setBusyTaskId(taskId);
    setActionError(null);
    try {
      await completeTask(taskId);
      refreshClientActivity();
    } catch (error) {
      console.error('Unable to update client task status', error);
      setActionError(userFacingErrorMessage(error, 'Unable to update the task. Please try again.'));
      throw error;
    } finally {
      setBusyTaskId(null);
    }
  };

  const openAddTask = () => {
    setTaskForm((current) => ({ ...current, dueDate: toDateTimeInput(current.dueDate) }));
    setShowAddTaskModal(true);
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !noteForm.content || savingNote) return;
    setSavingNote(true);
    setActionError(null);
    try {
      await addNote(selectedClientId, noteForm.content);
      adjustSelectedClientTabCounts({ notes: 1 });
      refreshClientActivity();
      setNoteForm({ content: '' });
      setShowAddNoteModal(false);
    } catch (error) {
      console.error('Unable to save client note', error);
      setActionError('Unable to save the note. Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setEditTaskForm({
      title: task.title,
      description: task.description || '',
      type: task.type === 'Task' ? 'Task' : 'Follow-up',
      dueDate: toDateTimeInput(task.dueDate),
      priority: task.priority,
      assignedToUid: task.assignedToUid || '',
      assignedToName: task.assignedToName || task.assignedTo || '',
    });
  };

  const handleEditTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTask || !editTaskForm.title.trim() || !editTaskForm.dueDate || savingTaskEdit) return;
    setSavingTaskEdit(true);
    setActionError(null);
    try {
      await updateTask(editingTask.id, { ...editTaskForm, relatedTo: editingTask.relatedTo });
      setEditingTask(null);
      refreshClientActivity();
    } catch (error) {
      setActionError(userFacingErrorMessage(error, 'Unable to update the task. Please try again.'));
    } finally {
      setSavingTaskEdit(false);
    }
  };

  const openEditNote = (noteId: string, content: string) => {
    setEditingNoteId(noteId);
    setEditNoteContent(content);
  };

  const handleEditNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClientId || !editingNoteId || !editNoteContent.trim() || savingNoteEdit) return;
    setSavingNoteEdit(true);
    setActionError(null);
    try {
      await updateNote(selectedClientId, editingNoteId, editNoteContent);
      setEditingNoteId(null);
      refreshClientActivity();
    } catch (error) {
      setActionError(userFacingErrorMessage(error, 'Unable to update the note. Please try again.'));
    } finally {
      setSavingNoteEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      {(actionError || clientsError) && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{actionError || clientsError}</p>}
      {/* If Client is Selected, Show Client Profile */}
      {selectedClient ? (
        <div className={`space-y-6 ${selectedMatchingClientIds.length > 0 ? 'pb-24' : ''}`}>
          {/* Back Button & Client Profile Header */}
          <div className="client-detail-header relative">
            <Button variant="ghost" onClick={() => setSelectedClientId(null)} className="-ml-2 mb-3 w-fit gap-2 px-2 text-[var(--app-muted)]">
              <ArrowLeft size={16} /> Back to Clients
            </Button>
            <div className="client-profile-hero overflow-hidden rounded-[var(--app-radius-panel)] bg-[var(--app-primary)] px-5 py-5 text-white shadow-[var(--app-shadow-sm)] sm:px-6 sm:py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl font-semibold text-[var(--app-primary)] shadow-[var(--app-shadow-xs)] sm:h-20 sm:w-20 sm:text-3xl" aria-hidden="true">
                    {selectedClient.name.trim().charAt(0).toUpperCase() || 'C'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl">{selectedClient.name}</h2>
                      <span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/90">
                        {selectedClient.status === 'ARCHIVED' || selectedClient.archived ? 'Archived Client' : 'Active Client'}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-sm text-white/65">{selectedClient.company ? `${selectedClient.company} • ` : ''}Client since {formatClientSince(selectedClient.createdAt)}</p>
                  </div>
                </div>
                <div className="client-detail-header-actions flex w-full flex-wrap items-center justify-start gap-2 lg:w-auto lg:shrink-0 lg:justify-end">
                  {canManage && <Button variant="secondary" onClick={() => {
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
                  {canManage && <Button variant="warning" onClick={() => void requestClientLifecycleAction('archive', selectedClient)} className="gap-2">
                    Archive Client
                  </Button>}
                  {canManageDeal && <Button variant="secondary" onClick={openAddDeal} className="gap-2">
                    <Plus size={16} /> Add Deal
                  </Button>}
                </div>
              </div>
            </div>
            <div className="absolute right-0 top-0"><ModalCloseButton onClose={() => setSelectedClientId(null)} /></div>
          </div>

          {/* Client Summary Banner */}
          <Card className="grid grid-cols-2 gap-3 border-[var(--app-border)] bg-white px-[15px] py-4 sm:gap-4 sm:px-[15px] sm:py-5 md:grid-cols-4">
            <div className="min-w-0 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">Company & Contact</p>
              <div className="flex min-w-0 items-center gap-2">
                <Building2 size={16} className="shrink-0 text-[var(--app-primary)]" aria-hidden="true" />
                <p className="min-w-0 break-words text-base font-semibold leading-5 text-[var(--app-text)]">{selectedClient.company || 'Independent'}</p>
              </div>
              <div className="space-y-2 text-sm text-[var(--app-muted)]">
                <div className="flex min-w-0 items-start gap-2">
                  <Mail size={15} className="mt-0.5 shrink-0 text-[var(--app-tertiary)]" aria-hidden="true" />
                  <span className="min-w-0 break-all leading-5">{selectedClient.email || 'No email provided'}</span>
                </div>
                <div className="flex min-w-0 items-start gap-2">
                  <Phone size={15} className="mt-0.5 shrink-0 text-[var(--app-tertiary)]" aria-hidden="true" />
                  <span className="min-w-0 break-words leading-5">{selectedClient.phone || 'No phone provided'}</span>
                </div>
              </div>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">Active Sales / Deals</p>
              <p className="text-base font-semibold text-[var(--app-primary)]">{formatCurrency(totalSalesValue, settings.currency)}</p>
              <p className="text-xs text-[var(--app-muted)]">{activeDealsCount} Active Deals / {clientDeals.length} Total</p>
            </div>
            <div className="min-w-0 space-y-1 pt-3 md:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">Assigned To</p>
              <p className="text-base font-semibold text-[var(--app-text)]">{selectedClient.assignedToName || selectedClient.assignedTo || 'Unassigned'}</p>
              <p className="text-xs text-[var(--app-muted)]">Client Since: {new Date(selectedClient.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="min-w-0 space-y-1 pt-3 md:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">Next Follow-up</p>
              <p className="text-sm font-medium text-[var(--app-text)]">{nextFollowUp}</p>
              {canCreateTask && <button type="button" onClick={openAddTask} className="mt-1 inline-flex min-h-8 items-center px-0.5 py-1 text-xs font-medium text-[var(--app-primary)] underline underline-offset-4 transition-colors hover:text-[var(--app-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2">
                + Add Task
              </button>}
            </div>
          </Card>

          {/* Profile Navigation Tabs */}
          <div className="client-profile-tabs flex gap-6 overflow-x-auto border-b border-[var(--app-border)]" aria-label="Client detail sections">
            {[
              { id: 'overview', label: 'Overview' },
                { id: 'deals', label: 'Deals' },
                { id: 'sales', label: 'Sales' },
                { id: 'tasks', label: 'Tasks' },
                { id: 'activity', label: 'Activity Log' },
                { id: 'notes', label: 'Notes' },
                { id: 'documents', label: 'Documents' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`client-profile-tab whitespace-nowrap pb-3 font-semibold text-sm transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id 
                    ? 'border-[var(--app-primary)] text-[var(--app-primary)]'
                    : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="space-y-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <Card className="space-y-4">
                  <h3 className="font-bold text-[var(--app-text)]">Deals Overview</h3>
                  {dealsLoading ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Loading deal summary" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-[var(--app-surface-subtle)]" />)}</div> : dealsError ? <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{dealsError}</p> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-[var(--app-surface-subtle)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-tertiary)]">Open Deals</p><p className="mt-1 text-lg font-bold text-[var(--app-text)]">{activePipelineDeals.length}</p><p className="text-xs text-[var(--app-muted)]">Deals in progress</p></div>
                    <div className="rounded-xl bg-[var(--app-surface-subtle)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-tertiary)]">Potential Sales</p><p className="mt-1 text-lg font-bold text-[var(--app-text)]">{formatCurrency(activePipelineValue, settings.currency)}</p><p className="text-xs text-[var(--app-muted)]">Total value of open deals</p></div>
                    <div className="rounded-xl bg-[var(--app-surface-subtle)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-tertiary)]">Expected Sales</p><p className="mt-1 text-lg font-bold text-[var(--app-text)]">{formatCurrency(weightedForecast, settings.currency)}</p><p className="text-xs text-[var(--app-muted)]">Based on deal probability</p></div>
                    <div className="rounded-xl bg-[var(--app-surface-subtle)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-tertiary)]">Won Sales</p><p className="mt-1 text-lg font-bold text-[var(--app-text)]">{formatCurrency(wonValue, settings.currency)}</p><p className="text-xs text-[var(--app-muted)]">Successfully closed deals</p></div>
                  </div>}
                </Card>
              </div>
            )}

            {activeTab === 'deals' && (
              <div className="space-y-4">
                <Card className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-[var(--app-text)]">Client Deals</h3><div className="flex flex-wrap gap-2">{canManageDeal && <Button size="sm" onClick={openAddDeal} className="gap-2"><Plus size={14} /> Add Deal</Button>}<Button size="sm" variant="outline" onClick={() => { setShowArchivedDeals((current) => !current); if (!showArchivedDeals) void loadArchivedRecords(); }}>{showArchivedDeals ? 'Active Deals' : 'Archived Deals'}</Button></div></div>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--app-surface-subtle)] p-2"><input aria-label="Search client deals" className="min-w-[12rem] flex-1" placeholder="Search deals" value={clientDealSearch} onChange={(event) => setClientDealSearch(event.target.value)} /><select aria-label="Filter client deals by stage" value={clientDealStageFilter} onChange={(event) => setClientDealStageFilter(event.target.value)}><option value="ALL">All stages</option>{['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select><span className="text-xs text-[var(--app-muted)]">Filters apply to loaded results</span></div>
                  {dealsLoading ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">Loading deals…</p> : dealsError ? <p className="rounded-xl bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-8 text-center text-sm text-[var(--app-danger)]" role="alert">{dealsError}</p> : clientDeals.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center"><p className="text-sm text-[var(--app-muted)]">No deals recorded for this client.</p>{canManageDeal && <Button size="sm" onClick={openAddDeal} className="mt-3">Add Deal</Button>}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-[var(--app-border)]"><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Deal</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Product / Service</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Stage</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Prob.</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Value</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Expected Close</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Tasks</th><th className="px-3 py-3 text-right text-xs font-bold uppercase text-[var(--app-muted)]">Actions</th></tr></thead><tbody className="divide-y divide-[var(--app-border-subtle)]">
                  {pagedClientDeals.map(deal => {
                    const openTaskCount = pendingDealTaskCounts.get(deal.id) || 0;
                    const productServiceName = getDealProductServiceName(deal.items || [], deal.productServiceName);
                    return (
                    <tr key={deal.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select')) setSelectedDealId(deal.id); }} className="cursor-pointer transition-colors hover:bg-[var(--app-surface-subtle)]"><td className="px-3 py-3"><button type="button" onClick={() => setSelectedDealId(deal.id)} className="font-semibold text-[var(--app-text)] hover:text-[var(--app-primary)]">{deal.title}</button></td><td className="px-3 py-3 text-sm text-[var(--app-muted)]">{productServiceName || '—'}</td><td className="px-3 py-3"><Badge variant={deal.stage === 'Won' ? 'green' : deal.stage === 'Lost' ? 'red' : 'purple'}>{deal.stage}</Badge></td><td className="px-3 py-3 text-sm text-[var(--app-muted)]">{getDealProbability(deal.stage)}%</td><td className="px-3 py-3 text-sm font-bold text-[var(--app-text)]">{formatCurrency(deal.value, settings.currency)}</td><td className="px-3 py-3 text-sm text-[var(--app-muted)]">{deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}</td><td className="px-3 py-3 text-sm text-[var(--app-muted)]">{openTaskCount > 0 ? `${openTaskCount} ${openTaskCount === 1 ? 'Task' : 'Tasks'}` : '—'}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-1">{deal.stage === 'Won' && canManageSale && <IconActionButton icon={<ReceiptText size={15} />} label="Record Sale" variant="primary" disabled={dealSaleActionId === deal.id} onClick={() => void openDealSale(deal)} />}{canManageDeal && <IconActionButton icon={<Archive size={15} />} label="Archive Deal" disabled={detailConfirmBusy} onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'archive', id: deal.id, name: deal.title })} />}</div></td></tr>
                    );
                  })}
                  </tbody></table></div>}
                  {pagedClientDeals.length < visibleClientDeals.length && <div className="text-center"><Button size="sm" variant="outline" onClick={() => setClientDealsPage((page) => page + 1)}>Load more deals</Button></div>}
                  {showArchivedDeals && <div className="space-y-2 border-t border-[var(--app-border-subtle)] pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Archived Deals</p>{archivedDeals.filter((deal) => deal.clientId === selectedClientId).length === 0 ? <p className="text-sm text-[var(--app-muted)]">No archived deals.</p> : archivedDeals.filter((deal) => deal.clientId === selectedClientId).map((deal) => <div key={deal.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--app-text)]">{deal.title}</p><p className="text-xs text-[var(--app-muted)]">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div>{canManageDeal && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Deal" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'restore', id: deal.id, name: deal.title })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Deal permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Deal', kind: 'delete', id: deal.id, name: deal.title })} /></div>}</div>)}</div>}
                </Card>
              </div>
            )}

            {activeTab === 'sales' && (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-[var(--app-text)]">Client Sales History</h3><p className="text-xs text-[var(--app-muted)]">Recorded transactions for this Client. Voided Sales remain visible.</p></div><p className="text-sm font-bold text-[var(--app-text)]">Active total: {formatCurrency(clientSalesTotal, settings.currency)}</p></div>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--app-surface-subtle)] p-2"><select aria-label="Filter client sales by source" value={clientSalesSourceFilter} onChange={(event) => setClientSalesSourceFilter(event.target.value as typeof clientSalesSourceFilter)}><option value="ALL">All sources</option><option value="DEAL">Deal</option><option value="CLIENT">Client</option></select><select aria-label="Filter client sales by payment" value={clientSalesPaymentFilter} onChange={(event) => setClientSalesPaymentFilter(event.target.value as typeof clientSalesPaymentFilter)}><option value="ALL">All payments</option><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="UNPAID">Unpaid</option></select><select aria-label="Filter client sales by lifecycle" value={clientSalesLifecycleFilter} onChange={(event) => setClientSalesLifecycleFilter(event.target.value as typeof clientSalesLifecycleFilter)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="VOIDED">Voided</option></select></div>
                {clientSalesLoading && clientSales.length === 0 ? <p className="py-8 text-center text-sm text-[var(--app-muted)]">Loading Sales…</p> : clientSalesError ? <div className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert"><p>{CLIENT_SALES_LOAD_ERROR}</p><Button className="mt-2" size="sm" variant="outline" onClick={() => setClientSalesReloadToken((token) => token + 1)}>Retry</Button></div> : clientSales.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">No sales recorded for this client yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-[var(--app-border)]"><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Sale #</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Date</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Source</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Sale Total</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Amount Paid</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Balance</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Payment</th><th className="px-3 py-3 text-xs font-bold uppercase text-[var(--app-muted)]">Status</th></tr></thead><tbody className="divide-y divide-[var(--app-border-subtle)]">{visibleClientSales.map((sale) => <tr key={sale.id} className="cursor-pointer hover:bg-[var(--app-surface-subtle)]" onClick={() => setSelectedClientSale(sale)}><td className="px-3 py-3 font-semibold">{sale.saleNumber}</td><td className="px-3 py-3 text-sm">{sale.saleDate}</td><td className="px-3 py-3"><Badge variant="gray">{sale.source === 'DEAL' ? 'Deal' : sale.source === 'CLIENT' ? 'Client' : 'Walk-in'}</Badge></td><td className="px-3 py-3 text-sm font-semibold">{formatCurrency(sale.total, settings.currency)}</td><td className="px-3 py-3 text-sm">{formatCurrency(sale.amountPaid, settings.currency)}</td><td className="px-3 py-3 text-sm">{formatCurrency(sale.balance, settings.currency)}</td><td className="px-3 py-3"><Badge variant={sale.paymentStatus === 'PAID' ? 'green' : sale.paymentStatus === 'PARTIAL' ? 'orange' : 'gray'}>{sale.paymentStatus === 'PAID' ? 'Paid' : sale.paymentStatus === 'PARTIAL' ? 'Partial' : 'Unpaid'}</Badge></td><td className="px-3 py-3"><Badge variant={sale.status === 'VOIDED' ? 'red' : 'green'}>{sale.status === 'VOIDED' ? 'Voided' : 'Active'}</Badge></td></tr>)}</tbody></table></div>}
                {clientSalesHasMore && <div className="text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientSales()} disabled={clientSalesLoading}>{clientSalesLoading ? 'Loading…' : 'Load More'}</Button></div>}
              </Card>
            )}

            {activeTab === 'tasks' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-[var(--app-text)]">Client Tasks & Follow-ups</h3>
                  <div className="flex flex-wrap gap-2">{canCreateTask && <Button size="sm" onClick={openAddTask} className="gap-2"><Plus size={14} /> Add Task</Button>}<Button size="sm" variant="outline" onClick={() => { setShowArchivedTasks((current) => !current); if (!showArchivedTasks) void loadArchivedRecords(); }}>{showArchivedTasks ? 'Active Tasks' : 'Archived Tasks'}</Button></div>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--app-surface-subtle)] p-2"><select aria-label="Filter client tasks by status" value={clientTaskStatusFilter} onChange={(event) => setClientTaskStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="Pending">Pending</option><option value="Completed">Completed</option></select><select aria-label="Filter client tasks by priority" value={clientTaskPriorityFilter} onChange={(event) => setClientTaskPriorityFilter(event.target.value)}><option value="ALL">All priorities</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select><span className="text-xs text-[var(--app-muted)]">Filters apply to loaded results</span></div>
                  <>
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{visibleOpenClientTasks.length} Open Tasks</p>{nextTask && <p className="text-xs text-[var(--app-muted)]">Next: {nextTask.title}</p>}</div>
                    <div className="space-y-3">
                      {pagedClientTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} busy={busyTaskId === task.id} canManage={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid)} onEdit={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? openEditTask : undefined} onToggle={(taskId) => void handleCompleteTask(taskId).catch(() => undefined)} onArchive={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? (taskId) => setDetailConfirmAction({ entity: 'Task', kind: 'archive', id: taskId, name: task.title }) : undefined} />)}
                      {visibleOpenClientTasks.length === 0 && <p className="rounded-xl border border-dashed border-[var(--app-border)] p-6 text-center text-sm text-[var(--app-muted)]">No open tasks for this client.</p>}
                      {pagedClientTasks.length < visibleOpenClientTasks.length && <div className="text-center"><Button size="sm" variant="outline" onClick={() => setClientTasksPage((page) => page + 1)}>Load more tasks</Button></div>}
                    </div>
                    {completedClientTasks.length > 0 && <details className="rounded-xl border border-[var(--app-border-subtle)] p-3"><summary className="cursor-pointer text-sm font-semibold text-[var(--app-muted)]">Completed ({completedClientTasks.length})</summary><div className="mt-3 space-y-3">{completedClientTasks.map((task) => <TaskCard key={task.id} task={task} now={currentTime} busy={busyTaskId === task.id} canManage={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid)} onEdit={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? openEditTask : undefined} onToggle={(taskId) => void handleCompleteTask(taskId).catch(() => undefined)} onArchive={canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid) ? (taskId) => setDetailConfirmAction({ entity: 'Task', kind: 'archive', id: taskId, name: task.title }) : undefined} />)}</div></details>}
                    {showArchivedTasks && <div className="space-y-2 border-t border-[var(--app-border-subtle)] pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Archived Tasks</p>{archivedTasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId).length === 0 ? <p className="text-sm text-[var(--app-muted)]">No archived tasks.</p> : archivedTasks.filter((task) => task.relatedTo?.type === 'Client' && task.relatedTo.id === selectedClientId).map((task) => { const taskCanManage = canManageTask || (membership?.role === 'USER' && task.assignedToUid === user?.uid); return <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--app-text)]">{task.title}</p><p className="text-xs text-[var(--app-muted)]">{task.status} · {formatTaskDueDate(task.dueDate, settings.timezone)}</p></div>{taskCanManage && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Task" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Task', kind: 'restore', id: task.id, name: task.title })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Task permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Task', kind: 'delete', id: task.id, name: task.title })} /></div>}</div>; })}</div>}
                  </>
              </Card>
            )}

            {activeTab === 'activity' && (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-[var(--app-text)]">Activity History</h3><p className="text-xs text-[var(--app-muted)]">Showing the latest loaded activity. Load more for older entries.</p></div><select aria-label="Activity filter" className="rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}><option>All</option><option>Deals</option><option>Tasks</option><option>Notes</option></select></div>
                <div className="space-y-3">
                  {clientActivitiesLoading ? <p className="text-sm text-[var(--app-muted)]">Loading activity history…</p> : clientActivitiesError ? <div className="space-y-2"><p className="text-sm text-[var(--app-danger)]">{clientActivitiesError}</p><Button size="sm" variant="outline" onClick={refreshClientActivity}>Retry</Button></div> : clientActivities.filter((activity) => activityBelongsToClient(activity, selectedClient.id, selectedClient.sourceLeadId)).filter((activity) => activityFilter === 'All' || (activityFilter === 'Deals' && activity.entityType === 'Deal') || (activityFilter === 'Tasks' && activity.entityType === 'Task') || (activityFilter === 'Notes' && activity.entityType === 'Note')).map(act => (
                    <div key={act.id} className="flex items-start gap-3 p-3 bg-[var(--app-surface-subtle)] border border-[var(--app-border-subtle)] rounded-xl">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-[var(--app-primary)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-[var(--app-text)]">{act.description}</p><span className="rounded bg-[var(--app-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--app-muted)]">{act.entityType || 'Activity'}</span></div>
                        <span className="text-[10px] text-[var(--app-tertiary)]">Created by {act.createdBy || 'Unknown user'}</span>
                      </div>
                    </div>
                  ))}
                  {!clientActivitiesLoading && !clientActivitiesError && clientActivities.filter((activity) => activityBelongsToClient(activity, selectedClient.id, selectedClient.sourceLeadId)).filter((activity) => activityFilter === 'All' || (activityFilter === 'Deals' && activity.entityType === 'Deal') || (activityFilter === 'Tasks' && activity.entityType === 'Task') || (activityFilter === 'Notes' && activity.entityType === 'Note')).length === 0 && <p className="text-sm text-[var(--app-muted)]">No activity history for this Client{activityFilter === 'All' ? '' : ` in ${activityFilter.toLowerCase()}`}.</p>}
                  {!clientActivitiesLoading && !clientActivitiesError && clientActivitiesHasMore && <div className="text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientActivities()} disabled={clientActivitiesLoading}>Load More</Button></div>}
                </div>
              </Card>
            )}

            {activeTab === 'notes' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-[var(--app-text)]">Client Notes</h3>
                  <div className="flex flex-wrap gap-2">{canManage && <Button size="sm" disabled={savingNote} onClick={() => setShowAddNoteModal(true)} className="gap-2"><Plus size={14} /> Add Note</Button>}<Button size="sm" variant="outline" onClick={() => setShowArchivedNotes((current) => !current)}>{showArchivedNotes ? 'Active Notes' : 'Archived Notes'}</Button></div>
                </div>
                <div className="space-y-3">
                  {clientNotesLoading ? <p className="text-xs text-[var(--app-tertiary)]">Loading notes…</p> : clientNotesError ? <p className="text-xs text-[var(--app-danger)]">{clientNotesError}</p> : clientNotes.map(note => (
                    <div key={note.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--app-border-subtle)] bg-[var(--app-surface-subtle)] p-4"><div className="min-w-0 space-y-2"><p className="text-sm text-[var(--app-text)]">{note.content}</p><div className="flex justify-between gap-3 text-xs text-[var(--app-tertiary)]">
                        <span>Author: {note.author}</span>
                        <span>{new Date(note.createdAt).toLocaleString()}</span>
                      </div></div>{canManage && <div className="flex shrink-0 gap-1"><IconActionButton icon={<Edit size={15} />} label="Edit Note" onClick={() => openEditNote(note.id, note.content)} /><IconActionButton icon={<Archive size={15} />} label="Archive Note" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'archive', id: note.id, name: note.content.slice(0, 40) || 'Note' })} /></div>}</div>
                  ))}
                  {!clientNotesLoading && clientNotesHasMore && <div className="text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientNotes()} disabled={clientNotesLoading}>Load More</Button></div>}
                  {showArchivedNotes && <div className="space-y-2 border-t border-[var(--app-border-subtle)] pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Archived Notes</p>{archivedClientNotes.filter((note) => note.clientId === selectedClientId).length === 0 ? <p className="text-sm text-[var(--app-muted)]">No archived notes.</p> : archivedClientNotes.filter((note) => note.clientId === selectedClientId).map((note) => <div key={note.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><p className="min-w-0 text-sm text-[var(--app-text)]">{note.content}</p>{canManage && <div className="flex shrink-0 gap-1"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Note" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'restore', id: note.id, name: note.content.slice(0, 40) || 'Note' })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Note permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Note', kind: 'delete', id: note.id, name: note.content.slice(0, 40) || 'Note' })} /></div>}</div>)}</div>}
                </div>
              </Card>
            )}

            {activeTab === 'documents' && (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[var(--app-text)]">Client Documents</h3>
                    <p className="text-xs text-[var(--app-muted)]">Secure files stored for this client.</p>
                    <p className="text-xs text-[var(--app-tertiary)]">Maximum file size: 1 MB</p>
                  </div>
                  <div className="flex flex-wrap gap-2">{canManage && !selectedClient.archived && <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--app-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--app-primary-hover)] ${documentSaving ? 'pointer-events-none opacity-60' : ''}`}>
                    <Upload size={14} /> {documentSaving ? 'Uploading…' : 'Upload document'}
                    <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png" disabled={documentSaving} onChange={(event) => void handleDocumentUpload(event)} />
                  </label>}<Button size="sm" variant="outline" onClick={() => setShowArchivedDocuments((current) => !current)}>{showArchivedDocuments ? 'Active Documents' : 'Archived Documents'}</Button></div>
                </div>
                {clientDocumentsLoading ? <p className="py-8 text-center text-sm text-[var(--app-muted)]">Loading documents…</p> : clientDocumentsError ? <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]">{clientDocumentsError}</p> : clientDocuments.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">No documents uploaded yet.</p> : <><div className="divide-y divide-[var(--app-border-subtle)] rounded-lg border border-[var(--app-border)]">{clientDocuments.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="flex min-w-0 items-center gap-3"><FileText size={18} className="shrink-0 text-[var(--app-tertiary)]" /><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--app-text)]">{document.name}</p><p className="text-xs text-[var(--app-muted)]">{formatDocumentSize(document.size)} · {document.mimeType} · {formatCompactDateTime(document.uploadedAt, settings.timezone)} · {document.uploadedByName || document.uploadedBy || 'Unknown user'}</p></div></div><div className="flex shrink-0 gap-1">{document.downloadURL && <IconActionButton icon={<Download size={15} />} label={`Download ${document.name}`} variant="primary" onClick={() => window.open(document.downloadURL, '_blank', 'noopener,noreferrer')} />}{canManage && <IconActionButton icon={<Archive size={15} />} label="Archive Document" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'archive', id: document.id, name: document.name })} />}</div></div>)}</div>{clientDocumentsHasMore && <div className="pt-2 text-center"><Button size="sm" variant="outline" onClick={() => void loadMoreClientDocuments()} disabled={clientDocumentsLoading}>Load More</Button></div>}</>}
                {showArchivedDocuments && <div className="space-y-2 border-t border-[var(--app-border-subtle)] pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Archived Documents</p>{archivedClientDocuments.filter((document) => document.clientId === selectedClientId).length === 0 ? <p className="text-sm text-[var(--app-muted)]">No archived documents.</p> : archivedClientDocuments.filter((document) => document.clientId === selectedClientId).map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><div className="flex min-w-0 items-center gap-3"><FileText size={18} className="shrink-0 text-[var(--app-tertiary)]" /><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--app-text)]">{document.name}</p><p className="text-xs text-[var(--app-muted)]">{formatDocumentSize(document.size)} · {document.mimeType} · {formatCompactDateTime(document.uploadedAt, settings.timezone)}</p></div></div><div className="flex shrink-0 gap-1">{document.downloadURL && <IconActionButton icon={<Download size={15} />} label={`Download ${document.name}`} variant="primary" onClick={() => window.open(document.downloadURL, '_blank', 'noopener,noreferrer')} />}{canManage && <><IconActionButton icon={<RotateCcw size={15} />} label="Restore Document" variant="success" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'restore', id: document.id, name: document.name })} /><IconActionButton icon={<Trash2 size={15} />} label="Delete Document permanently" variant="danger" onClick={() => setDetailConfirmAction({ entity: 'Document', kind: 'delete', id: document.id, name: document.name })} /></>}</div></div>)}</div>}
              </Card>
            )}

          </div>
        </div>
      ) : (
        /* Client List View */
        <div className="space-y-6">
          <PageHeader title="Clients" subtitle="Manage customer accounts and relationships." actions={<>{<Button variant="outline" onClick={toggleArchived}>{showArchived ? 'Active Clients' : 'Archived Clients'}</Button>}<Button variant="outline" onClick={toggleTrash}>{showTrash ? 'Active Clients' : 'Trash'}</Button>{canManage && <Button onClick={openAddClient} className="gap-2"><Plus size={18} /> Add Client</Button>}</>} mobileQuickActions={<MobileQuickActionMenu items={[{ label: 'Add Client', onSelect: openAddClient, disabled: !canManage }, { label: 'Archived', onSelect: toggleArchived }, { label: 'Trash', onSelect: toggleTrash }]} />} />

          <Card className="page-filter-panel flex flex-col gap-4 p-4 md:flex-row md:flex-wrap md:items-center">
            <div className="relative min-w-0 flex-1 md:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" size={20} />
              <input
                type="text"
                placeholder="Search clients by name, company, or email..."
                className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                value={searchTerm}
                onChange={(event) => handleClientSearchChange(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Client quick filter" className="h-9 rounded-lg border border-[var(--app-border)] bg-white px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]/50" value={clientQuickFilter} onChange={(event) => handleClientQuickFilterChange(event.target.value as ClientQuickFilter)}>
                <option>All</option>
                <option>Active Deals</option>
                <option>No Active Deals</option>
                <option>Follow-up Due</option>
                <option>No Follow-up</option>
              </select>
              {clientQuickFilter !== 'All' && <span className="self-center text-[11px] text-[var(--app-muted)]">Applies to loaded clients</span>}
              <Button variant="outline" onClick={() => setShowClientFilters((current) => !current)} className="gap-2"><Filter size={18} /> Filter</Button>
              <Button variant="outline" onClick={() => void refreshClients()} disabled={clientsLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>
            </div>
            {showClientFilters && <div className="flex w-full flex-wrap items-end gap-3 border-t border-[var(--app-border-subtle)] pt-3">
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-[var(--app-muted)]">Company<input type="text" value={companyFilter} onChange={(event) => handleCompanyFilterChange(event.target.value)} placeholder="Filter by company" className="rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--app-muted)]">Client since<input type="date" value={clientSinceFrom} onChange={(event) => handleClientSinceFromChange(event.target.value)} className="rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--app-muted)]">Through<input type="date" value={clientSinceTo} onChange={(event) => handleClientSinceToChange(event.target.value)} className="rounded-lg border border-[var(--app-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]" /></label>
              <Button variant="ghost" onClick={clearClientTableFilters}>Clear filters</Button>
            </div>}
          </Card>

          {canManage && <BulkActionToolbar selectedCount={selectedMatchingClientIds.length} matchingCount={selectableClientRows.length} action={bulkClientAction} actions={clientBulkActions} processing={bulkClientBusy} onSelectAllMatching={selectAllMatchingClients} onActionChange={(action) => setBulkClientAction(action as BulkLifecycleAction)} onApply={() => void runBulkClientPreview()} onClear={() => setSelectedClientIds(new Set())} />}
          {showArchived && <Card className="p-0"><div className="border-b bg-[var(--app-surface-subtle)] px-6 py-3 text-sm font-semibold text-[var(--app-text)]">Archived Clients</div>{archivedClients.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">No archived clients.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{archivedClients.map((client) => <div key={client.id} className="flex items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><input type="checkbox" checked={selectedClientIds.has(client.id)} onChange={() => toggleClientSelection(client.id)} aria-label={`Select ${client.name}`} /><div><p className="font-semibold text-[var(--app-text)]">{client.name}</p><p className="text-sm text-[var(--app-muted)]">{client.company || client.email}</p></div></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Client" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: client.id, name: client.name })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Move Client to Trash" variant="danger" onClick={() => void requestClientLifecycleAction('trash', client)} />}</div></div>)}</div>}{archivedClientsHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreArchivedClients()}>Load More</Button></div>}</Card>}
          {showTrash && <Card className="p-0"><div className="border-b bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] px-6 py-3 text-sm font-semibold text-[var(--app-danger)]">Client Trash</div>{trashedClients.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">Trash is empty.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{trashedClients.map((client) => { const decision = trashDecisions[client.id]; const blocked = decision?.outcome === 'BLOCKED'; const blockingCount = decision ? Object.values(decision.blockingRecords).reduce((total, count) => total + count, 0) : 0; return <div key={client.id} className="flex items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><input type="checkbox" checked={selectedClientIds.has(client.id)} onChange={() => toggleClientSelection(client.id)} aria-label={`Select ${client.name}`} /><div><p className="font-semibold text-[var(--app-text)]">{client.name}</p><p className={`text-sm ${blocked ? 'text-[var(--app-danger)]' : 'text-[var(--app-muted)]'}`}>{blocked ? `Deletion blocked — ${blockingCount} related record${blockingCount === 1 ? '' : 's'}.` : decision?.outcome === 'ALLOWED_WITH_WARNING' ? 'Ready to delete with cleanup warning.' : 'Deletion status will be checked before confirmation.'}</p></div></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Client from Trash" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: client.id, name: client.name })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label={blocked ? 'View deletion block' : decision ? 'Delete Client permanently' : 'Check deletion'} variant="danger" disabled={confirmBusy} onClick={() => void handlePermanentDelete(client)} />}</div></div>; })}</div>}{trashedClientsHasMore && <div className="p-3 text-center"><Button variant="outline" onClick={() => void loadMoreTrashedClients()}>Load More</Button></div>}</Card>}

          {/* Client Table */}
          {!showArchived && !showTrash && <Card className="overflow-hidden rounded-xl border border-[var(--app-border)]/80 bg-white p-0 shadow-none">
            {clientsLoading ? <p className="flex min-h-[220px] items-center justify-center p-10 text-center text-sm text-[var(--app-muted)]">Loading clients…</p> : filteredClientRows.length === 0 ? <p className="p-10 text-center text-sm text-[var(--app-muted)]">{clientsError ? 'Clients could not be loaded.' : <>No clients yet.<span className="mt-1 block text-xs font-normal text-[var(--app-tertiary)]">Convert a lead or add a client to get started.</span></>}</p> : <div className="overflow-x-auto overscroll-x-contain">
              <table className="clients-data-table w-full min-w-[980px] xl:min-w-0 table-fixed border-separate border-spacing-0 text-left">
                <colgroup>
                  <col style={{ width: '3%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead className="bg-[var(--app-surface-subtle)]">
                  <tr className="border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)]">
                    <th scope="col" className="w-10 px-2 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" checked={allVisibleClientsSelected} ref={(element) => { if (element) element.indeterminate = someVisibleClientsSelected; }} onChange={toggleAllVisibleClients} aria-checked={someVisibleClientsSelected ? "mixed" : allVisibleClientsSelected} aria-label="Select all visible Clients" /></th>
                    <SortableColumnHeader label="Client" direction={clientSort?.key === 'client' ? clientSort.direction : undefined} onSort={() => handleClientSort('client')} compact fullWidth />
                    <SortableColumnHeader label="Company" direction={clientSort?.key === 'company' ? clientSort.direction : undefined} onSort={() => handleClientSort('company')} compact fullWidth />
                    <SortableColumnHeader label="Contact" direction={clientSort?.key === 'contact' ? clientSort.direction : undefined} onSort={() => handleClientSort('contact')} compact fullWidth />
                    <SortableColumnHeader label="Client Since" direction={clientSort?.key === 'clientSince' ? clientSort.direction : undefined} onSort={() => handleClientSort('clientSince')} compact fullWidth />
                    <SortableColumnHeader label="Active Deals" direction={clientSort?.key === 'activeDeals' ? clientSort.direction : undefined} onSort={() => handleClientSort('activeDeals')} align="center" compact fullWidth />
                    <SortableColumnHeader label="Won Deal Value" direction={clientSort?.key === 'totalSales' ? clientSort.direction : undefined} onSort={() => handleClientSort('totalSales')} align="right" compact fullWidth />
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold uppercase text-[var(--app-muted)]"><span>Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-border)]/80">
                  {sortedClientRows.slice((safeClientPage - 1) * clientPageSize, safeClientPage * clientPageSize).map(({ client, activeDeals, totalSales }) => {
                    return (
                      <tr key={client.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,select,input')) setSelectedClientId(client.id); }} className={`cursor-pointer transition-colors hover:bg-[var(--app-surface-subtle)]/80 ${selectedClientIds.has(client.id) ? 'bg-[var(--app-accent-soft)]/40' : ''}`}>
                        <td className="w-10 px-2 py-2.5 align-middle"><input type="checkbox" checked={selectedClientIds.has(client.id)} onChange={() => toggleClientSelection(client.id)} aria-label={`Select ${client.name}`} className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" /></td>
                        <td className="min-w-0 px-4 py-2 align-middle"><button onClick={() => setSelectedClientId(client.id)} className="line-clamp-2 max-w-full break-words text-left font-normal leading-5 text-[var(--app-text)] hover:text-[var(--app-primary)]">{client.name}</button></td>
                        <td className="px-4 py-2 align-middle text-sm leading-5 text-[var(--app-muted)]"><span className="line-clamp-2 break-words">{client.company || 'Private'}</span></td>
                        <td className="min-w-0 pl-4 pr-2 py-2 align-middle text-xs leading-4 text-[var(--app-muted)]">
                          <div className="flex min-w-0 items-center gap-1"><Mail className="shrink-0" size={12}/><span className="truncate">{client.email}</span></div>
                          <div className="mt-0 flex min-w-0 items-center gap-1"><Phone className="shrink-0" size={12}/><span className="truncate">{client.phone || '—'}</span></div>
                        </td>
                        <td className="pl-2 pr-4 py-2 align-middle text-sm text-[var(--app-muted)]">{new Date(client.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                        <td className="px-2 py-2 text-center align-middle">
                          {activeDeals > 0 ? <span className="inline-flex"><Badge variant="purple">{activeDeals} Active</Badge></span> : <span className="text-sm text-[var(--app-tertiary)]">—</span>}
                        </td>
                        <td className={`px-2 py-2 text-right align-middle text-sm font-semibold ${totalSales > 0 ? 'text-[var(--app-primary)]' : 'text-[var(--app-tertiary)]'}`}>{totalSales > 0 ? formatCurrency(totalSales, settings.currency) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                          <IconActionButton icon={<ExternalLink size={15} />} label="View Client" variant="primary" onClick={() => setSelectedClientId(client.id)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
            {!showArchived && !showTrash && <TablePagination page={safeClientPage} pageSize={clientPageSize} totalCount={filteredClientRows.length} hasMore={clientsHasMore} onPageChange={setClientPage} onPageSizeChange={(nextPageSize) => { setClientPageSize(nextPageSize); setClientPage(1); }} />}
          </Card>}
          {!showArchived && !showTrash && clientsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreClients()} disabled={clientsLoading}>{clientsLoading ? 'Loading…' : 'Load More Clients'}</Button></div>}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Add Client dialog">
            <form onSubmit={handleCreateClient} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <ModalHeader title="Add New Client" onClose={() => setShowAddModal(false)} />
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Client Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  value={clientForm.name}
                  onChange={e => setClientForm({...clientForm, name: e.target.value})}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Email</label>
                  <input 
                    type="email" 
                    required 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={clientForm.email}
                    onChange={e => setClientForm({...clientForm, email: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Phone</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={clientForm.phone}
                    onChange={e => setClientForm({...clientForm, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Company</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={clientForm.company}
                    onChange={e => setClientForm({...clientForm, company: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Assigned To</label>
                  <select className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm" value={clientForm.assignedToUid} disabled={usersLoading} onChange={e => { const assignee = users.find(item => item.uid === e.target.value); setClientForm({ ...clientForm, assignedToUid: e.target.value, assignedToName: assignee?.name || '' }); }}>
                    <option value="">Unassigned</option>
                    {users.map(item => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="app-modal-footer">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient}>{savingClient ? 'Saving…' : 'Save Client'}</Button>
              </div>
            </form>
          </div>
        )}

        {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={selectedClient?.name} leadName={leads.find((lead) => lead.id === selectedDeal.leadId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canWrite={canWrite} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid && canWrite)} canAssign={canManage} saving={savingDeal} productsCollapsedByDefault={true} tasks={tasks} canAddTask={canCreateTask} onAddTask={async (task) => { await addTask(task); refreshClientActivity(); }} onCompleteTask={handleCompleteTask} currentUser={user} onClose={() => setSelectedDealId(null)} onSave={async (input) => { setSavingDeal(true); try { await updateDeal(selectedDeal.id, input); refreshClientActivity(); } finally { setSavingDeal(false); } }} />}
        {recordSaleDealId && user && currentOrganizationId && (() => { const deal = deals.find((item) => item.id === recordSaleDealId); return deal ? <RecordSaleModal user={user} organizationId={currentOrganizationId} currency={settings.currency} prefill={{ dealId: deal.id, dealTitle: deal.title, clientId: deal.clientId, clientName: selectedClient?.name || 'Client', items: deal.items, value: deal.value }} onClose={() => setRecordSaleDealId(null)} onSubmit={submitClientDealSale} /> : null; })()}

        {showEditModal && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Edit Client dialog">
            <form onSubmit={handleUpdateClient} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <ModalHeader title="Edit Client" onClose={() => setShowEditModal(false)} />
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Client Name</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  value={editClientForm.name}
                  onChange={e => setEditClientForm({...editClientForm, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Email</label>
                  <input 
                    type="email" 
                    required 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={editClientForm.email}
                    onChange={e => setEditClientForm({...editClientForm, email: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Phone</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={editClientForm.phone}
                    onChange={e => setEditClientForm({...editClientForm, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Company</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={editClientForm.company}
                    onChange={e => setEditClientForm({...editClientForm, company: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Assigned To</label>
                  <select className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm" value={editClientForm.assignedToUid} disabled={usersLoading} onChange={e => { const assignee = users.find(item => item.uid === e.target.value); setEditClientForm({ ...editClientForm, assignedToUid: e.target.value, assignedToName: assignee?.name || '' }); }}>
                    <option value="">Unassigned</option>
                    {editClientForm.assignedToUid && !users.some(item => item.uid === editClientForm.assignedToUid) && <option value={editClientForm.assignedToUid}>{editClientForm.assignedToName || 'Legacy assignee'}</option>}
                    {users.map(item => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="app-modal-footer">
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient}>{savingClient ? 'Saving…' : 'Update Client'}</Button>
              </div>
            </form>
          </div>
        )}

        {showAddDealModal && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Add Deal dialog">
            <form onSubmit={handleCreateDeal} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
              <ModalHeader title="Add Deal for Client" onClose={() => setShowAddDealModal(false)} />
              <div className="rounded-xl bg-[var(--app-surface-subtle)] px-4 py-3"><p className="text-xs font-bold uppercase text-[var(--app-muted)]">Client</p><p className="mt-1 text-sm font-semibold text-[var(--app-text)]">{selectedClient?.name || 'Client'}</p></div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Deal Title</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  value={dealForm.title}
                  onChange={e => setDealForm({...dealForm, title: e.target.value})}
                />
              </div>
              {user && currentOrganizationId && <DealCatalogItemsField user={user} organizationId={currentOrganizationId} items={dealForm.items} currency={settings.currency} disabled={savingDeal} onChange={(items) => setDealForm((current) => ({ ...current, items, value: getDealValue(current.value, items) }))} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Deal Value</label>
                  {dealForm.items.length > 0 ? <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-4 py-2 text-sm font-semibold text-[var(--app-text)]">{formatCurrency(getDealValue(dealForm.value, dealForm.items), settings.currency)}</div> : <MoneyInput aria-label="Deal value" value={dealForm.value} currency={settings.currency} required className="px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm" onChange={value => setDealForm({...dealForm, value})} />}
                  {dealForm.items.length > 0 && <p className="text-xs text-[var(--app-muted)]">Calculated from Products &amp; Services.</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Stage</label>
                  <select 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm bg-white"
                    value={dealForm.stage}
                    onChange={e => setDealForm({...dealForm, stage: e.target.value})}
                  >
                    {dealCreationStages.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                  <p className="text-xs font-semibold text-[var(--app-primary)]">{getDealProbability(dealForm.stage)}% Probability</p>
                </div>
              </div>
              {dealForm.stage === 'Lost' && <div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]">Loss Reason</label><input required className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={dealForm.lossReason} onChange={(event) => setDealForm({ ...dealForm, lossReason: event.target.value })} placeholder="Why was this Deal lost?" /></div>}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Expected Close Date</label>
                <input 
                  type="date" 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  value={dealForm.expectedCloseDate}
                  onChange={e => setDealForm({...dealForm, expectedCloseDate: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Notes (Optional)</label>
                <textarea rows={3} className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm" value={dealForm.notes} onChange={e => setDealForm({...dealForm, notes: e.target.value})} placeholder="Short context about this deal" />
              </div>
              <div className="app-modal-footer">
                <Button type="button" variant="outline" onClick={() => setShowAddDealModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingDeal || !defaultDealStage}>{savingDeal ? 'Saving…' : 'Create Deal'}</Button>
              </div>
            </form>
          </div>
        )}

        {showAddTaskModal && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Add Task dialog">
            <form onSubmit={handleCreateTask} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <ModalHeader title="Add Task & Follow-up" subtitle={<>Related to: {selectedClient?.name || 'Client'}</>} onClose={() => setShowAddTaskModal(false)} />
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Task Title</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  value={taskForm.title}
                  onChange={e => setTaskForm({...taskForm, title: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Schedule Date &amp; Time</label>
                  <input 
                    type="datetime-local"
                    required 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                    value={taskForm.dueDate}
                    onChange={e => setTaskForm({...taskForm, dueDate: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Priority</label>
                  <select 
                    className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm bg-white"
                    value={taskForm.priority}
                    onChange={e => setTaskForm({...taskForm, priority: e.target.value as any})}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>
              <p className="text-xs font-medium text-[var(--app-muted)]">{Date.parse(taskForm.dueDate) > currentTime ? 'This task will be scheduled.' : 'This task is due now or overdue.'}</p>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Description</label>
                <textarea 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  rows={3}
                  value={taskForm.description}
                  onChange={e => setTaskForm({...taskForm, description: e.target.value})}
                />
              </div>
              <div className="app-modal-footer">
                <Button type="button" variant="outline" onClick={() => setShowAddTaskModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingTask}>{savingTask ? 'Saving…' : 'Create Task'}</Button>
              </div>
            </form>
          </div>
        )}

        {editingTask && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Edit Task dialog">
            <form onSubmit={handleEditTask} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
              <ModalHeader title="Edit Task" subtitle={<>Related to: {selectedClient?.name || 'Client'}</>} onClose={() => setEditingTask(null)} />
              <input required className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={editTaskForm.title} onChange={(event) => setEditTaskForm({ ...editTaskForm, title: event.target.value })} placeholder="Task title" />
              <div className="grid grid-cols-2 gap-4"><input required type="datetime-local" className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={editTaskForm.dueDate} onChange={(event) => setEditTaskForm({ ...editTaskForm, dueDate: event.target.value })} /><select className="w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2 text-sm" value={editTaskForm.priority} onChange={(event) => setEditTaskForm({ ...editTaskForm, priority: event.target.value as typeof editTaskForm.priority })}><option>Low</option><option>Medium</option><option>High</option></select></div>
              <select className="w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2 text-sm" value={editTaskForm.type} onChange={(event) => setEditTaskForm({ ...editTaskForm, type: event.target.value as typeof editTaskForm.type })}><option>Follow-up</option><option>Task</option></select>
              <textarea rows={4} className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={editTaskForm.description} onChange={(event) => setEditTaskForm({ ...editTaskForm, description: event.target.value })} placeholder="Description" />
              <div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setEditingTask(null)}>Cancel</Button><Button type="submit" disabled={savingTaskEdit}>{savingTaskEdit ? 'Saving…' : 'Save Changes'}</Button></div>
            </form>
          </div>
        )}

        {showAddNoteModal && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Add Note dialog">
            <form onSubmit={handleCreateNote} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <ModalHeader title="Add Note" onClose={() => setShowAddNoteModal(false)} />
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Note Content</label>
                <textarea 
                  required 
                  className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm"
                  rows={4}
                  value={noteForm.content}
                  onChange={e => setNoteForm({...noteForm, content: e.target.value})}
                />
              </div>
              <div className="app-modal-footer">
                <Button type="button" variant="outline" onClick={() => setShowAddNoteModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingNote}>{savingNote ? 'Saving…' : 'Save Note'}</Button>
              </div>
            </form>
          </div>
        )}

        {editingNoteId && (
          <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Edit Note dialog">
            <form onSubmit={handleEditNote} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
              <ModalHeader title="Edit Note" onClose={() => setEditingNoteId(null)} />
              <textarea required rows={5} className="w-full rounded-xl border border-[var(--app-border)] px-4 py-2 text-sm" value={editNoteContent} onChange={(event) => setEditNoteContent(event.target.value)} />
              <div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setEditingNoteId(null)}>Cancel</Button><Button type="submit" disabled={savingNoteEdit}>{savingNoteEdit ? 'Saving…' : 'Save Changes'}</Button></div>
            </form>
          </div>
        )}

      </AnimatePresence>
      {confirmAction && <ConfirmActionDialog open title={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED' ? 'Permanent deletion blocked' : `${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'trash' ? 'Move to Trash' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.decision ? `${confirmAction.decision.reason} ${Object.entries(confirmAction.decision.cleanupRecords).map(([label, count]) => `${count} ${label}`).join(', ')} ${Object.entries(confirmAction.decision.preservedRecords).map(([label, value]) => `${label}${typeof value === 'number' ? ` (${value})` : ` “${value}”`}`).join(', ')} ${confirmAction.decision.recommendedAction}` : confirmAction.kind === 'restore' ? 'This Client will be restored without changing the state of its related records.' : 'This action cannot be undone.'} confirmLabel={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED' ? 'Unavailable' : confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'trash' ? 'Move to Trash' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} confirmDisabled={confirmAction.kind === 'delete' && confirmAction.decision?.outcome === 'BLOCKED'} variant={confirmAction.kind === 'delete' || confirmAction.kind === 'trash' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
      {bulkClientConfirmation && <ConfirmActionDialog open title={(bulkClientConfirmation.action === 'permanent-delete' ? 'Permanently delete' : bulkClientConfirmation.action === 'restore' ? 'Restore' : bulkClientConfirmation.action === 'trash' ? 'Move to Trash' : 'Archive') + ' ' + bulkClientConfirmation.ids.length + ' Clients?'} description={'Preview: ' + (bulkClientConfirmation.ids.length - bulkClientBlocked) + ' ready, ' + bulkClientBlocked + ' blocked or unavailable. ' + bulkClientPreviewDescription + (bulkClientConfirmation.action === 'permanent-delete' && bulkClientAffected > 0 ? ` Total eligible related records: ${bulkClientAffected}.` : '')} confirmLabel={bulkClientConfirmation.action === 'permanent-delete' ? 'Delete Permanently' : bulkClientConfirmation.action === 'restore' ? 'Restore' : bulkClientConfirmation.action === 'trash' ? 'Move to Trash' : 'Archive'} variant={bulkClientConfirmation.action === 'permanent-delete' || bulkClientConfirmation.action === 'trash' ? 'danger' : bulkClientConfirmation.action === 'archive' ? 'warning' : 'default'} loading={bulkClientBusy} onCancel={() => setBulkClientConfirmation(null)} onConfirm={() => void executeBulkClientAction()} />}
      {selectedClientSale && <SaleDetailsModal sale={selectedClientSale} currency={settings.currency} canManage={false} onClose={() => setSelectedClientSale(null)} />}
      {detailConfirmAction && <ConfirmActionDialog open title={`${detailConfirmAction.kind === 'archive' ? 'Archive' : detailConfirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${detailConfirmAction.name}”${detailConfirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={detailConfirmAction.kind === 'archive' ? `This ${detailConfirmAction.entity.toLowerCase()} will be moved to Archived and can be restored later.` : detailConfirmAction.kind === 'restore' ? `This ${detailConfirmAction.entity.toLowerCase()} will be restored to the active list.` : `This action cannot be undone. This archived ${detailConfirmAction.entity.toLowerCase()} will be permanently deleted.`} confirmLabel={detailConfirmAction.kind === 'archive' ? 'Archive' : detailConfirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={detailConfirmAction.kind === 'delete' ? 'danger' : detailConfirmAction.kind === 'archive' ? 'warning' : 'default'} loading={detailConfirmBusy} onCancel={() => setDetailConfirmAction(null)} onConfirm={() => void executeDetailConfirmedAction()} />}
    </div>
  );
}

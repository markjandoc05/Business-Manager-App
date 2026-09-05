'use client';

import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Lead, Client, Deal, Task, Activity, Settings, DocumentItem, Note } from '../types';
import { useAuth } from '@/context/AuthContext';
import { addClientNote, archiveClient as archiveClientRepository, archiveClientDocument as archiveClientDocumentRepository, archiveClientNote as archiveClientNoteRepository, createClient as createClientRepository, getClientById, listArchivedClientDocuments, listArchivedClientNotes, listArchivedClientsPage, listClientDocumentsPage, listClientNotesPage, listClientsPage, listTrashedClientsPage, permanentlyDeleteClient as permanentlyDeleteClientRepository, permanentlyDeleteClientDocument as permanentlyDeleteClientDocumentRepository, permanentlyDeleteClientNote as permanentlyDeleteClientNoteRepository, restoreClient as restoreClientRepository, restoreClientDocument as restoreClientDocumentRepository, restoreClientNote as restoreClientNoteRepository, trashClient as trashClientRepository, uploadClientDocument, updateClient as updateClientRepository, updateClientNote as updateClientNoteRepository, type ClientInput } from '@/lib/repositories/clients';
import { archiveLead as archiveLeadRepository, convertLeadToClient as convertLeadRepository, createLead as createLeadRepository, listArchivedLeadsPage, listLeadsPage, listTrashedLeadsPage, permanentlyDeleteLead as permanentlyDeleteLeadRepository, restoreLead as restoreLeadRepository, trashLead as trashLeadRepository, updateLead as updateLeadRepository, updateLeadStatus as updateLeadStatusRepository, type LeadInput, type LeadListFilters } from '@/lib/repositories/leads';
import { archiveDeal as archiveDealRepository, createDeal as createDealRepository, listArchivedDealsPage, listDeals, permanentlyDeleteDeal as permanentlyDeleteDealRepository, restoreDeal as restoreDealRepository, updateDeal as updateDealRepository, updateDealStage as updateDealStageRepository } from '@/lib/repositories/deals';
import { getDealValue } from '@/lib/deal-items';
import { archiveTask as archiveTaskRepository, completeTask as completeTaskRepository, createTask as createTaskRepository, listArchivedTasksPage, listLeadTasks, listTasksPage, permanentlyDeleteTask as permanentlyDeleteTaskRepository, restoreTask as restoreTaskRepository, updateTask as updateTaskRepository, type TaskListFilters } from '@/lib/repositories/tasks';
import { defaultSettings, loadSettings, SettingsLoadError, SettingsPersistenceError, updateSettings as updateSettingsRepository } from '@/lib/repositories/settings';
import { invalidateDashboardMetrics } from '@/lib/repositories/dashboard';
import { listActivities } from '@/lib/repositories/activities';
import { listAssignableOrganizationUsers, type AssignableUser } from '@/lib/repositories/users';
import { getDealStatusForStage } from '@/lib/deal-workflow';
import { useWorkspace } from '@/context/WorkspaceContext';
import { firestoreQueryErrorMessage, userFacingErrorMessage, type FirestoreCursor } from '@/lib/repositories/pagination';
import { isActiveLead, isArchivedLead, isTrashedLead, dedupeLeadsById, type LeadLifecycleState } from '@/lib/lead-lifecycle';
import { executeBulkLifecycle as executeBulkLifecycleRequest, type BulkLifecycleAction as BulkLifecycleRequestAction, type BulkLifecycleResult } from '@/lib/repositories/lifecycle';

type LeadActionInput = Omit<LeadInput, 'assignedToUid' | 'assignedToName'> & Partial<Pick<LeadInput, 'assignedToUid' | 'assignedToName'>>;

interface AppContextType {
  leads: Lead[];
  leadsLoading: boolean;
  leadsError: string | null;
  refreshLeads: (filters?: LeadListFilters, pageSize?: number) => Promise<void>;
  loadMoreLeads: () => Promise<void>;
  leadsHasMore: boolean;
  clients: Client[];
  clientsLoading: boolean;
  clientsError: string | null;
  archivedClients: Client[];
  archivedLeads: Lead[];
  trashedClients: Client[];
  trashedLeads: Lead[];
  archivedDeals: Deal[];
  archivedTasks: Task[];
  archivedClientsHasMore: boolean;
  archivedLeadsHasMore: boolean;
  trashedClientsHasMore: boolean;
  trashedLeadsHasMore: boolean;
  archivedDealsHasMore: boolean;
  archivedTasksHasMore: boolean;
  loadArchivedRecords: () => Promise<void>;
  loadTrashRecords: () => Promise<void>;
  loadMoreArchivedLeads: () => Promise<void>;
  loadMoreArchivedClients: () => Promise<void>;
  loadMoreArchivedDeals: () => Promise<void>;
  loadMoreArchivedTasks: () => Promise<void>;
  loadMoreTrashedLeads: () => Promise<void>;
  loadMoreTrashedClients: () => Promise<void>;
  clientNotes: Note[];
  archivedClientNotes: Note[];
  clientNotesLoading: boolean;
  clientNotesError: string | null;
  clientDocuments: DocumentItem[];
  archivedClientDocuments: DocumentItem[];
  clientDocumentsLoading: boolean;
  clientDocumentsError: string | null;
  deals: Deal[];
  dealsLoading: boolean;
  dealsError: string | null;
  tasks: Task[];
  tasksLoading: boolean;
  tasksError: string | null;
  leadTasks: Task[];
  leadTasksLoading: boolean;
  leadTasksError: string | null;
  loadLeadTasks: (leadId: string) => Promise<void>;
  users: AssignableUser[];
  usersLoading: boolean;
  usersError: string | null;
  activities: Activity[];
  refreshActivities: () => Promise<void>;
  settings: Settings;
  settingsLoading: boolean;
  settingsError: string | null;
  addLead: (lead: LeadActionInput) => Promise<void>;
  updateLead: (leadId: string, lead: LeadActionInput) => Promise<void>;
  updateLeadStatus: (lead: Lead, status: Lead['status']) => Promise<void>;
  archiveLead: (leadId: string) => Promise<void>;
  trashLead: (leadId: string) => Promise<void>;
  addClient: (client: ClientInput) => Promise<void>;
  updateClient: (clientId: string, client: ClientInput) => Promise<void>;
  archiveClient: (clientId: string) => Promise<void>;
  trashClient: (clientId: string) => Promise<void>;
  restoreClient: (clientId: string) => Promise<void>;
  permanentlyDeleteClient: (clientId: string) => Promise<void>;
  refreshClients: (ensureClientId?: string, search?: string, pageSize?: number) => Promise<void>;
  loadMoreClients: () => Promise<void>;
  clientsHasMore: boolean;
  loadClientNotes: (clientId: string) => Promise<void>;
  loadArchivedClientNotes: (clientId: string) => Promise<void>;
  loadMoreClientNotes: () => Promise<void>;
  clientNotesHasMore: boolean;
  loadClientDocuments: (clientId: string) => Promise<void>;
  loadArchivedClientDocuments: (clientId: string) => Promise<void>;
  loadMoreClientDocuments: () => Promise<void>;
  clientDocumentsHasMore: boolean;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateDeal: (dealId: string, input: { title: string; value: number; stage: string; expectedCloseDate: string; productServiceName?: string; notes?: string; items?: Deal['items']; assignedToUid: string; assignedToName: string; lossReason: string }) => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  updateTask: (taskId: string, task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  archiveTask: (taskId: string) => Promise<void>;
  restoreTask: (taskId: string) => Promise<void>;
  permanentlyDeleteTask: (taskId: string) => Promise<void>;
  refreshTasks: (filters?: TaskListFilters) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  tasksHasMore: boolean;
  updateDealStage: (dealId: string, stage: string, status?: Deal['status'], lossReason?: string) => Promise<void>;
  refreshDeals: () => Promise<void>;
  archiveDeal: (dealId: string) => Promise<void>;
  restoreDeal: (dealId: string) => Promise<void>;
  permanentlyDeleteDeal: (dealId: string) => Promise<void>;
  restoreLead: (leadId: string) => Promise<void>;
  permanentlyDeleteLead: (leadId: string) => Promise<void>;
  executeBulkLifecycleAction: (entity: 'Lead' | 'Client', action: BulkLifecycleRequestAction, recordIds: string[]) => Promise<BulkLifecycleResult[]>;
  convertLeadToClient: (leadId: string) => Promise<void>;
  addNote: (clientId: string, content: string) => Promise<void>;
  updateNote: (clientId: string, noteId: string, content: string) => Promise<void>;
  archiveClientNote: (clientId: string, noteId: string) => Promise<void>;
  restoreClientNote: (clientId: string, noteId: string) => Promise<void>;
  permanentlyDeleteClientNote: (clientId: string, noteId: string) => Promise<void>;
  uploadDocument: (clientId: string, file: File) => Promise<void>;
  archiveClientDocument: (clientId: string, documentId: string) => Promise<void>;
  restoreClientDocument: (clientId: string, documentId: string) => Promise<void>;
  permanentlyDeleteClientDocument: (clientId: string, documentId: string) => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
  canWrite: boolean;
  isReadOnly: boolean;
  licenseState: ReturnType<typeof import('@/lib/repositories/licenses').resolveLicenseState>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const { currentOrganizationId, loading: workspaceLoading, ready: workspaceReady, membership, canWrite, isReadOnly, licenseState } = useWorkspace();
  const pathname = usePathname();
  const isDashboardRoute = pathname === '/';
  const isLeadsRoute = pathname.startsWith('/leads');
  const isClientsRoute = pathname.startsWith('/clients');
  const isPipelineRoute = pathname.startsWith('/pipeline');
  const isTasksRoute = pathname.startsWith('/tasks');
  const loadsAssignees = isLeadsRoute || isClientsRoute || isPipelineRoute || isTasksRoute;
  const loadsClients = isDashboardRoute || isClientsRoute || isPipelineRoute || isTasksRoute;
  // Leads and Tasks pages own their filtered queries; related-name views use the shared first page.
  const loadsLeads = isDashboardRoute || isTasksRoute;
  const loadsTasks = isDashboardRoute || isPipelineRoute;
  const loadsDeals = isDashboardRoute || isPipelineRoute || isTasksRoute;
  const loadsActivities = isDashboardRoute;
  const canLoadBusinessData = authStatus === 'active' && Boolean(user) && !workspaceLoading;
  const canLoadTenantData = canLoadBusinessData && workspaceReady && Boolean(currentOrganizationId);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsOrganizationId, setLeadsOrganizationId] = useState<string | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [leadsCursor, setLeadsCursor] = useState<FirestoreCursor>(null);
  const [leadsHasMore, setLeadsHasMore] = useState(false);
  const currentOrganizationRef = useRef(currentOrganizationId);
  const clientNotesRequestRef = useRef(0);
  const clientDocumentsRequestRef = useRef(0);
  const leadsPageSizeRef = useRef(25);
  const clientsPageSizeRef = useRef(25);
  useEffect(() => {
    currentOrganizationRef.current = currentOrganizationId;
  }, [currentOrganizationId]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsOrganizationId, setDealsOrganizationId] = useState<string | null>(null);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksOrganizationId, setTasksOrganizationId] = useState<string | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [tasksCursor, setTasksCursor] = useState<FirestoreCursor>(null);
  const [tasksHasMore, setTasksHasMore] = useState(false);
  const [leadTasks, setLeadTasks] = useState<Task[]>([]);
  const [leadTasksOrganizationId, setLeadTasksOrganizationId] = useState<string | null>(null);
  const [leadTasksUserId, setLeadTasksUserId] = useState<string | null>(null);
  const [leadTasksLoading, setLeadTasksLoading] = useState(false);
  const [leadTasksError, setLeadTasksError] = useState<string | null>(null);
  const leadFiltersRef = useRef<LeadListFilters>({});
  const taskFiltersRef = useRef<TaskListFilters>({});
  const leadsRequestRef = useRef(0);
  const archivedLeadsRequestRef = useRef(0);
  const trashedLeadsRequestRef = useRef(0);
  const clientsRequestRef = useRef(0);
  const clientSearchRef = useRef('');
  const tasksRequestRef = useRef(0);
  const leadTasksRequestRef = useRef(0);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsOrganizationId, setClientsOrganizationId] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientsCursor, setClientsCursor] = useState<FirestoreCursor>(null);
  const [clientsHasMore, setClientsHasMore] = useState(false);
  const [archivedClients, setArchivedClients] = useState<Client[]>([]);
  const [archivedLeads, setArchivedLeads] = useState<Lead[]>([]);
  const [trashedClients, setTrashedClients] = useState<Client[]>([]);
  const [trashedLeads, setTrashedLeads] = useState<Lead[]>([]);
  const [archivedDeals, setArchivedDeals] = useState<Deal[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [archivedOrganizationId, setArchivedOrganizationId] = useState<string | null>(null);
  const [archivedLeadsCursor, setArchivedLeadsCursor] = useState<FirestoreCursor>(null);
  const [archivedClientsCursor, setArchivedClientsCursor] = useState<FirestoreCursor>(null);
  const [archivedDealsCursor, setArchivedDealsCursor] = useState<FirestoreCursor>(null);
  const [archivedTasksCursor, setArchivedTasksCursor] = useState<FirestoreCursor>(null);
  const [archivedLeadsHasMore, setArchivedLeadsHasMore] = useState(false);
  const [archivedClientsHasMore, setArchivedClientsHasMore] = useState(false);
  const [trashedLeadsCursor, setTrashedLeadsCursor] = useState<FirestoreCursor>(null);
  const [trashedClientsCursor, setTrashedClientsCursor] = useState<FirestoreCursor>(null);
  const [trashedLeadsHasMore, setTrashedLeadsHasMore] = useState(false);
  const [trashedClientsHasMore, setTrashedClientsHasMore] = useState(false);
  const [archivedDealsHasMore, setArchivedDealsHasMore] = useState(false);
  const [archivedTasksHasMore, setArchivedTasksHasMore] = useState(false);
  const [clientNotes, setClientNotes] = useState<Note[]>([]);
  const [clientNotesOrganizationId, setClientNotesOrganizationId] = useState<string | null>(null);
  const [clientNotesClientId, setClientNotesClientId] = useState<string | null>(null);
  const [archivedClientNotes, setArchivedClientNotes] = useState<Note[]>([]);
  const [archivedClientNotesOrganizationId, setArchivedClientNotesOrganizationId] = useState<string | null>(null);
  const [archivedClientNotesClientId, setArchivedClientNotesClientId] = useState<string | null>(null);
  const [clientNotesLoading, setClientNotesLoading] = useState(false);
  const [clientNotesError, setClientNotesError] = useState<string | null>(null);
  const [clientNotesCursor, setClientNotesCursor] = useState<FirestoreCursor>(null);
  const [clientNotesHasMore, setClientNotesHasMore] = useState(false);
  const [clientDocuments, setClientDocuments] = useState<DocumentItem[]>([]);
  const [clientDocumentsOrganizationId, setClientDocumentsOrganizationId] = useState<string | null>(null);
  const [clientDocumentsClientId, setClientDocumentsClientId] = useState<string | null>(null);
  const [archivedClientDocuments, setArchivedClientDocuments] = useState<DocumentItem[]>([]);
  const [archivedClientDocumentsOrganizationId, setArchivedClientDocumentsOrganizationId] = useState<string | null>(null);
  const [archivedClientDocumentsClientId, setArchivedClientDocumentsClientId] = useState<string | null>(null);
  const [clientDocumentsLoading, setClientDocumentsLoading] = useState(false);
  const [clientDocumentsError, setClientDocumentsError] = useState<string | null>(null);
  const [clientDocumentsCursor, setClientDocumentsCursor] = useState<FirestoreCursor>(null);
  const [clientDocumentsHasMore, setClientDocumentsHasMore] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesOrganizationId, setActivitiesOrganizationId] = useState<string | null>(null);

  const requireWritableLicense = () => {
    if (!canWrite) {
      throw new Error(licenseState.status === 'UNKNOWN'
        ? 'Subscription status could not be verified. This workspace is temporarily read-only.'
        : licenseState.reason === 'suspended'
        ? 'This workspace is suspended and read-only.'
        : isReadOnly
          ? 'This workspace is read-only because the subscription has expired.'
          : 'Subscription status is still loading. Please try again.');
    }
  };

  const syncLeadLifecycleState = useCallback((lead: Lead, state: LeadLifecycleState) => {
    const now = new Date().toISOString();
    const nextLead: Lead = {
      ...lead,
      archived: state !== 'ACTIVE',
      trashed: state === 'TRASHED',
      archivedAt: state === 'ACTIVE' ? '' : state === 'ARCHIVED' ? now : lead.archivedAt,
      archivedBy: state === 'ACTIVE' ? undefined : lead.archivedBy,
      trashedAt: state === 'TRASHED' ? now : '',
      trashedBy: state === 'TRASHED' ? user?.uid : undefined,
      updatedAt: now,
      updatedBy: user?.uid,
    };

    // Invalidate older list responses so a slow read cannot put the lead back
    // into the wrong lifecycle view after a successful mutation.
    leadsRequestRef.current += 1;
    archivedLeadsRequestRef.current += 1;
    trashedLeadsRequestRef.current += 1;
    setLeads((current) => state === 'ACTIVE'
      ? [nextLead, ...current.filter((item) => item.id !== lead.id && isActiveLead(item))]
      : current.filter((item) => item.id !== lead.id));
    setArchivedLeads((current) => state === 'ARCHIVED'
      ? [nextLead, ...current.filter((item) => item.id !== lead.id && isArchivedLead(item))]
      : current.filter((item) => item.id !== lead.id));
    setTrashedLeads((current) => state === 'TRASHED'
      ? [nextLead, ...current.filter((item) => item.id !== lead.id && isTrashedLead(item))]
      : current.filter((item) => item.id !== lead.id));
    setLeadsLoading(false);
  }, [user?.uid]);

  const syncClientLifecycleState = useCallback((client: Client, action: BulkLifecycleRequestAction) => {
    if (action === 'permanent-delete') {
      setClients((current) => current.filter((item) => item.id !== client.id));
      setArchivedClients((current) => current.filter((item) => item.id !== client.id));
      setTrashedClients((current) => current.filter((item) => item.id !== client.id));
      return;
    }
    const now = new Date().toISOString();
    const isActive = action === 'restore';
    const isTrashed = action === 'trash';
    const nextClient: Client = {
      ...client,
      status: isActive ? 'ACTIVE' : 'ARCHIVED',
      archived: !isActive,
      trashed: isTrashed,
      archivedAt: isActive ? undefined : action === 'archive' ? now : client.archivedAt,
      archivedBy: isActive ? undefined : client.archivedBy,
      trashedAt: isTrashed ? now : undefined,
      trashedBy: isTrashed ? user?.uid : undefined,
      updatedAt: now,
      updatedBy: user?.uid,
    };
    setClients((current) => isActive ? [nextClient, ...current.filter((item) => item.id !== client.id && !item.archived && !item.trashed)] : current.filter((item) => item.id !== client.id));
    setArchivedClients((current) => action === 'archive' ? [nextClient, ...current.filter((item) => item.id !== client.id && item.archived && !item.trashed)] : current.filter((item) => item.id !== client.id));
    setTrashedClients((current) => isTrashed ? [nextClient, ...current.filter((item) => item.id !== client.id && item.trashed)] : current.filter((item) => item.id !== client.id));
  }, [user?.uid]);

  useEffect(() => {
    if (!canLoadBusinessData || !user || !loadsAssignees) return;
    let cancelled = false;
    const loadUsers = async () => {
      setUsersLoading(true);
      setUsersError(null);
      setUsers([]);
      try {
        if (!currentOrganizationId) return;
        const loadedUsers = await listAssignableOrganizationUsers(user, currentOrganizationId);
        if (!cancelled) setUsers(membership?.role === 'USER' ? loadedUsers.filter((item) => item.uid === user.uid) : loadedUsers);
      } catch (error) {
        console.error('Unable to load assignees', error);
        if (!cancelled) setUsersError('Unable to load assignees.');
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };
    void loadUsers();
    return () => { cancelled = true; };
  }, [canLoadBusinessData, currentOrganizationId, loadsAssignees, membership, user]);

  const loadClientNotes = useCallback(async (clientId: string) => {
    if (!user) return;
    const organizationId = currentOrganizationId;
    const requestId = ++clientNotesRequestRef.current;
    setClientNotesLoading(true);
    setClientNotesError(null);
    setClientNotes([]);
    try {
      if (!organizationId) return;
      const loadedNotes = await listClientNotesPage(user, organizationId, clientId);
      if (requestId !== clientNotesRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClientNotes(loadedNotes.items);
      setClientNotesCursor(loadedNotes.nextCursor);
      setClientNotesHasMore(loadedNotes.hasMore);
      setClientNotesOrganizationId(organizationId);
      setClientNotesClientId(clientId);
    } catch (error) {
      console.error('Unable to load client notes', error);
      if (requestId === clientNotesRequestRef.current && organizationId === currentOrganizationRef.current) setClientNotesError('Unable to load client notes. Please try again.');
    } finally {
      if (requestId === clientNotesRequestRef.current) setClientNotesLoading(false);
    }
  }, [currentOrganizationId, user]);

  const loadClientDocuments = useCallback(async (clientId: string) => {
    if (!user) return;
    const organizationId = currentOrganizationId;
    const requestId = ++clientDocumentsRequestRef.current;
    setClientDocumentsLoading(true);
    setClientDocumentsError(null);
    setClientDocuments([]);
    try {
      if (!organizationId) return;
      const loadedDocuments = await listClientDocumentsPage(user, organizationId, clientId);
      if (requestId !== clientDocumentsRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClientDocuments(loadedDocuments.items);
      setClientDocumentsCursor(loadedDocuments.nextCursor);
      setClientDocumentsHasMore(loadedDocuments.hasMore);
      setClientDocumentsOrganizationId(organizationId);
      setClientDocumentsClientId(clientId);
    } catch (error) {
      console.error('Unable to load client documents', error);
      if (requestId === clientDocumentsRequestRef.current && organizationId === currentOrganizationRef.current) setClientDocumentsError('Unable to load client documents. Please try again.');
    } finally {
      if (requestId === clientDocumentsRequestRef.current) setClientDocumentsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const loadArchivedClientNotes = useCallback(async (clientId: string) => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    try {
      const loadedNotes = await listArchivedClientNotes(user, organizationId, clientId);
      if (organizationId !== currentOrganizationRef.current) return;
      setArchivedClientNotes(loadedNotes);
      setArchivedClientNotesOrganizationId(organizationId);
      setArchivedClientNotesClientId(clientId);
    } catch (error) {
      console.error('Unable to load archived client notes', error);
    }
  }, [currentOrganizationId, user]);

  const loadMoreClientNotes = useCallback(async () => {
    if (!user || !currentOrganizationId || !clientNotesCursor || clientNotesLoading) return;
    const clientId = clientNotesClientId;
    if (!clientId) return;
    const organizationId = currentOrganizationId;
    setClientNotesLoading(true);
    try {
      const page = await listClientNotesPage(user, organizationId, clientId, clientNotesCursor);
      if (organizationId !== currentOrganizationRef.current) return;
      setClientNotes((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setClientNotesCursor(page.nextCursor); setClientNotesHasMore(page.hasMore);
    } catch (error) {
      console.error('Unable to load more client notes', error);
      if (organizationId === currentOrganizationRef.current) setClientNotesError(userFacingErrorMessage(error, 'Unable to load client notes. Please try again.'));
    } finally { if (organizationId === currentOrganizationRef.current) setClientNotesLoading(false); }
  }, [clientNotesClientId, clientNotesCursor, clientNotesLoading, currentOrganizationId, user]);

  const loadMoreClientDocuments = useCallback(async () => {
    if (!user || !currentOrganizationId || !clientDocumentsCursor || clientDocumentsLoading) return;
    const clientId = clientDocumentsClientId;
    if (!clientId) return;
    const organizationId = currentOrganizationId;
    setClientDocumentsLoading(true);
    try {
      const page = await listClientDocumentsPage(user, organizationId, clientId, clientDocumentsCursor);
      if (organizationId !== currentOrganizationRef.current) return;
      setClientDocuments((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setClientDocumentsCursor(page.nextCursor); setClientDocumentsHasMore(page.hasMore);
    } catch (error) {
      console.error('Unable to load more client documents', error);
      if (organizationId === currentOrganizationRef.current) setClientDocumentsError(userFacingErrorMessage(error, 'Unable to load client documents. Please try again.'));
    } finally { if (organizationId === currentOrganizationRef.current) setClientDocumentsLoading(false); }
  }, [clientDocumentsClientId, clientDocumentsCursor, clientDocumentsLoading, currentOrganizationId, user]);

  const refreshClients = useCallback(async (ensureClientId?: string, search = '', requestedPageSize?: number) => {
    if (!user || !currentOrganizationId) return;
    const pageSize = requestedPageSize && Number.isFinite(requestedPageSize) ? Math.max(1, Math.floor(requestedPageSize)) : clientsPageSizeRef.current;
    clientsPageSizeRef.current = pageSize;
    const requestId = ++clientsRequestRef.current;
    const organizationId = currentOrganizationId;
    clientSearchRef.current = search;
    setClientsLoading(true);
    setClientsError(null);
    try {
      const loadedClients = await listClientsPage(user, organizationId, null, pageSize, search);
      let nextClients = loadedClients.items;
      if (ensureClientId && !nextClients.some((client) => client.id === ensureClientId)) {
        const ensuredClient = await getClientById(user, organizationId, ensureClientId);
        if (!ensuredClient.archived) nextClients = [ensuredClient, ...nextClients];
      }
      if (requestId !== clientsRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClients(nextClients);
      setClientsCursor(loadedClients.nextCursor);
      setClientsHasMore(loadedClients.hasMore);
      setClientsOrganizationId(organizationId);
    } catch (error) {
      console.error('Unable to load shared clients', error);
      if (requestId === clientsRequestRef.current && organizationId === currentOrganizationRef.current) setClientsError(firestoreQueryErrorMessage(error, 'Unable to load clients. Please check your connection and try again.'));
    } finally {
      if (requestId === clientsRequestRef.current && organizationId === currentOrganizationRef.current) setClientsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const loadArchivedClientDocuments = useCallback(async (clientId: string) => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    try {
      const loadedDocuments = await listArchivedClientDocuments(user, organizationId, clientId);
      if (organizationId !== currentOrganizationRef.current) return;
      setArchivedClientDocuments(loadedDocuments);
      setArchivedClientDocumentsOrganizationId(organizationId);
      setArchivedClientDocumentsClientId(clientId);
    } catch (error) {
      console.error('Unable to load archived client documents', error);
    }
  }, [currentOrganizationId, user]);


  const loadMoreClients = useCallback(async () => {
    if (!user || !currentOrganizationId || !clientsCursor || clientsLoading) return;
    const requestId = ++clientsRequestRef.current;
    const organizationId = currentOrganizationId;
    setClientsLoading(true);
    try {
      const page = await listClientsPage(user, organizationId, clientsCursor, clientsPageSizeRef.current, clientSearchRef.current);
      if (requestId !== clientsRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClients((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setClientsCursor(page.nextCursor);
      setClientsHasMore(page.hasMore);
    } finally {
      if (requestId === clientsRequestRef.current && organizationId === currentOrganizationRef.current) setClientsLoading(false);
    }
  }, [clientsCursor, clientsLoading, currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId || !loadsClients) return;
    let cancelled = false;
    const requestId = ++clientsRequestRef.current;
    const loadClients = async () => {
      setClientsLoading(true);
      setClientsError(null);
      try {
        const pageSize = isDashboardRoute ? 10 : clientsPageSizeRef.current;
        clientsPageSizeRef.current = pageSize;
        const loadedClients = await listClientsPage(user, currentOrganizationId, null, pageSize);
        if (!cancelled && requestId === clientsRequestRef.current) {
          setClients(loadedClients.items);
          setClientsCursor(loadedClients.nextCursor);
          setClientsHasMore(loadedClients.hasMore);
          setClientsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared clients', error);
        if (!cancelled && requestId === clientsRequestRef.current) setClientsError(firestoreQueryErrorMessage(error, 'Unable to load clients. Please check your connection and try again.'));
      } finally {
        if (!cancelled && requestId === clientsRequestRef.current) setClientsLoading(false);
      }
    };
    void loadClients();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, isDashboardRoute, loadsClients, user]);

  useEffect(() => {
    if (!canLoadBusinessData || !user || !currentOrganizationId || !loadsLeads) {
      return;
    }
    let cancelled = false;
    const requestId = ++leadsRequestRef.current;
    const loadLeads = async () => {
      setLeadsLoading(true);
      setLeadsError(null);
      try {
        const pageSize = isDashboardRoute ? 5 : leadsPageSizeRef.current;
        leadsPageSizeRef.current = pageSize;
        const loadedLeads = await listLeadsPage(user, currentOrganizationId, null, pageSize);
        if (!cancelled && requestId === leadsRequestRef.current) {
          setLeads(dedupeLeadsById(loadedLeads.items.filter(isActiveLead)));
          setLeadsCursor(loadedLeads.nextCursor);
          setLeadsHasMore(loadedLeads.hasMore);
          setLeadsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared leads', error);
        if (!cancelled && requestId === leadsRequestRef.current) setLeadsError(firestoreQueryErrorMessage(error, 'Unable to load leads. Please check your connection and try again.'));
      } finally {
        if (!cancelled && requestId === leadsRequestRef.current) setLeadsLoading(false);
      }
    };
    void loadLeads();
    return () => { cancelled = true; };
  }, [canLoadBusinessData, currentOrganizationId, isDashboardRoute, loadsLeads, user]);

  const refreshLeads = useCallback(async (filters: LeadListFilters = {}, requestedPageSize?: number) => {
    if (!user || !currentOrganizationId) return;
    const pageSize = requestedPageSize && Number.isFinite(requestedPageSize) ? Math.max(1, Math.floor(requestedPageSize)) : leadsPageSizeRef.current;
    leadsPageSizeRef.current = pageSize;
    leadFiltersRef.current = filters;
    const requestId = ++leadsRequestRef.current;
    const organizationId = currentOrganizationId;
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const loadedLeads = await listLeadsPage(user, organizationId, null, pageSize, filters);
      if (requestId === leadsRequestRef.current && organizationId === currentOrganizationRef.current) {
        setLeads(dedupeLeadsById(loadedLeads.items.filter(isActiveLead)));
        setLeadsCursor(loadedLeads.nextCursor);
        setLeadsHasMore(loadedLeads.hasMore);
        setLeadsOrganizationId(organizationId);
      }
    } catch (error) {
      console.error('Unable to refresh shared leads', error);
      if (requestId === leadsRequestRef.current && organizationId === currentOrganizationRef.current) setLeadsError(firestoreQueryErrorMessage(error, 'Unable to load leads. Please check your connection and try again.'));
    } finally {
      if (requestId === leadsRequestRef.current && organizationId === currentOrganizationRef.current) setLeadsLoading(false);
    }
  }, [currentOrganizationId, user]);


  const loadMoreLeads = useCallback(async () => {
    if (!user || !currentOrganizationId || !leadsCursor || leadsLoading) return;
    const organizationId = currentOrganizationId;
    const requestId = ++leadsRequestRef.current;
    setLeadsLoading(true);
    try {
      const page = await listLeadsPage(user, organizationId, leadsCursor, leadsPageSizeRef.current, leadFiltersRef.current);
      if (organizationId !== currentOrganizationRef.current || requestId !== leadsRequestRef.current) return;
      setLeads((current) => dedupeLeadsById([...current, ...page.items]).filter(isActiveLead));
      setLeadsCursor(page.nextCursor);
      setLeadsHasMore(page.hasMore);
    } finally {
      if (organizationId === currentOrganizationRef.current && requestId === leadsRequestRef.current) setLeadsLoading(false);
    }
  }, [currentOrganizationId, leadsCursor, leadsLoading, user]);

  const refreshTasks = useCallback(async (filters: TaskListFilters = {}) => {
    if (!user || !currentOrganizationId) return;
    taskFiltersRef.current = filters;
    const requestId = ++tasksRequestRef.current;
    setTasksLoading(true);
    setTasksError(null);
    try {
      const loadedTasks = await listTasksPage(user, currentOrganizationId, null, undefined, filters);
      if (requestId === tasksRequestRef.current) {
        setTasks(loadedTasks.items);
        setTasksCursor(loadedTasks.nextCursor);
        setTasksHasMore(loadedTasks.hasMore);
        setTasksOrganizationId(currentOrganizationId);
      }
    } catch (error) {
      console.error('Unable to load shared tasks', error);
      if (requestId === tasksRequestRef.current) setTasksError(firestoreQueryErrorMessage(error, 'Unable to load tasks. Please check your connection and try again.'));
    } finally {
      if (requestId === tasksRequestRef.current) setTasksLoading(false);
    }
  }, [currentOrganizationId, user]);

  const loadLeadTasks = useCallback(async (leadId: string) => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    const requestId = ++leadTasksRequestRef.current;
    setLeadTasksLoading(true);
    setLeadTasksError(null);
    setLeadTasks([]);
    setLeadTasksOrganizationId(organizationId);
    setLeadTasksUserId(user.uid);
    try {
      const loadedTasks = await listLeadTasks(user, organizationId, leadId);
      if (requestId !== leadTasksRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setLeadTasks(loadedTasks);
      setLeadTasksOrganizationId(organizationId);
    } catch (error) {
      console.error('Unable to load Lead tasks', error);
      if (requestId === leadTasksRequestRef.current && organizationId === currentOrganizationRef.current) {
        setLeadTasksError(firestoreQueryErrorMessage(error, 'Unable to load Lead tasks. Please try again.'));
      }
    } finally {
      if (requestId === leadTasksRequestRef.current) setLeadTasksLoading(false);
    }
  }, [currentOrganizationId, user]);


  const loadMoreTasks = useCallback(async () => {
    if (!user || !currentOrganizationId || !tasksCursor || tasksLoading) return;
    const organizationId = currentOrganizationId;
    setTasksLoading(true);
    try {
      const page = await listTasksPage(user, organizationId, tasksCursor, undefined, taskFiltersRef.current);
      if (organizationId !== currentOrganizationRef.current) return;
      setTasks((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTasksCursor(page.nextCursor);
      setTasksHasMore(page.hasMore);
    } finally {
      if (organizationId === currentOrganizationRef.current) setTasksLoading(false);
    }
  }, [currentOrganizationId, tasksCursor, tasksLoading, user]);

  const refreshDeals = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    setDealsLoading(true);
    setDealsError(null);
    try {
      const loadedDeals = await listDeals(user, organizationId);
      if (organizationId === currentOrganizationRef.current) {
        setDeals(loadedDeals);
        setDealsOrganizationId(organizationId);
      }
    } catch (error) {
      console.error('Unable to refresh shared deals', error);
      if (organizationId === currentOrganizationRef.current) setDealsError(firestoreQueryErrorMessage(error, 'Unable to load deals. Please check your connection and try again.'));
    } finally {
      if (organizationId === currentOrganizationRef.current) setDealsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const refreshActivities = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    try {
      const loadedActivities = await listActivities(user, organizationId);
      if (organizationId === currentOrganizationRef.current) {
        setActivities(loadedActivities);
        setActivitiesOrganizationId(organizationId);
      }
    } catch (error) {
      console.error('Unable to refresh activities', error);
    }
  }, [currentOrganizationId, user]);

  const loadArchivedRecords = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    const requestId = ++archivedLeadsRequestRef.current;
    const [loadedClients, loadedLeads, loadedDeals, loadedTasks] = await Promise.all([
      listArchivedClientsPage(user, organizationId),
      listArchivedLeadsPage(user, organizationId),
      listArchivedDealsPage(user, organizationId),
      listArchivedTasksPage(user, organizationId),
    ]);
    if (organizationId !== currentOrganizationRef.current || requestId !== archivedLeadsRequestRef.current) return;
    setArchivedClients(loadedClients.items);
    setArchivedLeads(dedupeLeadsById(loadedLeads.items.filter(isArchivedLead)));
    setArchivedDeals(loadedDeals.items);
    setArchivedTasks(loadedTasks.items);
    setArchivedClientsCursor(loadedClients.nextCursor); setArchivedClientsHasMore(loadedClients.hasMore);
    setArchivedLeadsCursor(loadedLeads.nextCursor); setArchivedLeadsHasMore(loadedLeads.hasMore);
    setArchivedDealsCursor(loadedDeals.nextCursor); setArchivedDealsHasMore(loadedDeals.hasMore);
    setArchivedTasksCursor(loadedTasks.nextCursor); setArchivedTasksHasMore(loadedTasks.hasMore);
    setArchivedOrganizationId(organizationId);
  }, [currentOrganizationId, user]);

  const loadTrashRecords = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    const requestId = ++trashedLeadsRequestRef.current;
    const [loadedClients, loadedLeads] = await Promise.all([
      listTrashedClientsPage(user, organizationId),
      listTrashedLeadsPage(user, organizationId),
    ]);
    if (organizationId !== currentOrganizationRef.current || requestId !== trashedLeadsRequestRef.current) return;
    setTrashedClients(loadedClients.items);
    setTrashedLeads(dedupeLeadsById(loadedLeads.items.filter(isTrashedLead)));
    setTrashedClientsCursor(loadedClients.nextCursor); setTrashedClientsHasMore(loadedClients.hasMore);
    setTrashedLeadsCursor(loadedLeads.nextCursor); setTrashedLeadsHasMore(loadedLeads.hasMore);
    setArchivedOrganizationId(organizationId);
  }, [currentOrganizationId, user]);

  const loadMoreArchivedLeads = useCallback(async () => {
    if (!user || !currentOrganizationId || !archivedLeadsCursor) return;
    const organizationId = currentOrganizationId;
    const requestId = ++archivedLeadsRequestRef.current;
    const page = await listArchivedLeadsPage(user, organizationId, archivedLeadsCursor);
    if (organizationId !== currentOrganizationRef.current || requestId !== archivedLeadsRequestRef.current) return;
    setArchivedLeads((current) => dedupeLeadsById([...current, ...page.items]).filter(isArchivedLead));
    setArchivedLeadsCursor(page.nextCursor); setArchivedLeadsHasMore(page.hasMore);
  }, [archivedLeadsCursor, currentOrganizationId, user]);

  const loadMoreArchivedClients = useCallback(async () => {
    if (!user || !currentOrganizationId || !archivedClientsCursor) return;
    const organizationId = currentOrganizationId;
    const page = await listArchivedClientsPage(user, organizationId, archivedClientsCursor);
    if (organizationId !== currentOrganizationRef.current) return;
    setArchivedClients((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setArchivedClientsCursor(page.nextCursor); setArchivedClientsHasMore(page.hasMore);
  }, [archivedClientsCursor, currentOrganizationId, user]);

  const loadMoreTrashedLeads = useCallback(async () => {
    if (!user || !currentOrganizationId || !trashedLeadsCursor) return;
    const organizationId = currentOrganizationId;
    const requestId = ++trashedLeadsRequestRef.current;
    const page = await listTrashedLeadsPage(user, organizationId, trashedLeadsCursor);
    if (organizationId !== currentOrganizationRef.current || requestId !== trashedLeadsRequestRef.current) return;
    setTrashedLeads((current) => dedupeLeadsById([...current, ...page.items]).filter(isTrashedLead));
    setTrashedLeadsCursor(page.nextCursor); setTrashedLeadsHasMore(page.hasMore);
  }, [currentOrganizationId, trashedLeadsCursor, user]);

  const loadMoreTrashedClients = useCallback(async () => {
    if (!user || !currentOrganizationId || !trashedClientsCursor) return;
    const organizationId = currentOrganizationId;
    const page = await listTrashedClientsPage(user, organizationId, trashedClientsCursor);
    if (organizationId !== currentOrganizationRef.current) return;
    setTrashedClients((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setTrashedClientsCursor(page.nextCursor); setTrashedClientsHasMore(page.hasMore);
  }, [currentOrganizationId, trashedClientsCursor, user]);

  const loadMoreArchivedDeals = useCallback(async () => {
    if (!user || !currentOrganizationId || !archivedDealsCursor) return;
    const organizationId = currentOrganizationId;
    const page = await listArchivedDealsPage(user, organizationId, archivedDealsCursor);
    if (organizationId !== currentOrganizationRef.current) return;
    setArchivedDeals((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setArchivedDealsCursor(page.nextCursor); setArchivedDealsHasMore(page.hasMore);
  }, [archivedDealsCursor, currentOrganizationId, user]);

  const loadMoreArchivedTasks = useCallback(async () => {
    if (!user || !currentOrganizationId || !archivedTasksCursor) return;
    const organizationId = currentOrganizationId;
    const page = await listArchivedTasksPage(user, organizationId, archivedTasksCursor);
    if (organizationId !== currentOrganizationRef.current) return;
    setArchivedTasks((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setArchivedTasksCursor(page.nextCursor); setArchivedTasksHasMore(page.hasMore);
  }, [archivedTasksCursor, currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId || !loadsTasks) return;
    let cancelled = false;
    const requestId = ++tasksRequestRef.current;
    const loadTasks = async () => {
      setTasksLoading(true);
      setTasksError(null);
      try {
        const dashboardTaskFilters: TaskListFilters = isDashboardRoute ? { status: 'Pending', type: 'Follow-up' } : {};
        const loadedTasks = await listTasksPage(user, currentOrganizationId, null, isDashboardRoute ? 10 : undefined, dashboardTaskFilters);
        if (!cancelled && requestId === tasksRequestRef.current) {
          setTasks(loadedTasks.items);
          setTasksCursor(loadedTasks.nextCursor);
          setTasksHasMore(loadedTasks.hasMore);
          setTasksOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared tasks', error);
        if (!cancelled && requestId === tasksRequestRef.current) setTasksError(firestoreQueryErrorMessage(error, 'Unable to load tasks. Please check your connection and try again.'));
      } finally {
        if (!cancelled && requestId === tasksRequestRef.current) setTasksLoading(false);
      }
    };
    void loadTasks();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, isDashboardRoute, loadsTasks, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId || !loadsDeals) return;
    let cancelled = false;
    const loadDeals = async () => {
      setDealsLoading(true);
      setDealsError(null);
      try {
        const loadedDeals = await listDeals(user, currentOrganizationId, isDashboardRoute ? 10 : undefined);
        if (!cancelled) {
          setDeals(loadedDeals);
          setDealsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        const firebaseError = error as { code?: string; message?: string };
        console.error(`Unable to load shared deals code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
        if (!cancelled) setDealsError(firestoreQueryErrorMessage(error, 'Unable to load deals. Please check your connection and try again.'));
      } finally {
        if (!cancelled) setDealsLoading(false);
      }
    };
    void loadDeals();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, isDashboardRoute, loadsDeals, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId || !loadsActivities) return;
    let cancelled = false;
    const loadActivities = async () => {
      try {
        const loadedActivities = await listActivities(user, currentOrganizationId, isDashboardRoute ? 10 : undefined);
        if (!cancelled) {
          setActivities(loadedActivities);
          setActivitiesOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared activities', error);
      }
    };
    void loadActivities();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, loadsActivities, isDashboardRoute, user]);

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOrganizationId, setSettingsOrganizationId] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const resetSettingsState = (loading: boolean) => {
      if (cancelled) return;
      setSettings(defaultSettings);
      setSettingsOrganizationId(null);
      setSettingsLoading(loading);
      setSettingsError(null);
    };

    if (!canLoadTenantData || !user || !currentOrganizationId) {
      queueMicrotask(() => resetSettingsState(false));
      return () => { cancelled = true; };
    }
    queueMicrotask(() => resetSettingsState(true));
    const load = async () => {
      try {
        const loadedSettings = await loadSettings(user, currentOrganizationId);
        if (!cancelled) {
          setSettings(loadedSettings);
          setSettingsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Settings load diagnostic]', JSON.stringify(error instanceof SettingsLoadError ? error.diagnostics : {
            errorName: (error as { name?: string }).name,
            firebaseCode: (error as { code?: string }).code,
            firebaseMessage: (error as { message?: string }).message,
            path: `organizations/${currentOrganizationId}/settings/settings`,
            operation: 'get',
            sourceFunction: 'AppProvider.settingsLoad',
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            authResolved: authStatus === 'active',
            currentUserPresent: Boolean(user),
            navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
            authenticatedUid: user?.uid,
            organizationId: currentOrganizationId,
          }));
        }
        if (!cancelled) setSettingsError('Unable to load business settings. Please check your connection and try again.');
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authStatus, canLoadTenantData, currentOrganizationId, user]);

  const updateSettings = async (newSettings: Partial<Settings>) => {
    try {
      if (!user) return;
      requireWritableLicense();
      if (settingsLoading) throw new Error('Business settings are still loading. Please wait a moment and try again.');
      if (!currentOrganizationId) throw new Error('No active organization is selected.');
      await updateSettingsRepository(user, currentOrganizationId, newSettings);
      setSettings(prev => ({ ...prev, ...newSettings }));
      setSettingsOrganizationId(currentOrganizationId);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Settings save diagnostic]', JSON.stringify({
          ...(error instanceof SettingsPersistenceError ? error.diagnostics : {
            firebaseErrorName: (error as { name?: string }).name,
            firebaseCode: (error as { code?: string }).code,
            firebaseMessage: (error as { message?: string }).message,
            path: currentOrganizationId ? `organizations/${currentOrganizationId}/settings/settings` : null,
            activityPath: currentOrganizationId ? `organizations/${currentOrganizationId}/activities/<generated-id>` : null,
            activityType: 'settings_update',
            operation: 'set',
            merge: true,
            transactional: true,
            batchOperationCount: 2,
            authenticatedUid: user?.uid,
            organizationId: currentOrganizationId,
            resolvedRole: membership?.role,
          }),
          licenseCanWrite: canWrite,
          workspaceReady,
        }));
      }
      throw error;
    }
  };

  const addLead = async (leadData: LeadActionInput) => {
    if (!user) return;
    requireWritableLicense();
    if (workspaceLoading) throw new Error('Workspace is still loading. Please wait a moment and try again.');
    if (!workspaceReady || !currentOrganizationId) throw new Error('No active organization is available. Please contact an administrator.');
    const newLead = await createLeadRepository(user, currentOrganizationId, { ...leadData, assignedToUid: leadData.assignedToUid || '', assignedToName: leadData.assignedToName || '' });
    invalidateDashboardMetrics(currentOrganizationId);
    setLeads(prev => dedupeLeadsById([newLead, ...prev]).filter(isActiveLead));
    setLeadsOrganizationId(currentOrganizationId);
  };

  const updateLead = async (leadId: string, leadData: LeadActionInput) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await updateLeadRepository(user, currentOrganizationId, leadId, { ...leadData, assignedToUid: leadData.assignedToUid || '', assignedToName: leadData.assignedToName || '' });
    invalidateDashboardMetrics(currentOrganizationId);
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, ...leadData, updatedAt: new Date().toISOString(), updatedBy: user.uid } : lead));
  };

  const updateLeadStatus = async (lead: Lead, status: Lead['status']) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    if (status === 'Client') {
      await convertLeadToClient(lead.id);
      return;
    }
    await updateLeadStatusRepository(user, currentOrganizationId, lead, status);
    invalidateDashboardMetrics(currentOrganizationId);
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status, updatedAt: new Date().toISOString(), updatedBy: user.uid } : item));
  };

  const executeBulkLifecycleAction = async (entity: 'Lead' | 'Client', action: BulkLifecycleRequestAction, recordIds: string[]) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const results = await executeBulkLifecycleRequest(user, currentOrganizationId, entity, action, recordIds);
    const succeededIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
    recordIds.filter((id) => succeededIds.has(id)).forEach((id) => {
      if (entity === 'Lead') {
        const record = [...leads, ...archivedLeads, ...trashedLeads].find((item) => item.id === id);
        if (!record) {
          if (action === 'permanent-delete') {
            setLeads((current) => current.filter((item) => item.id !== id));
            setArchivedLeads((current) => current.filter((item) => item.id !== id));
            setTrashedLeads((current) => current.filter((item) => item.id !== id));
          }
          return;
        }
        if (action === 'permanent-delete') {
          setLeads((current) => current.filter((item) => item.id !== id));
          setArchivedLeads((current) => current.filter((item) => item.id !== id));
          setTrashedLeads((current) => current.filter((item) => item.id !== id));
        } else {
          syncLeadLifecycleState(record, action === 'restore' ? 'ACTIVE' : action === 'trash' ? 'TRASHED' : 'ARCHIVED');
        }
      } else {
        const record = [...clients, ...archivedClients, ...trashedClients].find((item) => item.id === id);
        if (!record) {
          if (action === 'permanent-delete') {
            setClients((current) => current.filter((item) => item.id !== id));
            setArchivedClients((current) => current.filter((item) => item.id !== id));
            setTrashedClients((current) => current.filter((item) => item.id !== id));
          }
          return;
        }
        syncClientLifecycleState(record, action);
      }
    });
    invalidateDashboardMetrics(currentOrganizationId);
    return results;
  };

  const archiveLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const knownLead = [...leads, ...archivedLeads, ...trashedLeads].find((lead) => lead.id === leadId);
    await archiveLeadRepository(user, currentOrganizationId, leadId);
    invalidateDashboardMetrics(currentOrganizationId);
    if (knownLead) syncLeadLifecycleState(knownLead, 'ARCHIVED');
    else {
      leadsRequestRef.current += 1;
      archivedLeadsRequestRef.current += 1;
      trashedLeadsRequestRef.current += 1;
      setLeads((current) => current.filter((lead) => lead.id !== leadId));
      setArchivedLeads((current) => current.filter((lead) => lead.id !== leadId));
      setTrashedLeads((current) => current.filter((lead) => lead.id !== leadId));
      setLeadsLoading(false);
    }
  };

  const trashLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const knownLead = [...leads, ...archivedLeads, ...trashedLeads].find((lead) => lead.id === leadId);
    await trashLeadRepository(user, currentOrganizationId, leadId);
    invalidateDashboardMetrics(currentOrganizationId);
    if (knownLead) syncLeadLifecycleState(knownLead, 'TRASHED');
    else {
      leadsRequestRef.current += 1;
      archivedLeadsRequestRef.current += 1;
      trashedLeadsRequestRef.current += 1;
      setLeads((current) => current.filter((lead) => lead.id !== leadId));
      setArchivedLeads((current) => current.filter((lead) => lead.id !== leadId));
      setTrashedLeads((current) => current.filter((lead) => lead.id !== leadId));
      setLeadsLoading(false);
    }
  };

  const addClient = async (clientData: ClientInput) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newClient = await createClientRepository(user, currentOrganizationId, clientData);
    invalidateDashboardMetrics(currentOrganizationId);
    setClients(prev => [newClient, ...prev]);
    setClientsOrganizationId(currentOrganizationId);
  };

  const updateClient = async (clientId: string, clientData: ClientInput) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateClientRepository(user, currentOrganizationId, clientId, clientData);
    invalidateDashboardMetrics(currentOrganizationId);
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, ...clientData, updatedAt: new Date().toISOString(), updatedBy: user.uid } : client));
  };

  const archiveClient = async (clientId: string) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await archiveClientRepository(user, currentOrganizationId, clientId);
    invalidateDashboardMetrics(currentOrganizationId);
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, status: 'ARCHIVED', updatedAt: new Date().toISOString(), updatedBy: user.uid } : client));
  };

  const trashClient = async (clientId: string) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await trashClientRepository(user, currentOrganizationId, clientId);
    invalidateDashboardMetrics(currentOrganizationId);
    setClients((current) => current.filter((client) => client.id !== clientId));
  };

  const restoreClient = async (clientId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await restoreClientRepository(user, currentOrganizationId, clientId);
    invalidateDashboardMetrics(currentOrganizationId);
    setArchivedClients((prev) => prev.filter((client) => client.id !== clientId));
    setTrashedClients((prev) => prev.filter((client) => client.id !== clientId));
    await refreshClients();
  };

  const permanentlyDeleteClient = async (clientId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteClientRepository(user, currentOrganizationId, clientId);
    setArchivedClients((prev) => prev.filter((client) => client.id !== clientId));
    setTrashedClients((prev) => prev.filter((client) => client.id !== clientId));
  };

  const addDeal = async (dealData: Omit<Deal, 'id' | 'createdAt' | 'status'>) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newDeal = await createDealRepository(user, currentOrganizationId, dealData);
    invalidateDashboardMetrics(currentOrganizationId);
    setDeals(prev => [newDeal, ...prev]);
    setDealsOrganizationId(currentOrganizationId);
  };

  const updateDeal = async (dealId: string, dealData: { title: string; value: number; stage: string; expectedCloseDate: string; productServiceName?: string; notes?: string; items?: Deal['items']; assignedToUid: string; assignedToName: string; lossReason: string }) => {
    if (!user) return;
    requireWritableLicense();
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) throw new Error('Deal not found. Please refresh and try again.');
    const nextStatus = getDealStatusForStage(dealData.stage);
    const value = getDealValue(dealData.value, dealData.items);
    const productServiceName = dealData.productServiceName?.trim() || deal.productServiceName;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateDealRepository(user, currentOrganizationId, deal, { ...dealData, value, clientId: deal.clientId, leadId: deal.leadId });
    invalidateDashboardMetrics(currentOrganizationId);
    setDeals(prev => prev.map(item => item.id === dealId ? {
      ...item,
      ...dealData,
      value,
      ...(productServiceName !== undefined ? { productServiceName } : {}),
      status: nextStatus,
      wonAt: nextStatus === 'Won' ? item.status === 'Won' ? item.wonAt : new Date().toISOString() : undefined,
      lostAt: nextStatus === 'Lost' ? item.status === 'Lost' ? item.lostAt : new Date().toISOString() : undefined,
      lossReason: nextStatus === 'Lost' ? dealData.lossReason : undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: user.uid,
    } : item));
  };

  const addTask = async (taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newTask = await createTaskRepository(user, currentOrganizationId, taskData);
    invalidateDashboardMetrics(currentOrganizationId);
    setTasks(prev => [newTask, ...prev]);
    setTasksOrganizationId(currentOrganizationId);
    setLeadTasks((prev) => newTask.relatedTo?.type === 'Lead' ? [newTask, ...prev.filter((task) => task.id !== newTask.id)] : prev);
    setLeadTasksOrganizationId(currentOrganizationId);
  };

  const updateTask = async (taskId: string, taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateTaskRepository(user, currentOrganizationId, taskId, taskData);
    invalidateDashboardMetrics(currentOrganizationId);
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, ...taskData, updatedAt: new Date().toISOString() } : task));
  };

  const completeTask = async (taskId: string) => {
    if (!user) return;
    requireWritableLicense();
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    const nextStatus = task.status === 'Pending' ? 'Completed' : 'Pending';
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await completeTaskRepository(user, currentOrganizationId, taskId, nextStatus);
    invalidateDashboardMetrics(currentOrganizationId);
    setTasks(prev => prev.map(item => item.id === taskId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item));
    setLeadTasks((prev) => prev.map(item => item.id === taskId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item));
  };

  const archiveTask = async (taskId: string) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const task = tasks.find((item) => item.id === taskId);
    await archiveTaskRepository(user, currentOrganizationId, taskId);
    invalidateDashboardMetrics(currentOrganizationId);
    setTasks(prev => prev.filter(task => task.id !== taskId));
    if (task) {
      const now = new Date().toISOString();
      setArchivedTasks((current) => [{ ...task, archived: true, archivedAt: now, archivedBy: user.uid, updatedAt: now, updatedBy: user.uid }, ...current.filter((item) => item.id !== taskId)]);
    }
  };

  const restoreTask = async (taskId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const archivedTask = archivedTasks.find((item) => item.id === taskId);
    await restoreTaskRepository(user, currentOrganizationId, taskId);
    invalidateDashboardMetrics(currentOrganizationId);
    setArchivedTasks((prev) => prev.filter((task) => task.id !== taskId));
    if (archivedTask) {
      const now = new Date().toISOString();
      setTasks((current) => [{ ...archivedTask, archived: false, archivedAt: '', archivedBy: undefined, updatedAt: now, updatedBy: user.uid }, ...current.filter((item) => item.id !== taskId)]);
      setTasksOrganizationId(currentOrganizationId);
    } else {
      await refreshTasks();
    }
  };

  const permanentlyDeleteTask = async (taskId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteTaskRepository(user, currentOrganizationId, taskId);
    setArchivedTasks((prev) => prev.filter((task) => task.id !== taskId));
  };

  const updateDealStage = async (dealId: string, stage: string, status: Deal['status'] = 'Active', lossReason?: string) => {
    if (!user) return;
    requireWritableLicense();
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return;
    const nextStatus = getDealStatusForStage(stage);
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateDealStageRepository(user, currentOrganizationId, deal, stage, nextStatus, lossReason);
    invalidateDashboardMetrics(currentOrganizationId);
    setDeals(prev => prev.map(item => item.id === dealId ? {
      ...item,
      stage,
      status: nextStatus,
      wonAt: nextStatus === 'Won' ? item.status === 'Won' ? item.wonAt : new Date().toISOString() : undefined,
      lostAt: nextStatus === 'Lost' ? item.status === 'Lost' ? item.lostAt : new Date().toISOString() : undefined,
      lossReason: nextStatus === 'Lost' ? lossReason : undefined,
    } : item));
  };

  const archiveDeal = async (dealId: string) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const deal = deals.find((item) => item.id === dealId);
    await archiveDealRepository(user, currentOrganizationId, dealId);
    invalidateDashboardMetrics(currentOrganizationId);
    setDeals(prev => prev.filter((deal) => deal.id !== dealId));
    if (deal) {
      const now = new Date().toISOString();
      setArchivedDeals((current) => [{ ...deal, archived: true, archivedAt: now, archivedBy: user.uid, updatedAt: now, updatedBy: user.uid }, ...current.filter((item) => item.id !== dealId)]);
    }
  };

  const restoreDeal = async (dealId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const archivedDeal = archivedDeals.find((item) => item.id === dealId);
    await restoreDealRepository(user, currentOrganizationId, dealId);
    invalidateDashboardMetrics(currentOrganizationId);
    setArchivedDeals((prev) => prev.filter((deal) => deal.id !== dealId));
    if (archivedDeal) {
      const now = new Date().toISOString();
      setDeals((current) => [{ ...archivedDeal, archived: false, archivedAt: '', archivedBy: undefined, updatedAt: now, updatedBy: user.uid }, ...current.filter((item) => item.id !== dealId)]);
      setDealsOrganizationId(currentOrganizationId);
    } else {
      await refreshDeals();
    }
  };

  const permanentlyDeleteDeal = async (dealId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteDealRepository(user, currentOrganizationId, dealId);
    setArchivedDeals((prev) => prev.filter((deal) => deal.id !== dealId));
  };

  const restoreLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const knownLead = [...leads, ...archivedLeads, ...trashedLeads].find((lead) => lead.id === leadId);
    await restoreLeadRepository(user, currentOrganizationId, leadId);
    invalidateDashboardMetrics(currentOrganizationId);
    if (knownLead) syncLeadLifecycleState(knownLead, 'ACTIVE');
    else {
      leadsRequestRef.current += 1;
      archivedLeadsRequestRef.current += 1;
      trashedLeadsRequestRef.current += 1;
      setArchivedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      setTrashedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      setLeadsLoading(false);
    }
  };

  const permanentlyDeleteLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteLeadRepository(user, currentOrganizationId, leadId);
    leadsRequestRef.current += 1;
    archivedLeadsRequestRef.current += 1;
    trashedLeadsRequestRef.current += 1;
    setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    setArchivedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    setTrashedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    setLeadsLoading(false);
  };


  const addNote = async (clientId: string, content: string) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newNote = await addClientNote(user, currentOrganizationId, clientId, content);
    setClientNotes(prev => [newNote, ...prev]);
  };

  const updateNote = async (clientId: string, noteId: string, content: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await updateClientNoteRepository(user, currentOrganizationId, clientId, noteId, content);
    setClientNotes((current) => current.map((note) => note.id === noteId ? { ...note, content: content.trim() } : note));
  };

  const archiveClientNote = async (clientId: string, noteId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const note = clientNotes.find((item) => item.id === noteId && item.clientId === clientId);
    await archiveClientNoteRepository(user, currentOrganizationId, clientId, noteId);
    setClientNotes((current) => current.filter((note) => note.id !== noteId));
    if (note) {
      setArchivedClientNotes((current) => [{ ...note, archived: true, archivedAt: new Date().toISOString(), archivedBy: user.uid }, ...current.filter((item) => item.id !== noteId)]);
      setArchivedClientNotesOrganizationId(currentOrganizationId);
      setArchivedClientNotesClientId(clientId);
    }
  };

  const restoreClientNote = async (clientId: string, noteId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    const note = archivedClientNotes.find((item) => item.id === noteId && item.clientId === clientId);
    await restoreClientNoteRepository(user, currentOrganizationId, clientId, noteId);
    setArchivedClientNotes((current) => current.filter((note) => note.id !== noteId));
    if (note) {
      setClientNotes((current) => [{ ...note, archived: false, archivedAt: undefined, archivedBy: undefined }, ...current.filter((item) => item.id !== noteId)]);
      setClientNotesOrganizationId(currentOrganizationId);
      setClientNotesClientId(clientId);
    }
  };

  const permanentlyDeleteClientNote = async (clientId: string, noteId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteClientNoteRepository(user, currentOrganizationId, clientId, noteId);
    setArchivedClientNotes((current) => current.filter((note) => note.id !== noteId));
  };

  const uploadDocument = async (clientId: string, file: File) => {
    if (!user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newDoc = await uploadClientDocument(user, currentOrganizationId, clientId, file);
    setClientDocuments(prev => [newDoc, ...prev]);
    setClientDocumentsOrganizationId(currentOrganizationId);
  };

  const archiveClientDocument = async (clientId: string, documentId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await archiveClientDocumentRepository(user, currentOrganizationId, clientId, documentId);
    setClientDocuments((current) => current.filter((document) => document.id !== documentId));
    await loadArchivedClientDocuments(clientId);
  };

  const restoreClientDocument = async (clientId: string, documentId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await restoreClientDocumentRepository(user, currentOrganizationId, clientId, documentId);
    setArchivedClientDocuments((current) => current.filter((document) => document.id !== documentId));
    await loadClientDocuments(clientId);
  };

  const permanentlyDeleteClientDocument = async (clientId: string, documentId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    requireWritableLicense();
    await permanentlyDeleteClientDocumentRepository(user, currentOrganizationId, clientId, documentId);
    setArchivedClientDocuments((current) => current.filter((document) => document.id !== documentId));
  };

  const convertLeadToClient = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !user) return;
    requireWritableLicense();
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const organizationId = currentOrganizationId;
    const result = await convertLeadRepository(user, organizationId, lead);
    invalidateDashboardMetrics(currentOrganizationId);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Client', convertedClientId: result.clientId } : l));
    await refreshClients(result.clientId);
  };


  return (
    <AppContext.Provider value={{
      leads: canLoadTenantData && leadsOrganizationId === currentOrganizationId ? leads : [],
      leadsLoading: canLoadTenantData ? (leadsOrganizationId !== currentOrganizationId || leadsLoading) : false,
      leadsError,
      refreshLeads,
      loadMoreLeads,
      leadsHasMore,
      clients: canLoadTenantData && clientsOrganizationId === currentOrganizationId ? clients : [],
      clientsLoading: canLoadTenantData ? (clientsOrganizationId !== currentOrganizationId || clientsLoading) : false,
      clientsError,
      loadMoreClients,
      clientsHasMore,
      archivedClients: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedClients : [],
      archivedLeads: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedLeads : [],
      trashedClients: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? trashedClients : [],
      trashedLeads: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? trashedLeads : [],
      archivedDeals: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedDeals : [],
      archivedTasks: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedTasks : [],
      archivedClientsHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedClientsHasMore : false,
      archivedLeadsHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedLeadsHasMore : false,
      trashedClientsHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? trashedClientsHasMore : false,
      trashedLeadsHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? trashedLeadsHasMore : false,
      archivedDealsHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedDealsHasMore : false,
      archivedTasksHasMore: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedTasksHasMore : false,
      loadArchivedRecords,
      loadTrashRecords,
      loadMoreArchivedLeads,
      loadMoreArchivedClients,
      loadMoreTrashedLeads,
      loadMoreTrashedClients,
      loadMoreArchivedDeals,
      loadMoreArchivedTasks,
      clientNotes: canLoadTenantData && clientNotesOrganizationId === currentOrganizationId ? clientNotes : [],
      archivedClientNotes: canLoadTenantData && archivedClientNotesOrganizationId === currentOrganizationId && archivedClientNotesClientId ? archivedClientNotes : [],
      clientNotesLoading: canLoadTenantData && clientNotesOrganizationId === currentOrganizationId ? clientNotesLoading : false,
      clientNotesError,
      loadMoreClientNotes,
      loadArchivedClientNotes,
      clientNotesHasMore,
      clientDocuments: canLoadTenantData && clientDocumentsOrganizationId === currentOrganizationId ? clientDocuments : [],
      archivedClientDocuments: canLoadTenantData && archivedClientDocumentsOrganizationId === currentOrganizationId && archivedClientDocumentsClientId ? archivedClientDocuments : [],
      clientDocumentsLoading: canLoadTenantData && clientDocumentsOrganizationId === currentOrganizationId ? clientDocumentsLoading : false,
      clientDocumentsError,
      loadMoreClientDocuments,
      loadArchivedClientDocuments,
      clientDocumentsHasMore,
      deals: canLoadTenantData && dealsOrganizationId === currentOrganizationId ? deals : [],
      dealsLoading: canLoadTenantData ? (dealsOrganizationId !== currentOrganizationId || dealsLoading) : false,
      dealsError,
      tasks: canLoadTenantData && tasksOrganizationId === currentOrganizationId ? tasks : [],
      tasksLoading: canLoadTenantData ? (tasksOrganizationId !== currentOrganizationId || tasksLoading) : false,
      tasksError,
      leadTasks: canLoadTenantData && leadTasksOrganizationId === currentOrganizationId && leadTasksUserId === user?.uid ? leadTasks : [],
      leadTasksLoading: canLoadTenantData && leadTasksOrganizationId === currentOrganizationId && leadTasksUserId === user?.uid ? leadTasksLoading : false,
      leadTasksError: canLoadTenantData && leadTasksOrganizationId === currentOrganizationId && leadTasksUserId === user?.uid ? leadTasksError : null,
      loadLeadTasks,
      users,
      usersLoading,
      usersError,
      activities: canLoadTenantData && activitiesOrganizationId === currentOrganizationId ? activities : [],
      refreshActivities,
      settings: canLoadTenantData && settingsOrganizationId === currentOrganizationId ? settings : defaultSettings,
      settingsLoading: canLoadTenantData ? settingsLoading || settingsOrganizationId !== currentOrganizationId : false,
      settingsError,
      addLead,
      updateLead,
      updateLeadStatus,
      archiveLead,
      trashLead,
      addClient,
      updateClient,
      archiveClient,
      trashClient,
      restoreClient,
      permanentlyDeleteClient,
      refreshClients,
      loadClientNotes,
      loadClientDocuments,
      addDeal,
      updateDeal,
      addTask,
      updateTask,
      completeTask,
      archiveTask,
      restoreTask,
      permanentlyDeleteTask,
      refreshTasks,
      loadMoreTasks,
      tasksHasMore,
      updateDealStage,
      refreshDeals,
      archiveDeal,
      restoreDeal,
      permanentlyDeleteDeal,
      restoreLead,
      permanentlyDeleteLead,
      executeBulkLifecycleAction,
      convertLeadToClient,
      addNote,
      updateNote,
      archiveClientNote,
      restoreClientNote,
      permanentlyDeleteClientNote,
      uploadDocument,
      archiveClientDocument,
      restoreClientDocument,
      permanentlyDeleteClientDocument,
      updateSettings,
      canWrite,
      isReadOnly,
      licenseState,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
}

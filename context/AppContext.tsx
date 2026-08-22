'use client';

import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { Lead, Client, Deal, Task, Activity, Settings, DocumentItem, Note } from '../types';
import { useAuth } from '@/context/AuthContext';
import { addClientNote, archiveClient as archiveClientRepository, createClient as createClientRepository, listArchivedClients, listClientDocuments, listClientNotes, listClients, permanentlyDeleteClient as permanentlyDeleteClientRepository, restoreClient as restoreClientRepository, uploadClientDocument, updateClient as updateClientRepository, type ClientInput } from '@/lib/repositories/clients';
import { convertLeadToClient as convertLeadRepository, createLead as createLeadRepository, listArchivedLeads, listLeads, permanentlyDeleteLead as permanentlyDeleteLeadRepository, restoreLead as restoreLeadRepository } from '@/lib/repositories/leads';
import { archiveDeal as archiveDealRepository, createDeal as createDealRepository, listArchivedDeals, listDeals, permanentlyDeleteDeal as permanentlyDeleteDealRepository, restoreDeal as restoreDealRepository, updateDeal as updateDealRepository, updateDealStage as updateDealStageRepository } from '@/lib/repositories/deals';
import { archiveTask as archiveTaskRepository, completeTask as completeTaskRepository, createTask as createTaskRepository, listArchivedTasks, listTasks, permanentlyDeleteTask as permanentlyDeleteTaskRepository, restoreTask as restoreTaskRepository, updateTask as updateTaskRepository } from '@/lib/repositories/tasks';
import { defaultSettings, loadSettings, updateSettings as updateSettingsRepository } from '@/lib/repositories/settings';
import { createActivity, listActivities, type ActivityInput } from '@/lib/repositories/activities';
import { formatCurrency } from '@/lib/formatting';
import { listAssignableOrganizationUsers, type AssignableUser } from '@/lib/repositories/users';
import { getDealStatusForStage } from '@/lib/deal-workflow';
import { useWorkspace } from '@/context/WorkspaceContext';

interface AppContextType {
  leads: Lead[];
  leadsLoading: boolean;
  leadsError: string | null;
  refreshLeads: () => Promise<void>;
  clients: Client[];
  clientsLoading: boolean;
  clientsError: string | null;
  archivedClients: Client[];
  archivedLeads: Lead[];
  archivedDeals: Deal[];
  archivedTasks: Task[];
  loadArchivedRecords: () => Promise<void>;
  clientNotes: Note[];
  clientNotesLoading: boolean;
  clientNotesError: string | null;
  clientDocuments: DocumentItem[];
  clientDocumentsLoading: boolean;
  clientDocumentsError: string | null;
  deals: Deal[];
  dealsLoading: boolean;
  tasks: Task[];
  tasksLoading: boolean;
  tasksError: string | null;
  users: AssignableUser[];
  usersLoading: boolean;
  usersError: string | null;
  activities: Activity[];
  settings: Settings;
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  addClient: (client: ClientInput) => Promise<void>;
  updateClient: (clientId: string, client: ClientInput) => Promise<void>;
  archiveClient: (clientId: string) => Promise<void>;
  restoreClient: (clientId: string) => Promise<void>;
  permanentlyDeleteClient: (clientId: string) => Promise<void>;
  refreshClients: () => Promise<void>;
  loadClientNotes: (clientId: string) => Promise<void>;
  loadClientDocuments: (clientId: string) => Promise<void>;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateDeal: (dealId: string, input: { title: string; value: number; stage: string; expectedCloseDate: string; productServiceName?: string; notes?: string; assignedToUid: string; assignedToName: string; lossReason: string }) => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  updateTask: (taskId: string, task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  archiveTask: (taskId: string) => Promise<void>;
  restoreTask: (taskId: string) => Promise<void>;
  permanentlyDeleteTask: (taskId: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  updateDealStage: (dealId: string, stage: string, status?: Deal['status'], lossReason?: string) => Promise<void>;
  archiveDeal: (dealId: string) => Promise<void>;
  restoreDeal: (dealId: string) => Promise<void>;
  permanentlyDeleteDeal: (dealId: string) => Promise<void>;
  restoreLead: (leadId: string) => Promise<void>;
  permanentlyDeleteLead: (leadId: string) => Promise<void>;
  convertLeadToClient: (leadId: string) => Promise<void>;
  addNote: (clientId: string, content: string) => Promise<void>;
  uploadDocument: (clientId: string, file: File) => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const { currentOrganizationId, loading: workspaceLoading, ready: workspaceReady, membership } = useWorkspace();
  const canLoadBusinessData = authStatus === 'active' && Boolean(user) && !workspaceLoading;
  const canLoadTenantData = canLoadBusinessData && workspaceReady && Boolean(currentOrganizationId);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsOrganizationId, setLeadsOrganizationId] = useState<string | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const currentOrganizationRef = useRef(currentOrganizationId);
  const clientNotesRequestRef = useRef(0);
  const clientDocumentsRequestRef = useRef(0);
  useEffect(() => {
    currentOrganizationRef.current = currentOrganizationId;
  }, [currentOrganizationId]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsOrganizationId, setDealsOrganizationId] = useState<string | null>(null);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksOrganizationId, setTasksOrganizationId] = useState<string | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsOrganizationId, setClientsOrganizationId] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [archivedClients, setArchivedClients] = useState<Client[]>([]);
  const [archivedLeads, setArchivedLeads] = useState<Lead[]>([]);
  const [archivedDeals, setArchivedDeals] = useState<Deal[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [archivedOrganizationId, setArchivedOrganizationId] = useState<string | null>(null);
  const [clientNotes, setClientNotes] = useState<Note[]>([]);
  const [clientNotesOrganizationId, setClientNotesOrganizationId] = useState<string | null>(null);
  const [clientNotesLoading, setClientNotesLoading] = useState(false);
  const [clientNotesError, setClientNotesError] = useState<string | null>(null);
  const [clientDocuments, setClientDocuments] = useState<DocumentItem[]>([]);
  const [clientDocumentsOrganizationId, setClientDocumentsOrganizationId] = useState<string | null>(null);
  const [clientDocumentsLoading, setClientDocumentsLoading] = useState(false);
  const [clientDocumentsError, setClientDocumentsError] = useState<string | null>(null);

  useEffect(() => {
    if (!canLoadBusinessData || !user) return;
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
  }, [canLoadBusinessData, currentOrganizationId, membership, user]);

  const loadClientNotes = useCallback(async (clientId: string) => {
    if (!user) return;
    const organizationId = currentOrganizationId;
    const requestId = ++clientNotesRequestRef.current;
    setClientNotesLoading(true);
    setClientNotesError(null);
    setClientNotes([]);
    try {
      if (!organizationId) return;
      const loadedNotes = await listClientNotes(user, organizationId, clientId);
      if (requestId !== clientNotesRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClientNotes(loadedNotes);
      setClientNotesOrganizationId(organizationId);
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
      const loadedDocuments = await listClientDocuments(user, organizationId, clientId);
      if (requestId !== clientDocumentsRequestRef.current || organizationId !== currentOrganizationRef.current) return;
      setClientDocuments(loadedDocuments);
      setClientDocumentsOrganizationId(organizationId);
    } catch (error) {
      console.error('Unable to load client documents', error);
      if (requestId === clientDocumentsRequestRef.current && organizationId === currentOrganizationRef.current) setClientDocumentsError('Unable to load client documents. Please try again.');
    } finally {
      if (requestId === clientDocumentsRequestRef.current) setClientDocumentsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const refreshClients = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    setClientsLoading(true);
    setClientsError(null);
    try {
      const loadedClients = await listClients(user, organizationId);
      if (organizationId !== currentOrganizationRef.current) return;
      setClients(loadedClients);
      setClientsOrganizationId(organizationId);
    } catch (error) {
      console.error('Unable to load shared clients', error);
      if (organizationId === currentOrganizationRef.current) setClientsError('Unable to load clients. Please check your connection and try again.');
    } finally {
      if (organizationId === currentOrganizationRef.current) setClientsLoading(false);
    }
  }, [currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId) return;
    let cancelled = false;
    const loadClients = async () => {
      setClientsLoading(true);
      setClientsError(null);
      try {
        const loadedClients = await listClients(user, currentOrganizationId);
        if (!cancelled) {
          setClients(loadedClients);
          setClientsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared clients', error);
        if (!cancelled) setClientsError('Unable to load clients. Please check your connection and try again.');
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    };
    void loadClients();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadBusinessData || !user || !currentOrganizationId) {
      return;
    }
    let cancelled = false;
    const loadLeads = async () => {
      setLeads([]);
      setLeadsOrganizationId(null);
      setLeadsLoading(true);
      setLeadsError(null);
      try {
        const loadedLeads = await listLeads(user, currentOrganizationId);
        if (!cancelled) {
          setLeads(loadedLeads);
          setLeadsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared leads', error);
        if (!cancelled) setLeadsError('Unable to load leads. Please check your connection and try again.');
      } finally {
        if (!cancelled) setLeadsLoading(false);
      }
    };
    void loadLeads();
    return () => { cancelled = true; };
  }, [canLoadBusinessData, currentOrganizationId, user]);

  const refreshLeads = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const loadedLeads = await listLeads(user, organizationId);
      if (organizationId === currentOrganizationRef.current) {
        setLeads(loadedLeads);
        setLeadsOrganizationId(organizationId);
      }
    } catch (error) {
      console.error('Unable to refresh shared leads', error);
      if (organizationId === currentOrganizationRef.current) setLeadsError('Unable to load leads. Please check your connection and try again.');
    } finally {
      if (organizationId === currentOrganizationRef.current) setLeadsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const refreshTasks = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    setTasksLoading(true);
    setTasksError(null);
    try {
      setTasks(await listTasks(user, currentOrganizationId));
      setTasksOrganizationId(currentOrganizationId);
    } catch (error) {
      console.error('Unable to load shared tasks', error);
      setTasksError('Unable to load tasks. Please check your connection and try again.');
    } finally {
      setTasksLoading(false);
    }
  }, [currentOrganizationId, user]);

  const refreshDeals = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    setDealsLoading(true);
    try {
      const loadedDeals = await listDeals(user, organizationId);
      if (organizationId === currentOrganizationRef.current) {
        setDeals(loadedDeals);
        setDealsOrganizationId(organizationId);
      }
    } catch (error) {
      console.error('Unable to refresh shared deals', error);
    } finally {
      if (organizationId === currentOrganizationRef.current) setDealsLoading(false);
    }
  }, [currentOrganizationId, user]);

  const loadArchivedRecords = useCallback(async () => {
    if (!user || !currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    const [loadedClients, loadedLeads, loadedDeals, loadedTasks] = await Promise.all([
      listArchivedClients(user, organizationId),
      listArchivedLeads(user, organizationId),
      listArchivedDeals(user, organizationId),
      listArchivedTasks(user, organizationId),
    ]);
    if (organizationId !== currentOrganizationRef.current) return;
    setArchivedClients(loadedClients);
    setArchivedLeads(loadedLeads);
    setArchivedDeals(loadedDeals);
    setArchivedTasks(loadedTasks);
    setArchivedOrganizationId(organizationId);
  }, [currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId) return;
    let cancelled = false;
    const loadTasks = async () => {
      setTasksLoading(true);
      setTasksError(null);
      try {
        const loadedTasks = await listTasks(user, currentOrganizationId);
        if (!cancelled) {
          setTasks(loadedTasks);
          setTasksOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared tasks', error);
        if (!cancelled) setTasksError('Unable to load tasks. Please check your connection and try again.');
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    };
    void loadTasks();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, user]);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId) return;
    let cancelled = false;
    const loadDeals = async () => {
      setDealsLoading(true);
      try {
        const loadedDeals = await listDeals(user, currentOrganizationId);
        if (!cancelled) {
          setDeals(loadedDeals);
          setDealsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        const firebaseError = error as { code?: string; message?: string };
        console.error(`Unable to load shared deals code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
      } finally {
        if (!cancelled) setDealsLoading(false);
      }
    };
    void loadDeals();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, user]);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesOrganizationId, setActivitiesOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId) return;
    let cancelled = false;
    const loadActivities = async () => {
      try {
        const loadedActivities = await listActivities(user, currentOrganizationId);
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
  }, [canLoadTenantData, currentOrganizationId, user]);

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOrganizationId, setSettingsOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    if (!canLoadTenantData || !user || !currentOrganizationId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const loadedSettings = await loadSettings(user, currentOrganizationId);
        if (!cancelled) {
          setSettings(loadedSettings);
          setSettingsOrganizationId(currentOrganizationId);
        }
      } catch (error) {
        console.error('Unable to load shared business settings', error);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [canLoadTenantData, currentOrganizationId, user]);

  const updateSettings = async (newSettings: Partial<Settings>) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateSettingsRepository(user, currentOrganizationId, newSettings);
    setSettings(prev => ({ ...prev, ...newSettings }));
    setSettingsOrganizationId(currentOrganizationId);
    void logActivity('settings_update', 'Business settings updated', 'Settings');
  };

  const logActivity = async (type: Activity['type'], description: string, entityType?: ActivityInput['entityType'], entityId?: string, metadata?: Record<string, unknown>) => {
    if (!user || !currentOrganizationId) return;
    try {
      const newActivity = await createActivity(user, currentOrganizationId, { type, description, entityType, entityId, metadata });
      setActivities(prev => [newActivity, ...prev]);
      setActivitiesOrganizationId(currentOrganizationId);
    } catch (error) {
      console.error('Unable to persist activity', error);
    }
  };

  const addLead = async (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    if (workspaceLoading) throw new Error('Workspace is still loading. Please wait a moment and try again.');
    if (!workspaceReady || !currentOrganizationId) throw new Error('No active organization is available. Please contact an administrator.');
    const newLead = await createLeadRepository(user, currentOrganizationId, leadData);
    setLeads(prev => [newLead, ...prev]);
    setLeadsOrganizationId(currentOrganizationId);
    void logActivity('lead_creation', `Lead added: ${newLead.name} (${newLead.company || 'Independent'})`, 'Lead', newLead.id);
  };

  const addClient = async (clientData: ClientInput) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newClient = await createClientRepository(user, currentOrganizationId, clientData);
    setClients(prev => [newClient, ...prev]);
    setClientsOrganizationId(currentOrganizationId);
    void logActivity('client_creation', `Client added: ${newClient.name}`, 'Client', newClient.id);
  };

  const updateClient = async (clientId: string, clientData: ClientInput) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateClientRepository(user, currentOrganizationId, clientId, clientData);
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, ...clientData, updatedAt: new Date().toISOString(), updatedBy: user.uid } : client));
    void logActivity('client_update', `Client updated: ${clientData.name}`, 'Client', clientId);
  };

  const archiveClient = async (clientId: string) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await archiveClientRepository(user, currentOrganizationId, clientId);
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, status: 'ARCHIVED', updatedAt: new Date().toISOString(), updatedBy: user.uid } : client));
    void logActivity('client_archive', `Client archived: ${clientId}`, 'Client', clientId);
  };

  const restoreClient = async (clientId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await restoreClientRepository(user, currentOrganizationId, clientId);
    setArchivedClients((prev) => prev.filter((client) => client.id !== clientId));
    await refreshClients();
  };

  const permanentlyDeleteClient = async (clientId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await permanentlyDeleteClientRepository(user, currentOrganizationId, clientId);
    setArchivedClients((prev) => prev.filter((client) => client.id !== clientId));
  };

  const addDeal = async (dealData: Omit<Deal, 'id' | 'createdAt' | 'status'>) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newDeal = await createDealRepository(user, currentOrganizationId, dealData);
    setDeals(prev => [newDeal, ...prev]);
    setDealsOrganizationId(currentOrganizationId);
    void logActivity('deal_creation', `New deal created: ${newDeal.title} (${formatCurrency(newDeal.value, settings.currency)})`, 'Deal', newDeal.id);
  };

  const updateDeal = async (dealId: string, dealData: { title: string; value: number; stage: string; expectedCloseDate: string; productServiceName?: string; notes?: string; assignedToUid: string; assignedToName: string; lossReason: string }) => {
    if (!user) return;
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) throw new Error('Deal not found. Please refresh and try again.');
    const nextStatus = getDealStatusForStage(dealData.stage);
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateDealRepository(user, currentOrganizationId, deal, { ...dealData, clientId: deal.clientId, leadId: deal.leadId });
    setDeals(prev => prev.map(item => item.id === dealId ? { ...item, ...dealData, status: nextStatus, lossReason: nextStatus === 'Lost' ? dealData.lossReason : undefined, updatedAt: new Date().toISOString(), updatedBy: user.uid } : item));
    const activityType = nextStatus === 'Won' ? 'deal_won' : nextStatus === 'Lost' ? 'deal_lost' : deal.stage !== dealData.stage ? 'stage_change' : 'deal_update';
    void logActivity(activityType, nextStatus === 'Won' ? `Deal "${deal.title}" marked Won` : nextStatus === 'Lost' ? `Deal "${deal.title}" marked Lost` : deal.stage !== dealData.stage ? `Deal "${deal.title}" moved from ${deal.stage} to ${dealData.stage}` : `Deal "${deal.title}" updated`, 'Deal', deal.id, nextStatus === 'Lost' ? { reason: dealData.lossReason } : undefined);
  };

  const addTask = async (taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newTask = await createTaskRepository(user, currentOrganizationId, taskData);
    setTasks(prev => [newTask, ...prev]);
    setTasksOrganizationId(currentOrganizationId);
  };

  const updateTask = async (taskId: string, taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateTaskRepository(user, currentOrganizationId, taskId, taskData);
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, ...taskData, updatedAt: new Date().toISOString() } : task));
  };

  const completeTask = async (taskId: string) => {
    if (!user) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    const nextStatus = task.status === 'Pending' ? 'Completed' : 'Pending';
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await completeTaskRepository(user, currentOrganizationId, taskId, nextStatus);
    setTasks(prev => prev.map(item => item.id === taskId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item));
    if (nextStatus === 'Completed') void logActivity('task_completion', `Task Completed: ${task.title}`, 'Task', task.id);
  };

  const archiveTask = async (taskId: string) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await archiveTaskRepository(user, currentOrganizationId, taskId);
    setTasks(prev => prev.filter(task => task.id !== taskId));
  };

  const restoreTask = async (taskId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await restoreTaskRepository(user, currentOrganizationId, taskId);
    setArchivedTasks((prev) => prev.filter((task) => task.id !== taskId));
    await refreshTasks();
  };

  const permanentlyDeleteTask = async (taskId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await permanentlyDeleteTaskRepository(user, currentOrganizationId, taskId);
    setArchivedTasks((prev) => prev.filter((task) => task.id !== taskId));
  };

  const updateDealStage = async (dealId: string, stage: string, status: Deal['status'] = 'Active', lossReason?: string) => {
    if (!user) return;
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return;
    const nextStatus = getDealStatusForStage(stage);
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await updateDealStageRepository(user, currentOrganizationId, deal, stage, nextStatus, lossReason);
    setDeals(prev => prev.map(item => item.id === dealId ? { ...item, stage, status: nextStatus, lossReason: nextStatus === 'Lost' ? lossReason : undefined } : item));
    if (deal.stage !== stage) {
      const activityType = nextStatus === 'Won' ? 'deal_won' : nextStatus === 'Lost' ? 'deal_lost' : 'stage_change';
      void logActivity(activityType, nextStatus === 'Won' ? `Deal "${deal.title}" marked Won` : nextStatus === 'Lost' ? `Deal "${deal.title}" marked Lost` : `Deal "${deal.title}" moved from ${deal.stage} to ${stage}`, 'Deal', deal.id, nextStatus === 'Lost' ? { reason: lossReason } : nextStatus === 'Won' ? { value: deal.value } : undefined);
    }
  };

  const archiveDeal = async (dealId: string) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    await archiveDealRepository(user, currentOrganizationId, dealId);
    setDeals(prev => prev.filter((deal) => deal.id !== dealId));
  };

  const restoreDeal = async (dealId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await restoreDealRepository(user, currentOrganizationId, dealId);
    setArchivedDeals((prev) => prev.filter((deal) => deal.id !== dealId));
    await refreshDeals();
  };

  const permanentlyDeleteDeal = async (dealId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await permanentlyDeleteDealRepository(user, currentOrganizationId, dealId);
    setArchivedDeals((prev) => prev.filter((deal) => deal.id !== dealId));
  };

  const restoreLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await restoreLeadRepository(user, currentOrganizationId, leadId);
    setArchivedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    await refreshLeads();
  };

  const permanentlyDeleteLead = async (leadId: string) => {
    if (!user || !currentOrganizationId) throw new Error('No active organization is selected.');
    await permanentlyDeleteLeadRepository(user, currentOrganizationId, leadId);
    setArchivedLeads((prev) => prev.filter((lead) => lead.id !== leadId));
  };


  const addNote = async (clientId: string, content: string) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newNote = await addClientNote(user, currentOrganizationId, clientId, content);
    setClientNotes(prev => [newNote, ...prev]);
  };

  const uploadDocument = async (clientId: string, file: File) => {
    if (!user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const newDoc = await uploadClientDocument(user, currentOrganizationId, clientId, file);
    setClientDocuments(prev => [newDoc, ...prev]);
    setClientDocumentsOrganizationId(currentOrganizationId);
    void logActivity('task_completion', `Document uploaded for client: ${file.name}`, 'Client', clientId);
  };

  const convertLeadToClient = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !user) return;
    if (!currentOrganizationId) throw new Error('No active organization is selected.');
    const result = await convertLeadRepository(user, currentOrganizationId, lead);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Client', convertedClientId: result.clientId } : l));
    await refreshClients();
    void logActivity('client_creation', `Client created from lead: ${lead.name}`, 'Client', result.clientId, { sourceLeadId: lead.id });
    void logActivity('client_conversion', `Converted lead ${lead.name} to Client`, 'Lead', lead.id, { clientId: result.clientId });
  };


  return (
    <AppContext.Provider value={{
      leads: canLoadTenantData && leadsOrganizationId === currentOrganizationId ? leads : [],
      leadsLoading: canLoadTenantData ? (leadsOrganizationId !== currentOrganizationId || leadsLoading) : false,
      leadsError,
      refreshLeads,
      clients: canLoadTenantData && clientsOrganizationId === currentOrganizationId ? clients : [],
      clientsLoading: canLoadTenantData ? (clientsOrganizationId !== currentOrganizationId || clientsLoading) : false,
      clientsError,
      archivedClients: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedClients : [],
      archivedLeads: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedLeads : [],
      archivedDeals: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedDeals : [],
      archivedTasks: canLoadTenantData && archivedOrganizationId === currentOrganizationId ? archivedTasks : [],
      loadArchivedRecords,
      clientNotes: canLoadTenantData && clientNotesOrganizationId === currentOrganizationId ? clientNotes : [],
      clientNotesLoading: canLoadTenantData && clientNotesOrganizationId === currentOrganizationId ? clientNotesLoading : false,
      clientNotesError,
      clientDocuments: canLoadTenantData && clientDocumentsOrganizationId === currentOrganizationId ? clientDocuments : [],
      clientDocumentsLoading: canLoadTenantData && clientDocumentsOrganizationId === currentOrganizationId ? clientDocumentsLoading : false,
      clientDocumentsError,
      deals: canLoadTenantData && dealsOrganizationId === currentOrganizationId ? deals : [],
      dealsLoading: canLoadTenantData ? (dealsOrganizationId !== currentOrganizationId || dealsLoading) : false,
      tasks: canLoadTenantData && tasksOrganizationId === currentOrganizationId ? tasks : [],
      tasksLoading: canLoadTenantData ? (tasksOrganizationId !== currentOrganizationId || tasksLoading) : false,
      tasksError,
      users,
      usersLoading,
      usersError,
      activities: canLoadTenantData && activitiesOrganizationId === currentOrganizationId ? activities : [],
      settings: canLoadTenantData && settingsOrganizationId === currentOrganizationId ? settings : defaultSettings,
      addLead,
      addClient,
      updateClient,
      archiveClient,
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
      updateDealStage,
      archiveDeal,
      restoreDeal,
      permanentlyDeleteDeal,
      restoreLead,
      permanentlyDeleteLead,
      convertLeadToClient,
      addNote,
      uploadDocument,
      updateSettings,
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

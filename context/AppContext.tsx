'use client';

import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Lead, Client, Deal, Task, Activity, Settings } from '../types';
import { mockClients, mockActivities, mockSettings } from '../lib/mock-data';
import { useAuth } from '@/context/AuthContext';
import { convertLeadToClient as convertLeadRepository, createLead as createLeadRepository, listLeads } from '@/lib/repositories/leads';
import { archiveDeal as archiveDealRepository, createDeal as createDealRepository, listDeals, updateDealStage as updateDealStageRepository } from '@/lib/repositories/deals';
import { archiveTask as archiveTaskRepository, completeTask as completeTaskRepository, createTask as createTaskRepository, listTasks, updateTask as updateTaskRepository } from '@/lib/repositories/tasks';

interface AppContextType {
  leads: Lead[];
  clients: Client[];
  deals: Deal[];
  dealsLoading: boolean;
  tasks: Task[];
  tasksLoading: boolean;
  tasksError: string | null;
  activities: Activity[];
  settings: Settings;
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  addClient: (client: Omit<Client, 'id' | 'createdAt'>) => void;
  updateClient: (client: Client) => void;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  updateTask: (taskId: string, task: Omit<Task, 'id' | 'status'>) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  archiveTask: (taskId: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  updateDealStage: (dealId: string, stage: string, status?: Deal['status'], lossReason?: string) => Promise<void>;
  archiveDeal: (dealId: string) => Promise<void>;
  convertLeadToClient: (leadId: string) => Promise<void>;
  addNote: (clientId: string, content: string, author?: string) => void;
  uploadDocument: (clientId: string, name: string, size: string) => void;
  updateSettings: (settings: Partial<Settings>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

let activityIdSequence = 0;

function createActivityId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `act_${globalThis.crypto.randomUUID()}`;
  }

  activityIdSequence += 1;
  return `act_${Date.now()}_${activityIdSequence}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || pathname !== '/') return;
    let cancelled = false;
    const loadLeads = async () => {
      try {
        const loadedLeads = await listLeads(user);
        if (!cancelled) setLeads(loadedLeads);
      } catch (error) {
        console.error('Unable to load shared leads', error);
      }
    };
    void loadLeads();
    return () => { cancelled = true; };
  }, [pathname, user]);

  const refreshTasks = useCallback(async () => {
    if (!user) return;
    setTasksLoading(true);
    setTasksError(null);
    try {
      setTasks(await listTasks(user));
    } catch (error) {
      console.error('Unable to load shared tasks', error);
      setTasksError('Unable to load tasks. Please check your connection and try again.');
    } finally {
      setTasksLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !['/', '/tasks', '/clients'].includes(pathname)) return;
    let cancelled = false;
    const loadTasks = async () => {
      setTasksLoading(true);
      setTasksError(null);
      try {
        const loadedTasks = await listTasks(user);
        if (!cancelled) setTasks(loadedTasks);
      } catch (error) {
        console.error('Unable to load shared tasks', error);
        if (!cancelled) setTasksError('Unable to load tasks. Please check your connection and try again.');
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    };
    void loadTasks();
    return () => { cancelled = true; };
  }, [pathname, user]);

  useEffect(() => {
    if (!user || !['/', '/pipeline', '/clients'].includes(pathname)) return;
    let cancelled = false;
    const loadDeals = async () => {
      setDealsLoading(true);
      try {
        const loadedDeals = await listDeals(user);
        if (!cancelled) setDeals(loadedDeals);
      } catch (error) {
        const firebaseError = error as { code?: string; message?: string };
        console.error(`Unable to load shared deals code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
      } finally {
        if (!cancelled) setDealsLoading(false);
      }
    };
    void loadDeals();
    return () => { cancelled = true; };
  }, [pathname, user]);

  const [clients, setClients] = useState<Client[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_clients');
      if (saved) return JSON.parse(saved);
    }
    return mockClients;
  });

  const [activities, setActivities] = useState<Activity[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_activities');
      if (saved) {
        const savedActivities = JSON.parse(saved) as Activity[];
        const usedIds = new Set<string>();

        return savedActivities.map((activity) => {
          const savedId = typeof activity.id === 'string' ? activity.id : '';
          const id = savedId && !usedIds.has(savedId) ? savedId : createActivityId();
          usedIds.add(id);
          return { ...activity, id };
        });
      }
    }
    return mockActivities;
  });

  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_settings');
      if (saved) return JSON.parse(saved);
    }
    return mockSettings;
  });

  useEffect(() => {
    localStorage.setItem('bsm_settings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    logActivity('task_completion', 'Settings updated');
  };

  useEffect(() => {
    localStorage.setItem('bsm_clients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('bsm_activities', JSON.stringify(activities));
  }, [activities]);

  const logActivity = (type: Activity['type'], description: string, meta?: string) => {
    const newAct: Activity = {
      id: createActivityId(),
      type,
      description,
      timestamp: new Date().toISOString(),
      meta
    };
    setActivities(prev => [newAct, ...prev]);
  };

  const addLead = async (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    const newLead = await createLeadRepository(user, leadData);
    setLeads(prev => [newLead, ...prev]);
    logActivity('lead_creation', `Lead added: ${newLead.name} (${newLead.company || 'Independent'})`);
  };

  const addClient = (clientData: Omit<Client, 'id' | 'createdAt'>) => {
    const newClient: Client = {
      ...clientData,
      id: 'c_' + Date.now(),
      notes: [],
      documents: [],
      createdAt: new Date().toISOString(),
    };
    setClients(prev => [newClient, ...prev]);
    logActivity('client_conversion', `Client added: ${newClient.name}`);
  };

  const updateClient = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  };

  const addDeal = async (dealData: Omit<Deal, 'id' | 'createdAt' | 'status'>) => {
    if (!user) return;
    const newDeal = await createDealRepository(user, dealData);
    setDeals(prev => [newDeal, ...prev]);
    logActivity('stage_change', `New deal created: ${newDeal.title} ($${newDeal.value.toLocaleString()})`);
  };

  const addTask = async (taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    const newTask = await createTaskRepository(user, taskData);
    setTasks(prev => [newTask, ...prev]);
  };

  const updateTask = async (taskId: string, taskData: Omit<Task, 'id' | 'status'>) => {
    if (!user) return;
    await updateTaskRepository(user, taskId, taskData);
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, ...taskData, updatedAt: new Date().toISOString() } : task));
  };

  const completeTask = async (taskId: string) => {
    if (!user) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    const nextStatus = task.status === 'Pending' ? 'Completed' : 'Pending';
    await completeTaskRepository(user, taskId, nextStatus);
    setTasks(prev => prev.map(item => item.id === taskId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item));
    if (nextStatus === 'Completed') logActivity('task_completion', `Task Completed: ${task.title}`);
  };

  const archiveTask = async (taskId: string) => {
    if (!user) return;
    await archiveTaskRepository(user, taskId);
    setTasks(prev => prev.filter(task => task.id !== taskId));
  };

  const updateDealStage = async (dealId: string, stage: string, status: Deal['status'] = 'Active', lossReason?: string) => {
    if (!user) return;
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return;
    await updateDealStageRepository(user, deal, stage, status, lossReason);
    setDeals(prev => prev.map(item => item.id === dealId ? { ...item, stage, status, lossReason } : item));
    if (deal.stage !== stage) logActivity('stage_change', `Deal "${deal.title}" moved from ${deal.stage} to ${stage}`, status === 'Lost' ? `Reason: ${lossReason}` : status === 'Won' ? `+$${deal.value.toLocaleString()}` : undefined);
  };

  const archiveDeal = async (dealId: string) => {
    if (!user) return;
    await archiveDealRepository(user, dealId);
    setDeals(prev => prev.filter((deal) => deal.id !== dealId));
  };


  const addNote = (clientId: string, content: string, author: string = 'Current User') => {
    const newNote = {
      id: 'n_' + Date.now(),
      clientId,
      content,
      author,
      createdAt: new Date().toISOString(),
    };
    setClients(prev => prev.map(c => {
      if (c.id === clientId) {
        return {
          ...c,
          notes: [newNote, ...(c.notes || [])]
        };
      }
      return c;
    }));
  };

  const uploadDocument = (clientId: string, name: string, size: string) => {
    const newDoc = {
      id: 'doc_' + Date.now(),
      clientId,
      name,
      size,
      uploadedAt: new Date().toISOString(),
    };
    setClients(prev => prev.map(c => {
      if (c.id === clientId) {
        return {
          ...c,
          documents: [newDoc, ...(c.documents || [])]
        };
      }
      return c;
    }));
    logActivity('task_completion', `Document uploaded for client: ${name}`);
  };

  const convertLeadToClient = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !user) return;
    const result = await convertLeadRepository(user, lead);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Client', convertedClientId: result.clientId } : l));
    logActivity('client_conversion', `Converted lead ${lead.name} to Client`);
  };


  return (
    <AppContext.Provider value={{
      leads,
      clients,
      deals,
      dealsLoading,
      tasks,
      tasksLoading,
      tasksError,
      activities,
      settings,
      addLead,
      addClient,
      updateClient,
      addDeal,
      addTask,
      updateTask,
      completeTask,
      archiveTask,
      refreshTasks,
      updateDealStage,
      archiveDeal,
      convertLeadToClient,
      addNote,
      uploadDocument,
      updateSettings
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

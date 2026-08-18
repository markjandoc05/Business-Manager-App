'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Lead, Client, Deal, Task, Activity, Settings } from '../types';
import { mockLeads, mockClients, mockDeals, mockTasks, mockActivities, mockSettings } from '../lib/mock-data';

interface AppContextType {
  leads: Lead[];
  clients: Client[];
  deals: Deal[];
  tasks: Task[];
  activities: Activity[];
  settings: Settings;
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addClient: (client: Omit<Client, 'id' | 'createdAt'>) => void;
  updateClient: (client: Client) => void;
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt'>) => void;
  addTask: (task: Omit<Task, 'id' | 'status'>) => void;
  completeTask: (taskId: string) => void;
  updateDealStage: (dealId: string, stage: string, status?: Deal['status'], lossReason?: string) => void;
  convertLeadToClient: (leadId: string) => void;
  addNote: (clientId: string, content: string, author?: string) => void;
  uploadDocument: (clientId: string, name: string, size: string) => void;
  updateSettings: (settings: Partial<Settings>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_leads');
      if (saved) return JSON.parse(saved);
    }
    return mockLeads;
  });

  const [clients, setClients] = useState<Client[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_clients');
      if (saved) return JSON.parse(saved);
    }
    return mockClients;
  });

  const [deals, setDeals] = useState<Deal[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_deals');
      if (saved) return JSON.parse(saved);
    }
    return mockDeals;
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_tasks');
      if (saved) return JSON.parse(saved);
    }
    return mockTasks;
  });

  const [activities, setActivities] = useState<Activity[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsm_activities');
      if (saved) return JSON.parse(saved);
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
    localStorage.setItem('bsm_leads', JSON.stringify(leads));
  }, [leads]);

  useEffect(() => {
    localStorage.setItem('bsm_clients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('bsm_deals', JSON.stringify(deals));
  }, [deals]);

  useEffect(() => {
    localStorage.setItem('bsm_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('bsm_activities', JSON.stringify(activities));
  }, [activities]);

  const logActivity = (type: Activity['type'], description: string, meta?: string) => {
    const newAct: Activity = {
      id: 'act_' + Date.now(),
      type,
      description,
      timestamp: new Date().toISOString(),
      meta
    };
    setActivities(prev => [newAct, ...prev]);
  };

  const addLead = (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newLead: Lead = {
      ...leadData,
      id: 'l_' + Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
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

  const addDeal = (dealData: Omit<Deal, 'id' | 'createdAt'>) => {
    const newDeal: Deal = {
      ...dealData,
      id: 'd_' + Date.now(),
      createdAt: new Date().toISOString(),
    };
    setDeals(prev => [newDeal, ...prev]);
    logActivity('stage_change', `New deal created: ${newDeal.title} ($${newDeal.value.toLocaleString()})`);
  };

  const addTask = (taskData: Omit<Task, 'id' | 'status'>) => {
    const newTask: Task = {
      ...taskData,
      id: 't_' + Date.now(),
      status: 'Pending',
    };
    setTasks(prev => [newTask, ...prev]);
  };

  const completeTask = (taskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const nextStatus = t.status === 'Pending' ? 'Completed' : 'Pending';
        if (nextStatus === 'Completed') {
          logActivity('task_completion', `Task Completed: ${t.title}`);
        }
        return { ...t, status: nextStatus };
      }
      return t;
    }));
  };

  const updateDealStage = (dealId: string, stage: string, status?: Deal['status'], lossReason?: string) => {
    setDeals(prev => prev.map(d => {
      if (d.id === dealId) {
        const oldStage = d.stage;
        
        // Handle Won/Lost status
        const updatedDeal = { ...d, stage, status: status || 'Active', lossReason };

        if (oldStage !== stage) {
          logActivity('stage_change', `Deal "${d.title}" moved from ${oldStage} to ${stage}`);
          if (status === 'Won') {
            logActivity('won_deal', `Deal Won: ${d.title}`, `+$${d.value.toLocaleString()}`);
          }
          if (status === 'Lost') {
            logActivity('stage_change', `Deal Lost: ${d.title}`, `Reason: ${lossReason}`);
          }
        }
        return updatedDeal;
      }
      return d;
    }));
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

  const convertLeadToClient = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Client' } : l));

    const newClient: Client = {
      id: 'c_' + Date.now(),
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      assignedTo: 'Sales Team',
      notes: [{ id: 'n_' + Date.now(), clientId: '', content: `Converted from lead source: ${lead.source}`, author: 'System', createdAt: new Date().toISOString() }],
      documents: [],
      createdAt: new Date().toISOString()
    };

    // Also create an initial deal for this client
    const initialDeal: Deal = {
      id: 'd_' + Date.now(),
      title: `${lead.company || lead.name} Initial Project`,
      clientId: newClient.id,
      value: 5000,
      stage: 'Opportunity',
      expectedCloseDate: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    };

    setClients(prev => [newClient, ...prev]);
    setDeals(prev => [initialDeal, ...prev]);
    logActivity('client_conversion', `Converted lead ${lead.name} to Client`);
  };


  return (
    <AppContext.Provider value={{
      leads,
      clients,
      deals,
      tasks,
      activities,
      settings,
      addLead,
      addClient,
      updateClient,
      addDeal,
      addTask,
      completeTask,
      updateDealStage,
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

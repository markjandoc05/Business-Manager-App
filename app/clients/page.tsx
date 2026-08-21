'use client';

import React, { useEffect, useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { 
  Search, 
  Plus, 
  Mail, 
  Phone, 
  Building2, 
  Calendar, 
  DollarSign, 
  FileText, 
  CheckCircle2, 
  Clock, 
  ArrowLeft, 
  UserCheck, 
  Upload, 
  Edit,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/context/AuthContext';
import { canManageClients } from '@/lib/permissions';
import { archiveClient, createClient, listClients, updateClient } from '@/lib/repositories/clients';
import type { Client } from '@/types';

export default function ClientsPage() {
  const { 
    deals, 
    tasks, 
    activities, 
    settings, 
    addDeal, 
    addTask, 
    addNote, 
    uploadDocument, 
    completeTask 
  } = useApp();
  const { user } = useAuth();
  const canManage = canManageClients(user);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [archivingClient, setArchivingClient] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'deals' | 'tasks' | 'activity' | 'notes' | 'documents'>('overview');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddDealModal, setShowAddDealModal] = useState(false);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [showUploadDocModal, setShowUploadDocModal] = useState(false);

  // Form states
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedTo: 'Sarah Jenkins' });
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedTo: '' });
  const [dealForm, setDealForm] = useState({ title: '', value: 5000, stage: 'Opportunity', expectedCloseDate: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High', description: '' });
  const [noteForm, setNoteForm] = useState({ content: '', author: 'Sarah Jenkins' });
  const [docForm, setDocForm] = useState({ name: '', size: '1.5 MB' });

  const loadClients = async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      setClients(await listClients(user));
    } catch (error) {
      console.error('Unable to load clients', error);
      setClientsError('Unable to load clients. Please check your connection and try again.');
    } finally {
      setClientsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setClientsLoading(true);
      setClientsError(null);
      try {
        const loadedClients = await listClients(user);
        if (!cancelled) setClients(loadedClients);
      } catch (error) {
        console.error('Unable to load clients', error);
        if (!cancelled) setClientsError('Unable to load clients. Please check your connection and try again.');
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [user]);

  // Selected client computed data
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const clientDeals = selectedClientId ? deals.filter(d => d.clientId === selectedClientId) : [];
  const activeDealsCount = clientDeals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost').length;
  const totalSalesValue = clientDeals.filter(d => d.stage === 'Won').reduce((sum, d) => sum + d.value, 0);

  // Next follow up task
  const clientTasks = selectedClientId ? tasks.filter(t => t.relatedTo?.type === 'Client' && t.relatedTo.id === selectedClientId && t.status === 'Pending') : [];
  const sortedTasks = [...clientTasks].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const nextFollowUp = sortedTasks[0]?.dueDate ? new Date(sortedTasks[0].dueDate).toISOString().replace('T', ' ').substring(0, 16) : 'No pending tasks';

  const visibleClients = clients.filter(client => client.status !== 'ARCHIVED');
  const filteredClients = visibleClients.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email || !canManage) return;
    setSavingClient(true);
    setClientsError(null);
    try {
      const savedClient = await createClient(user, clientForm);
      setClients((currentClients) => [savedClient, ...currentClients]);
      setClientForm({ name: '', email: '', phone: '', company: '', assignedTo: '' });
      setShowAddModal(false);
    } catch (error) {
      console.error('Unable to create client', error);
      setClientsError('Unable to save the client. Please try again.');
    } finally {
      setSavingClient(false);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !canManage) return;
    setSavingClient(true);
    setClientsError(null);
    try {
      await updateClient(user, selectedClient.id, editClientForm);
      setClients((currentClients) => currentClients.map((client) => client.id === selectedClient.id ? { ...client, ...editClientForm, updatedAt: new Date().toISOString(), updatedBy: user?.uid } : client));
      setShowEditModal(false);
    } catch (error) {
      console.error('Unable to update client', error);
      setClientsError('Unable to update the client. Please try again.');
    } finally {
      setSavingClient(false);
    }
  };

  const handleArchiveClient = async () => {
    if (!selectedClient || !canManage) return;
    setArchivingClient(true);
    setClientsError(null);
    try {
      await archiveClient(user, selectedClient.id);
      setClients((currentClients) => currentClients.map((client) => client.id === selectedClient.id ? { ...client, status: 'ARCHIVED', updatedAt: new Date().toISOString(), updatedBy: user?.uid } : client));
      setSelectedClientId(null);
    } catch (error) {
      console.error('Unable to archive client', error);
      setClientsError('Unable to archive the client. Please try again.');
    } finally {
      setArchivingClient(false);
    }
  };

  const handleCreateDeal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !dealForm.title) return;
    addDeal({
      title: dealForm.title,
      clientId: selectedClientId,
      value: Number(dealForm.value),
      stage: dealForm.stage,
      expectedCloseDate: dealForm.expectedCloseDate,
    });
    setDealForm({ title: '', value: 5000, stage: 'Opportunity', expectedCloseDate: new Date(Date.now() + 30*86400000).toISOString().split('T')[0] });
    setShowAddDealModal(false);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !taskForm.title) return;
    addTask({
      title: taskForm.title,
      description: taskForm.description,
      dueDate: taskForm.dueDate,
      priority: taskForm.priority,
      relatedTo: { type: 'Client', id: selectedClientId }
    });
    setTaskForm({ title: '', dueDate: new Date().toISOString().split('T')[0], priority: 'Medium', description: '' });
    setShowAddTaskModal(false);
  };

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !noteForm.content) return;
    addNote(selectedClientId, noteForm.content, noteForm.author);
    setNoteForm({ content: '', author: 'Sarah Jenkins' });
    setShowAddNoteModal(false);
  };

  const handleUploadDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !docForm.name) return;
    uploadDocument(selectedClientId, docForm.name, docForm.size);
    setDocForm({ name: '', size: '1.5 MB' });
    setShowUploadDocModal(false);
  };

  return (
    <div className="space-y-6">
      {clientsError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{clientsError}</p>}
      {/* If Client is Selected, Show Client Profile */}
      {selectedClient ? (
        <div className="space-y-6">
          {/* Back Button & Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setSelectedClientId(null)} className="gap-2">
                <ArrowLeft size={16} /> Back to Clients
              </Button>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">{selectedClient.name} Profile</h2>
            </div>
            <div className="flex items-center gap-2">
              {canManage && <Button variant="outline" onClick={() => {
                setEditClientForm({
                  name: selectedClient.name,
                  email: selectedClient.email,
                  phone: selectedClient.phone,
                  company: selectedClient.company || '',
                  assignedTo: selectedClient.assignedTo || 'Sarah Jenkins'
                });
                setShowEditModal(true);
              }} className="gap-2">
                <Edit size={16} /> Edit Client
              </Button>}
              {canManage && <Button variant="outline" onClick={() => void handleArchiveClient()} disabled={archivingClient} className="gap-2 text-red-600 hover:text-red-700">
                {archivingClient ? 'Archiving…' : 'Archive Client'}
              </Button>}
              <Button onClick={() => setShowAddDealModal(true)} className="gap-2">
                <Plus size={16} /> Add Deal
              </Button>
            </div>
          </div>

          {/* Client Summary Banner */}
          <Card className="grid gap-6 md:grid-cols-4 p-6 bg-slate-900 text-white">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Company & Contact</p>
              <p className="text-lg font-bold">{selectedClient.company || 'Independent'}</p>
              <p className="text-xs text-slate-300">{selectedClient.email} • {selectedClient.phone}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Total Sales / Deals</p>
              <p className="text-lg font-bold text-green-400">${totalSalesValue.toLocaleString()}</p>
              <p className="text-xs text-slate-300">{activeDealsCount} Active Deals / {clientDeals.length} Total</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Assigned To</p>
              <p className="text-lg font-bold">{selectedClient.assignedTo || 'Unassigned'}</p>
              <p className="text-xs text-slate-300">Client Since: {new Date(selectedClient.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Next Follow-up</p>
              <p className="text-sm font-semibold text-orange-300">{nextFollowUp}</p>
              <Button size="sm" variant="outline" onClick={() => setShowAddTaskModal(true)} className="mt-2 text-xs bg-white/10 text-white border-white/20 hover:bg-white/20">
                + Add Task
              </Button>
            </div>
          </Card>

          {/* Profile Navigation Tabs */}
          <div className="flex border-b border-slate-200 gap-6">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'deals', label: `Deals (${clientDeals.length})` },
              { id: 'tasks', label: `Tasks (${clientTasks.length})` },
              { id: 'activity', label: 'Activity Log' },
              { id: 'notes', label: `Notes (${selectedClient.notes?.length || 0})` },
              { id: 'documents', label: `Documents (${selectedClient.documents?.length || 0})` },
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

          {/* Tab Content */}
          <div className="space-y-6">
            {activeTab === 'overview' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="space-y-4">
                  <h3 className="font-bold text-slate-900">Recent Notes</h3>
                  <div className="space-y-3">
                    {selectedClient.notes?.map(note => (
                      <div key={note.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                        <p className="text-sm text-slate-800">{note.content}</p>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>By {note.author}</span>
                          <span>{new Date(note.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                    {(!selectedClient.notes || selectedClient.notes.length === 0) && (
                      <p className="text-xs text-slate-400">No notes recorded yet.</p>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setShowAddNoteModal(true)} className="w-full gap-2 mt-2">
                      <Plus size={14} /> Add Note
                    </Button>
                  </div>
                </Card>

                <Card className="space-y-4">
                  <h3 className="font-bold text-slate-900">Recent Documents</h3>
                  <div className="space-y-3">
                    {selectedClient.documents?.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <div className="flex items-center gap-3">
                          <FileText size={20} className="text-blue-600" />
                          <div>
                            <p className="text-sm font-medium text-slate-900">{doc.name}</p>
                            <span className="text-[10px] text-slate-400">{doc.size} • {new Date(doc.uploadedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!selectedClient.documents || selectedClient.documents.length === 0) && (
                      <p className="text-xs text-slate-400">No documents uploaded.</p>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setShowUploadDocModal(true)} className="w-full gap-2 mt-2">
                      <Upload size={14} /> Upload Document
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'deals' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Client Deals</h3>
                  <Button size="sm" onClick={() => setShowAddDealModal(true)} className="gap-2">
                    <Plus size={14} /> Add Deal
                  </Button>
                </div>
                <div className="space-y-3">
                  {clientDeals.map(deal => (
                    <div key={deal.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <div>
                        <h4 className="font-semibold text-slate-900">{deal.title}</h4>
                        <span className="text-xs text-slate-500">Expected close: {deal.expectedCloseDate}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={deal.stage === 'Won' ? 'green' : deal.stage === 'Lost' ? 'red' : 'purple'}>
                          {deal.stage}
                        </Badge>
                        <span className="font-bold text-slate-900">${deal.value.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {clientDeals.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">No deals recorded for this client.</p>}
                </div>
              </Card>
            )}

            {activeTab === 'tasks' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Client Tasks & Follow-ups</h3>
                  <Button size="sm" onClick={() => setShowAddTaskModal(true)} className="gap-2">
                    <Plus size={14} /> Add Task
                  </Button>
                </div>
                <div className="space-y-3">
                  {tasks.filter(t => t.relatedTo?.type === 'Client' && t.relatedTo.id === selectedClientId).map(task => (
                    <div key={task.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">{task.title}</span>
                          <Badge variant={task.priority === 'High' ? 'red' : 'orange'}>{task.priority}</Badge>
                        </div>
                        <p className="text-xs text-slate-500">Due: {new Date(task.dueDate).toLocaleString()}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => completeTask(task.id)}>
                        {task.status === 'Completed' ? 'Completed' : 'Complete'}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {activeTab === 'activity' && (
              <Card className="space-y-4">
                <h3 className="font-bold text-slate-900">Activity History</h3>
                <div className="space-y-3">
                  {activities.map(act => (
                    <div key={act.id} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{act.description}</p>
                        <span className="text-[10px] text-slate-400">{new Date(act.timestamp).toLocaleString()}</span>
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
                  <Button size="sm" onClick={() => setShowAddNoteModal(true)} className="gap-2">
                    <Plus size={14} /> Add Note
                  </Button>
                </div>
                <div className="space-y-3">
                  {selectedClient.notes?.map(note => (
                    <div key={note.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                      <p className="text-sm text-slate-800">{note.content}</p>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Author: {note.author}</span>
                        <span>{new Date(note.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {activeTab === 'documents' && (
              <Card className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">Client Documents</h3>
                  <Button size="sm" onClick={() => setShowUploadDocModal(true)} className="gap-2">
                    <Upload size={14} /> Upload Document
                  </Button>
                </div>
                <div className="space-y-3">
                  {selectedClient.documents?.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-3">
                        <FileText size={24} className="text-blue-600" />
                        <div>
                          <p className="font-semibold text-slate-900">{doc.name}</p>
                          <span className="text-xs text-slate-400">{doc.size} • Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : (
        /* Client List View */
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Clients</h2>
              <p className="text-sm text-slate-500">Centralized customer records, deals, and history.</p>
            </div>
            {canManage && <Button onClick={() => setShowAddModal(true)} className="gap-2">
              <Plus size={18} /> Add Client
            </Button>}
          </div>

          <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="text" 
                placeholder="Search clients by name, company, or email..." 
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => void loadClients()} disabled={clientsLoading}>Refresh</Button>
          </Card>

          {/* Client Table */}
          <Card className="p-0 overflow-hidden">
            {clientsLoading ? <p className="p-10 text-center text-sm text-slate-500">Loading clients…</p> : filteredClients.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{clientsError ? 'Clients could not be loaded.' : 'No active clients found.'}</p> : <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Client</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Company</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Contact</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Client Since</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Assigned To</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Active Deals</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Total Sales</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Next Follow-up</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredClients.map((client) => {
                    const cDeals = deals.filter(d => d.clientId === client.id);
                    const activeDeals = cDeals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost').length;
                    const totalSales = cDeals.filter(d => d.stage === 'Won').reduce((sum, d) => sum + d.value, 0);

                    // Next task
                    const cTasks = tasks.filter(t => t.relatedTo?.type === 'Client' && t.relatedTo.id === client.id && t.status === 'Pending');
                    const sortedC = [...cTasks].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
                    const nextFU = sortedC[0]?.dueDate ? sortedC[0].dueDate : '-';

                    return (
                      <tr key={client.id} className="hover:bg-slate-50 transition-colors">
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
                        <td className="px-6 py-4 text-sm text-slate-600">{client.assignedTo || 'Unassigned'}</td>
                        <td className="px-6 py-4">
                          <Badge variant="purple">{activeDeals} Active</Badge>
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-green-600">${totalSales.toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">{nextFU}</td>
                        <td className="px-6 py-4 text-right">
                          <Button size="sm" variant="outline" onClick={() => setSelectedClientId(client.id)}>
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
          </Card>
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
                  required 
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
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={clientForm.assignedTo}
                    onChange={e => setClientForm({...clientForm, assignedTo: e.target.value})}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" disabled={savingClient}>{savingClient ? 'Saving…' : 'Save Client'}</Button>
              </div>
            </form>
          </div>
        )}

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
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={editClientForm.assignedTo}
                    onChange={e => setEditClientForm({...editClientForm, assignedTo: e.target.value})}
                  />
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Value ($)</label>
                  <input 
                    type="number" 
                    required 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                    value={dealForm.value}
                    onChange={e => setDealForm({...dealForm, value: Number(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Stage</label>
                  <select 
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    value={dealForm.stage}
                    onChange={e => setDealForm({...dealForm, stage: e.target.value})}
                  >
                    {settings.pipelineStages.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Expected Close Date</label>
                <input 
                  type="date" 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={dealForm.expectedCloseDate}
                  onChange={e => setDealForm({...dealForm, expectedCloseDate: e.target.value})}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddDealModal(false)}>Cancel</Button>
                <Button type="submit">Create Deal</Button>
              </div>
            </form>
          </div>
        )}

        {showAddTaskModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleCreateTask} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Add Task & Follow-up</h3>
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
                  <label className="text-xs font-bold text-slate-500 uppercase">Due Date</label>
                  <input 
                    type="date" 
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
                <Button type="submit">Create Task</Button>
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

        {showUploadDocModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleUploadDoc} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Upload Document</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Document Name</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. Contract_Signed.pdf" 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={docForm.name}
                  onChange={e => setDocForm({...docForm, name: e.target.value})}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowUploadDocModal(false)}>Cancel</Button>
                <Button type="submit">Upload</Button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients, canManageTasks } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import { getActiveDealCreationStages, getDefaultDealCreationStage } from '@/lib/deal-workflow';
import { DealDetailsModal } from '@/components/DealDetailsModal';
import { getDefaultAssignment } from '@/lib/ownership';

function formatFileSize(size: number | string) {
  if (typeof size !== 'number') return size;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientsPage() {
  const searchParams = useSearchParams();
  const { 
    clients,
    clientsLoading,
    clientsError,
    users,
    usersLoading,
    clientNotes,
    clientNotesLoading,
    clientNotesError,
    loadClientNotes,
    clientDocuments,
    clientDocumentsLoading,
    clientDocumentsError,
    loadClientDocuments,
    refreshClients,
    deals, 
    leads,
    tasks, 
    activities, 
    settings, 
    addDeal, 
    updateDeal,
    addTask, 
    addNote, 
    uploadDocument, 
    completeTask,
    addClient: addClientToApp,
    updateClient: updateClientInApp,
    archiveClient: archiveClientInApp,
  } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId } = useWorkspace();
  const canManage = canManageClients(user);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [archivingClient, setArchivingClient] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => searchParams.get('clientId'));
  const [activeTab, setActiveTab] = useState<'overview' | 'deals' | 'tasks' | 'activity' | 'notes' | 'documents'>('overview');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddDealModal, setShowAddDealModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [showUploadDocModal, setShowUploadDocModal] = useState(false);

  // Form states
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', company: '', assignedToUid: '', assignedToName: '' });
  const dealCreationStages = getActiveDealCreationStages(settings.pipelineStages);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const [dealForm, setDealForm] = useState({ title: '', value: 0, stage: defaultDealStage, expectedCloseDate: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High', description: '' });
  const [noteForm, setNoteForm] = useState({ content: '' });
  const [docForm, setDocForm] = useState<{ file: File | null }>({ file: null });
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Selected client computed data
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const openAddClient = () => {
    if (!user) return;
    setClientForm({ name: '', email: '', phone: '', company: '', ...getDefaultAssignment(user) });
    setShowAddModal(true);
  };

  useEffect(() => {
    if (selectedClientId) {
      void loadClientNotes(selectedClientId);
      void loadClientDocuments(selectedClientId);
    }
  }, [loadClientDocuments, loadClientNotes, selectedClientId]);

  const clientDeals = selectedClientId ? deals.filter(d => d.clientId === selectedClientId) : [];
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;
  const activeDealsCount = clientDeals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost').length;
  const totalSalesValue = clientDeals.filter(d => d.status === 'Won').reduce((sum, d) => sum + d.value, 0);

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

  const handleArchiveClient = async () => {
    if (!selectedClient || !canManage) return;
    setArchivingClient(true);
    setActionError(null);
    try {
      await archiveClientInApp(selectedClient.id);
      setSelectedClientId(null);
    } catch (error) {
      console.error('Unable to archive client', error);
      setActionError('Unable to archive the client. Please try again.');
    } finally {
      setArchivingClient(false);
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
        value: Number(dealForm.value),
        stage: dealForm.stage,
        expectedCloseDate: dealForm.expectedCloseDate,
      });
      setDealForm({ title: '', value: 0, stage: defaultDealStage, expectedCloseDate: '' });
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

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !noteForm.content) return;
    try {
      await addNote(selectedClientId, noteForm.content);
      setNoteForm({ content: '' });
      setShowAddNoteModal(false);
    } catch (error) {
      console.error('Unable to save client note', error);
      setActionError('Unable to save the note. Please try again.');
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !docForm.file) return;
    setUploadingDocument(true);
    setActionError(null);
    try {
      await uploadDocument(selectedClientId, docForm.file);
      setDocForm({ file: null });
      if (documentInputRef.current) documentInputRef.current.value = '';
      setShowUploadDocModal(false);
    } catch (error) {
      console.error('Unable to upload client document', error);
      setActionError(error instanceof Error ? error.message : 'Unable to upload the document. Please try again.');
    } finally {
      setUploadingDocument(false);
    }
  };

  return (
    <div className="space-y-6">
      {(actionError || clientsError) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{actionError || clientsError}</p>}
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
                  assignedToUid: selectedClient.assignedToUid || selectedClient.assignedTo || '',
                  assignedToName: selectedClient.assignedToName || selectedClient.assignedTo || ''
                });
                setShowEditModal(true);
              }} className="gap-2">
                <Edit size={16} /> Edit Client
              </Button>}
              {canManage && <Button variant="outline" onClick={() => void handleArchiveClient()} disabled={archivingClient} className="gap-2 text-red-600 hover:text-red-700">
                {archivingClient ? 'Archiving…' : 'Archive Client'}
              </Button>}
              <Button onClick={openAddDeal} className="gap-2">
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
              <p className="text-lg font-bold text-green-400">{formatCurrency(totalSalesValue, settings.currency)}</p>
              <p className="text-xs text-slate-300">{activeDealsCount} Active Deals / {clientDeals.length} Total</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Assigned To</p>
              <p className="text-lg font-bold">{selectedClient.assignedToName || selectedClient.assignedTo || 'Unassigned'}</p>
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
              { id: 'notes', label: `Notes (${clientNotes.length})` },
              { id: 'documents', label: `Documents (${clientDocuments.length})` },
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
                    <Button variant="outline" size="sm" onClick={() => setShowAddNoteModal(true)} className="w-full gap-2 mt-2">
                      <Plus size={14} /> Add Note
                    </Button>
                  </div>
                </Card>

                <Card className="space-y-4">
                  <h3 className="font-bold text-slate-900">Recent Documents</h3>
                  <div className="space-y-3">
                    {clientDocumentsLoading ? <p className="text-xs text-slate-400">Loading documents…</p> : clientDocumentsError ? <p className="text-xs text-red-600">{clientDocumentsError}</p> : clientDocuments.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <div className="flex items-center gap-3">
                          <FileText size={20} className="text-blue-600" />
                          <div>
                            {doc.downloadURL ? <a href={doc.downloadURL} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">{doc.name}</a> : <p className="text-sm font-medium text-slate-900">{doc.name}</p>}
                            <span className="text-[10px] text-slate-400">{formatFileSize(doc.size)} • {new Date(doc.uploadedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!clientDocumentsLoading && !clientDocumentsError && clientDocuments.length === 0 && (
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
                  <Button size="sm" onClick={openAddDeal} className="gap-2">
                    <Plus size={14} /> Add Deal
                  </Button>
                </div>
                <div className="space-y-3">
                  {clientDeals.map(deal => (
                    <button type="button" key={deal.id} onClick={() => setSelectedDealId(deal.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-4 text-left">
                      <div>
                        <h4 className="font-semibold text-slate-900">{deal.title}</h4>
                        <span className="text-xs text-slate-500">Expected close: {deal.expectedCloseDate || 'Not set'}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={deal.stage === 'Won' ? 'green' : deal.stage === 'Lost' ? 'red' : 'purple'}>
                          {deal.stage}
                        </Badge>
                        <span className="font-bold text-slate-900">{formatCurrency(deal.value, settings.currency)}</span>
                      </div>
                    </button>
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
                  {clientNotesLoading ? <p className="text-xs text-slate-400">Loading notes…</p> : clientNotesError ? <p className="text-xs text-red-600">{clientNotesError}</p> : clientNotes.map(note => (
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
                  {clientDocumentsLoading ? <p className="text-xs text-slate-400">Loading documents…</p> : clientDocumentsError ? <p className="text-xs text-red-600">{clientDocumentsError}</p> : clientDocuments.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-3">
                        <FileText size={24} className="text-blue-600" />
                        <div>
                          {doc.downloadURL ? <a href={doc.downloadURL} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">{doc.name}</a> : <p className="font-semibold text-slate-900">{doc.name}</p>}
                          <span className="text-xs text-slate-400">{formatFileSize(doc.size)} • Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</span>
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
            {canManage && <Button onClick={openAddClient} className="gap-2">
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
            <Button variant="outline" onClick={() => void refreshClients()} disabled={clientsLoading}>Refresh</Button>
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
                    const totalSales = cDeals.filter(d => d.status === 'Won').reduce((sum, d) => sum + d.value, 0);

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
                        <td className="px-6 py-4">
                          <Badge variant="purple">{activeDeals} Active</Badge>
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-green-600">{formatCurrency(totalSales, settings.currency)}</td>
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

        {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={selectedClient?.name} leadName={leads.find((lead) => lead.id === selectedDeal.leadId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canEdit={canManage || (user.active === true && selectedDeal.assignedToUid === user.uid)} canAssign={canManage} saving={savingClient} tasks={tasks} canAddTask={canManageTasks(user)} onAddTask={addTask} onCompleteTask={completeTask} currentUser={user} onClose={() => setSelectedDealId(null)} onSave={async (input) => { setSavingClient(true); try { await updateDeal(selectedDeal.id, input); } finally { setSavingClient(false); } }} />}

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
                    <label className="text-xs font-bold text-slate-500 uppercase">Value ({settings.currency})</label>
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
                    {dealCreationStages.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
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
                <label className="text-xs font-bold text-slate-500 uppercase">Select File</label>
                <input
                  ref={documentInputRef}
                  type="file"
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  onChange={e => setDocForm({ file: e.target.files?.[0] || null })}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowUploadDocModal(false)}>Cancel</Button>
                <Button type="submit" disabled={uploadingDocument || !docForm.file}>{uploadingDocument ? 'Uploading…' : 'Upload'}</Button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

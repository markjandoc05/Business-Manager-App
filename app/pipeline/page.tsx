'use client';

import React, { useMemo, useState } from 'react';
import { Card, Badge, Button } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import { type DealStatus } from '@/lib/repositories/deals';
import { getActiveDealCreationStages, getDefaultDealCreationStage } from '@/lib/deal-workflow';
import { DealDetailsModal, type DealEditInput } from '@/components/DealDetailsModal';
import { getDefaultAssignment } from '@/lib/ownership';
import type { Client, Deal } from '@/types';
import { Plus, Calendar, DollarSign, Search, Filter, Archive, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type DealForm = { title: string; clientId: string; value: number; stage: string; expectedCloseDate: string; assignedToUid: string; assignedToName: string };

export default function PipelinePage() {
  const { clients, clientsLoading, refreshClients, deals, dealsLoading, tasks, settings, users, updateDealStage, updateDeal, archiveDeal, addDeal, addTask, completeTask } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership } = useWorkspace();
  const canManage = canManageClients(membership);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState<{ dealId: string } | null>(null);
  const [showLostModal, setShowLostModal] = useState<{ dealId: string } | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const creationStages = useMemo(() => getActiveDealCreationStages(settings.pipelineStages), [settings.pipelineStages]);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const defaultAssignment = user ? getDefaultAssignment(user) : { assignedToUid: '', assignedToName: '' };
  const [dealForm, setDealForm] = useState<DealForm>({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment });
  const [lostReason, setLostReason] = useState('');

  const stages = useMemo(() => settings.pipelineStages.some((stage) => stage.name === 'Lost') ? settings.pipelineStages : [...settings.pipelineStages, { name: 'Lost', isActive: true }], [settings.pipelineStages]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const changeStage = async (deal: Deal, stage: string, status: DealStatus = 'Active', lossReason?: string) => {
    if ((!canManage && !(membership?.role === 'USER' && deal.assignedToUid === user?.uid)) || busyDealId) return;
    setBusyDealId(deal.id); setError(null);
    try { await updateDealStage(deal.id, stage, status, lossReason); }
    catch (stageError) { console.error('Unable to update deal stage', stageError); setError('Unable to save the deal stage. Please try again.'); }
    finally { setBusyDealId(null); }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const deal = deals.find((item) => item.id === active.id);
    const newStage = over.id as string;
    if (!deal || (!canManage && !(membership?.role === 'USER' && deal.assignedToUid === user?.uid)) || deal.stage === newStage) return;
    if (newStage === 'Won') setShowWonModal({ dealId: deal.id });
    else if (newStage === 'Lost') setShowLostModal({ dealId: deal.id });
    else void changeStage(deal, newStage);
  };

  const handleWonConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    const deal = showWonModal ? deals.find((item) => item.id === showWonModal.dealId) : undefined;
    if (!deal) return;
    await changeStage(deal, 'Won', 'Won');
    setShowWonModal(null);
  };

  const handleLostConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    const deal = showLostModal ? deals.find((item) => item.id === showLostModal.dealId) : undefined;
    if (!deal || !lostReason.trim()) return;
    await changeStage(deal, 'Lost', 'Lost', lostReason);
    setLostReason('');
    setShowLostModal(null);
  };

  const handleCreateDeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!defaultDealStage) { setError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    if (!canManage || !dealForm.title || !dealForm.clientId || !creationStages.some((stage) => stage.name === dealForm.stage)) return;
    setSaving(true); setError(null);
    try {
      await addDeal(dealForm);
      setDealForm({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment });
      setShowAddModal(false);
    } catch (createError) { console.error('Unable to create deal', createError); setError('Unable to create the deal. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleArchive = async (deal: Deal) => {
    if (!canManage || busyDealId) return;
    setBusyDealId(deal.id); setError(null);
    try { await archiveDeal(deal.id); }
    catch (archiveError) { console.error('Unable to archive deal', archiveError); setError('Unable to archive the deal. Please try again.'); setBusyDealId(null); }
  };

  const handleDealSave = async (input: DealEditInput) => {
    if (!selectedDeal) return;
    setSaving(true);
    try { await updateDeal(selectedDeal.id, input); }
    finally { setSaving(false); }
  };

  const filteredDeals = deals.filter((deal) => deal.title.toLowerCase().includes(searchTerm.toLowerCase()));
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;

  return <div className="space-y-6">
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-bold tracking-tight text-slate-900">Pipeline</h2><p className="text-sm text-slate-500">Persisted opportunities and stage execution.</p></div><div className="flex gap-2"><Button variant="outline" className="gap-2"><Filter size={18} /> Filters</Button><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="text" placeholder="Search deals..." className="rounded-xl border py-2 pl-9 pr-4 text-sm" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div><Button variant="outline" onClick={() => void refreshClients()} disabled={clientsLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>{canManage && <Button onClick={() => { if (!defaultDealStage) setError('No active sales stage is available. Please configure your Pipeline settings.'); else { setDealForm((current) => ({ ...current, stage: defaultDealStage })); setShowAddModal(true); } }} className="gap-2"><Plus size={18} /> Add Opportunity</Button>}</div></div>
    {dealsLoading || clientsLoading ? <Card className="p-10 text-center text-sm text-slate-500">Loading pipeline…</Card> : deals.length === 0 ? <Card className="p-10 text-center text-sm text-slate-500">No active deals found.</Card> : <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}><div className="flex min-h-[70vh] gap-6 overflow-x-auto pb-6">{stages.map((stage) => { const stageDeals = filteredDeals.filter((deal) => deal.stage === stage.name); const totalValue = stageDeals.reduce((sum, deal) => sum + deal.value, 0); return <div key={stage.name} className="flex w-80 shrink-0 flex-col gap-4"><div className="flex items-center justify-between px-2"><div className="flex items-center gap-2"><h3 className="font-bold text-slate-800">{stage.name}</h3><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-500">{stageDeals.length}</span></div></div><div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Value</p><p className="text-base font-bold text-slate-900">{formatCurrency(totalValue, settings.currency)}</p></div><SortableContext items={stageDeals.map((deal) => deal.id)} strategy={verticalListSortingStrategy}><div className="flex-1 space-y-3">{stageDeals.map((deal) => <SortableDealCard key={deal.id} deal={deal} client={clients.find((client) => client.id === deal.clientId)} canManage={canManage} busy={busyDealId === deal.id} onOpen={() => setSelectedDealId(deal.id)} onArchive={() => void handleArchive(deal)} currency={settings.currency} />)}</div></SortableContext></div>; })}</div></DndContext>}
    <AnimatePresence>{showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleCreateDeal} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Add Opportunity</h3><input required placeholder="Deal title" className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.title} onChange={(event) => setDealForm({ ...dealForm, title: event.target.value })} /><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.clientId} onChange={(event) => setDealForm({ ...dealForm, clientId: event.target.value })}><option value="">Select client</option>{clients.filter((client) => client.status !== 'ARCHIVED').map((client) => <option key={client.id} value={client.id}>{client.name}{client.company ? ` — ${client.company}` : ''}</option>)}</select><div className="grid grid-cols-2 gap-4"><input type="number" min="0" required className="rounded-xl border px-4 py-2 text-sm" value={dealForm.value} onChange={(event) => setDealForm({ ...dealForm, value: Number(event.target.value) })} /><input type="date" className="rounded-xl border px-4 py-2 text-sm" value={dealForm.expectedCloseDate} onChange={(event) => setDealForm({ ...dealForm, expectedCloseDate: event.target.value })} /></div><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.stage} onChange={(event) => setDealForm({ ...dealForm, stage: event.target.value })}>{creationStages.map((stage) => <option key={stage.name} value={stage.name}>{stage.name}</option>)}</select><select className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.assignedToUid} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); setDealForm({ ...dealForm, assignedToUid: event.target.value, assignedToName: assignee?.name || "" }); }}><option value="">Unassigned</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Deal'}</Button></div></form></div>}{showWonModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleWonConfirm} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Won</h3><p className="text-sm text-slate-500">Confirm this opportunity is won.</p><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowWonModal(null)}>Cancel</Button><Button type="submit">Confirm Won</Button></div></form></div>}{showLostModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleLostConfirm} className="w-full max-w-lg space-y-4"><div className="rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Lost</h3><input required placeholder="Reason for loss" className="mt-4 w-full rounded-xl border px-4 py-2" value={lostReason} onChange={(event) => setLostReason(event.target.value)} /><div className="mt-4 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowLostModal(null)}>Cancel</Button><Button type="submit">Confirm Lost</Button></div></div></form></div>}</AnimatePresence>
    {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={clients.find((client) => client.id === selectedDeal.clientId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid)} canAssign={canManage} saving={saving} tasks={tasks} canAddTask={canManage} onAddTask={addTask} onCompleteTask={completeTask} currentUser={user} onClose={() => setSelectedDealId(null)} onSave={handleDealSave} />}
  </div>;
}

function SortableDealCard({ deal, client, canManage, busy, onOpen, onArchive, currency }: { deal: Deal; client?: Client; canManage: boolean; busy: boolean; onOpen: () => void; onArchive: () => void; currency: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onOpen}><Card className="cursor-pointer space-y-3 p-4 transition-shadow hover:shadow-md"><div className="flex items-start justify-between gap-2"><h4 className="line-clamp-1 text-sm font-semibold text-slate-900">{deal.title}</h4>{canManage && <button type="button" title="Archive deal" disabled={busy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onArchive(); }} className="text-slate-400 hover:text-red-600"><Archive size={15} /></button>}</div><p className="text-xs text-slate-500">{client?.name || 'Client unavailable'}</p><div className="flex items-center justify-between"><div className="flex items-center gap-1 rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-bold text-green-600"><DollarSign size={12} /> {formatCurrency(deal.value, currency)}</div>{deal.status === 'Lost' && <Badge variant="red">Lost</Badge>}{deal.status === 'Won' && <Badge variant="green">Won</Badge>}</div>{deal.expectedCloseDate && <div className="flex items-center gap-1 text-[10px] text-slate-400"><Calendar size={11} /> {deal.expectedCloseDate}</div>}</Card></div>;
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Badge, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { MobileQuickActionMenu } from '@/components/MobileQuickActionMenu';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import { countActiveDeals, type DealStatus } from '@/lib/repositories/deals';
import { getActiveDealCreationStages, getDefaultDealCreationStage, getDealProbability } from '@/lib/deal-workflow';
import { DealDetailsModal, type DealEditInput } from '@/components/DealDetailsModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { getTaskDisplayState } from '@/lib/task-utils';
import { getDefaultAssignment } from '@/lib/ownership';
import { PIPELINE_STAGES } from '@/components/PipelineFunnel';
import { IconActionButton } from '@/components/IconActionButton';
import { MoneyInput } from '@/components/MoneyInput';
import type { Client, Deal, Task } from '@/types';
import { Plus, Search, Filter, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { DndContext, closestCenter, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from '@dnd-kit/core';

type DealForm = { title: string; clientId: string; value: number; stage: string; expectedCloseDate: string; assignedToUid: string; assignedToName: string };

export default function PipelinePage() {
  const { clients, clientsLoading, deals, dealsLoading, dealsError, tasks, settings, users, updateDealStage, updateDeal, archiveDeal, archivedDeals, loadArchivedRecords, loadMoreArchivedDeals, archivedDealsHasMore, restoreDeal, permanentlyDeleteDeal, addDeal, addTask, completeTask } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, canWrite } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = canManageClients(membership) && canWrite;
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'All' | DealStatus>('All');
  const [assignedFilter, setAssignedFilter] = useState('All');
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState<{ dealId: string } | null>(null);
  const [showLostModal, setShowLostModal] = useState<{ dealId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [activeDealCount, setActiveDealCount] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const stageChangeInFlight = useRef(false);
  const dragGestureRef = useRef(false);
  const [activeDragDealId, setActiveDragDealId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const creationStages = useMemo(() => getActiveDealCreationStages(settings.pipelineStages), [settings.pipelineStages]);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const defaultAssignment = user ? getDefaultAssignment(user) : { assignedToUid: '', assignedToName: '' };
  const [dealForm, setDealForm] = useState<DealForm>({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment });
  const [lostReason, setLostReason] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const selectedDealId = searchParams.get('dealId');
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;
  const openDeal = (dealId: string) => { router.push(`/pipeline?dealId=${encodeURIComponent(dealId)}`, { scroll: false }); };
  const closeDeal = () => { router.replace('/pipeline', { scroll: false }); };

  useEffect(() => {
    if (!user || !currentOrganizationId) return;
    let cancelled = false;
    void countActiveDeals(user, currentOrganizationId).then((count) => { if (!cancelled) setActiveDealCount(count); }).catch(() => { if (!cancelled) setActiveDealCount(null); });
    return () => { cancelled = true; };
  }, [currentOrganizationId, user]);

  useEffect(() => {
    if (searchParams.get('action') !== 'create' || !canManage) return;
    const timer = window.setTimeout(() => {
      setDealForm((current) => ({ ...current, stage: defaultDealStage }));
      setShowAddModal(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canManage, defaultDealStage, searchParams]);

  const canMoveDeal = (deal: Deal) => canWrite && (canManage || (membership?.role === 'USER' && deal.assignedToUid === user?.uid));

  const changeStage = async (deal: Deal, stage: string, status: DealStatus = 'Active', lossReason?: string) => {
    if (!canMoveDeal(deal) || busyDealId || stageChangeInFlight.current) return false;
    stageChangeInFlight.current = true;
    setBusyDealId(deal.id); setError(null);
    try { await updateDealStage(deal.id, stage, status, lossReason); return true; } catch (stageError) { console.error('Unable to update deal stage', stageError); setError('Unable to save the deal stage. Please try again.'); return false; } finally { stageChangeInFlight.current = false; setBusyDealId(null); }
  };

  const clearDragState = () => {
    setActiveDragDealId(null);
    setDragOverStage(null);
    window.requestAnimationFrame(() => { dragGestureRef.current = false; });
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const dealId = parseDealDragId(active.id);
    const deal = dealId ? deals.find((item) => item.id === dealId) : undefined;
    if (!deal || !canMoveDeal(deal)) return;
    dragGestureRef.current = true;
    setActiveDragDealId(deal.id);
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    setDragOverStage(resolveStageDropId(over?.id, deals));
  };

  const handleDragCancel = () => {
    clearDragState();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dealId = parseDealDragId(active.id);
    const deal = dealId ? deals.find((item) => item.id === dealId) : undefined;
    const newStage = resolveStageDropId(over?.id, deals);
    clearDragState();
    if (!deal || !newStage || deal.stage === newStage || !canMoveDeal(deal)) return;
    if (newStage === 'Won') { setLostReason(''); setShowWonModal({ dealId: deal.id }); }
    else if (newStage === 'Lost') { setLostReason(''); setShowLostModal({ dealId: deal.id }); }
    else void changeStage(deal, newStage);
  };

  const handleWonConfirm = async (event: React.FormEvent) => {
    event.preventDefault(); const deal = showWonModal ? deals.find((item) => item.id === showWonModal.dealId) : undefined;
    if (!deal) return; if (await changeStage(deal, 'Won', 'Won')) setShowWonModal(null);
  };

  const handleLostConfirm = async (event: React.FormEvent) => {
    event.preventDefault(); const deal = showLostModal ? deals.find((item) => item.id === showLostModal.dealId) : undefined;
    if (!deal || !lostReason.trim()) return; if (await changeStage(deal, 'Lost', 'Lost', lostReason)) { setLostReason(''); setShowLostModal(null); }
  };

  const handleCreateDeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!defaultDealStage) { setError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    if (!canManage || !dealForm.title || !dealForm.clientId || !creationStages.some((stage) => stage.name === dealForm.stage)) return;
    setSaving(true); setError(null);
    try { await addDeal(dealForm); setDealForm({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment }); setShowAddModal(false); } catch (createError) { console.error('Unable to create deal', createError); setError('Unable to create the deal. Please try again.'); } finally { setSaving(false); }
  };

  const handleArchive = async (deal: Deal) => {
    if (!canMoveDeal(deal) || busyDealId) return;
    setConfirmAction({ kind: 'archive', id: deal.id, name: deal.title });
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || confirmBusy) return;
    setConfirmBusy(true); setError(null);
    try {
      if (confirmAction.kind === 'archive') await archiveDeal(confirmAction.id);
      else if (confirmAction.kind === 'restore') await restoreDeal(confirmAction.id);
      else await permanentlyDeleteDeal(confirmAction.id);
      setConfirmAction(null);
    } catch (error) {
      console.error('Unable to complete deal lifecycle action', error);
      setError(error instanceof Error ? error.message : 'Unable to complete the deal action. Please try again.');
    } finally { setConfirmBusy(false); }
  };

  const handleDealSave = async (input: DealEditInput) => {
    if (!selectedDeal) return; setSaving(true);
    try { await updateDeal(selectedDeal.id, input); } finally { setSaving(false); }
  };

  const filteredDeals = deals.filter((deal) => {
    const client = clients.find((item) => item.id === deal.clientId);
    const search = searchTerm.toLowerCase();
    const matchesSearch = deal.title.toLowerCase().includes(search) || (client?.name || '').toLowerCase().includes(search) || (deal.productServiceName || '').toLowerCase().includes(search);
    return matchesSearch && (statusFilter === 'All' || deal.status === statusFilter) && (assignedFilter === 'All' || deal.assignedToUid === assignedFilter);
  });

  return <div className="space-y-4">
    {activeDealCount !== null && activeDealCount > 100 && <p className="text-xs text-slate-500">Showing the latest 100 active deals.</p>}
    {showArchived && archivedDealsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreArchivedDeals()}>Load More Archived Deals</Button></div>}
    {(error || dealsError) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error || dealsError}</p>}
    <PageHeader title="Sales Pipeline" subtitle="Track deals across all clients and sales stages." actions={<><Button variant="outline" onClick={() => setShowFilters((current) => !current)} className="gap-2"><Filter size={16} /> Filters</Button><Button variant="outline" onClick={() => { const next = !showArchived; setShowArchived(next); if (next && archivedDeals.length === 0) void loadArchivedRecords(); }}>{showArchived ? 'Active Deals' : 'Archived Deals'}</Button><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="text" placeholder="Search deals..." aria-label="Search deals" className="w-full rounded-xl border py-2 pl-9 pr-4 text-sm sm:w-56" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div>{canManage && <Button onClick={() => { if (!defaultDealStage) setError('No active sales stage is available. Please configure your Pipeline settings.'); else { setDealForm((current) => ({ ...current, stage: defaultDealStage })); setShowAddModal(true); } }} className="gap-2"><Plus size={16} /> Add Deal</Button>}</>} mobileQuickActions={<MobileQuickActionMenu items={[{ label: 'Add Deal', onSelect: () => { if (!defaultDealStage) setError('No active sales stage is available. Please configure your Pipeline settings.'); else { setDealForm((current) => ({ ...current, stage: defaultDealStage })); setShowAddModal(true); } }, disabled: !canManage || !defaultDealStage }, { label: 'Archived', onSelect: () => { const next = !showArchived; setShowArchived(next); if (next && archivedDeals.length === 0) void loadArchivedRecords(); } }]} />} />
    {showFilters && <Card className="page-filter-panel flex flex-wrap items-center gap-3 p-3"><label className="text-sm text-slate-600">Status<select aria-label="Filter deals by status" className="ml-2 rounded-lg border px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="All">All statuses</option><option value="Active">Active</option><option value="Won">Won</option><option value="Lost">Lost</option></select></label><label className="text-sm text-slate-600">Assigned to<select aria-label="Filter deals by assignee" className="ml-2 rounded-lg border px-3 py-2 text-sm" value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}><option value="All">Everyone</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}</select></label><Button variant="ghost" size="sm" onClick={() => { setStatusFilter('All'); setAssignedFilter('All'); setSearchTerm(''); }}>Clear filters</Button></Card>}
    {dealsLoading || clientsLoading ? <Card className="p-10 text-center text-sm text-slate-500">Loading pipeline…</Card> : deals.length === 0 ? <Card className="p-8 text-center"><p className="text-sm font-medium text-slate-700">No deals yet.</p><p className="mt-1 text-xs text-slate-500">Create a deal from a client profile.</p></Card> : filteredDeals.length === 0 ? <Card className="p-8 text-center"><p className="text-sm font-medium text-slate-700">No deals match these filters.</p><p className="mt-1 text-xs text-slate-500">Try clearing a filter or changing the search.</p></Card> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}><div className="overflow-x-auto pb-3"><div className="grid min-w-[1380px] grid-cols-6 gap-3">{PIPELINE_STAGES.map((stage) => { const stageDeals = filteredDeals.filter((deal) => deal.stage === stage); const totalValue = stageDeals.reduce((sum, deal) => sum + deal.value, 0); return <StageColumn key={stage} stage={stage} deals={stageDeals} totalValue={totalValue} probability={getDealProbability(stage)} clients={clients} tasks={tasks} busyDealId={busyDealId} dragOverStage={dragOverStage} canMoveDeal={canMoveDeal} onOpen={(dealId) => { if (!dragGestureRef.current) openDeal(dealId); }} onArchive={(deal) => void handleArchive(deal)} currency={settings.currency} />; })}</div></div><DragOverlay dropAnimation={null}>{activeDragDealId ? (() => { const deal = deals.find((item) => item.id === activeDragDealId); return deal ? <DealCardPreview deal={deal} client={clients.find((item) => item.id === deal.clientId)} tasks={tasks} currency={settings.currency} /> : null; })() : null}</DragOverlay></DndContext>}
    {showArchived && <Card className="p-0"><div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Archived Deals</div>{archivedDeals.length === 0 ? <p className="p-6 text-sm text-slate-500">No archived deals.</p> : <div className="divide-y divide-slate-100">{archivedDeals.map((deal) => <div key={deal.id} className="flex items-center justify-between px-4 py-3"><div><p className="font-semibold text-slate-900">{deal.title}</p><p className="text-xs text-slate-500">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Deal" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: deal.id, name: deal.title })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Delete Deal permanently" variant="danger" onClick={() => setConfirmAction({ kind: "delete", id: deal.id, name: deal.title })} />}</div></div>)}</div>}</Card>}
    <AnimatePresence>{showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleCreateDeal} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Add Deal</h3><input required placeholder="Deal title" className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.title} onChange={(event) => setDealForm({ ...dealForm, title: event.target.value })} /><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.clientId} onChange={(event) => setDealForm({ ...dealForm, clientId: event.target.value })}><option value="">Select client</option>{clients.filter((client) => client.status !== 'ARCHIVED').map((client) => <option key={client.id} value={client.id}>{client.name}{client.company ? ` — ${client.company}` : ''}</option>)}</select><div className="grid grid-cols-2 gap-4"><MoneyInput aria-label="Deal value" value={dealForm.value} currency={settings.currency} required className="rounded-xl border px-4 py-2 text-sm" onChange={(value) => setDealForm({ ...dealForm, value })} /><input type="date" className="rounded-xl border px-4 py-2 text-sm" value={dealForm.expectedCloseDate} onChange={(event) => setDealForm({ ...dealForm, expectedCloseDate: event.target.value })} /></div><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.stage} onChange={(event) => setDealForm({ ...dealForm, stage: event.target.value })}>{creationStages.map((stage) => <option key={stage.name} value={stage.name}>{stage.name}</option>)}</select><select className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.assignedToUid} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); setDealForm({ ...dealForm, assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Deal'}</Button></div></form></div>}{showWonModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleWonConfirm} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Won</h3><p className="text-sm text-slate-500">Confirm this opportunity is won.</p><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowWonModal(null)}>Cancel</Button><Button type="submit">Confirm Won</Button></div></form></div>}{showLostModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleLostConfirm} className="w-full max-w-lg space-y-4"><div className="rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Lost</h3><input required placeholder="Reason for loss" className="mt-4 w-full rounded-xl border px-4 py-2" value={lostReason} onChange={(event) => setLostReason(event.target.value)} /><div className="mt-4 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowLostModal(null)}>Cancel</Button><Button type="submit">Confirm Lost</Button></div></div></form></div>}</AnimatePresence>
    {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={clients.find((client) => client.id === selectedDeal.clientId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canWrite={canWrite} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid)} canAssign={canManage} saving={saving} tasks={tasks} canAddTask={canManage} onAddTask={addTask} onCompleteTask={completeTask} currentUser={user} onClose={closeDeal} onSave={handleDealSave} />}
    {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This deal will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This deal will be restored to the active list.' : 'This action cannot be undone. This archived deal will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
  </div>;
}

function StageColumn({ stage, deals, totalValue, probability, clients, tasks, busyDealId, dragOverStage, canMoveDeal, onOpen, onArchive, currency }: { stage: typeof PIPELINE_STAGES[number]; deals: Deal[]; totalValue: number; probability: number; clients: Client[]; tasks: Task[]; busyDealId: string | null; dragOverStage: string | null; canMoveDeal: (deal: Deal) => boolean; onOpen: (dealId: string) => void; onArchive: (deal: Deal) => void; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}`, data: { stage } });
  const highlighted = isOver || dragOverStage === stage;
  return <div ref={setNodeRef} className={`flex min-w-0 flex-col overflow-hidden rounded-lg border ${highlighted ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 bg-slate-100/70'}`}><div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2.5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{stage}</h3><span className="text-xs font-medium text-slate-500">{deals.length}</span></div><div className="mt-1 flex items-center justify-between text-xs text-slate-500"><span>{formatCurrency(totalValue, currency)}</span><span>{probability}% probability</span></div></div><div className="min-h-[220px] max-h-[calc(100vh-280px)] flex-1 space-y-2 overflow-y-auto p-2">{deals.length === 0 ? <p className="py-8 text-center text-xs text-slate-400">No deals in this stage</p> : deals.map((deal) => <DraggableDealCard key={deal.id} deal={deal} client={clients.find((client) => client.id === deal.clientId)} tasks={tasks} canManage={canMoveDeal(deal)} busy={busyDealId === deal.id} canDrag={canMoveDeal(deal)} onOpen={() => onOpen(deal.id)} onArchive={() => onArchive(deal)} currency={currency} />)}</div></div>;
}

function DraggableDealCard({ deal, client, tasks, canManage, busy, canDrag, onOpen, onArchive, currency }: { deal: Deal; client?: Client; tasks: Task[]; canManage: boolean; busy: boolean; canDrag: boolean; onOpen: () => void; onArchive: () => void; currency: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `deal:${deal.id}`, disabled: !canDrag, data: { dealId: deal.id, sourceStage: deal.stage } });
  const dealTasks = tasks.filter((task) => task.relatedTo?.type === 'Deal' && task.relatedTo.id === deal.id && task.status === 'Pending');
  const overdueCount = dealTasks.filter((task) => getTaskDisplayState(task) === 'Overdue').length;
  const taskLabel = overdueCount > 0 ? `${overdueCount} Overdue` : dealTasks.length > 0 ? `${dealTasks.length} ${dealTasks.length === 1 ? 'Task' : 'Tasks'}` : null;
  return <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="draggable deal" aria-label={`Open deal ${deal.title}`} onClick={() => { if (!isDragging) onOpen(); }}><DealCardContent deal={deal} client={client} canManage={canManage} busy={busy} onArchive={onArchive} currency={currency} taskLabel={taskLabel} overdueCount={overdueCount} dragging={isDragging} /></div>;
}

function DealCardPreview({ deal, client, tasks, currency }: { deal: Deal; client?: Client; tasks: Task[]; currency: string }) {
  const dealTasks = tasks.filter((task) => task.relatedTo?.type === 'Deal' && task.relatedTo.id === deal.id && task.status === 'Pending');
  const overdueCount = dealTasks.filter((task) => getTaskDisplayState(task) === 'Overdue').length;
  const taskLabel = overdueCount > 0 ? `${overdueCount} Overdue` : dealTasks.length > 0 ? `${dealTasks.length} ${dealTasks.length === 1 ? 'Task' : 'Tasks'}` : null;
  return <div className="w-[250px] rotate-1"><DealCardContent deal={deal} client={client} canManage={false} busy={false} currency={currency} taskLabel={taskLabel} overdueCount={overdueCount} dragging /></div>;
}

function DealCardContent({ deal, client, canManage, busy, onArchive, currency, taskLabel, overdueCount, dragging }: { deal: Deal; client?: Client; canManage: boolean; busy: boolean; onArchive?: () => void; currency: string; taskLabel: string | null; overdueCount: number; dragging?: boolean }) {
  return <Card className={`space-y-2 rounded-lg p-3 shadow-none ${dragging ? 'shadow-xl ring-2 ring-blue-300' : 'cursor-pointer transition-colors hover:border-slate-300 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500'}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-left text-sm font-medium text-slate-900">{deal.title}</p>{canManage && onArchive && <IconActionButton icon={<Archive size={15} />} label="Archive Deal" variant="danger" disabled={busy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onArchive(); }} />}</div><p className="truncate text-xs text-slate-500">{client?.name || 'Client'}</p>{deal.productServiceName && <p className="truncate text-[11px] text-slate-400">{deal.productServiceName}</p>}<div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-800">{formatCurrency(deal.value, currency)}</span>{deal.expectedCloseDate && <span className="truncate text-slate-400">{new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</div>{taskLabel && <Badge variant={overdueCount > 0 ? 'red' : 'gray'}>{taskLabel}</Badge>}</Card>;
}

function parseDealDragId(id: UniqueIdentifier | null | undefined): string | null {
  const value = String(id ?? '');
  return value.startsWith('deal:') ? value.slice('deal:'.length) : null;
}

function resolveStageDropId(id: UniqueIdentifier | null | undefined, deals: Deal[]): string | null {
  const value = String(id ?? '');
  if (value.startsWith('stage:')) {
    const stage = value.slice('stage:'.length);
    return PIPELINE_STAGES.includes(stage as typeof PIPELINE_STAGES[number]) ? stage : null;
  }
  if (value.startsWith('deal:')) {
    return deals.find((deal) => deal.id === value.slice('deal:'.length))?.stage ?? null;
  }
  return null;
}

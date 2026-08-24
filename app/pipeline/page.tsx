'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Badge, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
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
import { PipelineFunnel, PIPELINE_STAGES } from '@/components/PipelineFunnel';
import { IconActionButton } from '@/components/IconActionButton';
import type { Client, Deal, Task } from '@/types';
import { Plus, Search, Filter, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type DealForm = { title: string; clientId: string; value: number; stage: string; expectedCloseDate: string; assignedToUid: string; assignedToName: string };

export default function PipelinePage() {
  const { clients, clientsLoading, deals, dealsLoading, dealsError, tasks, settings, users, updateDealStage, updateDeal, archiveDeal, archivedDeals, loadArchivedRecords, loadMoreArchivedDeals, archivedDealsHasMore, restoreDeal, permanentlyDeleteDeal, addDeal, addTask, completeTask } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, canWrite } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = canManageClients(membership) && canWrite;
  const [searchTerm, setSearchTerm] = useState('');
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
  const creationStages = useMemo(() => getActiveDealCreationStages(settings.pipelineStages), [settings.pipelineStages]);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const defaultAssignment = user ? getDefaultAssignment(user) : { assignedToUid: '', assignedToName: '' };
  const [dealForm, setDealForm] = useState<DealForm>({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment });
  const [lostReason, setLostReason] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
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

  const changeStage = async (deal: Deal, stage: string, status: DealStatus = 'Active', lossReason?: string) => {
    if (!canWrite || (!canManage && !(membership?.role === 'USER' && deal.assignedToUid === user?.uid)) || busyDealId) return;
    setBusyDealId(deal.id); setError(null);
    try { await updateDealStage(deal.id, stage, status, lossReason); } catch (stageError) { console.error('Unable to update deal stage', stageError); setError('Unable to save the deal stage. Please try again.'); } finally { setBusyDealId(null); }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const deal = deals.find((item) => item.id === active.id);
    const newStage = PIPELINE_STAGES.includes(over.id as typeof PIPELINE_STAGES[number]) ? String(over.id) : deals.find((item) => item.id === over.id)?.stage;
    if (!deal || !newStage || deal.stage === newStage) return;
    if (newStage === 'Won') setShowWonModal({ dealId: deal.id });
    else if (newStage === 'Lost') setShowLostModal({ dealId: deal.id });
    else void changeStage(deal, newStage);
  };

  const handleWonConfirm = async (event: React.FormEvent) => {
    event.preventDefault(); const deal = showWonModal ? deals.find((item) => item.id === showWonModal.dealId) : undefined;
    if (!deal) return; await changeStage(deal, 'Won', 'Won'); setShowWonModal(null);
  };

  const handleLostConfirm = async (event: React.FormEvent) => {
    event.preventDefault(); const deal = showLostModal ? deals.find((item) => item.id === showLostModal.dealId) : undefined;
    if (!deal || !lostReason.trim()) return; await changeStage(deal, 'Lost', 'Lost', lostReason); setLostReason(''); setShowLostModal(null);
  };

  const handleCreateDeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!defaultDealStage) { setError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    if (!canManage || !dealForm.title || !dealForm.clientId || !creationStages.some((stage) => stage.name === dealForm.stage)) return;
    setSaving(true); setError(null);
    try { await addDeal(dealForm); setDealForm({ title: '', clientId: '', value: 5000, stage: defaultDealStage, expectedCloseDate: '', ...defaultAssignment }); setShowAddModal(false); } catch (createError) { console.error('Unable to create deal', createError); setError('Unable to create the deal. Please try again.'); } finally { setSaving(false); }
  };

  const handleArchive = async (deal: Deal) => {
    if (!canManage || busyDealId) return;
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
    return deal.title.toLowerCase().includes(search) || (client?.name || '').toLowerCase().includes(search) || (deal.productServiceName || '').toLowerCase().includes(search);
  });

  return <div className="space-y-4">
    {activeDealCount !== null && activeDealCount > 100 && <p className="text-xs text-slate-500">Showing the latest 100 active deals.</p>}
    {showArchived && archivedDealsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreArchivedDeals()}>Load More Archived Deals</Button></div>}
    {(error || dealsError) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error || dealsError}</p>}
    <PageHeader title="Sales Pipeline" subtitle="Track deals across all clients and sales stages." actions={<><Button variant="outline" className="gap-2"><Filter size={16} /> Filters</Button><Button variant="outline" onClick={() => { const next = !showArchived; setShowArchived(next); if (next && archivedDeals.length === 0) void loadArchivedRecords(); }}>{showArchived ? 'Active Deals' : 'Archived Deals'}</Button><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="text" placeholder="Search deals..." aria-label="Search deals" className="w-full rounded-xl border py-2 pl-9 pr-4 text-sm sm:w-56" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div>{canManage && <Button onClick={() => { if (!defaultDealStage) setError('No active sales stage is available. Please configure your Pipeline settings.'); else { setDealForm((current) => ({ ...current, stage: defaultDealStage })); setShowAddModal(true); } }} className="gap-2"><Plus size={16} /> Add Deal</Button>}</>} />
    {dealsLoading || clientsLoading ? <Card className="p-10 text-center text-sm text-slate-500">Loading pipeline…</Card> : deals.length === 0 ? <Card className="p-8 text-center"><p className="text-sm font-medium text-slate-700">No deals yet.</p><p className="mt-1 text-xs text-slate-500">Create a deal from a client profile.</p></Card> : <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}><div className="overflow-x-auto pb-3"><div className="grid min-w-[1380px] grid-cols-6 gap-3">{PIPELINE_STAGES.map((stage) => { const stageDeals = filteredDeals.filter((deal) => deal.stage === stage); const totalValue = stageDeals.reduce((sum, deal) => sum + deal.value, 0); return <StageColumn key={stage} stage={stage} deals={stageDeals} totalValue={totalValue} probability={getDealProbability(stage)} clients={clients} tasks={tasks} canManage={canManage} busyDealId={busyDealId} onOpen={openDeal} onArchive={(deal) => void handleArchive(deal)} currency={settings.currency} />; })}</div></div></DndContext>}
    {showArchived && <Card className="p-0"><div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Archived Deals</div>{archivedDeals.length === 0 ? <p className="p-6 text-sm text-slate-500">No archived deals.</p> : <div className="divide-y divide-slate-100">{archivedDeals.map((deal) => <div key={deal.id} className="flex items-center justify-between px-4 py-3"><div><p className="font-semibold text-slate-900">{deal.title}</p><p className="text-xs text-slate-500">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div><div className="flex gap-2"><IconActionButton icon={<RotateCcw size={15} />} label="Restore Deal" variant="success" onClick={() => setConfirmAction({ kind: "restore", id: deal.id, name: deal.title })} />{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Delete Deal permanently" variant="danger" onClick={() => setConfirmAction({ kind: "delete", id: deal.id, name: deal.title })} />}</div></div>)}</div>}</Card>}
    <AnimatePresence>{showAddModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleCreateDeal} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Add Deal</h3><input required placeholder="Deal title" className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.title} onChange={(event) => setDealForm({ ...dealForm, title: event.target.value })} /><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.clientId} onChange={(event) => setDealForm({ ...dealForm, clientId: event.target.value })}><option value="">Select client</option>{clients.filter((client) => client.status !== 'ARCHIVED').map((client) => <option key={client.id} value={client.id}>{client.name}{client.company ? ` — ${client.company}` : ''}</option>)}</select><div className="grid grid-cols-2 gap-4"><input type="number" min="0" required className="rounded-xl border px-4 py-2 text-sm" value={dealForm.value} onChange={(event) => setDealForm({ ...dealForm, value: Number(event.target.value) })} /><input type="date" className="rounded-xl border px-4 py-2 text-sm" value={dealForm.expectedCloseDate} onChange={(event) => setDealForm({ ...dealForm, expectedCloseDate: event.target.value })} /></div><select required className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.stage} onChange={(event) => setDealForm({ ...dealForm, stage: event.target.value })}>{creationStages.map((stage) => <option key={stage.name} value={stage.name}>{stage.name}</option>)}</select><select className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.assignedToUid} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); setDealForm({ ...dealForm, assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Deal'}</Button></div></form></div>}{showWonModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleWonConfirm} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Won</h3><p className="text-sm text-slate-500">Confirm this opportunity is won.</p><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowWonModal(null)}>Cancel</Button><Button type="submit">Confirm Won</Button></div></form></div>}{showLostModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={handleLostConfirm} className="w-full max-w-lg space-y-4"><div className="rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-bold text-slate-900">Mark Deal as Lost</h3><input required placeholder="Reason for loss" className="mt-4 w-full rounded-xl border px-4 py-2" value={lostReason} onChange={(event) => setLostReason(event.target.value)} /><div className="mt-4 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowLostModal(null)}>Cancel</Button><Button type="submit">Confirm Lost</Button></div></div></form></div>}</AnimatePresence>
    {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={clients.find((client) => client.id === selectedDeal.clientId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canWrite={canWrite} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid)} canAssign={canManage} saving={saving} tasks={tasks} canAddTask={canManage} onAddTask={addTask} onCompleteTask={completeTask} currentUser={user} onClose={closeDeal} onSave={handleDealSave} />}
    {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This deal will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This deal will be restored to the active list.' : 'This action cannot be undone. This archived deal will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
  </div>;
}

function StageColumn({ stage, deals, totalValue, probability, clients, tasks, canManage, busyDealId, onOpen, onArchive, currency }: { stage: typeof PIPELINE_STAGES[number]; deals: Deal[]; totalValue: number; probability: number; clients: Client[]; tasks: Task[]; canManage: boolean; busyDealId: string | null; onOpen: (dealId: string) => void; onArchive: (deal: Deal) => void; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return <div ref={setNodeRef} className={`flex min-w-0 flex-col overflow-hidden rounded-lg border ${isOver ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 bg-slate-100/70'}`}><div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2.5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{stage}</h3><span className="text-xs font-medium text-slate-500">{deals.length}</span></div><div className="mt-1 flex items-center justify-between text-xs text-slate-500"><span>{formatCurrency(totalValue, currency)}</span><span>{probability}% probability</span></div></div><SortableContext items={deals.map((deal) => deal.id)} strategy={verticalListSortingStrategy}><div className="min-h-[220px] max-h-[calc(100vh-280px)] flex-1 space-y-2 overflow-y-auto p-2">{deals.length === 0 ? <p className="py-8 text-center text-xs text-slate-400">No deals in this stage</p> : deals.map((deal) => <SortableDealCard key={deal.id} deal={deal} client={clients.find((client) => client.id === deal.clientId)} tasks={tasks} canManage={canManage} busy={busyDealId === deal.id} onOpen={() => onOpen(deal.id)} onArchive={() => onArchive(deal)} currency={currency} />)}</div></SortableContext></div>;
}

function SortableDealCard({ deal, client, tasks, canManage, busy, onOpen, onArchive, currency }: { deal: Deal; client?: Client; tasks: Task[]; canManage: boolean; busy: boolean; onOpen: () => void; onArchive: () => void; currency: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const pointerMoved = useRef(false);
  const dealTasks = tasks.filter((task) => task.relatedTo?.type === 'Deal' && task.relatedTo.id === deal.id && task.status === 'Pending');
  const overdueCount = dealTasks.filter((task) => getTaskDisplayState(task) === 'Overdue').length;
  const taskLabel = overdueCount > 0 ? `${overdueCount} Overdue` : dealTasks.length > 0 ? `${dealTasks.length} ${dealTasks.length === 1 ? 'Task' : 'Tasks'}` : null;
  const openFromCard = () => { if (!isDragging && !pointerMoved.current) onOpen(); pointerMoved.current = false; };
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isDragging) onOpen();
    }
  };
return <div ref={setNodeRef} style={style} {...attributes} {...listeners} role="button" tabIndex={0} aria-label={`Open deal ${deal.title}`} onPointerDown={() => { pointerMoved.current = false; }} onPointerMove={() => { pointerMoved.current = true; }} onClick={openFromCard} onKeyDown={handleCardKeyDown}><Card className="cursor-pointer space-y-2 rounded-lg p-3 shadow-none transition-colors hover:border-slate-300 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500"><div className="flex items-start justify-between gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }} className="line-clamp-2 text-left text-sm font-medium text-slate-900 hover:text-blue-600">{deal.title}</button>{canManage && <IconActionButton icon={<Archive size={15} />} label="Archive Deal" variant="danger" disabled={busy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onArchive(); }} />}</div><p className="truncate text-xs text-slate-500">{client?.name || 'Client'}</p>{deal.productServiceName && <p className="truncate text-[11px] text-slate-400">{deal.productServiceName}</p>}<div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-800">{formatCurrency(deal.value, currency)}</span>{deal.expectedCloseDate && <span className="truncate text-slate-400">{new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</div>{taskLabel && <Badge variant={overdueCount > 0 ? 'red' : 'gray'}>{taskLabel}</Badge>}</Card></div>;
}

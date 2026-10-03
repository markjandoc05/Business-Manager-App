'use client';

import { MobileNavigationTabs } from '@/components/MobileNavigationTabs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Badge, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { LoadedListStatus } from '@/components/LoadedListStatus';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients } from '@/lib/permissions';
import { formatCurrency } from '@/lib/formatting';
import type { DealStatus } from '@/lib/repositories/deals';
import { getDealCreationStages, getDefaultDealCreationStage, getDealProbability } from '@/lib/deal-workflow';
import { DealDetailsModal, type DealEditInput } from '@/components/DealDetailsModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { getTaskDisplayState } from '@/lib/task-utils';
import { getDefaultAssignment } from '@/lib/ownership';
import { PIPELINE_STAGE_COLORS, PIPELINE_STAGES } from '@/components/PipelineFunnel';
import { IconActionButton } from '@/components/IconActionButton';
import { MoneyInput } from '@/components/MoneyInput';
import { DealCatalogItemsField } from '@/components/DealCatalogItemsField';
import { ModalHeader } from '@/components/ModalCloseButton';
import { getDealProductServiceName, getDealValue } from '@/lib/deal-items';
import type { Deal, DealLineItem, Task } from '@/types';
import { Plus, Search, Filter, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { DndContext, closestCenter, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDealClientLookup } from '@/hooks/use-deal-client-lookup';
import { matchesDealLookupSearch } from '@/lib/client-lookup';
import { DealClientSelector } from '@/components/DealClientSelector';
import type { Client } from '@/types';

type DealForm = { title: string; clientId: string; value: number; items: DealLineItem[]; stage: string; expectedCloseDate: string; assignedToUid: string; assignedToName: string; lossReason: string };

export default function PipelinePage() {
  const { clients, clientsLoading, deals, dealsLoading, dealsLoadingMore, dealsError, dealsHasMore, loadMoreDeals, refreshDeals, tasks, settings, users, updateDealStage, updateDeal, archiveDeal, archivedDeals, loadArchivedRecords, loadMoreArchivedDeals, archivedDealsHasMore, restoreDeal, permanentlyDeleteDeal, addDeal, addTask, completeTask } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, canWrite } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = canManageClients(membership) && canWrite;
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'All' | DealStatus>('All');
  const [assignedFilter, setAssignedFilter] = useState('All');
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dealFormError, setDealFormError] = useState<string | null>(null);
  const [showWonModal, setShowWonModal] = useState<{ dealId: string } | null>(null);
  const [showLostModal, setShowLostModal] = useState<{ dealId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'archive' | 'restore' | 'delete'; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const stageChangeInFlight = useRef(false);
  const dragGestureRef = useRef(false);
  const dragContextRef = useRef<string | null>(null);
  const [activeDragDealId, setActiveDragDealId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<typeof PIPELINE_STAGES[number]>('New');
  const creationStages = useMemo(() => getDealCreationStages(settings.pipelineStages), [settings.pipelineStages]);
  const defaultDealStage = getDefaultDealCreationStage(settings.pipelineStages);
  const defaultAssignment = user ? getDefaultAssignment(user) : { assignedToUid: '', assignedToName: '' };
  const [dealForm, setDealForm] = useState<DealForm>({ title: '', clientId: '', value: 5000, items: [], stage: defaultDealStage, expectedCloseDate: '', lossReason: '', ...defaultAssignment });
  const [dealClientSelection, setDealClientSelection] = useState<{ organizationId: string; client: Client } | null>(null);
  const [lostReason, setLostReason] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const selectedDealId = searchParams.get('dealId');
  const selectedDeal = selectedDealId ? deals.find((deal) => deal.id === selectedDealId) : undefined;
  const openDeal = (dealId: string) => { router.push(`/pipeline?dealId=${encodeURIComponent(dealId)}`, { scroll: false }); };
  const closeDeal = () => { router.replace('/pipeline', { scroll: false }); };
  const pipelineContextKey = `${currentOrganizationId || ''}:${searchTerm}:${statusFilter}:${assignedFilter}`;
  const pipelineContextRef = useRef(pipelineContextKey);
  const previousPipelineContextRef = useRef(pipelineContextKey);
  const dealFormOrganizationRef = useRef(currentOrganizationId);
  pipelineContextRef.current = pipelineContextKey;
  const selectedDealClient = dealClientSelection?.organizationId === currentOrganizationId ? dealClientSelection.client : null;

  useEffect(() => {
    if (dealFormOrganizationRef.current === currentOrganizationId) return;
    dealFormOrganizationRef.current = currentOrganizationId;
    setDealClientSelection(null);
    setDealForm((current) => ({ ...current, clientId: '' }));
  }, [currentOrganizationId]);

  useEffect(() => {
    if (previousPipelineContextRef.current === pipelineContextKey) return;
    previousPipelineContextRef.current = pipelineContextKey;
    dragContextRef.current = null;
    dragGestureRef.current = false;
    setActiveDragDealId(null);
    setDragOverStage(null);
    setBusyDealId(null);
    setShowWonModal(null);
    setShowLostModal(null);
    setLostReason('');
  }, [pipelineContextKey]);

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
    const operationContext = pipelineContextKey;
    stageChangeInFlight.current = true;
    setBusyDealId(deal.id); setError(null);
    try {
      await updateDealStage(deal.id, stage, status, lossReason);
      return operationContext === pipelineContextRef.current;
    } catch (stageError) {
      console.error('Unable to update deal stage', stageError);
      if (operationContext === pipelineContextRef.current) setError('Unable to save the deal stage. Please try again.');
      return false;
    } finally {
      stageChangeInFlight.current = false;
      setBusyDealId(null);
    }
  };

  const clearDragState = () => {
    dragContextRef.current = null;
    setActiveDragDealId(null);
    setDragOverStage(null);
    window.requestAnimationFrame(() => { dragGestureRef.current = false; });
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const dealId = parseDealDragId(active.id);
    const deal = dealId ? deals.find((item) => item.id === dealId) : undefined;
    if (!deal || !canMoveDeal(deal)) return;
    dragGestureRef.current = true;
    dragContextRef.current = pipelineContextKey;
    setActiveDragDealId(deal.id);
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    if (dragContextRef.current !== pipelineContextRef.current) return;
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
    const matchesCurrentContext = dragContextRef.current === pipelineContextRef.current;
    clearDragState();
    if (!matchesCurrentContext || !deal || !newStage || deal.stage === newStage || !canMoveDeal(deal)) return;
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
    if (!defaultDealStage) { setDealFormError('No active sales stage is available. Please configure your Pipeline settings.'); return; }
    if (!canManage) return;
    if (!dealForm.title.trim()) { setDealFormError('Deal title is required.'); return; }
    if (!selectedDealClient || selectedDealClient.id !== dealForm.clientId) { setDealFormError('Select an active Client before creating this Deal.'); return; }
    if (!creationStages.some((stage) => stage.name === dealForm.stage)) return;
    setSaving(true); setDealFormError(null);
    try {
      await addDeal(dealForm);
      setDealForm({ title: '', clientId: '', value: 5000, items: [], stage: defaultDealStage, expectedCloseDate: '', lossReason: '', ...defaultAssignment });
      setDealClientSelection(null);
      setShowAddModal(false);
    } catch (createError) {
      console.error('Unable to create deal', createError);
      const message = userFacingErrorMessage(createError, 'Unable to create the Deal. Please try again.');
      setDealFormError(message);
      if (/selected client is not available/i.test(message)) {
        setDealClientSelection(null);
        setDealForm((current) => ({ ...current, clientId: '' }));
      }
    } finally { setSaving(false); }
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
      setError(userFacingErrorMessage(error, 'Unable to complete the deal action. Please try again.'));
    } finally { setConfirmBusy(false); }
  };

  const handleDealSave = async (input: DealEditInput) => {
    if (!selectedDeal) return; setSaving(true);
    try { await updateDeal(selectedDeal.id, input); } finally { setSaving(false); }
  };

  const clientLookup = useDealClientLookup({ user, organizationId: currentOrganizationId, deals, loadedClients: clients });
  const clientsById = clientLookup.clientsById;
  const clientNamesById = useMemo(() => new Map(deals.map((deal) => {
    const name = clientsById.get(deal.clientId)?.name.trim();
    return [deal.clientId, name || (clientLookup.pendingClientIds.has(deal.clientId) ? 'Loading Client…' : 'Client unavailable')];
  })), [clientLookup.pendingClientIds, clientsById, deals]);
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      const client = clientsById.get(deal.clientId);
      const productServiceName = getDealProductServiceName(deal.items || [], deal.productServiceName);
      const matchesSearch = matchesDealLookupSearch({ dealTitle: deal.title, clientName: client?.name, productServiceName }, searchTerm);
      return matchesSearch && (statusFilter === 'All' || deal.status === statusFilter) && (assignedFilter === 'All' || deal.assignedToUid === assignedFilter);
    });
  }, [assignedFilter, clientsById, deals, searchTerm, statusFilter]);
  const dealsByStage = useMemo(() => Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, filteredDeals.filter((deal) => deal.stage === stage)])) as Record<typeof PIPELINE_STAGES[number], Deal[]>, [filteredDeals]);
  const mobileStageDeals = dealsByStage[mobileStage];
  const mobileStageValue = mobileStageDeals.reduce((sum, deal) => sum + deal.value, 0);

  return <div className="pipeline-list-layout space-y-4">
    <PageHeader title="Sales Pipeline" subtitle="Track Deal Value across clients and sales stages." actions={<><Button variant="outline" onClick={() => { const next = !showArchived; setShowArchived(next); setShowFilters(false); if (next && archivedDeals.length === 0) void loadArchivedRecords(); }} aria-label={showArchived ? 'Show pipeline deals' : 'Show archived deals'}><Archive size={16} /><span className="hidden md:inline">{showArchived ? 'Pipeline Deals' : 'Archived Deals'}</span><span className="md:hidden">{showArchived ? 'Active' : 'Archive'}</span></Button>{!showArchived && <><Button variant="outline" onClick={() => setShowFilters((current) => !current)} aria-label="Filter pipeline deals"><Filter size={16} /><span className="hidden md:inline">Filters</span><span className="md:hidden">Filter</span></Button><div className="compact-filter-field compact-filter-search pipeline-header-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" size={16} /><input type="text" placeholder="Search loaded deals..." aria-label="Search loaded deals" className="w-full rounded-xl border py-2 pl-9 pr-4 text-sm sm:w-56" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div>{canManage && <Button onClick={() => { if (!defaultDealStage) setError('No active sales stage is available. Please configure your Pipeline settings.'); else { setDealFormError(null); setDealForm((current) => ({ ...current, stage: defaultDealStage })); setShowAddModal(true); } }} className="gap-2"><Plus size={16} /> Add Deal</Button>}</>}</>} />
    {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
    {dealsError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert"><span>{dealsError}</span><Button variant="outline" size="sm" onClick={() => void refreshDeals()}>Retry</Button></div>}
    {clientLookup.failed && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--app-surface-subtle)] p-3 text-sm text-[var(--app-muted)]" role="alert"><span>Some Client names could not be loaded. Check your connection and try again.</span><Button variant="outline" size="sm" onClick={clientLookup.retry}>Retry Client names</Button></div>}
    {searchTerm.trim() && clientLookup.loading && <p className="text-xs text-[var(--app-muted)]" role="status">Resolving Client names for loaded Deals. Search results will update automatically.</p>}
    {!showArchived && showFilters && <Card className="compact-filter-panel page-filter-panel flex flex-wrap items-center gap-3 p-3"><label className="compact-filter-label text-sm text-[var(--app-muted)]">Status<span className="compact-filter-field"><select aria-label="Filter deals by status" className="ml-2 rounded-lg border px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="All">All statuses</option><option value="Active">Active</option><option value="Won">Won</option><option value="Lost">Lost</option></select></span></label><label className="compact-filter-label text-sm text-[var(--app-muted)]">Assigned to<span className="compact-filter-field"><select aria-label="Filter deals by assignee" className="ml-2 rounded-lg border px-3 py-2 text-sm" value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}><option value="All">Everyone</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}</select></span></label><Button variant="ghost" size="sm" onClick={() => { setStatusFilter('All'); setAssignedFilter('All'); setSearchTerm(''); }}>Clear filters</Button></Card>}
    {!showArchived && ((dealsLoading && deals.length === 0) || clientsLoading ? <div role="status"><Card className="p-10 text-center text-sm text-[var(--app-muted)]">Loading pipeline…</Card></div> : dealsError && deals.length === 0 ? null : deals.length === 0 ? <Card className="p-8 text-center"><p className="text-sm font-medium text-[var(--app-text)]">No deals yet.</p><p className="mt-1 text-xs text-[var(--app-muted)]">Create a deal from a client profile.</p></Card> : <>
      {filteredDeals.length === 0 ? <Card className="p-8 text-center"><p className="text-sm font-medium text-[var(--app-text)]">No loaded deals match these filters.</p><p className="mt-1 text-xs text-[var(--app-muted)]">Clear a filter, change the search, or load more Deals.</p></Card> : isMobile ? <div>
          <MobileNavigationTabs activeKey={mobileStage} className="pipeline-stage-tabs overflow-x-auto pb-2" role="tablist" aria-label="Pipeline stages"><div className="flex min-w-max gap-2">{PIPELINE_STAGES.map((stage) => <button key={stage} id={`pipeline-tab-${stage}`} type="button" role="tab" aria-selected={mobileStage === stage} aria-controls="mobile-pipeline-stage" onClick={() => setMobileStage(stage)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 ${mobileStage === stage ? 'border-[var(--app-primary)] bg-[var(--app-primary)] text-white' : 'border-[var(--app-border)] bg-white text-[var(--app-muted)] hover:text-[var(--app-text)]'}`}>{stage}<span className="ml-1.5 text-xs opacity-80">{dealsByStage[stage].length}</span></button>)}</div></MobileNavigationTabs>
          <MobileStagePanel stage={mobileStage} deals={mobileStageDeals} totalValue={mobileStageValue} clientNamesById={clientNamesById} tasks={tasks} busyDealId={busyDealId} canMoveDeal={canMoveDeal} onOpen={openDeal} onArchive={(deal) => void handleArchive(deal)} currency={settings.currency} />
        </div> : <div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}><div className="overflow-x-auto pb-3"><div className="grid min-w-[1380px] grid-cols-6 gap-3">{PIPELINE_STAGES.map((stage) => { const stageDeals = dealsByStage[stage]; const totalValue = stageDeals.reduce((sum, deal) => sum + deal.value, 0); return <StageColumn key={stage} stage={stage} deals={stageDeals} totalValue={totalValue} probability={getDealProbability(stage)} clientNamesById={clientNamesById} tasks={tasks} busyDealId={busyDealId} dragOverStage={dragOverStage} canMoveDeal={canMoveDeal} onOpen={(dealId) => { if (!dragGestureRef.current) openDeal(dealId); }} onArchive={(deal) => void handleArchive(deal)} currency={settings.currency} />; })}</div></div><DragOverlay dropAnimation={null}>{activeDragDealId ? (() => { const deal = deals.find((item) => item.id === activeDragDealId); return deal ? <DealCardPreview deal={deal} clientName={clientNamesById.get(deal.clientId) || 'Client unavailable'} tasks={tasks} currency={settings.currency} /> : null; })() : null}</DragOverlay></DndContext>
        </div>}
      <div className="space-y-3 pt-1"><LoadedListStatus loadedCount={deals.length} visibleCount={filteredDeals.length} hasMore={dealsHasMore} noun="deals" loadedScope="Search and filters" />{dealsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreDeals()} disabled={dealsLoadingMore}>{dealsLoadingMore ? 'Loading…' : 'Load More Deals'}</Button></div>}</div>
    </>)}
    {showArchived && <><Card className="p-0"><div className="border-b bg-[var(--app-surface-subtle)] px-4 py-3 text-sm font-semibold text-[var(--app-text)]">Archived Deals</div>{archivedDeals.length === 0 ? <p className="p-6 text-sm text-[var(--app-muted)]">No archived deals.</p> : <div className="divide-y divide-[var(--app-border-subtle)]">{archivedDeals.map((deal) => <div key={deal.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate font-semibold text-[var(--app-text)]">{deal.title}</p><p className="text-xs text-[var(--app-muted)]">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div><div className="flex shrink-0 gap-2">{canMoveDeal(deal) && <IconActionButton icon={<RotateCcw size={15} />} label="Restore Deal" variant="success" onClick={() => setConfirmAction({ kind: 'restore', id: deal.id, name: deal.title })} />}{canManage && <IconActionButton icon={<Trash2 size={15} />} label="Delete Deal permanently" variant="danger" onClick={() => setConfirmAction({ kind: 'delete', id: deal.id, name: deal.title })} />}</div></div>)}</div>}</Card>{archivedDealsHasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMoreArchivedDeals()}>Load More Archived Deals</Button></div>}</>}
    <AnimatePresence>{showAddModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Add Deal dialog"><form onSubmit={handleCreateDeal} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"><ModalHeader title="Add Deal" onClose={() => { setDealFormError(null); setShowAddModal(false); }} />{dealFormError && <p role="alert" className="rounded-xl bg-[var(--app-danger-soft)] px-3 py-2 text-sm text-[var(--app-danger)]">{dealFormError}</p>}<label className="block text-sm font-medium">Deal title<input required placeholder="Deal title" className="w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.title} onChange={(event) => setDealForm({ ...dealForm, title: event.target.value })} /></label>{user && currentOrganizationId && <DealClientSelector key={currentOrganizationId} user={user} organizationId={currentOrganizationId} initialClients={clients} initialLoading={clientsLoading} selectedClient={selectedDealClient} disabled={saving} onSelect={(client) => { setDealClientSelection(client ? { organizationId: currentOrganizationId, client } : null); setDealForm((current) => ({ ...current, clientId: client?.id || '' })); setDealFormError(null); }} />}{user && currentOrganizationId && <DealCatalogItemsField user={user} organizationId={currentOrganizationId} items={dealForm.items} currency={settings.currency} disabled={saving} onChange={(items) => setDealForm((current) => ({ ...current, items, value: getDealValue(current.value, items) }))} />}<div className="grid gap-4 sm:grid-cols-2">{dealForm.items.length > 0 ? <div className="rounded-xl border bg-[var(--app-surface-subtle)] px-4 py-2 text-sm font-semibold text-[var(--app-text)]">{formatCurrency(getDealValue(dealForm.value, dealForm.items), settings.currency)}</div> : <label className="block text-sm font-medium">Deal value<MoneyInput aria-label="Deal value" value={dealForm.value} currency={settings.currency} required className="rounded-xl border px-4 py-2 text-sm" onChange={(value) => setDealForm({ ...dealForm, value })} /></label>}<label className="block text-sm font-medium">Expected close date<input type="date" className="mt-1 w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.expectedCloseDate} onChange={(event) => setDealForm({ ...dealForm, expectedCloseDate: event.target.value })} /></label></div><label className="block text-sm font-medium">Stage<select required className="mt-1 w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.stage} onChange={(event) => setDealForm({ ...dealForm, stage: event.target.value })}>{creationStages.map((stage) => <option key={stage.name} value={stage.name}>{stage.name}</option>)}</select></label><p className="mt-1 text-xs font-semibold text-[var(--app-primary)]">{getDealProbability(dealForm.stage)}% Probability</p>{dealForm.stage === 'Lost' && <label className="block text-sm font-medium text-[var(--app-text)]">Loss Reason<input required className="mt-1 w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.lossReason} onChange={(event) => setDealForm({ ...dealForm, lossReason: event.target.value })} placeholder="Why was this Deal lost?" /></label>}<label className="block text-sm font-medium">Assigned to<select className="mt-1 w-full rounded-xl border px-4 py-2 text-sm" value={dealForm.assignedToUid} onChange={(event) => { const assignee = users.find((item) => item.uid === event.target.value); setDealForm({ ...dealForm, assignedToUid: event.target.value, assignedToName: assignee?.name || '' }); }}><option value="">Unassigned</option>{users.map((item) => <option key={item.uid} value={item.uid}>{item.name} ({item.role})</option>)}</select></label><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => { setDealFormError(null); setShowAddModal(false); }}>Cancel</Button><Button type="submit" disabled={saving || !selectedDealClient}>{saving ? 'Saving…' : 'Create Deal'}</Button></div></form></div>}{showWonModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Mark Deal as Won dialog"><form onSubmit={handleWonConfirm} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><ModalHeader title="Mark Deal as Won" subtitle="Confirm this deal is won." onClose={() => setShowWonModal(null)} /><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setShowWonModal(null)}>Cancel</Button><Button type="submit">Confirm Won</Button></div></form></div>}{showLostModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="dialog" aria-modal="true" aria-label="Mark Deal as Lost dialog"><form onSubmit={handleLostConfirm} className="w-full max-w-lg space-y-4"><div className="rounded-2xl bg-white p-6 shadow-xl"><ModalHeader title="Mark Deal as Lost" onClose={() => setShowLostModal(null)} /><input required placeholder="Reason for loss" className="mt-4 w-full rounded-xl border px-4 py-2" value={lostReason} onChange={(event) => setLostReason(event.target.value)} /><div className="app-modal-footer"><Button type="button" variant="outline" onClick={() => setShowLostModal(null)}>Cancel</Button><Button type="submit">Confirm Lost</Button></div></div></form></div>}</AnimatePresence>
    {selectedDeal && user && currentOrganizationId && <DealDetailsModal deal={selectedDeal} organizationId={currentOrganizationId} clientName={clientsById.get(selectedDeal.clientId)?.name} users={users} pipelineStages={settings.pipelineStages} currency={settings.currency} timezone={settings.timezone} canWrite={canWrite} canEdit={canManage || (membership?.role === 'USER' && selectedDeal.assignedToUid === user.uid)} canAssign={canManage} saving={saving} tasks={tasks} canAddTask={canManage} onAddTask={addTask} onCompleteTask={completeTask} currentUser={user} onClose={closeDeal} onSave={handleDealSave} />}
    {confirmAction && <ConfirmActionDialog open title={`${confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete'} “${confirmAction.name}”${confirmAction.kind === 'delete' ? ' Permanently' : ''}?`} description={confirmAction.kind === 'archive' ? 'This deal will be moved to Archived and can be restored later.' : confirmAction.kind === 'restore' ? 'This deal will be restored to the active list.' : 'This action cannot be undone. This archived deal will be permanently deleted.'} confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : confirmAction.kind === 'restore' ? 'Restore' : 'Delete Permanently'} variant={confirmAction.kind === 'delete' ? 'danger' : confirmAction.kind === 'archive' ? 'warning' : 'default'} loading={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={() => void executeConfirmedAction()} />}
  </div>;
}

function StageColumn({ stage, deals, totalValue, probability, clientNamesById, tasks, busyDealId, dragOverStage, canMoveDeal, onOpen, onArchive, currency }: { stage: typeof PIPELINE_STAGES[number]; deals: Deal[]; totalValue: number; probability: number; clientNamesById: Map<string, string>; tasks: Task[]; busyDealId: string | null; dragOverStage: string | null; canMoveDeal: (deal: Deal) => boolean; onOpen: (dealId: string) => void; onArchive: (deal: Deal) => void; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}`, data: { stage } });
  const highlighted = isOver || dragOverStage === stage;
  const stageColor = PIPELINE_STAGE_COLORS[PIPELINE_STAGES.indexOf(stage)];
  return <div ref={setNodeRef} className={`flex min-w-0 flex-col overflow-hidden rounded-lg border ${highlighted ? 'border-[var(--app-primary)] bg-[var(--app-accent-soft)]/30' : 'border-[var(--app-border)] bg-[var(--app-surface-subtle)]/70'}`} style={{ boxShadow: `inset 0 3px 0 ${stageColor}` }}><div className="sticky top-0 z-10 border-b border-[var(--app-border)] bg-white px-3 py-2.5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--app-text)]">{stage}</h3><span className="text-xs font-medium text-[var(--app-muted)]">{deals.length}</span></div><div className="mt-1 flex items-center justify-between text-xs text-[var(--app-muted)]"><span title="Loaded Deal Value">{formatCurrency(totalValue, currency)}</span><span>{probability}% probability</span></div></div><div className="min-h-[220px] max-h-[calc(100vh-280px)] flex-1 space-y-2 overflow-y-auto p-2">{deals.length === 0 ? <p className="py-8 text-center text-xs text-[var(--app-tertiary)]">No deals in this stage</p> : deals.map((deal) => <DraggableDealCard key={deal.id} deal={deal} clientName={clientNamesById.get(deal.clientId) || 'Client unavailable'} tasks={tasks} canManage={canMoveDeal(deal)} busy={busyDealId === deal.id} canDrag={canMoveDeal(deal)} onOpen={() => onOpen(deal.id)} onArchive={() => onArchive(deal)} currency={currency} />)}</div></div>;
}

function MobileStagePanel({ stage, deals, totalValue, clientNamesById, tasks, busyDealId, canMoveDeal, onOpen, onArchive, currency }: { stage: typeof PIPELINE_STAGES[number]; deals: Deal[]; totalValue: number; clientNamesById: Map<string, string>; tasks: Task[]; busyDealId: string | null; canMoveDeal: (deal: Deal) => boolean; onOpen: (dealId: string) => void; onArchive: (deal: Deal) => void; currency: string }) {
  return <section id="mobile-pipeline-stage" role="tabpanel" aria-labelledby={`pipeline-tab-${stage}`} className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-subtle)]/70"><div className="border-b border-[var(--app-border)] bg-white px-3 py-3"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-[var(--app-text)]">{stage}</h3><span className="text-xs font-medium text-[var(--app-muted)]">{deals.length} {deals.length === 1 ? 'Deal' : 'Deals'}</span></div><div className="mt-1 flex items-center justify-between text-xs text-[var(--app-muted)]"><span>Loaded Deal Value: {formatCurrency(totalValue, currency)}</span><span>{getDealProbability(stage)}% probability</span></div></div><div className="space-y-2 p-2">{deals.length === 0 ? <p className="py-10 text-center text-sm text-[var(--app-muted)]">No loaded Deals in this stage.</p> : deals.map((deal) => { const { taskLabel, overdueCount } = getDealTaskSummary(deal, tasks); const canManageDeal = canMoveDeal(deal); return <div key={deal.id} className="relative"><button type="button" aria-label={`Open deal ${deal.title}`} className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30" onClick={() => onOpen(deal.id)}><DealCardContent deal={deal} clientName={clientNamesById.get(deal.clientId) || 'Client unavailable'} canManage={false} busy={busyDealId === deal.id} currency={currency} taskLabel={taskLabel} overdueCount={overdueCount} /></button>{canManageDeal && <div className="absolute right-3 top-3"><IconActionButton icon={<Archive size={15} />} label="Archive Deal" variant="danger" disabled={busyDealId === deal.id} onClick={() => onArchive(deal)} /></div>}</div>; })}</div></section>;
}

function DraggableDealCard({ deal, clientName, tasks, canManage, busy, canDrag, onOpen, onArchive, currency }: { deal: Deal; clientName: string; tasks: Task[]; canManage: boolean; busy: boolean; canDrag: boolean; onOpen: () => void; onArchive: () => void; currency: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `deal:${deal.id}`, disabled: !canDrag, data: { dealId: deal.id, sourceStage: deal.stage } });
  const { taskLabel, overdueCount } = getDealTaskSummary(deal, tasks);
  return <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="draggable deal" aria-label={`Open deal ${deal.title}`} onClick={() => { if (!isDragging) onOpen(); }}><DealCardContent deal={deal} clientName={clientName} canManage={canManage} busy={busy} onArchive={onArchive} currency={currency} taskLabel={taskLabel} overdueCount={overdueCount} dragging={isDragging} /></div>;
}

function DealCardPreview({ deal, clientName, tasks, currency }: { deal: Deal; clientName: string; tasks: Task[]; currency: string }) {
  const { taskLabel, overdueCount } = getDealTaskSummary(deal, tasks);
  return <div className="w-[250px] rotate-1"><DealCardContent deal={deal} clientName={clientName} canManage={false} busy={false} currency={currency} taskLabel={taskLabel} overdueCount={overdueCount} dragging /></div>;
}

function DealCardContent({ deal, clientName, canManage, busy, onArchive, currency, taskLabel, overdueCount, dragging }: { deal: Deal; clientName: string; canManage: boolean; busy: boolean; onArchive?: () => void; currency: string; taskLabel: string | null; overdueCount: number; dragging?: boolean }) {
  const productServiceName = getDealProductServiceName(deal.items || [], deal.productServiceName);
  return <Card className={`space-y-2 rounded-lg p-3 shadow-none ${dragging ? 'shadow-xl ring-2 ring-[var(--app-primary)]' : 'cursor-pointer transition-colors hover:border-[var(--app-border)] hover:bg-[var(--app-surface-subtle)] focus-within:ring-2 focus-within:ring-[var(--app-primary)]'}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-left text-sm font-medium text-[var(--app-text)]">{deal.title}</p>{canManage && onArchive && <IconActionButton icon={<Archive size={15} />} label="Archive Deal" variant="danger" disabled={busy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onArchive(); }} />}</div><p className="truncate text-xs text-[var(--app-muted)]">{clientName}</p>{productServiceName && <p className="truncate text-[11px] text-[var(--app-tertiary)]">{productServiceName}</p>}<div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-[var(--app-text)]">{formatCurrency(deal.value, currency)}</span>{deal.expectedCloseDate && <span className="truncate text-[var(--app-tertiary)]">{new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</div>{taskLabel && <Badge variant={overdueCount > 0 ? 'red' : 'gray'}>{taskLabel}</Badge>}</Card>;
}

function getDealTaskSummary(deal: Deal, tasks: Task[]) {
  const dealTasks = tasks.filter((task) => task.relatedTo?.type === 'Deal' && task.relatedTo.id === deal.id && task.status === 'Pending');
  const overdueCount = dealTasks.filter((task) => getTaskDisplayState(task) === 'Overdue').length;
  const taskLabel = overdueCount > 0 ? `${overdueCount} Overdue` : dealTasks.length > 0 ? `${dealTasks.length} ${dealTasks.length === 1 ? 'Task' : 'Tasks'}` : null;
  return { taskLabel, overdueCount };
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

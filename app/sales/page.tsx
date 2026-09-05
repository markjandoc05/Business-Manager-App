'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CircleDollarSign, Eye, HandCoins, Plus, ReceiptText, RotateCcw, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, LoadingState } from '@/components/ui/core';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { IconActionButton } from '@/components/IconActionButton';
import { PageHeader } from '@/components/PageHeader';
import { RecordSaleModal, SaleDetailsModal } from '@/components/SaleRecordModal';
import { TablePagination } from '@/components/TablePagination';
import { SortableColumnHeader } from '@/components/SortableColumnHeader';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatCurrency } from '@/lib/formatting';
import { canManageSales } from '@/lib/permissions';
import { getLocalCalendarDate } from '@/lib/sale-workflow';
import { archiveSale, createSale, getSalesKpiMetrics, listSalesPage, restoreSaleFromArchive, restoreSaleFromTrash, trashSale, voidSale, type CreateSaleInput } from '@/lib/repositories/sales';
import { getCachedDealDisplay, refreshDealDisplay } from '@/lib/repositories/deals';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import type { FirestoreCursor } from '@/lib/repositories/pagination';
import type { Deal, Sale, SalePaymentStatus, SaleSource } from '@/types';
import { invalidateDashboardMetrics } from '@/lib/repositories/dashboard';
import { compareDate, compareNumber, compareText, type SortDirection } from '@/lib/table-sorting';
import { KpiCardGrid, MovableKpiCard, StandardKpiCard } from '@/components/KpiCard';
import { KpiCustomizationModal } from '@/components/KpiCustomizationModal';
import { readKpiPreference, reorderKpiIds, writeKpiPreference } from '@/lib/kpi-preferences';

type DatePreset = 'TODAY' | 'SEVEN_DAYS' | 'TWENTY_EIGHT_DAYS' | 'CUSTOM';
type SalesView = 'NORMAL' | 'ARCHIVED' | 'TRASH';
type LifecycleAction = 'archive' | 'restoreArchive' | 'trash';
type SaleSortKey = 'date' | 'saleNumber' | 'customer' | 'source' | 'items' | 'total' | 'payment' | 'status';
type SaleSort = { key: SaleSortKey; direction: SortDirection } | null;
const SALES_KPIS = [
  { id: 'total', label: 'Total Sales', description: 'Total value of active sales.' },
  { id: 'transactions', label: 'Transactions', description: 'Number of active sales recorded.' },
  { id: 'collected', label: 'Amount Collected', description: 'Amount collected from active sales.' },
  { id: 'outstanding', label: 'Outstanding Balance', description: 'Current unpaid balance across active sales.' },
  { id: 'average', label: 'Average Sale Value', description: 'Average value of each active sale.' },
  { id: 'paid', label: 'Paid Sales', description: 'Active sales marked as fully paid.' },
  { id: 'partial', label: 'Partial Sales', description: 'Active sales with partial payment.' },
  { id: 'unpaid', label: 'Unpaid Sales', description: 'Active sales with no payment recorded.' },
  { id: 'deal', label: 'Deal Sales', description: 'Active sales recorded from Won Deals.' },
  { id: 'client', label: 'Direct Client Sales', description: 'Active sales recorded directly for Clients.' },
  { id: 'walkIn', label: 'Walk-in Sales', description: 'Active Walk-in sales recorded.' },
] as const;
const SALES_KPI_DEFAULTS = ['total', 'transactions', 'collected', 'outstanding'] as const;
const SALES_KPI_CONTEXTS: Record<string, string> = {
  total: 'Recorded sales value', transactions: 'Sales recorded', collected: 'Amount paid', outstanding: 'Unpaid active sales', average: 'Average per sale',
  paid: 'Fully paid sales', partial: 'Partially paid sales', unpaid: 'No payment recorded', deal: 'Sales from Won Deals', client: 'Direct Client sales', walkIn: 'Walk-in transactions',
};
const SALES_KPI_OPTIONS = SALES_KPIS.map((metric) => ({ ...metric, context: SALES_KPI_CONTEXTS[metric.id] }));
const SALES_KPI_CATEGORIES = [
  { id: 'sales', label: 'Sales', description: 'Core sales performance metrics', optionIds: ['total', 'transactions', 'average'] },
  { id: 'payments', label: 'Payments', description: 'Collection and payment status metrics', optionIds: ['collected', 'outstanding', 'paid', 'partial', 'unpaid'] },
  { id: 'source', label: 'Source', description: 'Where recorded Sales originated', optionIds: ['deal', 'client', 'walkIn'] },
] as const;

function dateRange(preset: Exclude<DatePreset, 'CUSTOM'>) {
  const to = getLocalCalendarDate();
  const days = preset === 'TODAY' ? 0 : preset === 'SEVEN_DAYS' ? 6 : 27;
  const today = new Date(`${to}T12:00:00`); today.setDate(today.getDate() - days);
  return { from: getLocalCalendarDate(today), to };
}

function paymentLabel(value: SalePaymentStatus) { return value === 'PAID' ? 'Paid' : value === 'PARTIAL' ? 'Partial' : 'Unpaid'; }

export default function SalesPage() {
  const { user } = useAuth(); const { settings } = useApp(); const { currentOrganizationId, ready, membership, canWrite } = useWorkspace();
  const canManage = canManageSales(membership) && canWrite;
  const [preset, setPreset] = useState<DatePreset>('TODAY'); const initialRange = dateRange('TODAY');
  const [dateFrom, setDateFrom] = useState(initialRange.from); const [dateTo, setDateTo] = useState(initialRange.to);
  const [sourceFilter, setSourceFilter] = useState<SaleSource | ''>(''); const [paymentStatus, setPaymentStatus] = useState<SalePaymentStatus | ''>(''); const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<SalesView>('NORMAL'); const [selectedSaleIds, setSelectedSaleIds] = useState<Set<string>>(new Set()); const [saleSort, setSaleSort] = useState<SaleSort>(null);
  const [salesKpiIds, setSalesKpiIds] = useState<string[]>([...SALES_KPI_DEFAULTS]); const [salesKpiDraft, setSalesKpiDraft] = useState<string[]>([...SALES_KPI_DEFAULTS]); const [customizeKpis, setCustomizeKpis] = useState(false); const [draggingKpi, setDraggingKpi] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]); const [cursor, setCursor] = useState<FirestoreCursor>(null); const [hasMore, setHasMore] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ transactionCount: 0, total: 0, amountPaid: 0, balance: 0, average: 0, paid: 0, partial: 0, unpaid: 0, deal: 0, client: 0, walkIn: 0, unavailable: [] as string[] });
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [showRecord, setShowRecord] = useState(false); const [selectedSale, setSelectedSale] = useState<Sale | null>(null); const [selectedSaleDeal, setSelectedSaleDeal] = useState<{ dealId: string; details: Pick<Deal, 'title' | 'value'> } | null>(null); const [selectedSaleDealLoading, setSelectedSaleDealLoading] = useState(false); const [voidTarget, setVoidTarget] = useState<Sale | null>(null); const [voiding, setVoiding] = useState(false); const [lifecycleTarget, setLifecycleTarget] = useState<{ sale: Sale; action: LifecycleAction } | null>(null); const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const requestRef = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => setSearchQuery(search), search.trim() ? 220 : 0); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setSalesKpiIds(readKpiPreference(window.localStorage, 'bsm_sales_kpis_v1', SALES_KPI_DEFAULTS, SALES_KPIS.map((kpi) => kpi.id))); }, []);
  const salesKpiQueryGroups = useMemo(() => salesKpiIds.filter((id) => ['paid', 'partial', 'unpaid', 'deal', 'client', 'walkIn'].includes(id)).sort().join(','), [salesKpiIds]);
  useEffect(() => {
    let cancelled = false;
    setSelectedSaleDeal(null);
    if (!selectedSale?.dealId || !currentOrganizationId) { setSelectedSaleDealLoading(false); return () => { cancelled = true; }; }
    const dealId = selectedSale.dealId;
    const cachedDeal = getCachedDealDisplay(currentOrganizationId, dealId);
    if (cachedDeal) setSelectedSaleDeal({ dealId, details: cachedDeal });
    setSelectedSaleDealLoading(!cachedDeal);
    void refreshDealDisplay(user, currentOrganizationId, dealId)
      .then((details) => { if (!cancelled) setSelectedSaleDeal({ dealId, details }); })
      .catch(() => { if (!cancelled && !cachedDeal) setSelectedSaleDeal(null); })
      .finally(() => { if (!cancelled) setSelectedSaleDealLoading(false); });
    return () => { cancelled = true; };
  }, [currentOrganizationId, selectedSale?.dealId, user]);
  const refresh = useCallback(async () => {
    if (!user || !currentOrganizationId || !ready) return;
    const request = ++requestRef.current; setLoading(true); setError(null); setSales([]); setCursor(null); setHasMore(false); setPage(1);
    try { const filters = { dateFrom, dateTo, customerType: sourceFilter === 'DEAL' ? undefined : sourceFilter || undefined, source: sourceFilter === 'DEAL' ? 'DEAL' as const : undefined, paymentStatus: paymentStatus || undefined, view, search: searchQuery }; const selectedKpis = salesKpiQueryGroups ? salesKpiQueryGroups.split(',') : []; const [listed, nextSummary] = await Promise.all([listSalesPage(user, currentOrganizationId, filters, null, pageSize), getSalesKpiMetrics(user, currentOrganizationId, dateFrom, dateTo, selectedKpis)]); if (request !== requestRef.current) return; setSales(listed.items); setCursor(listed.nextCursor); setHasMore(listed.hasMore); setSummary(nextSummary); }
    catch (cause) { if (request === requestRef.current) setError(userFacingErrorMessage(cause, 'Unable to load Sales.')); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [currentOrganizationId, sourceFilter, dateFrom, dateTo, pageSize, paymentStatus, ready, searchQuery, user, view, salesKpiQueryGroups]);
  useEffect(() => { void refresh(); }, [refresh]);
  const loadMore = async () => { if (!user || !currentOrganizationId || !cursor || loading) return; setLoading(true); try { const result = await listSalesPage(user, currentOrganizationId, { dateFrom, dateTo, customerType: sourceFilter === 'DEAL' ? undefined : sourceFilter || undefined, source: sourceFilter === 'DEAL' ? 'DEAL' : undefined, paymentStatus: paymentStatus || undefined, view, search: searchQuery }, cursor, pageSize); setSales((current) => [...current, ...result.items]); setCursor(result.nextCursor); setHasMore(result.hasMore); } catch (cause) { setError(userFacingErrorMessage(cause, 'Unable to load more sales.')); } finally { setLoading(false); } };
  const filtered = sales;
  const sortedSales = useMemo(() => { if (!saleSort) return filtered; const value = (sale: Sale) => saleSort.key === 'date' ? sale.saleDate : saleSort.key === 'saleNumber' ? sale.saleNumber : saleSort.key === 'customer' ? sale.customerName : saleSort.key === 'source' ? sale.source : saleSort.key === 'items' ? sale.items.length : saleSort.key === 'total' ? sale.total : saleSort.key === 'payment' ? sale.paymentStatus : sale.status; return [...filtered].sort((left, right) => typeof value(left) === 'number' ? compareNumber(value(left) as number, value(right) as number, saleSort.direction) : saleSort.key === 'date' ? compareDate(value(left) as string, value(right) as string, saleSort.direction) : compareText(value(left) as string, value(right) as string, saleSort.direction)); }, [filtered, saleSort]);
  const visible = sortedSales.slice((page - 1) * pageSize, page * pageSize); const safePage = Math.max(1, Math.min(page, Math.max(1, Math.ceil(sortedSales.length / pageSize))));
  const handleSaleSort = (key: SaleSortKey) => { setSaleSort((current) => current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }); setPage(1); };
  const allVisibleSalesSelected = visible.length > 0 && visible.every((sale) => selectedSaleIds.has(sale.id));
  const someVisibleSalesSelected = visible.some((sale) => selectedSaleIds.has(sale.id)) && !allVisibleSalesSelected;
  const toggleSaleSelection = (saleId: string) => setSelectedSaleIds((current) => { const next = new Set(current); next.has(saleId) ? next.delete(saleId) : next.add(saleId); return next; });
  const toggleAllVisibleSales = () => setSelectedSaleIds((current) => { const next = new Set(current); if (allVisibleSalesSelected) visible.forEach((sale) => next.delete(sale.id)); else visible.forEach((sale) => next.add(sale.id)); return next; });
  const setDatePreset = (value: DatePreset) => { setPreset(value); if (value !== 'CUSTOM') { const range = dateRange(value); setDateFrom(range.from); setDateTo(range.to); } };
  const submitRecord = async (input: CreateSaleInput) => { if (!user || !currentOrganizationId) return; await createSale(user, currentOrganizationId, input); invalidateDashboardMetrics(currentOrganizationId); setShowRecord(false); await refresh(); };
  const confirmVoid = async () => { if (!user || !currentOrganizationId || !voidTarget) return; setVoiding(true); try { await voidSale(user, currentOrganizationId, voidTarget.id); invalidateDashboardMetrics(currentOrganizationId); setVoidTarget(null); setSelectedSale((sale) => sale?.id === voidTarget.id ? { ...sale, status: 'VOIDED' } : sale); await refresh(); } catch (cause) { setError(userFacingErrorMessage(cause, 'Unable to void the sale.')); } finally { setVoiding(false); } };
  const confirmLifecycle = async () => { if (!user || !currentOrganizationId || !lifecycleTarget) return; setLifecycleBusy(true); try { const { sale, action } = lifecycleTarget; if (action === 'archive') await archiveSale(user, currentOrganizationId, sale.id); if (action === 'restoreArchive') await restoreSaleFromArchive(user, currentOrganizationId, sale.id); if (action === 'trash') await trashSale(user, currentOrganizationId, sale.id); setLifecycleTarget(null); await refresh(); } catch (cause) { setError(userFacingErrorMessage(cause, 'Unable to update the Sale record.')); } finally { setLifecycleBusy(false); } };
  const restoreFromTrash = async (sale: Sale) => { if (!user || !currentOrganizationId) return; try { await restoreSaleFromTrash(user, currentOrganizationId, sale.id); await refresh(); } catch (cause) { setError(userFacingErrorMessage(cause, 'Unable to restore the Sale.')); } };
  const currency = settings.currency || 'PHP';
  const displayedSaleDeal = selectedSale && selectedSaleDeal && selectedSaleDeal.dealId === selectedSale.dealId ? selectedSaleDeal.details : null;
  const viewLabel = view === 'NORMAL' ? 'Sales Log' : view === 'ARCHIVED' ? 'Archived Sales' : 'Sales Trash';
  const openCustomizeKpis = () => { setSalesKpiDraft([...salesKpiIds]); setCustomizeKpis(true); };
  const moveSalesKpi = (targetId: string) => { if (!draggingKpi || draggingKpi === targetId) return; setSalesKpiIds((current) => { const next = reorderKpiIds(current, draggingKpi, targetId); writeKpiPreference(window.localStorage, 'bsm_sales_kpis_v1', next); return next; }); };
  const salesMetrics = [
    { id: 'total', label: 'Total Sales', value: formatCurrency(summary.total, currency), description: 'Total value of active sales.', icon: ReceiptText },
    { id: 'transactions', label: 'Transactions', value: summary.transactionCount.toLocaleString(), description: 'Number of active sales recorded.', icon: ShoppingBag },
    { id: 'collected', label: 'Amount Collected', value: formatCurrency(summary.amountPaid, currency), description: 'Amount collected from active sales.', icon: HandCoins },
    { id: 'outstanding', label: 'Outstanding Balance', value: formatCurrency(summary.balance, currency), description: 'Current unpaid balance across active sales.', icon: CircleDollarSign },
    { id: 'average', label: 'Average Sale Value', value: formatCurrency(summary.average, currency), description: 'Average value of each active sale.', icon: ReceiptText },
    { id: 'paid', label: 'Paid Sales', value: summary.paid.toLocaleString(), description: 'Active sales marked as fully paid.', icon: HandCoins },
    { id: 'partial', label: 'Partial Sales', value: summary.partial.toLocaleString(), description: 'Active sales with partial payment.', icon: HandCoins },
    { id: 'unpaid', label: 'Unpaid Sales', value: summary.unpaid.toLocaleString(), description: 'Active sales with no payment recorded.', icon: CircleDollarSign },
    { id: 'deal', label: 'Deal Sales', value: summary.deal.toLocaleString(), description: 'Active sales recorded from Won Deals.', icon: ReceiptText },
    { id: 'client', label: 'Direct Client Sales', value: summary.client.toLocaleString(), description: 'Active sales recorded directly for Clients.', icon: ShoppingBag },
    { id: 'walkIn', label: 'Walk-in Sales', value: summary.walkIn.toLocaleString(), description: 'Active Walk-in sales recorded.', icon: ShoppingBag },
  ];
  const salesMetricById = new Map(salesMetrics.map((metric) => [metric.id, metric]));
  return <main className="space-y-5"><PageHeader title="Sales Log" subtitle="Record and manage your business sales transactions." actions={<div className="sales-log-header-actions flex flex-wrap gap-2"><Button variant="outline" onClick={() => setView(view === 'ARCHIVED' ? 'NORMAL' : 'ARCHIVED')}>{view === 'ARCHIVED' ? 'Active Sales' : 'Archived'}</Button><Button variant="outline" onClick={() => setView(view === 'TRASH' ? 'NORMAL' : 'TRASH')}>{view === 'TRASH' ? 'Active Sales' : 'Trash'}</Button>{canManage && <Button className="sales-log-primary-action gap-2" onClick={() => setShowRecord(true)}><Plus size={16} /> Record Sale</Button>}</div>} />
    {error && <Alert variant="error">{error}</Alert>}
    <section><div className="mb-2 flex justify-end"><Button size="sm" variant="outline" onClick={openCustomizeKpis}>Customize Cards</Button></div><KpiCardGrid className="sales-kpi-grid">{salesKpiIds.map((id, index) => { const metric = salesMetricById.get(id); if (!metric) return null; return <MovableKpiCard key={id} cardId={metric.label} order={index} onDragStart={setDraggingKpi} onDragEnd={() => setDraggingKpi(null)} onDrop={() => moveSalesKpi(id)}><StandardKpiCard label={metric.label} value={metric.value} description={metric.description} context={SALES_KPI_CONTEXTS[id] ?? 'Sales metric'} icon={metric.icon} unavailable={summary.unavailable.includes(id)} /></MovableKpiCard>; })}</KpiCardGrid></section>
    <Card className="p-3 sm:p-4"><div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_11rem_11rem] xl:grid-cols-[minmax(14rem,1fr)_auto_auto_auto]"><label className="relative"><span className="sr-only">Search sales</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" /><input className="w-full !pl-9" placeholder="Search sale # or customer" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><select value={sourceFilter} aria-label="Filter customer source" onChange={(event) => setSourceFilter(event.target.value as SaleSource | '')}><option value="">All sources</option><option value="WALK_IN">Walk-in</option><option value="CLIENT">Client</option><option value="DEAL">Deal</option></select><select value={paymentStatus} aria-label="Filter payment status" onChange={(event) => setPaymentStatus(event.target.value as SalePaymentStatus | '')}><option value="">All payments</option><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="UNPAID">Unpaid</option></select><select value={preset} aria-label="Date range" onChange={(event) => setDatePreset(event.target.value as DatePreset)}><option value="TODAY">Today</option><option value="SEVEN_DAYS">Last 7 days</option><option value="TWENTY_EIGHT_DAYS">Last 28 days</option><option value="CUSTOM">Custom</option></select></div>{preset === 'CUSTOM' && <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">From<input className="ml-2" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="text-sm">To<input className="ml-2" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Apply dates</Button></div>}</Card>
    {loading && sales.length === 0 ? <LoadingState label={`Loading ${viewLabel}…`} /> : filtered.length === 0 ? <Card className="p-0"><EmptyState title={sales.length === 0 ? `No ${viewLabel.toLowerCase()} in this date range.` : 'No matching sales.'} description={view === 'TRASH' ? 'Trashed Sales are retained as voided historical records.' : canManage ? 'Record a sale to begin your sales log.' : undefined} action={canManage && view === 'NORMAL' ? <Button onClick={() => setShowRecord(true)}><Plus size={16} /> Record Sale</Button> : undefined} /></Card> : <Card className="overflow-hidden rounded-xl border border-[var(--app-border)]/80 bg-white p-0 shadow-none"><div className="sales-table-scroll overflow-x-auto overscroll-x-contain"><table className="sales-data-table w-full min-w-[1060px] xl:min-w-0 table-fixed border-separate border-spacing-0 text-left"><colgroup><col style={{ width: '3%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '17%' }} /><col style={{ width: '11%' }} /><col style={{ width: '7%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /></colgroup><thead className="bg-[var(--app-surface-subtle)]"><tr className="border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)]"><th scope="col" className="w-10 px-2 py-2.5"><input type="checkbox" className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" checked={allVisibleSalesSelected} ref={(element) => { if (element) element.indeterminate = someVisibleSalesSelected; }} onChange={toggleAllVisibleSales} aria-checked={someVisibleSalesSelected ? 'mixed' : allVisibleSalesSelected} aria-label="Select all visible Sales" /></th><SortableColumnHeader label="Date" direction={saleSort?.key === 'date' ? saleSort.direction : undefined} onSort={() => handleSaleSort('date')} compact fullWidth /><SortableColumnHeader label="Sale #" direction={saleSort?.key === 'saleNumber' ? saleSort.direction : undefined} onSort={() => handleSaleSort('saleNumber')} compact fullWidth /><SortableColumnHeader label="Customer" direction={saleSort?.key === 'customer' ? saleSort.direction : undefined} onSort={() => handleSaleSort('customer')} compact fullWidth /><SortableColumnHeader label="Source" direction={saleSort?.key === 'source' ? saleSort.direction : undefined} onSort={() => handleSaleSort('source')} compact fullWidth /><SortableColumnHeader label="Items" direction={saleSort?.key === 'items' ? saleSort.direction : undefined} onSort={() => handleSaleSort('items')} align="center" compact fullWidth /><SortableColumnHeader label="Total" direction={saleSort?.key === 'total' ? saleSort.direction : undefined} onSort={() => handleSaleSort('total')} align="right" compact fullWidth /><SortableColumnHeader label="Payment" direction={saleSort?.key === 'payment' ? saleSort.direction : undefined} onSort={() => handleSaleSort('payment')} compact fullWidth /><SortableColumnHeader label="Status" direction={saleSort?.key === 'status' ? saleSort.direction : undefined} onSort={() => handleSaleSort('status')} compact fullWidth /><th scope="col" className="text-right">Actions</th></tr></thead><tbody className="divide-y divide-[var(--app-border)]/80">{visible.map((sale) => <tr key={sale.id} className={`transition-colors hover:bg-[var(--app-surface-subtle)]/80 ${selectedSaleIds.has(sale.id) ? 'bg-[var(--app-accent-soft)]/40' : ''}`}><td className="w-10 px-2 py-2.5 align-middle"><input type="checkbox" checked={selectedSaleIds.has(sale.id)} onChange={() => toggleSaleSelection(sale.id)} aria-label={`Select ${sale.saleNumber}`} className="h-4 w-4 rounded border-[var(--app-border)] accent-[var(--app-primary)]" /></td><td className="whitespace-nowrap">{sale.saleDate}</td><td className="font-semibold tracking-wide">{sale.saleNumber}</td><td className="truncate font-medium">{sale.customerName || 'Walk-in customer'}</td><td><Badge variant="gray">{sale.source === 'DEAL' ? 'Deal' : sale.source === 'CLIENT' ? 'Client' : 'Walk-in'}</Badge></td><td className="text-center tabular-nums">{sale.items.length}</td><td className="text-right font-semibold tabular-nums">{formatCurrency(sale.total, currency)}</td><td><Badge variant={sale.paymentStatus === 'PAID' ? 'green' : sale.paymentStatus === 'PARTIAL' ? 'orange' : 'gray'}>{paymentLabel(sale.paymentStatus)}</Badge></td><td><div className="flex flex-wrap gap-1"><Badge variant={sale.status === 'VOIDED' ? 'red' : 'green'}>{sale.status === 'VOIDED' ? 'Voided' : 'Active'}</Badge>{view !== 'NORMAL' && <Badge variant="gray">{view === 'TRASH' ? 'Trash' : 'Archived'}</Badge>}</div></td><td className="whitespace-nowrap text-right"><div className="flex justify-end gap-0.5"><IconActionButton icon={<Eye size={15} />} label={`View ${sale.saleNumber}`} onClick={() => setSelectedSale(sale)} />{canManage && view === 'NORMAL' && <><IconActionButton icon={<Archive size={15} />} label={`Archive ${sale.saleNumber}`} onClick={() => setLifecycleTarget({ sale, action: 'archive' })} />{sale.status === 'ACTIVE' ? <IconActionButton icon={<Trash2 size={15} />} label={`Void ${sale.saleNumber}`} variant="danger" onClick={() => setVoidTarget(sale)} /> : <IconActionButton icon={<Trash2 size={15} />} label={`Move ${sale.saleNumber} to Trash`} variant="danger" onClick={() => setLifecycleTarget({ sale, action: 'trash' })} />}</>}{canManage && view === 'ARCHIVED' && <><IconActionButton icon={<RotateCcw size={15} />} label={`Restore ${sale.saleNumber}`} variant="success" onClick={() => setLifecycleTarget({ sale, action: 'restoreArchive' })} />{sale.status === 'ACTIVE' ? <IconActionButton icon={<Trash2 size={15} />} label={`Void ${sale.saleNumber}`} variant="danger" onClick={() => setVoidTarget(sale)} /> : <IconActionButton icon={<Trash2 size={15} />} label={`Move ${sale.saleNumber} to Trash`} variant="danger" onClick={() => setLifecycleTarget({ sale, action: 'trash' })} />}</>}{canManage && view === 'TRASH' && <IconActionButton icon={<RotateCcw size={15} />} label={`Restore ${sale.saleNumber} from Trash`} variant="success" onClick={() => void restoreFromTrash(sale)} />}</div></td></tr>)}</tbody></table></div><TablePagination page={safePage} pageSize={pageSize} totalCount={filtered.length} hasMore={hasMore} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} /></Card>}
    {hasMore && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMore()} disabled={loading}>{loading ? 'Loading…' : 'Load More Sales'}</Button></div>}
    {showRecord && user && currentOrganizationId && <RecordSaleModal user={user} organizationId={currentOrganizationId} currency={currency} defaultPaymentStatus={settings.salesDefaultPaymentStatus} defaultPaymentMethod={settings.salesDefaultPaymentMethod} onClose={() => setShowRecord(false)} onSubmit={submitRecord} />}
    {selectedSale && <SaleDetailsModal sale={selectedSale} currency={currency} canManage={canManage} deal={displayedSaleDeal} dealLoading={selectedSaleDealLoading} onClose={() => setSelectedSale(null)} onVoid={() => { setVoidTarget(selectedSale); setSelectedSale(null); }} />}
    {customizeKpis && <KpiCustomizationModal idPrefix="sales" ariaLabel="Customize Sales KPI cards" title="Customize Sales Cards" subtitle="Choose the sales metrics you want to see in your Sales Log." draftIds={salesKpiDraft} defaultIds={SALES_KPI_DEFAULTS} options={SALES_KPI_OPTIONS} categories={SALES_KPI_CATEGORIES} onDraftChange={(ids) => setSalesKpiDraft(ids)} onClose={() => setCustomizeKpis(false)} onSave={(ids) => { setSalesKpiIds(ids); writeKpiPreference(window.localStorage, 'bsm_sales_kpis_v1', ids); setCustomizeKpis(false); }} />}
    <ConfirmActionDialog open={!!voidTarget} title="Void sale?" description="This keeps the transaction for your records and removes it from active Sales totals. This cannot be undone." confirmLabel="Void Sale" variant="danger" loading={voiding} onCancel={() => setVoidTarget(null)} onConfirm={() => void confirmVoid()} />
    <ConfirmActionDialog open={!!lifecycleTarget} title={lifecycleTarget?.action === 'archive' ? 'Archive sale?' : lifecycleTarget?.action === 'trash' ? 'Move voided sale to Trash?' : 'Restore archived sale?'} description={lifecycleTarget?.action === 'archive' ? 'It will be hidden from the normal Sales list but will remain included in Sales totals.' : lifecycleTarget?.action === 'trash' ? 'The transaction will remain stored as a voided historical record and can be restored.' : 'This restores the record to the normal Sales list without changing its financial status.'} confirmLabel={lifecycleTarget?.action === 'archive' ? 'Archive Sale' : lifecycleTarget?.action === 'trash' ? 'Move to Trash' : 'Restore Sale'} variant={lifecycleTarget?.action === 'trash' ? 'danger' : lifecycleTarget?.action === 'archive' ? 'warning' : 'default'} loading={lifecycleBusy} onCancel={() => setLifecycleTarget(null)} onConfirm={() => void confirmLifecycle()} />
  </main>;
}

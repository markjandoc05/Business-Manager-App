import { count, doc, getAggregateFromServer, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, sum, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';
import { requireOrganizationAccess } from '@/lib/permissions';
import { createSaleNumber, normalizeSaleDate, normalizeSalePayment } from '@/lib/sale-workflow';
import { getSaleItemsTotal, normalizeSaleLineItems, readSaleLineItems } from '@/lib/sale-items';
import type { AppUser } from '@/types/auth';
import type { Sale, SaleCustomerType, SaleLineItem, SalePaymentMethod, SalePaymentStatus, SaleSource } from '@/types';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';

export const SALES_PAGE_SIZE = 25;

export type SalesListFilters = {
  dateFrom: string;
  dateTo: string;
  customerType?: SaleCustomerType;
  source?: SaleSource;
  paymentStatus?: SalePaymentStatus;
  view?: 'NORMAL' | 'ARCHIVED' | 'TRASH';
  search?: string;
};

export type ClientSalesListFilters = {
  source?: SaleSource;
  paymentStatus?: SalePaymentStatus;
  status?: Sale['status'];
};

export type CreateSaleInput = {
  saleDate: string;
  customerType: SaleCustomerType;
  source?: SaleSource;
  customerName?: string;
  clientId?: string;
  dealId?: string;
  items: SaleLineItem[];
  paymentStatus: SalePaymentStatus;
  paymentMethod?: SalePaymentMethod;
  amountPaid?: number;
  notes?: string;
};

export function salesViewMatches(sale: Pick<Sale, 'archived' | 'trashed'>, view: NonNullable<SalesListFilters['view']>) {
  return view === 'TRASH' ? sale.trashed : view === 'ARCHIVED' ? sale.archived && !sale.trashed : !sale.archived && !sale.trashed;
}

function clientSaleMatches(sale: Sale, filters?: ClientSalesListFilters) {
  return (!filters?.source || sale.source === filters.source)
    && (!filters?.paymentStatus || sale.paymentStatus === filters.paymentStatus)
    && (!filters?.status || sale.status === filters.status);
}

function toIso(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function optionalIso(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : undefined;
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

function mapSale(id: string, data: Record<string, unknown>): Sale {
  const items = readSaleLineItems(data.items);
  const subtotal = typeof data.subtotal === 'number' && Number.isFinite(data.subtotal) ? data.subtotal : getSaleItemsTotal(items);
  const total = typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : subtotal;
  const paymentStatus: SalePaymentStatus = data.paymentStatus === 'PAID' || data.paymentStatus === 'PARTIAL' ? data.paymentStatus : 'UNPAID';
  const amountPaid = typeof data.amountPaid === 'number' && Number.isFinite(data.amountPaid) ? data.amountPaid : 0;
  return {
    id,
    saleNumber: text(data.saleNumber) || `S-${id.slice(0, 10).toUpperCase()}`,
    saleDate: text(data.saleDate),
    customerType: data.customerType === 'CLIENT' ? 'CLIENT' : 'WALK_IN',
    source: data.source === 'DEAL' ? 'DEAL' : data.customerType === 'CLIENT' ? 'CLIENT' : 'WALK_IN',
    customerName: text(data.customerName),
    clientId: text(data.clientId) || undefined,
    dealId: text(data.dealId) || undefined,
    items,
    subtotal,
    total,
    paymentStatus,
    paymentMethod: ['CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'CARD', 'OTHER'].includes(data.paymentMethod as string) ? data.paymentMethod as SalePaymentMethod : undefined,
    amountPaid,
    balance: typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : Math.max(0, total - amountPaid),
    notes: text(data.notes) || undefined,
    status: data.status === 'VOIDED' ? 'VOIDED' : 'ACTIVE',
    voidedAt: optionalIso(data.voidedAt),
    voidedBy: text(data.voidedBy) || undefined,
    voidReason: text(data.voidReason) || undefined,
    archived: data.archived === true,
    archivedAt: optionalIso(data.archivedAt),
    archivedBy: text(data.archivedBy) || undefined,
    trashed: data.trashed === true,
    trashedAt: optionalIso(data.trashedAt),
    trashedBy: text(data.trashedBy) || undefined,
    createdAt: toIso(data.createdAt),
    createdBy: text(data.createdBy),
    updatedAt: toIso(data.updatedAt),
    updatedBy: text(data.updatedBy),
  };
}

async function requireSalesManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
}

function nextSaleNumber(documentId: string, settings: Record<string, unknown>, sequence: Record<string, unknown>, transaction: { set: (ref: ReturnType<typeof organizationDocumentInCollection>, data: Record<string, unknown>, options?: { merge?: boolean }) => void }, sequenceRef: ReturnType<typeof organizationDocumentInCollection>, uid: string) {
  if (settings.salesReferenceMode !== 'SEQUENTIAL') return createSaleNumber(documentId);
  const prefix = typeof settings.salesReferencePrefix === 'string' ? settings.salesReferencePrefix : 'SALE-';
  const starting = typeof settings.salesReferenceStartingNumber === 'number' && settings.salesReferenceStartingNumber >= 1 ? Math.floor(settings.salesReferenceStartingNumber) : 1;
  const digits = typeof settings.salesReferenceDigits === 'number' && settings.salesReferenceDigits >= 1 && settings.salesReferenceDigits <= 12 ? Math.floor(settings.salesReferenceDigits) : 6;
  const current = typeof sequence.nextNumber === 'number' && sequence.nextNumber >= starting ? Math.floor(sequence.nextNumber) : starting;
  transaction.set(sequenceRef, { nextNumber: current + 1, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
  return `${prefix}${String(current).padStart(digits, '0')}`;
}

export async function listSalesPage(user: AppUser | null, organizationId: string, filters: SalesListFilters, cursor: FirestoreCursor = null, pageSize = SALES_PAGE_SIZE): Promise<PageResult<Sale>> {
  await requireOrganizationAccess(user, organizationId);
  const dateFrom = normalizeSaleDate(filters.dateFrom);
  const dateTo = normalizeSaleDate(filters.dateTo);
  if (dateFrom > dateTo) throw new Error('The start date cannot be after the end date.');
  const view = filters.view || 'NORMAL';
  const searchTerm = filters.search?.trim().toLowerCase() || '';
  const constraints = [where('saleDate', '>=', dateFrom), where('saleDate', '<=', dateTo)];
  if (filters.customerType) constraints.push(where('customerType', '==', filters.customerType));
  if (filters.source) constraints.push(where('source', '==', filters.source));
  if (filters.paymentStatus) constraints.push(where('paymentStatus', '==', filters.paymentStatus));
  const salesCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'sales');
  const pageLimit = Math.max(1, Math.floor(pageSize));
  const scanLimit = 20;
  const matchingSales: Sale[] = [];
  const matchingCursors: FirestoreCursor[] = [];
  let scanCursor = cursor;
  let lastRawCursor: FirestoreCursor = null;
  let exhausted = false;

  // Lifecycle fields were added after the first Sales records existed. A
  // Firestore predicate on archived/trashed would exclude those legacy
  // documents because missing fields do not match false. Scan ordered,
  // bounded pages and filter the selected view while keeping the cursor on
  // the last returned match. This fills the requested page without an
  // unbounded collection read and keeps legacy Normal Sales visible.
  for (let page = 0; page < scanLimit && matchingSales.length <= pageLimit; page += 1) {
    const salesQuery = query(salesCollection, ...constraints, orderBy('saleDate', 'desc'), orderBy('createdAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageLimit));
    const snapshot = await getDocs(salesQuery);
    if (snapshot.empty) { exhausted = true; break; }
    lastRawCursor = snapshot.docs.at(-1) || null;
    for (const saleDoc of snapshot.docs) {
      const sale = mapSale(saleDoc.id, saleDoc.data());
      const searchable = `${sale.saleNumber} ${sale.customerName}`.toLowerCase();
      if (salesViewMatches(sale, view) && (!searchTerm || searchable.includes(searchTerm))) {
        matchingSales.push(sale);
        matchingCursors.push(saleDoc);
        if (matchingSales.length > pageLimit) break;
      }
    }
    if (matchingSales.length > pageLimit) break;
    if (snapshot.docs.length < pageLimit) { exhausted = true; break; }
    scanCursor = lastRawCursor;
  }

  const items = matchingSales.slice(0, pageLimit);
  if (matchingSales.length > pageLimit) return { items, nextCursor: matchingCursors[pageLimit - 1] || null, hasMore: true };
  if (exhausted) return { items, nextCursor: null, hasMore: false };
  // The bounded safety cap was reached. Continue from the last returned
  // match (or the last scanned raw document when no match was found), and
  // conservatively expose another page rather than silently truncating data.
  return { items, nextCursor: matchingCursors[items.length - 1] || lastRawCursor, hasMore: true };
}

export const CLIENT_SALES_PAGE_SIZE = 25;

export async function listClientSalesPage(user: AppUser | null, organizationId: string, clientId: string, cursor: FirestoreCursor = null, pageSize = CLIENT_SALES_PAGE_SIZE, filters?: ClientSalesListFilters): Promise<PageResult<Sale>> {
  await requireOrganizationAccess(user, organizationId);
  const salesCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'sales');
  const pageLimit = Math.max(1, Math.floor(pageSize));
  const matchingSales: Sale[] = [];
  const matchingCursors: FirestoreCursor[] = [];
  let scanCursor = cursor;
  let lastRawCursor: FirestoreCursor = null;
  let exhausted = false;
  const scanLimit = 20;

  // Keep the clientId query as the canonical indexed predicate, then scan
  // bounded ordered pages so optional history filters apply to the full
  // history rather than only the first loaded page.
  for (let page = 0; page < scanLimit && matchingSales.length <= pageLimit; page += 1) {
    const salesQuery = query(salesCollection, where('clientId', '==', clientId), orderBy('saleDate', 'desc'), orderBy('createdAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageLimit));
    const snapshot = await getDocs(salesQuery);
    if (snapshot.empty) { exhausted = true; break; }
    lastRawCursor = snapshot.docs.at(-1) || null;
    for (const saleDoc of snapshot.docs) {
      const sale = mapSale(saleDoc.id, saleDoc.data());
      if (clientSaleMatches(sale, filters)) {
        matchingSales.push(sale);
        matchingCursors.push(saleDoc);
        if (matchingSales.length > pageLimit) break;
      }
    }
    if (matchingSales.length > pageLimit) break;
    if (snapshot.docs.length < pageLimit) { exhausted = true; break; }
    scanCursor = lastRawCursor;
  }

  const items = matchingSales.slice(0, pageLimit);
  if (matchingSales.length > pageLimit) return { items, nextCursor: matchingCursors[pageLimit - 1] || null, hasMore: true };
  if (exhausted) return { items, nextCursor: null, hasMore: false };
  return { items, nextCursor: matchingCursors[items.length - 1] || lastRawCursor, hasMore: true };
}

export async function getClientSalesSummary(user: AppUser | null, organizationId: string, clientId: string) {
  await requireOrganizationAccess(user, organizationId);
  const salesQuery = query(organizationCollection<Record<string, unknown>>(db, organizationId, 'sales'), where('clientId', '==', clientId), where('status', '==', 'ACTIVE'));
  const aggregate = await getAggregateFromServer(salesQuery, { total: sum('total'), transactionCount: count() });
  const data = aggregate.data();
  return { total: data.total || 0, transactionCount: data.transactionCount || 0 };
}

/** Reads the transaction lock first, with a legacy indexed-query fallback. */
export async function getActiveSaleForDeal(user: AppUser | null, organizationId: string, dealId: string): Promise<Sale | null> {
  await requireOrganizationAccess(user, organizationId);
  const lock = await getDoc(organizationDocumentInCollection(db, organizationId, 'dealSaleLocks', dealId));
  const lockData = lock.exists() ? lock.data() : null;
  if (lockData?.status === 'ACTIVE' && typeof lockData.saleId === 'string') {
    const sale = await getDoc(organizationDocumentInCollection(db, organizationId, 'sales', lockData.saleId));
    return sale.exists() && sale.data().status === 'ACTIVE' ? mapSale(sale.id, sale.data()) : null;
  }
  const legacy = await getDocs(query(organizationCollection<Record<string, unknown>>(db, organizationId, 'sales'), where('dealId', '==', dealId), limit(25)));
  const active = legacy.docs.find((saleDoc) => saleDoc.data().status === 'ACTIVE');
  return active ? mapSale(active.id, active.data()) : null;
}

export async function getSalesSummary(user: AppUser | null, organizationId: string, dateFromValue: string, dateToValue: string) {
  await requireOrganizationAccess(user, organizationId);
  const dateFrom = normalizeSaleDate(dateFromValue);
  const dateTo = normalizeSaleDate(dateToValue);
  if (dateFrom > dateTo) throw new Error('The start date cannot be after the end date.');
  const collection = organizationCollection<Record<string, unknown>>(db, organizationId, 'sales');
  const salesQuery = query(collection, where('status', '==', 'ACTIVE'), where('saleDate', '>=', dateFrom), where('saleDate', '<=', dateTo));
  const [aggregate, currentBalance] = await Promise.all([getAggregateFromServer(salesQuery, { transactionCount: count(), total: sum('total'), amountPaid: sum('amountPaid') }), getAggregateFromServer(query(collection, where('status', '==', 'ACTIVE')), { balance: sum('balance') })]);
  const data = aggregate.data();
  return {
    transactionCount: data.transactionCount || 0,
    total: data.total || 0,
    amountPaid: data.amountPaid || 0,
    balance: currentBalance.data().balance || 0,
  };
}

export async function getSalesKpiMetrics(user: AppUser | null, organizationId: string, dateFromValue: string, dateToValue: string, selectedKpiIds: readonly string[] = []) {
  await requireOrganizationAccess(user, organizationId);
  const dateFrom = normalizeSaleDate(dateFromValue);
  const dateTo = normalizeSaleDate(dateToValue);
  if (dateFrom > dateTo) throw new Error('The start date cannot be after the end date.');
  const collection = organizationCollection<Record<string, unknown>>(db, organizationId, 'sales');
  const activePeriod = query(collection, where('status', '==', 'ACTIVE'), where('saleDate', '>=', dateFrom), where('saleDate', '<=', dateTo));
  const activeCurrent = query(collection, where('status', '==', 'ACTIVE'));
  const [periodAggregate, currentAggregate] = await Promise.all([
    getAggregateFromServer(activePeriod, { transactionCount: count(), total: sum('total'), amountPaid: sum('amountPaid') }),
    getAggregateFromServer(activeCurrent, { balance: sum('balance') }),
  ]);
  const period = periodAggregate.data();
  const base = {
    transactionCount: period.transactionCount || 0,
    total: period.total || 0,
    amountPaid: period.amountPaid || 0,
    balance: currentAggregate.data().balance || 0,
  };
  const selected = new Set(selectedKpiIds);
  const countFor = (field: string, value: string) => getAggregateFromServer(query(activePeriod, where(field, '==', value)), { count: count() });
  const optionalCount = async (id: string, field: string, value: string) => {
    try { return [id, (await countFor(field, value)).data().count || 0] as const; }
    catch { return [id, null] as const; }
  };
  const paymentRequests = ([['paid', 'PAID'], ['partial', 'PARTIAL'], ['unpaid', 'UNPAID']] as const).filter(([id]) => selected.has(id)).map(([id, value]) => optionalCount(id, 'paymentStatus', value));
  const sourceRequests = ([['deal', 'DEAL'], ['client', 'CLIENT'], ['walkIn', 'WALK_IN']] as const).filter(([id]) => selected.has(id)).map(([id, value]) => optionalCount(id, 'source', value));
  const [paymentResults, sourceResults] = await Promise.all([Promise.all(paymentRequests), Promise.all(sourceRequests)]);
  const optionalCounts = new Map([...paymentResults, ...sourceResults]);
  return {
    ...base,
    average: base.transactionCount ? base.total / base.transactionCount : 0,
    paid: optionalCounts.get('paid') || 0,
    partial: optionalCounts.get('partial') || 0,
    unpaid: optionalCounts.get('unpaid') || 0,
    deal: optionalCounts.get('deal') || 0,
    client: optionalCounts.get('client') || 0,
    walkIn: optionalCounts.get('walkIn') || 0,
    unavailable: [...optionalCounts].filter(([, value]) => value === null).map(([id]) => id),
  };
}

export async function getSaleById(user: AppUser | null, organizationId: string, saleId: string) {
  await requireOrganizationAccess(user, organizationId);
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'sales', saleId));
  if (!snapshot.exists()) throw new Error('The sale could not be found.');
  return mapSale(snapshot.id, snapshot.data());
}

export async function createSale(user: AppUser | null, organizationId: string, input: CreateSaleInput) {
  await requireSalesManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to record a sale.');
  const saleDate = normalizeSaleDate(input.saleDate);
  const items = normalizeSaleLineItems(input.items);
  const total = getSaleItemsTotal(items);
  const payment = normalizeSalePayment(total, input.paymentStatus, input.paymentMethod, input.amountPaid);
  const customerType = input.customerType === 'CLIENT' ? 'CLIENT' : input.customerType === 'WALK_IN' ? 'WALK_IN' : null;
  if (!customerType) throw new Error('Choose a customer type.');
  let customerName = text(input.customerName);
  let clientId: string | null = null;
  if (customerType === 'CLIENT') {
    clientId = text(input.clientId);
    if (!clientId) throw new Error('Choose a client.');
    const client = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
    if (!client.exists() || client.data().trashed === true || client.data().archived === true || client.data().status === 'ARCHIVED') throw new Error('The selected client is not available.');
    customerName = text(client.data().name);
    if (!customerName) throw new Error('The selected client has no name.');
  }
  const source: SaleSource = input.source || (customerType === 'CLIENT' ? 'CLIENT' : 'WALK_IN');
  if (source === 'DEAL' && customerType !== 'CLIENT') throw new Error('Deal sales must be linked to a client.');
  const dealId = text(input.dealId);
  if (source === 'DEAL' && !dealId) throw new Error('The Deal reference is required.');
  if (source !== 'DEAL' && dealId) throw new Error('Only Deal sales may include a Deal reference.');
  const saleRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'sales'));
  const notes = text(input.notes);
  const baseSaleData = {
    saleDate, customerType, source, customerName, clientId,
    ...(dealId ? { dealId } : {}), items, subtotal: total, total, ...payment, paymentMethod: payment.paymentMethod || null, notes: notes || null, status: 'ACTIVE',
    archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null,
    createdAt: serverTimestamp(), createdBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid,
  };
  if (source === 'DEAL' && dealId) {
    const dealRef = organizationDocumentInCollection(db, organizationId, 'deals', dealId);
    const clientRef = organizationDocumentInCollection(db, organizationId, 'clients', clientId as string);
    const lockRef = organizationDocumentInCollection(db, organizationId, 'dealSaleLocks', dealId);
    await runTransaction(db, async (transaction) => {
      const settingsRef = organizationDocumentInCollection(db, organizationId, 'settings', 'settings');
      const sequenceRef = organizationDocumentInCollection(db, organizationId, 'settings', 'salesSequence');
      const settingsSnapshot = await transaction.get(settingsRef);
      const sequenceSnapshot = await transaction.get(sequenceRef);
      const dealSnapshot = await transaction.get(dealRef);
      const clientSnapshot = await transaction.get(clientRef);
      const lockSnapshot = await transaction.get(lockRef);
      if (!dealSnapshot.exists() || dealSnapshot.data().status !== 'Won' || dealSnapshot.data().stage !== 'Won') throw new Error('Only Won Deals can be recorded as Sales.');
      if (dealSnapshot.data().clientId !== clientId) throw new Error('The selected client does not match the Deal.');
      if (!clientSnapshot.exists() || clientSnapshot.data().archived === true || clientSnapshot.data().trashed === true || clientSnapshot.data().status === 'ARCHIVED') throw new Error('The Deal client is not available.');
      if (lockSnapshot.exists() && lockSnapshot.data().status === 'ACTIVE') throw new Error('An active Sale has already been recorded for this Deal.');
      const saleNumber = nextSaleNumber(saleRef.id, settingsSnapshot.exists() ? settingsSnapshot.data() : {}, sequenceSnapshot.exists() ? sequenceSnapshot.data() : {}, transaction, sequenceRef, user.uid);
      transaction.set(saleRef, { saleNumber, ...baseSaleData });
      transaction.set(lockRef, { dealId, saleId: saleRef.id, status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: user.uid });
    });
  } else {
    const settingsRef = organizationDocumentInCollection(db, organizationId, 'settings', 'settings');
    const sequenceRef = organizationDocumentInCollection(db, organizationId, 'settings', 'salesSequence');
    await runTransaction(db, async (transaction) => {
      const settingsSnapshot = await transaction.get(settingsRef);
      const sequenceSnapshot = await transaction.get(sequenceRef);
      const saleNumber = nextSaleNumber(saleRef.id, settingsSnapshot.exists() ? settingsSnapshot.data() : {}, sequenceSnapshot.exists() ? sequenceSnapshot.data() : {}, transaction, sequenceRef, user.uid);
      transaction.set(saleRef, { saleNumber, ...baseSaleData });
    });
  }
  return saleRef.id;
}

export async function voidSale(user: AppUser | null, organizationId: string, saleId: string, reason?: string) {
  await requireSalesManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to void a sale.');
  const saleRef = organizationDocumentInCollection(db, organizationId, 'sales', saleId);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(saleRef);
    if (!existing.exists()) throw new Error('The sale could not be found.');
    if (existing.data().status === 'VOIDED') throw new Error('This sale has already been voided.');
    const data = existing.data();
    const voidData = { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: user.uid, voidReason: text(reason) || null, updatedAt: serverTimestamp(), updatedBy: user.uid };
    if (data.source === 'DEAL' && typeof data.dealId === 'string') {
      const lockRef = organizationDocumentInCollection(db, organizationId, 'dealSaleLocks', data.dealId);
      const lock = await transaction.get(lockRef);
      if (lock.exists()) {
        const lockData = lock.data();
        if (lockData.status !== 'ACTIVE' || lockData.saleId !== saleId) throw new Error('The Deal Sale lock is not available for this Sale.');
        transaction.update(lockRef, { status: 'AVAILABLE', updatedAt: serverTimestamp(), updatedBy: user.uid });
      } else {
        // Historical Deal-linked Sales may predate dealSaleLocks. Creating the
        // AVAILABLE marker in the same transaction as the void preserves the
        // one-active-sale gate for all subsequent conversions.
        transaction.set(lockRef, { dealId: data.dealId, saleId, status: 'AVAILABLE', updatedAt: serverTimestamp(), updatedBy: user.uid });
      }
    }
    transaction.update(saleRef, voidData);
  });
}

async function getSaleForLifecycle(user: AppUser | null, organizationId: string, saleId: string) {
  await requireSalesManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to manage a sale.');
  const saleRef = organizationDocumentInCollection(db, organizationId, 'sales', saleId);
  const snapshot = await getDoc(saleRef);
  if (!snapshot.exists()) throw new Error('The sale could not be found.');
  return { saleRef, data: snapshot.data(), user };
}

export async function archiveSale(user: AppUser | null, organizationId: string, saleId: string) {
  const { saleRef, data, user: actor } = await getSaleForLifecycle(user, organizationId, saleId);
  if (data.trashed === true) throw new Error('Restore this Sale from Trash before archiving it.');
  if (data.archived === true) throw new Error('This Sale is already archived.');
  await updateDoc(saleRef, { archived: true, archivedAt: serverTimestamp(), archivedBy: actor.uid, trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: actor.uid });
}

export async function restoreSaleFromArchive(user: AppUser | null, organizationId: string, saleId: string) {
  const { saleRef, data, user: actor } = await getSaleForLifecycle(user, organizationId, saleId);
  if (data.trashed === true) throw new Error('Restore this Sale from Trash instead.');
  if (data.archived !== true) throw new Error('This Sale is not archived.');
  await updateDoc(saleRef, { archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: actor.uid });
}

export async function trashSale(user: AppUser | null, organizationId: string, saleId: string) {
  const { saleRef, data, user: actor } = await getSaleForLifecycle(user, organizationId, saleId);
  if (data.status !== 'VOIDED') throw new Error('This Sale is still active. Void the Sale before moving it to Trash.');
  if (data.trashed === true) throw new Error('This Sale is already in Trash.');
  await updateDoc(saleRef, { trashed: true, trashedAt: serverTimestamp(), trashedBy: actor.uid, updatedAt: serverTimestamp(), updatedBy: actor.uid });
}

export async function restoreSaleFromTrash(user: AppUser | null, organizationId: string, saleId: string) {
  const { saleRef, data, user: actor } = await getSaleForLifecycle(user, organizationId, saleId);
  if (data.status !== 'VOIDED') throw new Error('Invalid Sale lifecycle state: only voided Sales can be restored from Trash.');
  if (data.trashed !== true) throw new Error('This Sale is not in Trash.');
  await updateDoc(saleRef, { trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: actor.uid });
}

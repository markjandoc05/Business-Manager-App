import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebase-admin';
import { createSaleNumber, normalizeAdditionalSalePayment, normalizeSaleDate } from '@/lib/sale-workflow';

import { FinanceError, moneyCents, validateSaleRequest } from '@/lib/sale-validation';
export { FinanceError, financeId } from '@/lib/sale-validation';

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function requestFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((field) => !allowed.includes(field))) throw new FinanceError('Unexpected financial request fields.');
}

export async function requireFinanceAccess(transaction: Transaction, orgId: string, uid: string) {
  const organization = adminDb.doc(`organizations/${orgId}`);
  const [user, org, member, license] = await Promise.all([
    transaction.get(adminDb.doc(`users/${uid}`)), transaction.get(organization),
    transaction.get(organization.collection('members').doc(uid)), transaction.get(organization.collection('license').doc('current')),
  ]);
  const u = user.data() || {}; const o = org.data() || {}; const m = member.data() || {}; const l = license.data() || {};
  if (!user.exists || u.uid !== uid || u.status !== 'active' || (u.active !== undefined && u.active !== true) || !org.exists || !member.exists || m.userId !== uid || m.status !== 'active' || !['ADMIN', 'MANAGER'].includes(m.role)) throw new FinanceError('You are not allowed to manage financial records in this workspace.', 403);
  const expiry = l.status === 'TRIAL' ? l.trialEndsAt : l.subscriptionEndsAt;
  // Match existing business membership/mirror policy; a trial-to-paid root lifecycle mismatch is a separate Console issue.
  if (!['trial', 'active', 'expired', 'suspended'].includes(o.status) || o.licenseWriteEnabled !== true || !['TRIAL', 'ACTIVE'].includes(l.status) || o.licenseStatus !== l.status || !['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'].includes(l.plan) || !Number.isInteger(l.maxUsers) || l.maxUsers < 1 || !(expiry instanceof Timestamp) || expiry.toMillis() < Date.now() || !(o.licenseExpiresAt instanceof Timestamp) || o.licenseExpiresAt.toMillis() !== expiry.toMillis()) throw new FinanceError('Financial changes are unavailable for the current workspace license.', 409);
  return organization;
}

function operation(uid: string, key: string, body: unknown) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new FinanceError('A valid Idempotency-Key is required.');
  return { id: createHash('sha256').update(`${uid}:${key}`).digest('hex'), hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

function sameOperation(data: Record<string, unknown>, hash: string, uid: string) {
  if (data.requestHash !== hash || data.createdBy !== uid) throw new FinanceError('This request key was already used for different financial details.', 409);
}

export async function createSaleForOrganization(orgId: string, uid: string, body: Record<string, unknown>, key: string) {
  let input: ReturnType<typeof validateSaleRequest>;
  try { input = validateSaleRequest(body); } catch (error) { throw error instanceof FinanceError ? error : new FinanceError(error instanceof Error ? error.message : 'Invalid Sale data.'); }
  const op = operation(uid, key, input);
  const organization = adminDb.doc(`organizations/${orgId}`);
  const saleRef = organization.collection('sales').doc(op.id);
  return adminDb.runTransaction(async (transaction) => {
    await requireFinanceAccess(transaction, orgId, uid);
    const existing = await transaction.get(saleRef);
    if (existing.exists) { sameOperation(existing.data() || {}, op.hash, uid); return saleRef.id; }
    let customerName = input.customerName;
    if (input.clientId) {
      const client = await transaction.get(organization.collection('clients').doc(input.clientId));
      const data = client.data() || {};
      if (!client.exists || data.archived === true || data.trashed === true || data.status === 'ARCHIVED') throw new FinanceError('The selected Client is not available.', 409);
      customerName = text(data.name);
      if (!customerName) throw new FinanceError('The selected Client has no name.');
    }
    const lockRef = input.dealId ? organization.collection('dealSaleLocks').doc(input.dealId) : null;
    if (input.dealId && lockRef) {
      const [deal, lock, historicalActive] = await Promise.all([
        transaction.get(organization.collection('deals').doc(input.dealId)), transaction.get(lockRef),
        transaction.get(organization.collection('sales').where('dealId', '==', input.dealId).where('status', '==', 'ACTIVE').limit(1)),
      ]);
      const data = deal.data() || {};
      if (!deal.exists || data.status !== 'Won' || data.stage !== 'Won' || data.clientId !== input.clientId) throw new FinanceError('Only an available Won Deal with the matching Client can be recorded as a Sale.', 409);
      if (lock.data()?.status === 'ACTIVE' || !historicalActive.empty) throw new FinanceError('An active Sale has already been recorded for this Deal.', 409);
    }
    const settingsRef = organization.collection('settings').doc('settings');
    const sequenceRef = organization.collection('settings').doc('salesSequence');
    const [settingsSnapshot, sequenceSnapshot] = await Promise.all([transaction.get(settingsRef), transaction.get(sequenceRef)]);
    const settings = settingsSnapshot.data() || {}; const sequence = sequenceSnapshot.data() || {};
    let saleNumber = createSaleNumber(saleRef.id);
    if (settings.salesReferenceMode === 'SEQUENTIAL') {
      const starting = typeof settings.salesReferenceStartingNumber === 'number' && settings.salesReferenceStartingNumber >= 1 ? Math.floor(settings.salesReferenceStartingNumber) : 1;
      const next = typeof sequence.nextNumber === 'number' && sequence.nextNumber >= starting ? Math.floor(sequence.nextNumber) : starting;
      if (!Number.isSafeInteger(next) || !Number.isSafeInteger(next + 1)) throw new FinanceError('The sales reference sequence is invalid.', 409);
      const digits = typeof settings.salesReferenceDigits === 'number' && settings.salesReferenceDigits >= 1 && settings.salesReferenceDigits <= 12 ? Math.floor(settings.salesReferenceDigits) : 6;
      const prefix = typeof settings.salesReferencePrefix === 'string' ? settings.salesReferencePrefix : 'SALE-';
      saleNumber = `${prefix}${String(next).padStart(digits, '0')}`;
      transaction.set(sequenceRef, { nextNumber: next + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    }
    transaction.create(saleRef, { ...input, customerName, saleNumber, requestHash: op.hash, status: 'ACTIVE', archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, ...(input.amountPaid > 0 ? { lastPaymentId: 'opening' } : {}), createdAt: FieldValue.serverTimestamp(), createdBy: uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    if (input.amountPaid > 0) transaction.create(saleRef.collection('payments').doc('opening'), { saleId: saleRef.id, amount: input.amountPaid, method: input.paymentMethod, paymentDate: input.saleDate, notes: null, createdAt: FieldValue.serverTimestamp(), createdBy: uid });
    if (lockRef && input.dealId) transaction.set(lockRef, { dealId: input.dealId, saleId: saleRef.id, status: 'ACTIVE', updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    return saleRef.id;
  });
}

export async function recordPaymentForOrganization(orgId: string, uid: string, saleId: string, body: Record<string, unknown>, key: string) {
  requestFields(body, ['amount', 'method', 'paymentDate', 'notes']);
  if (moneyCents(body.amount) <= 0) throw new FinanceError('Payment amount must be greater than zero.');
  if (body.notes !== undefined && typeof body.notes !== 'string') throw new FinanceError('Notes must be text.');
  let paymentDate: string;
  try { paymentDate = normalizeSaleDate(body.paymentDate); } catch { throw new FinanceError('Payment date must be a valid calendar date.'); }
  const op = operation(uid, key, { amount: body.amount, method: body.method, paymentDate, notes: text(body.notes) || null });
  const saleRef = adminDb.doc(`organizations/${orgId}/sales/${saleId}`);
  const paymentRef = saleRef.collection('payments').doc(op.id);
  return adminDb.runTransaction(async (transaction) => {
    await requireFinanceAccess(transaction, orgId, uid);
    const [sale, previous] = await Promise.all([transaction.get(saleRef), transaction.get(paymentRef)]);
    if (!sale.exists) throw new FinanceError('The Sale could not be found.', 404);
    const data = sale.data() || {};
    if (previous.exists) { sameOperation(previous.data() || {}, op.hash, uid); return { paymentStatus: data.paymentStatus, paymentMethod: data.paymentMethod, amountPaid: data.amountPaid, balance: data.balance }; }
    if (data.status !== 'ACTIVE' || data.trashed === true) throw new FinanceError('Payments cannot be recorded for a voided or Trashed Sale.', 409);
    // Validate existing aggregate amounts without rewriting legacy items or fabricating opening receipts.
    moneyCents(data.total); moneyCents(data.amountPaid);
    let payment: ReturnType<typeof normalizeAdditionalSalePayment>;
    try { payment = normalizeAdditionalSalePayment(data.total, data.amountPaid, body.amount, body.method); } catch (error) { throw new FinanceError(error instanceof Error ? error.message : 'Invalid payment.'); }
    if (moneyCents(payment.amountPaid) !== moneyCents(data.amountPaid) + moneyCents(body.amount) || moneyCents(payment.balance) !== moneyCents(data.total) - moneyCents(payment.amountPaid)) throw new FinanceError('The Sale payment totals cannot be represented safely.', 409);
    const totals = { paymentStatus: payment.paymentStatus, paymentMethod: payment.method, amountPaid: payment.amountPaid, balance: payment.balance };
    transaction.create(paymentRef, { saleId, amount: payment.amount, method: payment.method, paymentDate, notes: text(body.notes) || null, requestHash: op.hash, createdAt: FieldValue.serverTimestamp(), createdBy: uid });
    transaction.update(saleRef, { ...totals, lastPaymentId: paymentRef.id, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    return totals;
  });
}

export async function deleteDealForOrganization(orgId: string, uid: string, dealId: string) {
  const organization = adminDb.doc(`organizations/${orgId}`);
  const dealRef = organization.collection('deals').doc(dealId);
  await adminDb.runTransaction(async (transaction) => {
    await requireFinanceAccess(transaction, orgId, uid);
    const [deal, sales, lock] = await Promise.all([
      transaction.get(dealRef), transaction.get(organization.collection('sales').where('dealId', '==', dealId).limit(1)),
      transaction.get(organization.collection('dealSaleLocks').doc(dealId)),
    ]);
    if (!deal.exists) throw new FinanceError('The Deal could not be found.', 404);
    if (deal.data()?.archived !== true) throw new FinanceError('Only archived Deals can be permanently deleted.', 409);
    if (!sales.empty || lock.exists) throw new FinanceError('This Deal has recorded financial history. Keep it archived to preserve its Sales and payment references.', 409);
    transaction.delete(dealRef);
  });
}

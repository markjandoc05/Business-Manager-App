import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/** Recheck in the deletion transaction, not only the earlier preview. Never cascade finance history. */
export async function assertClientFinancialRetention(transaction: Transaction, organization: DocumentReference, clientId: string) {
  const [sales, deals] = await Promise.all([
    transaction.get(organization.collection('sales').where('clientId', '==', clientId).limit(1)),
    transaction.get(organization.collection('deals').where('clientId', '==', clientId)),
  ]);
  if (!sales.empty || deals.docs.some((item) => {
    const data = item.data();
    return data.status === 'Won' || data.status === 'Lost' || (data.status === 'Active' && data.archived !== true);
  })) throw new Error('FINANCIAL_REFERENCES');
}

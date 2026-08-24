import { and, count, getAggregateFromServer, or, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection, organizationSubcollection } from '@/lib/organizations/paths';

export type ClientTabCounts = {
  deals: number;
  tasks: number;
  activities: number;
  notes: number;
  documents: number;
};

export async function countClientTabRecords(
  user: AppUser | null,
  organizationId: string,
  clientId: string,
  sourceLeadId?: string,
): Promise<ClientTabCounts> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const assignedToCurrentUser = membership.role === 'USER' && user?.uid
    ? [where('assignedToUid', '==', user.uid)]
    : [];

  const dealsQuery = query(
    organizationCollection(db, organizationId, 'deals'),
    where('clientId', '==', clientId),
    where('archived', '==', false),
    ...assignedToCurrentUser,
  );
  const tasksQuery = query(
    organizationCollection(db, organizationId, 'tasks'),
    where('relatedTo.type', '==', 'Client'),
    where('relatedTo.id', '==', clientId),
    where('archived', '==', false),
    ...assignedToCurrentUser,
  );

  const activitiesCollection = organizationCollection(db, organizationId, 'activities');
  const activityRelationship = sourceLeadId
    ? or(
      and(where('entityType', '==', 'Client'), where('entityId', '==', clientId)),
      and(where('entityType', '==', 'Lead'), where('entityId', '==', sourceLeadId)),
      where('metadata.clientId', '==', clientId),
    )
    : or(
      and(where('entityType', '==', 'Client'), where('entityId', '==', clientId)),
      where('metadata.clientId', '==', clientId),
    );
  const activitiesQuery = query(activitiesCollection, activityRelationship);
  const notesQuery = query(organizationSubcollection(db, organizationId, 'clients', clientId, 'notes'));
  const archivedNotesQuery = query(organizationSubcollection(db, organizationId, 'clients', clientId, 'notes'), where('archived', '==', true));
  const documentsQuery = query(organizationSubcollection(db, organizationId, 'clients', clientId, 'documents'));
  const archivedDocumentsQuery = query(organizationSubcollection(db, organizationId, 'clients', clientId, 'documents'), where('archived', '==', true));

  try {
    const [deals, tasks, activities, notes, archivedNotes, documents, archivedDocuments] = await Promise.all([
      getAggregateFromServer(dealsQuery, { count: count() }),
      getAggregateFromServer(tasksQuery, { count: count() }),
      getAggregateFromServer(activitiesQuery, { count: count() }),
      getAggregateFromServer(notesQuery, { count: count() }),
      getAggregateFromServer(archivedNotesQuery, { count: count() }),
      getAggregateFromServer(documentsQuery, { count: count() }),
      getAggregateFromServer(archivedDocumentsQuery, { count: count() }),
    ]);

    return {
      deals: deals.data().count,
      tasks: tasks.data().count,
      activities: activities.data().count,
      notes: Math.max(0, notes.data().count - archivedNotes.data().count),
      documents: Math.max(0, documents.data().count - archivedDocuments.data().count),
    };
  } catch (error) {
    console.error('Unable to count Client tab records', error);
    throw new Error('Unable to load Client record counts. Please try again.');
  }
}

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, updateDoc, where, writeBatch, type QueryConstraint } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Task } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { resolveAssignment } from '@/lib/ownership';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { addActivityToBatch } from '@/lib/repositories/activityEvents';

export const TASK_PAGE_SIZE = 25;
export type TaskListFilters = { status?: Task['status'] | 'All'; priority?: Task['priority'] | 'All'; due?: 'Today' | 'Upcoming' | 'Overdue' | 'All'; type?: Task['type'] | 'All' };

export type TaskInput = Pick<Task, 'title' | 'description' | 'type' | 'dueDate' | 'priority' | 'relatedTo' | 'assignedToUid' | 'assignedToName'>;

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function mapTask(id: string, data: Record<string, unknown>): Task {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    type: data.type === 'Task' ? 'Task' : 'Follow-up',
    dueDate: toIsoDate(data.dueDate),
    status: data.status === 'Completed' ? 'Completed' : 'Pending',
    priority: data.priority === 'High' || data.priority === 'Medium' ? data.priority : 'Low',
    relatedTo: data.relatedTo as Task['relatedTo'],
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    archived: data.archived === true,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    archivedAt: toIsoDate(data.archivedAt, ''),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireTaskManager(user: AppUser | null, organizationId: string, task?: Task) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (['ADMIN', 'MANAGER'].includes(membership.role)) return;
  if (membership.role === 'USER' && task?.assignedToUid === user?.uid) return;
  throw new Error('You do not have permission to manage this task.');
}

function reportFirestoreFailure(operation: string, error: unknown) {
  const firebaseError = error as { code?: string; message?: string };
  console.error(`[Firestore] tasks:${operation} failed code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
}

function taskPayload(input: TaskInput) {
  return {
    title: input.title.trim(),
    description: input.description?.trim() || '',
    type: input.type === 'Task' ? 'Task' : 'Follow-up',
    dueDate: input.dueDate,
    priority: input.priority,
    ...(input.relatedTo ? { relatedTo: input.relatedTo } : {}),
    assignedToUid: input.assignedToUid?.trim() || '',
    assignedToName: input.assignedToName?.trim() || '',
  };
}

async function requireRelatedRecords(organizationId: string, relatedTo: TaskInput['relatedTo']) {
  if (!relatedTo) return;
  const relatedRef = organizationDocumentInCollection(db, organizationId, `${relatedTo.type.toLowerCase()}s`, relatedTo.id);
  const snapshot = await getDoc(relatedRef);
  if (!snapshot.exists() || snapshot.data().archived === true || snapshot.data().status === 'ARCHIVED') throw new Error('The related record is not available in this organization.');
}

async function getOrganizationTask(organizationId: string, taskId: string) {
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'tasks', taskId));
  if (!snapshot.exists()) throw new Error('The task was not found.');
  return mapTask(snapshot.id, snapshot.data());
}

function taskFilterConstraints(filters: TaskListFilters = {}): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (filters.status && filters.status !== 'All') constraints.push(where('status', '==', filters.status));
  if (filters.type && filters.type !== 'All') constraints.push(where('type', '==', filters.type));
  if (filters.priority && filters.priority !== 'All') constraints.push(where('priority', '==', filters.priority));
  const now = new Date();
  if (filters.due === 'Today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    constraints.push(where('dueDate', '>=', start.toISOString()), where('dueDate', '<', end.toISOString()));
  } else if (filters.due === 'Upcoming') {
    constraints.push(where('dueDate', '>', now.toISOString()));
  } else if (filters.due === 'Overdue') {
    constraints.push(where('dueDate', '<', now.toISOString()));
  }
  return constraints;
}

export async function listTasksPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = TASK_PAGE_SIZE, filters: TaskListFilters = {}): Promise<PageResult<Task>> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  try {
    const tasksCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'tasks');
    const constraints: QueryConstraint[] = [where('archived', '==', false), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : []), ...taskFilterConstraints(filters), orderBy(filters.due && filters.due !== 'All' ? 'dueDate' : 'createdAt', filters.due && filters.due !== 'All' ? 'asc' : 'desc')];
    const tasksQuery = cursor ? query(tasksCollection, ...constraints, startAfter(cursor), limit(pageSize)) : query(tasksCollection, ...constraints, limit(pageSize));
    const snapshot = await getDocs(tasksQuery);
    const items = snapshot.docs
      .map((taskDoc) => mapTask(taskDoc.id, taskDoc.data()))
      .filter((task) => !task.archived);
    return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
  } catch (error) {
    reportFirestoreFailure('list', error);
    throw new Error(firestoreQueryErrorMessage(error, 'Unable to load tasks. Please try again.'));
  }
}

export async function listTasks(user: AppUser | null, organizationId: string) {
  return (await listTasksPage(user, organizationId)).items;
}

export async function createTask(user: AppUser | null, organizationId: string, input: TaskInput) {
  await requireTaskManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a task.');
  if (!input.title.trim() || !input.dueDate) throw new Error('Task title and due date are required.');
  await requireRelatedRecords(organizationId, input.relatedTo);

  try {
    const payload = { ...taskPayload(input), ...(await resolveAssignment(user, organizationId, input.assignedToUid, input.assignedToName)) };
    const taskRef = await addDoc(organizationCollection<Record<string, unknown>>(db, organizationId, 'tasks'), {
      ...payload,
      status: 'Pending',
      archived: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    const now = new Date().toISOString();
    return mapTask(taskRef.id, { ...payload, status: 'Pending', archived: false, createdAt: now, createdBy: user.uid, updatedAt: now, updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('create', error);
    throw new Error('Unable to create the task. Please try again.');
  }
}

export async function updateTask(user: AppUser | null, organizationId: string, taskId: string, input: TaskInput) {
  const existingTask = await getOrganizationTask(organizationId, taskId);
  await requireTaskManager(user, organizationId, existingTask);
  if (!user) throw new Error('You must be signed in to update a task.');
  if (!input.title.trim() || !input.dueDate) throw new Error('Task title and due date are required.');
  await requireRelatedRecords(organizationId, input.relatedTo);
  try {
    await updateDoc(organizationDocumentInCollection(db, organizationId, 'tasks', taskId), { ...taskPayload(input), updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('update', error);
    throw new Error('Unable to update the task. Please try again.');
  }
}

export async function completeTask(user: AppUser | null, organizationId: string, taskId: string, status: Task['status']) {
  const existingTask = await getOrganizationTask(organizationId, taskId);
  await requireTaskManager(user, organizationId, existingTask);
  if (!user) throw new Error('You must be signed in to update a task.');
  try {
    const batch = writeBatch(db);
    batch.update(organizationDocumentInCollection(db, organizationId, 'tasks', taskId), { status, updatedAt: serverTimestamp(), updatedBy: user.uid });
    if (status === 'Completed') addActivityToBatch(batch, organizationId, user, { type: 'task_completion', description: `Task Completed: ${existingTask.title}`, entityType: 'Task', entityId: taskId });
    await batch.commit();
  } catch (error) {
    reportFirestoreFailure('complete', error);
    throw new Error('Unable to update the task status. Please try again.');
  }
}

export async function archiveTask(user: AppUser | null, organizationId: string, taskId: string) {
  const existingTask = await getOrganizationTask(organizationId, taskId);
  await requireTaskManager(user, organizationId, existingTask);
  if (!user) throw new Error('You must be signed in to archive a task.');
  try {
    await updateDoc(organizationDocumentInCollection(db, organizationId, 'tasks', taskId), { archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('archive', error);
    throw new Error('Unable to archive the task. Please try again.');
  }
}

export async function listArchivedTasksPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = TASK_PAGE_SIZE): Promise<PageResult<Task>> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const tasksCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'tasks');
  const constraints = [where('archived', '==', true), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : []), orderBy('createdAt', 'desc'), limit(pageSize)] as const;
  const tasksQuery = cursor ? query(tasksCollection, ...constraints, startAfter(cursor)) : query(tasksCollection, ...constraints);
  const snapshot = await getDocs(tasksQuery);
  const items = snapshot.docs.map((taskDoc) => mapTask(taskDoc.id, taskDoc.data())).filter((task) => task.archived);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listArchivedTasks(user: AppUser | null, organizationId: string) {
  return (await listArchivedTasksPage(user, organizationId)).items;
}

export async function restoreTask(user: AppUser | null, organizationId: string, taskId: string) {
  const existingTask = await getOrganizationTask(organizationId, taskId);
  await requireTaskManager(user, organizationId, existingTask);
  if (!user) throw new Error('You must be signed in to restore a task.');
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'tasks', taskId), { archived: false, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function permanentlyDeleteTask(user: AppUser | null, organizationId: string, taskId: string) {
  const existingTask = await getOrganizationTask(organizationId, taskId);
  await requireTaskManager(user, organizationId, existingTask);
  if (!user) throw new Error('You must be signed in to delete a task.');
  const taskRef = organizationDocumentInCollection(db, organizationId, 'tasks', taskId);
  const snapshot = await getDoc(taskRef);
  if (!snapshot.exists() || snapshot.data().archived !== true) throw new Error('Only archived tasks can be permanently deleted.');
  await deleteDoc(taskRef);
}

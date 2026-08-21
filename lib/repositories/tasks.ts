import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Task } from '@/types';
import { canManageTasks, canViewBusinessData } from '@/lib/permissions';

export type TaskInput = Pick<Task, 'title' | 'description' | 'dueDate' | 'priority' | 'relatedTo' | 'assignedTo'>;

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
    dueDate: toIsoDate(data.dueDate),
    status: data.status === 'Completed' ? 'Completed' : 'Pending',
    priority: data.priority === 'High' || data.priority === 'Medium' ? data.priority : 'Low',
    relatedTo: data.relatedTo as Task['relatedTo'],
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : '',
    archived: data.archived === true,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to business data.');
}

function requireTaskManager(user: AppUser | null) {
  if (!canManageTasks(user)) throw new Error('You do not have permission to manage tasks.');
}

function reportFirestoreFailure(operation: string, error: unknown) {
  const firebaseError = error as { code?: string; message?: string };
  console.error(`[Firestore] tasks:${operation} failed code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
}

function taskPayload(input: TaskInput) {
  return {
    title: input.title.trim(),
    description: input.description?.trim() || '',
    dueDate: input.dueDate,
    priority: input.priority,
    ...(input.relatedTo ? { relatedTo: input.relatedTo } : {}),
    assignedTo: input.assignedTo?.trim() || '',
  };
}

export async function listTasks(user: AppUser | null) {
  requireActiveUser(user);
  try {
    const snapshot = await getDocs(collection(db, 'tasks'));
    return snapshot.docs
      .map((taskDoc) => mapTask(taskDoc.id, taskDoc.data()))
      .filter((task) => !task.archived)
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  } catch (error) {
    reportFirestoreFailure('list', error);
    throw new Error('Unable to load tasks. Please try again.');
  }
}

export async function createTask(user: AppUser | null, input: TaskInput) {
  requireTaskManager(user);
  if (!user) throw new Error('You must be signed in to create a task.');
  if (!input.title.trim() || !input.dueDate) throw new Error('Task title and due date are required.');

  try {
    const payload = taskPayload(input);
    const taskRef = await addDoc(collection(db, 'tasks'), {
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

export async function updateTask(user: AppUser | null, taskId: string, input: TaskInput) {
  requireTaskManager(user);
  if (!user) throw new Error('You must be signed in to update a task.');
  if (!input.title.trim() || !input.dueDate) throw new Error('Task title and due date are required.');
  try {
    await updateDoc(doc(db, 'tasks', taskId), { ...taskPayload(input), updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('update', error);
    throw new Error('Unable to update the task. Please try again.');
  }
}

export async function completeTask(user: AppUser | null, taskId: string, status: Task['status']) {
  requireTaskManager(user);
  if (!user) throw new Error('You must be signed in to update a task.');
  try {
    await updateDoc(doc(db, 'tasks', taskId), { status, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('complete', error);
    throw new Error('Unable to update the task status. Please try again.');
  }
}

export async function archiveTask(user: AppUser | null, taskId: string) {
  requireTaskManager(user);
  if (!user) throw new Error('You must be signed in to archive a task.');
  try {
    await updateDoc(doc(db, 'tasks', taskId), { archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('archive', error);
    throw new Error('Unable to archive the task. Please try again.');
  }
}

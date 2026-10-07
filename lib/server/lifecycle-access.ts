/** Keep API previews within the same parent-read policy as the browser rules. */
export function canInspectLifecycleRecord(entity: 'Lead' | 'Client', role: string, uid: string, parent: Record<string, unknown>) {
  return ['ADMIN', 'MANAGER'].includes(role) || (role === 'USER' && (entity === 'Client' || parent.assignedToUid === uid));
}

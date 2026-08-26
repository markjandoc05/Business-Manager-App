import type { Lead } from '@/types';

export type LeadLifecycleState = 'ACTIVE' | 'ARCHIVED' | 'TRASHED';

export function getLeadLifecycleState(lead: Pick<Lead, 'archived' | 'trashed'>): LeadLifecycleState {
  if (lead.trashed === true) return 'TRASHED';
  if (lead.archived === true) return 'ARCHIVED';
  return 'ACTIVE';
}

export function isActiveLead(lead: Pick<Lead, 'archived' | 'trashed'>) {
  return getLeadLifecycleState(lead) === 'ACTIVE';
}

export function isArchivedLead(lead: Pick<Lead, 'archived' | 'trashed'>) {
  return getLeadLifecycleState(lead) === 'ARCHIVED';
}

export function isTrashedLead(lead: Pick<Lead, 'archived' | 'trashed'>) {
  return getLeadLifecycleState(lead) === 'TRASHED';
}

export function dedupeLeadsById(leads: Lead[]) {
  const unique = new Map<string, Lead>();
  leads.forEach((lead) => unique.set(lead.id, lead));
  return [...unique.values()];
}

export function classifyLeads(leads: Lead[]) {
  const uniqueLeads = dedupeLeadsById(leads);
  return {
    active: uniqueLeads.filter(isActiveLead),
    archived: uniqueLeads.filter(isArchivedLead),
    trashed: uniqueLeads.filter(isTrashedLead),
  };
}

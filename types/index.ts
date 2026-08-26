export type LeadStatus = 'New' | 'Follow-up' | 'Opportunity' | 'Client' | 'Lost';

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  status: LeadStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  trashed?: boolean;
  trashedAt?: string;
  trashedBy?: string;
  convertedClientId?: string;
  nextScheduledActivityAt?: string;
  nextScheduledActivityType?: LeadActivityType;
  nextScheduledActivityId?: string;
  lastActivityAt?: string;
  lastActivityType?: LeadActivityType;
  createdBy?: string;
  updatedBy?: string;
}

export type LeadTimelineEntryType = 'ACTIVITY' | 'NOTE' | 'SYSTEM';
export type LeadActivityType = 'Call' | 'Email' | 'Meeting' | 'Follow-up' | 'Message' | 'Other';
export type LeadActivityStatus = 'SCHEDULED' | 'COMPLETED';

export interface LeadTimelineEntry {
  id: string;
  leadId: string;
  entryType: LeadTimelineEntryType;
  activityType?: LeadActivityType;
  activityStatus?: LeadActivityStatus;
  content: string;
  occurredAt: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface Note {
  id: string;
  clientId: string;
  content: string;
  author: string;
  createdByUid?: string;
  createdByName?: string;
  createdAt: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  trashed?: boolean;
  trashedAt?: string;
  trashedBy?: string;
}

export interface DocumentItem {
  id: string;
  clientId: string;
  name: string;
  storagePath: string;
  downloadURL?: string;
  mimeType: string;
  size: number | string;
  uploadedAt: string;
  uploadedByUid?: string;
  uploadedByName?: string;
  /** @deprecated Read legacy metadata during the transition only. */
  uploadedBy?: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  notes?: Note[];
  documents?: DocumentItem[];
  createdAt: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  trashed?: boolean;
  trashedAt?: string;
  trashedBy?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  sourceLeadId?: string;
}

export interface Deal {
  id: string;
  title: string;
  clientId: string;
  value: number;
  stage: string;
  expectedCloseDate: string;
  productServiceName?: string;
  notes?: string;
  status: 'Active' | 'Won' | 'Lost';
  wonAt?: string;
  lostAt?: string;
  lossReason?: string;
  createdAt: string;
  leadId?: string;
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
}

export type DealTimelineEntryType = 'ACTIVITY' | 'NOTE' | 'SYSTEM';
export type DealActivityType = 'Call' | 'Email' | 'Meeting' | 'Follow-up' | 'Message' | 'Other';

export interface DealTimelineEntry {
  id: string;
  dealId: string;
  entryType: DealTimelineEntryType;
  activityType?: DealActivityType;
  content: string;
  occurredAt: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type?: 'Task' | 'Follow-up';
  dueDate: string;
  status: 'Pending' | 'Completed';
  priority: 'Low' | 'Medium' | 'High';
  relatedTo?: {
    type: 'Lead' | 'Client' | 'Deal';
    id: string;
  };
  assignedToUid?: string;
  assignedToName?: string;
  assignedTo?: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Activity {
  id: string;
  type: 'lead_creation' | 'task_creation' | 'task_update' | 'task_completion' | 'task_reopened' | 'task_archive' | 'task_restore' | 'stage_change' | 'client_conversion' | 'client_creation' | 'client_update' | 'client_archive' | 'client_restore' | 'deal_creation' | 'deal_update' | 'deal_won' | 'deal_lost' | 'deal_reopened' | 'deal_archive' | 'deal_restore' | 'note_creation' | 'note_update' | 'note_archive' | 'note_restore' | 'settings_update' | 'won_deal';
  description: string;
  entityType?: 'Lead' | 'Client' | 'Deal' | 'Task' | 'Note' | 'Settings';
  entityId?: string;
  createdAt: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  meta?: string;
}

export type BusinessType = 'Real Estate' | 'Insurance' | 'Agency' | 'Freelancer/Consultant' | 'Small Business' | 'Solo Entrepreneur' | 'Professional Services' | 'Retail' | 'Other';

export interface CustomField {
  id: string;
  name: string;
  type: 'Text' | 'Number' | 'Date' | 'Dropdown' | 'Checkbox';
  target: 'Lead' | 'Client';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'Administrator' | 'User';
  isActive: boolean;
}

export interface Settings {
  // Business Profile
  businessName: string;
  businessType: BusinessType;
  email: string;
  phone: string;
  website: string;
  address: string;
  currency: string;
  timezone: string;
  
  // Branding
  logoUrl?: string;
  accentColor: string;
  
  // Pipeline & Lead Sources
  pipelineStages: { name: string; isActive: boolean }[];
  leadSources: { name: string; isActive: boolean }[];
  
  // Custom Fields & Users
  customFields: CustomField[];
  users: User[];
  
  // License
  license?: {
    installationId: string;
    status: 'Active' | 'Expiring' | 'Expired' | 'Suspended';
    activationDate: string;
    expirationDate: string;
    licensedDomain: string;
    appVersion: string;
  };
}

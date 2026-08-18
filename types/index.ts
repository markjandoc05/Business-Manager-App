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
}

export interface Note {
  id: string;
  clientId: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  clientId: string;
  name: string;
  size: string;
  uploadedAt: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  assignedTo?: string;
  notes?: Note[];
  documents?: DocumentItem[];
  createdAt: string;
}

export interface Deal {
  id: string;
  title: string;
  clientId: string;
  value: number;
  stage: string;
  expectedCloseDate: string;
  status?: 'Active' | 'Won' | 'Lost';
  lossReason?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  status: 'Pending' | 'Completed';
  priority: 'Low' | 'Medium' | 'High';
  relatedTo?: {
    type: 'Lead' | 'Client' | 'Deal';
    id: string;
  };
}

export interface Activity {
  id: string;
  type: 'lead_creation' | 'task_completion' | 'stage_change' | 'client_conversion' | 'won_deal';
  description: string;
  timestamp: string;
  meta?: string;
}

export type BusinessType = 'Real Estate' | 'Insurance' | 'Agency' | 'Freelancer/Consultant' | 'Small Business' | 'Other';

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
  logo?: string;
  accentColor: string;
  
  // Pipeline & Lead Sources
  pipelineStages: { name: string; isActive: boolean }[];
  leadSources: { name: string; isActive: boolean }[];
  
  // Custom Fields & Users
  customFields: CustomField[];
  users: User[];
  
  // License
  license: {
    installationId: string;
    status: 'Active' | 'Expiring' | 'Expired' | 'Suspended';
    activationDate: string;
    expirationDate: string;
    licensedDomain: string;
    appVersion: string;
  };
}


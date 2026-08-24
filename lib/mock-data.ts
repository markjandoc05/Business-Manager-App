import { Lead, Deal, Task, Settings } from '../types';

export const mockSettings: Settings = {
  businessName: 'BSM Solutions',
  businessType: 'Small Business',
  email: 'hello@bsmsolutions.com',
  phone: '+1 555 123 4567',
  website: 'https://bsmsolutions.com',
  address: '123 Business St, Tech City',
  currency: 'USD',
  timezone: 'UTC',
  accentColor: '#3b82f6',
  pipelineStages: [
    { name: 'New', isActive: true },
    { name: 'Qualified', isActive: true },
    { name: 'Proposal', isActive: true },
    { name: 'Negotiation', isActive: true },
    { name: 'Won', isActive: true },
  ],
  leadSources: [
    { name: 'Website', isActive: true },
    { name: 'Referral', isActive: true },
    { name: 'LinkedIn', isActive: true },
  ],
  customFields: [],
  users: [],
  license: {
    installationId: 'bsm-789-xyz',
    status: 'Active',
    activationDate: '2026-01-01T00:00:00Z',
    expirationDate: '2027-01-01T00:00:00Z',
    licensedDomain: 'bsmsolutions.com',
    appVersion: '1.0.0',
  },
};

export const mockLeads: Lead[] = [
  {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1 234 567 8900',
    company: 'Tech Corp',
    status: 'New',
    source: 'Website',
    createdAt: '2026-08-10T10:00:00Z',
    updatedAt: '2026-08-10T10:00:00Z',
  },
  {
    id: '2',
    name: 'Jane Smith',
    email: 'jane@smith.com',
    phone: '+1 987 654 3210',
    company: 'Creative Studio',
    status: 'Follow-up',
    source: 'LinkedIn',
    createdAt: '2026-08-12T14:30:00Z',
    updatedAt: '2026-08-13T09:00:00Z',
  },
  {
    id: '3',
    name: 'Robert Brown',
    email: 'robert@brown.biz',
    phone: '+1 555 0123',
    status: 'Opportunity',
    source: 'Referral',
    createdAt: '2026-08-15T11:20:00Z',
    updatedAt: '2026-08-16T16:45:00Z',
  },
];

export const mockDeals: Deal[] = [
  {
    id: 'd1',
    title: 'Consulting Phase 1',
    clientId: 'c1',
    value: 5000,
    stage: 'Won',
    status: 'Won',
    expectedCloseDate: '2026-08-25',
    createdAt: '2026-08-01T10:00:00Z',
  },
  {
    id: 'd2',
    title: 'System Implementation',
    clientId: 'c1',
    value: 10000,
    stage: 'New',
    status: 'Active',
    expectedCloseDate: '2026-09-15',
    createdAt: '2026-08-05T12:00:00Z',
  },
];

export const mockTasks: Task[] = [
  {
    id: 't1',
    title: 'Call John Doe',
    description: 'Discuss the new proposal',
    dueDate: '2026-08-18T14:00:00Z',
    status: 'Pending',
    priority: 'High',
    relatedTo: { type: 'Lead', id: '1' },
  },
  {
    id: 't2',
    title: 'Send invoice to Alice',
    dueDate: '2026-08-19T10:00:00Z',
    status: 'Pending',
    priority: 'Medium',
    relatedTo: { type: 'Client', id: 'c1' },
  },
];

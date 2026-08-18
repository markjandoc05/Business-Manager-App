import { Lead, Client, Deal, Task, Settings, Activity } from '../types';

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
    { name: 'Lead', isActive: true },
    { name: 'Contacted', isActive: true },
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
  users: [
    { id: 'u1', name: 'Admin User', email: 'admin@bsm.com', role: 'Administrator', isActive: true }
  ],
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

export const mockClients: Client[] = [
  {
    id: 'c1',
    name: 'Alice Johnson',
    email: 'alice@client.com',
    phone: '+1 444 888 2222',
    company: 'Global Logistics',
    assignedTo: 'Sarah Jenkins',
    notes: [
      { id: 'n1', clientId: 'c1', content: 'Initial briefing completed successfully.', author: 'Sarah Jenkins', createdAt: '2026-06-01T10:00:00Z' }
    ],
    documents: [
      { id: 'd1', clientId: 'c1', name: 'Service_Agreement_v1.pdf', size: '2.4 MB', uploadedAt: '2026-06-02T11:00:00Z' }
    ],
    createdAt: '2026-01-20T08:00:00Z',
  },
  {
    id: 'c2',
    name: 'Michael Scott',
    email: 'mscott@dundermifflin.com',
    phone: '+1 570 555 0199',
    company: 'Dunder Mifflin',
    assignedTo: 'Dwight Schrute',
    notes: [
      { id: 'n2', clientId: 'c2', content: 'Discussed paper supply contract renewal.', author: 'Dwight Schrute', createdAt: '2026-07-10T14:00:00Z' }
    ],
    documents: [],
    createdAt: '2026-03-15T09:30:00Z',
  },
];

export const mockDeals: Deal[] = [
  {
    id: 'd1',
    title: 'Consulting Phase 1',
    clientId: 'c1',
    value: 5000,
    stage: 'Won',
    expectedCloseDate: '2026-08-25',
    createdAt: '2026-08-01T10:00:00Z',
  },
  {
    id: 'd2',
    title: 'System Implementation',
    clientId: 'c1',
    value: 10000,
    stage: 'Opportunity',
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

export const mockActivities: Activity[] = [
  {
    id: 'a1',
    type: 'lead_creation',
    description: 'Lead added: John Doe (Tech Corp)',
    timestamp: '2026-08-10T10:00:00Z',
  },
  {
    id: 'a2',
    type: 'won_deal',
    description: 'Deal Won: Consulting Phase 1',
    timestamp: '2026-08-01T10:00:00Z',
    meta: '+$5,000',
  },
  {
    id: 'a3',
    type: 'task_completion',
    description: 'Task Completed: Initial briefing call',
    timestamp: '2026-08-15T09:30:00Z',
  },
];


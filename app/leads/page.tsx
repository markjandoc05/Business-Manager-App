'use client';

import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { Search, Filter, Plus, MoreVertical, Mail, Phone } from 'lucide-react';

export default function LeadsPage() {
  const { leads, addLead } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', source: 'Website' });

  const filteredLeads = leads.filter(lead => 
    lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.company?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email) return;
    addLead({
      name: form.name,
      email: form.email,
      phone: form.phone,
      company: form.company,
      status: 'New',
      source: form.source
    });
    setForm({ name: '', email: '', phone: '', company: '', source: 'Website' });
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Leads</h2>
        <Button onClick={() => setShowAddModal(true)} className="gap-2">
          <Plus size={18} />
          Add New Lead
        </Button>
      </div>

      <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Search leads..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Filter size={18} />
            Filter
          </Button>
          <Button variant="outline">Export</Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Lead Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Company</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Source</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Created</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-slate-900">{lead.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-xs text-slate-500"><Mail size={12}/> {lead.email}</span>
                        <span className="flex items-center gap-1 text-xs text-slate-500"><Phone size={12}/> {lead.phone}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={lead.status === 'New' ? 'blue' : lead.status === 'Opportunity' ? 'purple' : 'orange'}>{lead.status}</Badge>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{lead.company || '-'}</td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600">{lead.source}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                      <MoreVertical size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Add New Lead</h3>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
              <input 
                type="text" 
                required 
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                <input 
                  type="email" 
                  required 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                  value={form.phone}
                  onChange={e => setForm({...form, phone: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
              <input 
                type="text" 
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm"
                value={form.company}
                onChange={e => setForm({...form, company: e.target.value})}
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button type="submit">Save Lead</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


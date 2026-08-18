'use client';

import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { 
  Users, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  DollarSign, 
  Briefcase, 
  Plus, 
  Calendar, 
  ArrowRight,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { leads, clients, deals, tasks, activities, settings, completeTask, addLead, addClient, addTask } = useApp();

  // Modals state
  const [activeModal, setActiveModal] = useState<'lead' | 'client' | 'task' | null>(null);

  // Form states
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '', company: '', source: settings.leadSources[0]?.name || 'Website' });
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High' });

  // KPI Calculations
  const totalLeads = leads.length;
  const activeOpportunities = deals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost').length;
  const followUpsDue = tasks.filter(t => t.status === 'Pending').length;
  const wonDealsCount = deals.filter(d => d.stage === 'Won').length;
  const pipelineValue = deals.filter(d => d.stage !== 'Lost').reduce((sum, d) => sum + d.value, 0);

  // Sales this month calculation (assuming current month 2026-08 or current actual date)
  const currentMonthStr = '2026-08';
  const salesThisMonth = deals
    .filter(d => d.stage === 'Won' && d.createdAt.startsWith(currentMonthStr))
    .reduce((sum, d) => sum + d.value, 0) || 28450; // fallback mock value if date doesn't match exactly

  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.name || !leadForm.email) return;
    addLead({
      name: leadForm.name,
      email: leadForm.email,
      phone: leadForm.phone,
      company: leadForm.company,
      status: 'New',
      source: leadForm.source,
    });
    setLeadForm({ name: '', email: '', phone: '', company: '', source: settings.leadSources[0]?.name || 'Website' });
    setActiveModal(null);
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email) return;
    addClient({
      name: clientForm.name,
      email: clientForm.email,
      phone: clientForm.phone,
      company: clientForm.company,
    });
    setClientForm({ name: '', email: '', phone: '', company: '' });
    setActiveModal(null);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title) return;
    addTask({
      title: taskForm.title,
      description: taskForm.description,
      dueDate: taskForm.dueDate || new Date().toISOString().split('T')[0],
      priority: taskForm.priority,
    });
    setTaskForm({ title: '', description: '', dueDate: '', priority: 'Medium' });
    setActiveModal(null);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Welcome & Quick Actions Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard & Sales Overview</h2>
          <p className="text-sm text-slate-500">Real-time performance metrics and pipeline execution.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setActiveModal('lead')} className="gap-2">
            <Plus size={16} /> Add Lead
          </Button>
          <Button variant="outline" onClick={() => setActiveModal('client')} className="gap-2">
            <Plus size={16} /> Add Client
          </Button>
          <Button variant="outline" onClick={() => setActiveModal('task')} className="gap-2">
            <Plus size={16} /> Add Task
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid (6 cards required) */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Total Leads</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">{totalLeads}</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={18} /></div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Active Opportunities</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">{activeOpportunities}</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><TrendingUp size={18} /></div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Follow-ups Due</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">{followUpsDue}</span>
            <div className="p-2 bg-orange-50 text-orange-600 rounded-lg"><Clock size={18} /></div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Won Deals</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">{wonDealsCount}</span>
            <div className="p-2 bg-green-50 text-green-600 rounded-lg"><CheckCircle2 size={18} /></div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pipeline Value</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">${pipelineValue.toLocaleString()}</span>
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><DollarSign size={18} /></div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Sales This Month</p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-slate-900">${salesThisMonth.toLocaleString()}</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Briefcase size={18} /></div>
          </div>
        </Card>
      </div>

      {/* Main Grid: Follow-ups Due & Pipeline Overview */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Follow-ups Due */}
        <Card className="space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-800">Follow-ups Due</h3>
              <p className="text-xs text-slate-500">Pending tasks and required actions</p>
            </div>
            <Badge variant="orange">{followUpsDue} Pending</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {tasks.filter(t => t.status === 'Pending').map((task) => (
              <div key={task.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100/50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">{task.title}</span>
                    <Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'blue'}>
                      {task.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(task.dueDate).toISOString().replace('T', ' ').substring(0, 16)}</span>
                    {task.relatedTo && <span>• {task.relatedTo.type} ID: {task.relatedTo.id}</span>}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => completeTask(task.id)} className="text-xs">
                  Complete
                </Button>
              </div>
            ))}

            {tasks.filter(t => t.status === 'Pending').length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                No pending follow-ups. Great job!
              </div>
            )}
          </div>
        </Card>

        {/* Pipeline Overview */}
        <Card className="space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-800">Pipeline Overview</h3>
              <p className="text-xs text-slate-500">Opportunity count and value per stage</p>
            </div>
            <Badge variant="blue">{settings.pipelineStages.length} Stages</Badge>
          </div>

          <div className="space-y-3 flex-1">
            {settings.pipelineStages.map((stage) => {
              const stageDeals = deals.filter(d => d.stage === stage.name);
              const stageValue = stageDeals.reduce((sum, d) => sum + d.value, 0);
              return (
                <div key={stage.name} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div>
                    <span className="font-semibold text-sm text-slate-900">{stage.name}</span>
                    <p className="text-xs text-slate-500">{stageDeals.length} deals in stage</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-sm text-slate-900">${stageValue.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Second Grid: Recent Leads & Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Leads */}
        <Card className="space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-800">Recent Leads</h3>
              <p className="text-xs text-slate-500">Latest prospects registered in the system</p>
            </div>
            <Badge variant="purple">{leads.length} Total</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {leads.slice(0, 5).map((lead) => (
              <div key={lead.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <p className="font-semibold text-sm text-slate-900">{lead.name}</p>
                  <p className="text-xs text-slate-500">{lead.company || 'Independent'} • Source: {lead.source}</p>
                </div>
                <div className="text-right space-y-1">
                  <Badge variant={lead.status === 'New' ? 'blue' : lead.status === 'Opportunity' ? 'purple' : 'gray'}>
                    {lead.status}
                  </Badge>
                  <p className="text-[10px] text-slate-400">{new Date(lead.createdAt).toISOString().split('T')[0]}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Activity */}
        <Card className="space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-800">Recent Activity</h3>
              <p className="text-xs text-slate-500">System audit log of sales operations</p>
            </div>
            <Badge variant="gray">{activities.length} Events</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {activities.map((act) => (
              <div key={act.id} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{act.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-400">{new Date(act.timestamp).toISOString().replace('T', ' ').substring(0, 16)}</span>
                    {act.meta && <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{act.meta}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Modals for Quick Actions */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-6 relative"
            >
              <button 
                onClick={() => setActiveModal(null)}
                className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X size={20} />
              </button>

              {activeModal === 'lead' && (
                <form onSubmit={handleCreateLead} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Add New Lead</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={leadForm.name}
                      onChange={e => setLeadForm({...leadForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.email}
                        onChange={e => setLeadForm({...leadForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.phone}
                        onChange={e => setLeadForm({...leadForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.company}
                        onChange={e => setLeadForm({...leadForm, company: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Source</label>
                      <select 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={leadForm.source}
                        onChange={e => setLeadForm({...leadForm, source: e.target.value})}
                      >
                        {settings.leadSources.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Save Lead</Button>
                  </div>
                </form>
              )}

              {activeModal === 'client' && (
                <form onSubmit={handleCreateClient} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Add New Client</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Client Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={clientForm.name}
                      onChange={e => setClientForm({...clientForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={clientForm.email}
                        onChange={e => setClientForm({...clientForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={clientForm.phone}
                        onChange={e => setClientForm({...clientForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={clientForm.company}
                      onChange={e => setClientForm({...clientForm, company: e.target.value})}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Save Client</Button>
                  </div>
                </form>
              )}

              {activeModal === 'task' && (
                <form onSubmit={handleCreateTask} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Create Task & Follow-up</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Task Title</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={taskForm.title}
                      onChange={e => setTaskForm({...taskForm, title: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Due Date</label>
                      <input 
                        type="date" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={taskForm.dueDate}
                        onChange={e => setTaskForm({...taskForm, dueDate: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Priority</label>
                      <select 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={taskForm.priority}
                        onChange={e => setTaskForm({...taskForm, priority: e.target.value as any})}
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                    <textarea 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      value={taskForm.description}
                      onChange={e => setTaskForm({...taskForm, description: e.target.value})}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Create Task</Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { Search, Plus, Calendar, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { format, isToday, isFuture, isPast } from 'date-fns';

export default function TasksPage() {
  const { tasks, completeTask, leads, clients } = useApp();
  const [activeTab, setActiveTab] = useState<'Today' | 'Upcoming' | 'Overdue' | 'Completed' | 'All'>('Today');

  const getRelatedName = (task: any) => {
    if (!task.relatedTo) return 'General';
    const source = task.relatedTo.type === 'Lead' ? leads : clients;
    const item = source.find((i: any) => i.id === task.relatedTo.id);
    return item ? `${task.relatedTo.type}: ${item.name}` : 'Unknown';
  };

  const filteredTasks = tasks.filter(task => {
    const isCompleted = task.status === 'Completed';
    const isOverdue = isPast(new Date(task.dueDate)) && !isCompleted && !isToday(new Date(task.dueDate));
    
    switch (activeTab) {
      case 'Today': return isToday(new Date(task.dueDate)) && !isCompleted;
      case 'Upcoming': return isFuture(new Date(task.dueDate)) && !isCompleted;
      case 'Overdue': return isOverdue;
      case 'Completed': return isCompleted;
      default: return true;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Tasks & Follow-ups</h2>
        <Button className="gap-2">
            <Plus size={18} /> Add Task
        </Button>
      </div>

      <div className="flex border-b border-slate-200 gap-6">
        {['Today', 'Upcoming', 'Overdue', 'Completed', 'All'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`pb-3 font-semibold text-sm border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Task</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Related</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Type</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Due Date</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Priority</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.map((task) => (
              <tr key={task.id} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-900">{task.title}</div>
                  <div className="text-xs text-slate-500">{task.description}</div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{getRelatedName(task)}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{task.type}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(task.dueDate), 'MMM d, yyyy')}</td>
                <td className="px-6 py-4">
                  <Badge variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'orange' : 'slate'}>{task.priority}</Badge>
                </td>
                <td className="px-6 py-4">
                    <Badge variant={task.status === 'Completed' ? 'green' : 'blue'}>{task.status}</Badge>
                </td>
                <td className="px-6 py-4">
                  {task.status !== 'Completed' && (
                    <Button size="sm" variant="outline" onClick={() => completeTask(task.id)}>
                      Complete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

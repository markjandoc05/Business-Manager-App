'use client';

import React, { useState } from 'react';
import { Card, Badge, Button } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { Plus, MoreHorizontal, Calendar, DollarSign, Search, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  DndContext, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function PipelinePage() {
  const { deals, clients, settings, updateDealStage, addDeal } = useApp();
  const stages = settings.pipelineStages;
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals
  const [showWonModal, setShowWonModal] = useState<{dealId: string} | null>(null);
  const [showLostModal, setShowLostModal] = useState<{dealId: string} | null>(null);
  const [wonDetails, setWonDetails] = useState({ value: 0, closeDate: '', note: '' });
  const [lostDetails, setLostDetails] = useState({ reason: '', note: '' });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    
    const dealId = active.id as string;
    const newStage = over.id as string;
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;

    if (newStage === 'Won') {
        setShowWonModal({ dealId });
    } else if (newStage === 'Lost') {
        setShowLostModal({ dealId });
    } else {
        updateDealStage(dealId, newStage, 'Active');
    }
  };

  const handleWonConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showWonModal) return;
    updateDealStage(showWonModal.dealId, 'Won', 'Won');
    setShowWonModal(null);
  };

  const handleLostConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showLostModal) return;
    updateDealStage(showLostModal.dealId, 'Lost', 'Lost', lostDetails.reason);
    setShowLostModal(null);
  };

  const filteredDeals = deals.filter(d => 
    d.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Pipeline</h2>
        <div className="flex gap-2">
          <Button variant="outline"><Filter size={18}/> Filters</Button>
          <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
             <input type="text" placeholder="Search deals..." className="pl-9 pr-4 py-2 border rounded-xl text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
          </div>
          <Button className="gap-2"><Plus size={18}/> Add Opportunity</Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-6 pb-6 overflow-x-auto min-h-[70vh]">
          {stages.map((stage) => {
            const stageDeals = filteredDeals.filter(d => d.stage === stage.name && d.status !== 'Lost');
            const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);

            return (
              <div key={stage.name} className="flex flex-col w-80 shrink-0 gap-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800">{stage.name}</h3>
                    <span className="flex items-center justify-center w-6 h-6 text-xs font-bold text-slate-500 bg-slate-200 rounded-full">{stageDeals.length}</span>
                  </div>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Value</p>
                  <p className="text-base font-bold text-slate-900">${totalValue.toLocaleString()}</p>
                </div>
                <SortableContext items={stageDeals.map(d => d.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex-1 space-y-3">
                        {stageDeals.map(deal => <SortableDealCard key={deal.id} deal={deal} />)}
                    </div>
                </SortableContext>
              </div>
            );
          })}
        </div>
      </DndContext>
      <AnimatePresence>
        {showWonModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleWonConfirm} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Mark Deal as Won</h3>
              <p className="text-sm text-slate-500">Confirm the final value and closing date to finalize this deal.</p>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowWonModal(null)}>Cancel</Button>
                <Button type="submit">Confirm Won</Button>
              </div>
            </form>
          </div>
        )}
        {showLostModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleLostConfirm} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Mark Deal as Lost</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Reason for loss</label>
                <input required className="w-full px-4 py-2 border rounded-xl" value={lostDetails.reason} onChange={e => setLostDetails({...lostDetails, reason: e.target.value})}/>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowLostModal(null)}>Cancel</Button>
                <Button type="submit">Confirm Lost</Button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SortableDealCard({ deal }: { deal: any }) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const { clients } = useApp();
    const client = clients.find(c => c.id === deal.clientId);
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <Card className="p-4 hover:shadow-md transition-shadow space-y-3 cursor-grab active:cursor-grabbing">
                <h4 className="font-semibold text-sm text-slate-900 line-clamp-1">{deal.title}</h4>
                <p className="text-xs text-slate-500">{client?.name || 'No client'}</p>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                        <DollarSign size={12} /> {deal.value.toLocaleString()}
                    </div>
                </div>
            </Card>
        </div>
    );
}


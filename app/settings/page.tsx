'use client';

import React, { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { useApp } from '@/context/AppContext';
import { Settings as SettingsIcon, Users, ListFilter as Pipeline, Tag, CreditCard, Paintbrush, Building2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { UserRole } from '@/types/auth';
import { canManageSettings } from '@/lib/permissions';

interface ManagedUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLogin: unknown;
}

function formatLastLogin(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') {
    return 'Never';
  }

  return value.toDate().toLocaleString();
}

export default function SettingsPage() {
  const { settings, updateSettings } = useApp();
  const { user } = useAuth();
  const canManageSystemSettings = canManageSettings(user);
  const [activeTab, setActiveTab] = useState<'profile' | 'branding' | 'users' | 'pipeline' | 'sources' | 'license'>('profile');
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  // Profile form state
  const [profile, setProfile] = useState({
    businessName: settings.businessName,
    businessType: settings.businessType,
    email: settings.email || '',
    phone: settings.phone || '',
    website: settings.website || '',
    address: settings.address || '',
    currency: settings.currency || 'USD',
    timezone: settings.timezone || 'UTC'
  });

  const [newStageName, setNewStageName] = useState('');
  const [newSourceName, setNewSourceName] = useState('');

  const loadUsers = async () => {
    if (user?.role !== 'ADMIN') return;

    setUsersLoading(true);
    setUsersError(null);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const nextUsers = snapshot.docs.map((userDoc) => {
        const data = userDoc.data();
        const role = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER'
          ? data.role as UserRole
          : 'USER';

        return {
          uid: userDoc.id,
          name: typeof data.name === 'string' ? data.name : 'Unnamed user',
          email: typeof data.email === 'string' ? data.email : '',
          role,
          active: data.active === true,
          lastLogin: data.lastLogin,
        };
      });

      nextUsers.sort((left, right) => left.name.localeCompare(right.name));
      setManagedUsers(nextUsers);
    } catch (loadError) {
      console.error('Unable to load Firestore users', loadError);
      setUsersError('Unable to load users. Check your connection and try again.');
    } finally {
      setUsersLoading(false);
    }
  };

  const updateManagedUser = async (uid: string, changes: Partial<Pick<ManagedUser, 'role' | 'active'>>) => {
    if (user?.role !== 'ADMIN' || uid === user.uid || updatingUserId) return;

    setUpdatingUserId(uid);
    setUsersError(null);
    try {
      await updateDoc(doc(db, 'users', uid), changes);
      setManagedUsers((currentUsers) => currentUsers.map((managedUser) => (
        managedUser.uid === uid ? { ...managedUser, ...changes } : managedUser
      )));
    } catch (updateError) {
      console.error('Unable to update Firestore user', updateError);
      setUsersError('Unable to save that user change. Please try again.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(profile);
    alert('Settings saved successfully!');
  };

  const addPipelineStage = () => {
    if (!newStageName.trim()) return;
    const updated = [...settings.pipelineStages, { name: newStageName.trim(), isActive: true }];
    updateSettings({ pipelineStages: updated });
    setNewStageName('');
  };

  const togglePipelineStage = (index: number) => {
    const updated = [...settings.pipelineStages];
    updated[index].isActive = !updated[index].isActive;
    updateSettings({ pipelineStages: updated });
  };

  const addLeadSource = () => {
    if (!newSourceName.trim()) return;
    const updated = [...settings.leadSources, { name: newSourceName.trim(), isActive: true }];
    updateSettings({ leadSources: updated });
    setNewSourceName('');
  };

  const toggleLeadSource = (index: number) => {
    const updated = [...settings.leadSources];
    updated[index].isActive = !updated[index].isActive;
    updateSettings({ leadSources: updated });
  };

  const tabs = [
    { id: 'profile', label: 'Business Profile', icon: Building2 },
    { id: 'branding', label: 'Branding', icon: Paintbrush },
    ...(canManageSystemSettings ? [{ id: 'users', label: 'Users & Access', icon: Users }] : []),
    { id: 'pipeline', label: 'Pipeline', icon: Pipeline },
    { id: 'sources', label: 'Lead Sources', icon: Tag },
    { id: 'license', label: 'License', icon: CreditCard },
  ];

  const handleTabChange = (tabId: typeof activeTab) => {
    setActiveTab(tabId);
    if (tabId === 'users') void loadUsers();
  };

  const Icon = tabs.find(t => t.id === activeTab)?.icon || SettingsIcon;

  if (!canManageSystemSettings) {
    return <Card className="mx-auto max-w-xl space-y-2 p-8 text-center"><h2 className="text-xl font-bold text-slate-900">Settings access restricted</h2><p className="text-sm text-slate-500">System settings are available to ADMIN users only.</p></Card>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>
      
      <div className="flex flex-col md:flex-row gap-6">
        <aside className="w-full md:w-64 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as typeof activeTab)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                activeTab === tab.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </aside>
        
        <main className="flex-1">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
                <Icon className="text-blue-600" size={24}/>
                <h3 className="text-xl font-bold">{tabs.find(t => t.id === activeTab)?.label}</h3>
            </div>
            
            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Business Name</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.businessName} onChange={e => setProfile({...profile, businessName: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Business Type</label>
                    <select className="w-full p-2 border rounded-lg" value={profile.businessType} onChange={e => setProfile({...profile, businessType: e.target.value as any})}>
                      {['Real Estate', 'Insurance', 'Agency', 'Freelancer/Consultant', 'Small Business', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Currency</label>
                    <select className="w-full p-2 border rounded-lg" value={profile.currency} onChange={e => setProfile({...profile, currency: e.target.value})}>
                      {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Timezone</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.timezone} onChange={e => setProfile({...profile, timezone: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Address</label>
                  <input className="w-full p-2 border rounded-lg" value={profile.address} onChange={e => setProfile({...profile, address: e.target.value})} />
                </div>
                <Button type="submit">Save Profile</Button>
              </form>
            )}

            {activeTab === 'branding' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Accent Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={settings.accentColor || '#3b82f6'} onChange={e => updateSettings({ accentColor: e.target.value })} className="w-12 h-10 p-1 border rounded-lg cursor-pointer" />
                    <span className="text-sm font-mono">{settings.accentColor || '#3b82f6'}</span>
                  </div>
                </div>
                <p className="text-sm text-slate-500">Branding customizations apply instantly across all modules.</p>
              </div>
            )}

            {activeTab === 'users' && user?.role === 'ADMIN' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h4 className="font-semibold">Team Members</h4><p className="text-xs text-slate-500">Manage activation and roles for other users.</p></div>
                  <Button size="sm" variant="outline" onClick={() => void loadUsers()} disabled={usersLoading}>Refresh</Button>
                </div>
                {usersError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{usersError}</p>}
                {usersLoading && <p className="py-8 text-center text-sm text-slate-500">Loading users…</p>}
                {!usersLoading && !usersError && managedUsers.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No users found.</p>}
                {!usersLoading && managedUsers.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b bg-slate-50">
                        <tr>
                          <th className="p-3 font-bold text-slate-500">Name</th>
                          <th className="p-3 font-bold text-slate-500">Email</th>
                          <th className="p-3 font-bold text-slate-500">Role</th>
                          <th className="p-3 font-bold text-slate-500">Status</th>
                          <th className="p-3 font-bold text-slate-500">Last login</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {managedUsers.map((managedUser) => {
                          const isCurrentUser = managedUser.uid === user.uid;
                          const isUpdating = updatingUserId === managedUser.uid;
                          return (
                            <tr key={managedUser.uid}>
                              <td className="p-3 font-semibold text-slate-900">{managedUser.name}{isCurrentUser && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}</td>
                              <td className="p-3 text-slate-600">{managedUser.email}</td>
                              <td className="p-3">
                                <select aria-label={`Role for ${managedUser.email}`} value={managedUser.role} disabled={isCurrentUser || isUpdating} onChange={(event) => void updateManagedUser(managedUser.uid, { role: event.target.value as UserRole })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100">
                                  <option value="ADMIN">ADMIN</option><option value="MANAGER">MANAGER</option><option value="USER">USER</option>
                                </select>
                              </td>
                              <td className="p-3">
                                <Button size="sm" variant={managedUser.active ? 'outline' : 'primary'} disabled={isCurrentUser || isUpdating} onClick={() => void updateManagedUser(managedUser.uid, { active: !managedUser.active })}>
                                  {isUpdating ? 'Saving…' : managedUser.active ? 'Deactivate' : 'Activate'}
                                </Button>
                              </td>
                              <td className="p-3 text-slate-600">{formatLastLogin(managedUser.lastLogin)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'pipeline' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input placeholder="New stage name..." className="p-2 border rounded-lg flex-1" value={newStageName} onChange={e => setNewStageName(e.target.value)} />
                  <Button onClick={addPipelineStage} className="gap-1"><Plus size={16}/> Add Stage</Button>
                </div>
                <div className="space-y-2">
                  {settings.pipelineStages.map((stage, idx) => (
                    <div key={stage.name} className="flex items-center justify-between p-3 border rounded-xl bg-slate-50">
                      <span className="font-medium">{stage.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={stage.isActive ? 'green' : 'gray'}>{stage.isActive ? 'Active' : 'Inactive'}</Badge>
                        <Button size="sm" variant="outline" onClick={() => togglePipelineStage(idx)}>
                          {stage.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'sources' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input placeholder="New lead source..." className="p-2 border rounded-lg flex-1" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} />
                  <Button onClick={addLeadSource} className="gap-1"><Plus size={16}/> Add Source</Button>
                </div>
                <div className="space-y-2">
                  {settings.leadSources.map((source, idx) => (
                    <div key={source.name} className="flex items-center justify-between p-3 border rounded-xl bg-slate-50">
                      <span className="font-medium">{source.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={source.isActive ? 'green' : 'gray'}>{source.isActive ? 'Active' : 'Inactive'}</Badge>
                        <Button size="sm" variant="outline" onClick={() => toggleLeadSource(idx)}>
                          {source.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'license' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Installation ID</label>
                    <p className="font-mono bg-slate-100 p-2 rounded text-sm">{settings.license.installationId}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">License Status</label>
                    <div><Badge variant={settings.license.status === 'Active' ? 'green' : 'red'}>{settings.license.status}</Badge></div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Activation Date</label>
                    <p className="text-sm">{new Date(settings.license.activationDate).toLocaleDateString()}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Expiration Date</label>
                    <p className="text-sm">{new Date(settings.license.expirationDate).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Licensed Domain</label>
                    <p className="text-sm">{settings.license.licensedDomain}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">App Version</label>
                    <p className="text-sm font-mono">{settings.license.appVersion}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 pt-2 border-t">License management is restricted to server administration.</p>
              </div>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
}

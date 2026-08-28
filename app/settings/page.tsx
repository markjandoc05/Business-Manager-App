'use client';

import React, { useEffect, useState } from 'react';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { Settings as SettingsIcon, Users, ListFilter as Pipeline, Tag, CreditCard, Paintbrush, Building2, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/types/auth';
import { canManageSettings } from '@/lib/permissions';
import { listOrganizationMembers, updateOrganizationMember, type ManagedOrganizationMember } from '@/lib/repositories/users';
import { useWorkspace } from '@/context/WorkspaceContext';
import { DEAL_STAGES } from '@/lib/deal-workflow';

function formatLastLogin(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') {
    return 'Never';
  }

  return value.toDate().toLocaleString();
}

export default function SettingsPage() {
  const { settings, settingsLoading, settingsError, updateSettings } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, membership, license, licenseState, isReadOnly } = useWorkspace();
  const canManageSystemSettings = canManageSettings(membership);
  const [activeTab, setActiveTab] = useState<'profile' | 'branding' | 'users' | 'pipeline' | 'sources' | 'license'>('profile');
  const [managedUsers, setManagedUsers] = useState<ManagedOrganizationMember[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsActionError, setSettingsActionError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [accentColorDraft, setAccentColorDraft] = useState(settings.accentColor || '#3b82f6');

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

  const [newSourceName, setNewSourceName] = useState('');

  useEffect(() => {
    const syncSettingsDrafts = async () => {
      setProfile({
        businessName: settings.businessName,
        businessType: settings.businessType,
        email: settings.email || '',
        phone: settings.phone || '',
        website: settings.website || '',
        address: settings.address || '',
        currency: settings.currency || 'USD',
        timezone: settings.timezone || 'UTC',
      });
      setAccentColorDraft(settings.accentColor || '#3b82f6');
    };
    void syncSettingsDrafts();
  }, [settings]);

  const saveSettings = async (changes: Parameters<typeof updateSettings>[0], successMessage: string, onSuccess?: () => void) => {
    if (settingsSaving || isReadOnly) return;
    setSettingsSaving(true);
    setSettingsActionError(null);
    setSettingsNotice(null);
    try {
      await updateSettings(changes);
      onSuccess?.();
      setSettingsNotice(successMessage);
    } catch (error) {
      setSettingsActionError('Unable to save settings. Please try again.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const loadUsers = async () => {
    if (!user || !currentOrganizationId || !canManageSystemSettings) return;

    setUsersLoading(true);
    setUsersError(null);
    try {
      setManagedUsers(await listOrganizationMembers(user, currentOrganizationId));
    } catch (loadError) {
      console.error('Unable to load Firestore users', loadError);
      setUsersError('Unable to load users. Check your connection and try again.');
    } finally {
      setUsersLoading(false);
    }
  };

  const updateManagedUser = async (uid: string, changes: Partial<Pick<ManagedOrganizationMember, 'role'>> & { active?: boolean }) => {
    if (!user || !currentOrganizationId || !canManageSystemSettings || isReadOnly || uid === user.uid || updatingUserId) return;

    if (changes.active === true && managedUsers.filter((managedUser) => managedUser.status === 'active').length >= (license?.maxUsers || 3)) {
      setUsersError(`Your current plan supports up to ${license?.maxUsers || 3} active users.`);
      return;
    }

    setUpdatingUserId(uid);
    setUsersError(null);
    try {
      await updateOrganizationMember(user, currentOrganizationId, uid, {
        ...(changes.role ? { role: changes.role } : {}),
        ...(changes.active !== undefined ? { status: changes.active ? 'active' : 'inactive' } : {}),
      });
      setManagedUsers((currentUsers) => currentUsers.map((managedUser) => (
        managedUser.uid === uid ? { ...managedUser, ...(changes.role ? { role: changes.role } : {}), ...(changes.active !== undefined ? { status: changes.active ? 'active' : 'inactive' } : {}) } : managedUser
      )));
    } catch (updateError) {
      console.error('Unable to update Firestore user', updateError);
      setUsersError('Unable to save that user change. Please try again.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings(profile, 'Business profile saved.');
  };

  const addLeadSource = async () => {
    const normalizedName = newSourceName.trim();
    if (settingsLoading || isReadOnly || !normalizedName || settingsSaving) return;
    if (settings.leadSources.some((source) => source.name.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
      setSettingsActionError('That lead source already exists.');
      setSettingsNotice(null);
      return;
    }
    const updated = [...settings.leadSources, { name: normalizedName, isActive: true }];
    await saveSettings({ leadSources: updated }, 'Lead source saved.', () => setNewSourceName(''));
  };

  const toggleLeadSource = async (index: number) => {
    if (settingsLoading || isReadOnly || settingsSaving) return;
    const updated = settings.leadSources.map((source, sourceIndex) => sourceIndex === index
      ? { ...source, isActive: !source.isActive }
      : source);
    await saveSettings({ leadSources: updated }, 'Lead source updated.');
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
    return <Card className="mx-auto max-w-xl space-y-2 p-8 text-center"><h2 className="text-xl font-bold text-[var(--app-text)]">Settings access restricted</h2><p className="text-sm text-[var(--app-muted)]">System settings are available to ADMIN users only.</p></Card>;
  }

  if (settingsLoading) {
    return <div className="space-y-5"><PageHeader title="Settings" subtitle="Manage your organization, users, and application preferences." /><Card className="p-8 text-center text-sm text-[var(--app-muted)]">Loading organization settings…</Card></div>;
  }

  if (settingsError) {
    return <div className="space-y-5"><PageHeader title="Settings" subtitle="Manage your organization, users, and application preferences." /><div role="alert"><Card className="p-8 text-center text-sm text-[var(--app-danger)]">{settingsError}</Card></div></div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Manage your organization, users, and application preferences." />
      {settingsActionError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{settingsActionError}</p>}
      {settingsNotice && <p className="rounded-lg bg-[var(--app-accent-soft)] p-3 text-sm text-[var(--app-primary)]" role="status">{settingsNotice}</p>}
      
      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="settings-navigation w-full space-y-1 md:w-64" aria-label="Settings sections">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as typeof activeTab)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-[var(--app-surface-subtle)] text-[var(--app-text)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-surface-subtle)]'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </aside>
        
        <section className="min-w-0 flex-1" aria-label={`${tabs.find(t => t.id === activeTab)?.label || 'Settings'} settings`}>
          <Card className="p-4">
            <div className="mb-5 flex items-center gap-3">
                <Icon className="text-[var(--app-primary)]" size={24}/>
                <h3 className="text-base font-semibold text-[var(--app-text)]">{tabs.find(t => t.id === activeTab)?.label}</h3>
            </div>
            
            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Business Name</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.businessName} onChange={e => setProfile({...profile, businessName: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Business Type</label>
                    <select className="w-full p-2 border rounded-lg" value={profile.businessType} onChange={e => setProfile({...profile, businessType: e.target.value as any})}>
                      {['Solo Entrepreneur', 'Agency', 'Real Estate', 'Professional Services', 'Retail', 'Insurance', 'Freelancer/Consultant', 'Small Business', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Email</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Phone</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Website</label>
                  <input type="url" className="w-full p-2 border rounded-lg" value={profile.website} onChange={e => setProfile({...profile, website: e.target.value})} placeholder="https://" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Currency</label>
                    <select className="w-full p-2 border rounded-lg" value={profile.currency} onChange={e => setProfile({...profile, currency: e.target.value})}>
                      {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PHP'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Timezone</label>
                    <input className="w-full p-2 border rounded-lg" value={profile.timezone} onChange={e => setProfile({...profile, timezone: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Address</label>
                  <input className="w-full p-2 border rounded-lg" value={profile.address} onChange={e => setProfile({...profile, address: e.target.value})} />
                </div>
                <Button type="submit" disabled={isReadOnly || settingsSaving}>{settingsSaving ? 'Saving…' : 'Save Profile'}</Button>
              </form>
            )}

            {activeTab === 'branding' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Accent Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" disabled={isReadOnly || settingsSaving} value={accentColorDraft} onChange={e => setAccentColorDraft(e.target.value)} className="w-12 h-10 p-1 border rounded-lg cursor-pointer" />
                    <span className="text-sm font-mono">{accentColorDraft}</span>
                    <Button size="sm" variant="outline" disabled={isReadOnly || settingsSaving || accentColorDraft === (settings.accentColor || '#3b82f6')} onClick={() => void saveSettings({ accentColor: accentColorDraft }, 'Branding saved.')}>{settingsSaving ? 'Saving…' : 'Save Branding'}</Button>
                  </div>
                </div>
                <p className="text-sm text-[var(--app-muted)]">Saved branding customizations apply across all modules.</p>
              </div>
            )}

            {activeTab === 'users' && canManageSystemSettings && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h4 className="font-semibold">Team Members</h4><p className="text-xs text-[var(--app-muted)]">Manage activation and roles for other users.</p></div>
                  <Button size="sm" variant="outline" onClick={() => void loadUsers()} disabled={usersLoading || isReadOnly}>Refresh</Button>
                </div>
                {usersError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{usersError}</p>}
                {usersLoading && <p className="py-8 text-center text-sm text-[var(--app-muted)]">Loading users…</p>}
                {!usersLoading && !usersError && managedUsers.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-[var(--app-muted)]">No users found.</p>}
                {!usersLoading && managedUsers.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b bg-[var(--app-surface-subtle)]">
                        <tr>
                          <th className="p-3 font-bold text-[var(--app-muted)]">Name</th>
                          <th className="p-3 font-bold text-[var(--app-muted)]">Email</th>
                          <th className="p-3 font-bold text-[var(--app-muted)]">Role</th>
                          <th className="p-3 font-bold text-[var(--app-muted)]">Status</th>
                          <th className="p-3 font-bold text-[var(--app-muted)]">Last login</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {managedUsers.map((managedUser) => {
                          const isCurrentUser = managedUser.uid === user?.uid;
                          const isUpdating = updatingUserId === managedUser.uid;
                          return (
                            <tr key={managedUser.uid}>
                              <td className="p-3 font-semibold text-[var(--app-text)]">{managedUser.name}{isCurrentUser && <span className="ml-2 text-xs font-normal text-[var(--app-tertiary)]">(you)</span>}</td>
                              <td className="p-3 text-[var(--app-muted)]">{managedUser.email}</td>
                              <td className="p-3">
                                <select aria-label={`Role for ${managedUser.email}`} value={managedUser.role} disabled={isReadOnly || isCurrentUser || isUpdating} onChange={(event) => void updateManagedUser(managedUser.uid, { role: event.target.value as UserRole })} className="rounded-lg border border-[var(--app-border)] bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-[var(--app-surface-subtle)]">
                                  <option value="ADMIN">ADMIN</option><option value="MANAGER">MANAGER</option><option value="USER">USER</option>
                                </select>
                              </td>
                              <td className="p-3">
                                <Button size="sm" variant={managedUser.status === 'active' ? 'outline' : 'primary'} disabled={isReadOnly || isCurrentUser || isUpdating} onClick={() => void updateManagedUser(managedUser.uid, { active: managedUser.status !== 'active' })}>
                                  {isUpdating ? 'Saving…' : managedUser.status === 'active' ? 'Deactivate' : 'Activate'}
                                </Button>
                              </td>
                              <td className="p-3 text-[var(--app-muted)]">{formatLastLogin(managedUser.lastLogin)}</td>
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
                <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3 text-sm text-[var(--app-primary)]">
                  BSM uses one standard sales pipeline for every workspace. Pipeline stages are managed by the application and cannot be customized here.
                </div>
                <div className="space-y-2">
                  {DEAL_STAGES.map((stage) => (
                    <div key={stage} className="flex items-center justify-between p-3 border rounded-xl bg-[var(--app-surface-subtle)]">
                      <span className="font-medium">{stage}</span>
                      <Badge variant="green">Standard</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'sources' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                    <input disabled={isReadOnly || settingsSaving} placeholder="New lead source..." className="p-2 border rounded-lg flex-1" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} />
                  <Button disabled={isReadOnly || settingsSaving} onClick={() => void addLeadSource()} className="gap-1"><Plus size={16}/> Add Source</Button>
                </div>
                <div className="space-y-2">
                  {settings.leadSources.map((source, idx) => (
                    <div key={source.name} className="flex items-center justify-between p-3 border rounded-xl bg-[var(--app-surface-subtle)]">
                      <span className="font-medium">{source.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={source.isActive ? 'green' : 'gray'}>{source.isActive ? 'Active' : 'Inactive'}</Badge>
                        <Button size="sm" variant="outline" disabled={isReadOnly || settingsSaving} onClick={() => void toggleLeadSource(idx)}>
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
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Plan</label>
                    <p className="font-medium bg-[var(--app-surface-subtle)] p-2 rounded text-sm">{licenseState.plan || 'Unknown'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Status</label>
                    <div><Badge variant={licenseState.isReadOnly ? 'red' : 'green'}>{licenseState.status}</Badge></div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Expiration</label>
                    <p className="text-sm">{licenseState.status === 'TRIAL' ? formatLicenseDate(license?.trialEndsAt) : licenseState.status === 'ACTIVE' ? formatLicenseDate(license?.subscriptionEndsAt) : 'Not available'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">User limit</label>
                    <p className="text-sm">{license?.maxUsers ?? 'Not configured'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Days remaining</label>
                    <p className="text-sm">{licenseState.daysRemaining === null ? 'No expiration set' : licenseState.daysRemaining}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Workspace access</label>
                    <p className="text-sm">{isReadOnly ? 'Read-only' : 'Writable'}</p>
                  </div>
                </div>
                <p className="text-xs text-[var(--app-tertiary)] pt-2 border-t">License management is restricted to server administration.</p>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function formatLicenseDate(value: { toDate: () => Date } | undefined) {
  return value ? value.toDate().toLocaleDateString() : 'No expiration set';
}

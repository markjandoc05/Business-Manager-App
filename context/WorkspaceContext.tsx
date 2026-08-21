'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getOrganization, listUserMemberships } from '@/lib/repositories/workspaces';
import type { Organization, OrganizationMembership } from '@/types/auth';

interface WorkspaceContextValue {
  currentOrganization: Organization | null;
  currentOrganizationId: string | null;
  membership: OrganizationMembership | null;
  organizationRole: OrganizationMembership['role'] | null;
  organizationStatus: Organization['status'] | null;
  availableOrganizations: Organization[];
  loading: boolean;
  error: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [availableOrganizations, setAvailableOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearWorkspace = () => {
    setCurrentOrganization(null);
    setMembership(null);
    setAvailableOrganizations([]);
    setError(null);
  };

  /* Workspace reset is intentionally synchronous so stale tenant state is invalidated immediately. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    const userId = user?.uid;

    if (authStatus !== 'active' || !user || !userId) {
      clearWorkspace();
      setLoading(false);
      return () => { cancelled = true; };
    }

    clearWorkspace();
    setLoading(true);

    void listUserMemberships(user).then(async (memberships) => {
      const resolved = await Promise.all(memberships.map((item) => getOrganization(item.organizationId)));
      if (cancelled || userId !== user.uid) return;
      const organizations = resolved.filter((organization): organization is Organization => organization !== null);
      setAvailableOrganizations(organizations);
      const selectedMembership = memberships.find((item) => organizations.some((organization) => organization.id === item.organizationId)) || null;
      setMembership(selectedMembership);
      setCurrentOrganization(selectedMembership ? organizations.find((organization) => organization.id === selectedMembership.organizationId) || null : null);
    }).catch((workspaceError) => {
      console.error('Unable to resolve workspace memberships', workspaceError);
      if (!cancelled && userId === user.uid) setError('Workspace information is not available yet.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authStatus, user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return <WorkspaceContext.Provider value={{ currentOrganization, currentOrganizationId: currentOrganization?.id || null, membership, organizationRole: membership?.role || null, organizationStatus: currentOrganization?.status || null, availableOrganizations, loading, error }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
}

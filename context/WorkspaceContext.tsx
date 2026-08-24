'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getOrganization, listUserMemberships } from '@/lib/repositories/workspaces';
import { getOrganizationLicense, resolveLicenseState } from '@/lib/repositories/licenses';
import type { License, Organization, OrganizationMembership, ResolvedLicenseState } from '@/types/auth';

interface WorkspaceContextValue {
  currentOrganization: Organization | null;
  currentOrganizationId: string | null;
  membership: OrganizationMembership | null;
  organizationRole: OrganizationMembership['role'] | null;
  organizationStatus: Organization['status'] | null;
  availableOrganizations: Organization[];
  hasMembership: boolean;
  onboardingRequired: boolean;
  membershipCount: number;
  activeMembershipCount: number;
  membershipSummaries: { organizationId: string; status: OrganizationMembership['status']; role: OrganizationMembership['role'] }[];
  loading: boolean;
  ready: boolean;
  refresh: () => void;
  selectOrganization: (organizationId: string) => void;
  error: string | null;
  license: License | null;
  licenseLoading: boolean;
  licenseError: string | null;
  licenseState: ResolvedLicenseState;
  canWrite: boolean;
  isReadOnly: boolean;
  daysRemaining: number | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [availableOrganizations, setAvailableOrganizations] = useState<Organization[]>([]);
  const [hasMembership, setHasMembership] = useState(false);
  const [membershipSummaries, setMembershipSummaries] = useState<{ organizationId: string; status: OrganizationMembership['status']; role: OrganizationMembership['role'] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [license, setLicense] = useState<License | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const resolutionRequestRef = useRef(0);
  const lastResolvedUserIdRef = useRef<string | null>(null);

  const clearWorkspace = () => {
    setCurrentOrganization(null);
    setMembership(null);
    setAvailableOrganizations([]);
    setHasMembership(false);
    setMembershipSummaries([]);
    setError(null);
    setLicense(null);
    setLicenseError(null);
  };

  /* Workspace reset is intentionally synchronous so stale tenant state is invalidated immediately. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    const requestId = ++resolutionRequestRef.current;
    const userId = user?.uid;

    const isCurrentRequest = () => !cancelled && requestId === resolutionRequestRef.current;

    if (authStatus !== 'active' || !user || !userId) {
      lastResolvedUserIdRef.current = null;
      setSelectedOrganizationId(null);
      clearWorkspace();
      setLoading(false);
      return () => { cancelled = true; };
    }

    if (lastResolvedUserIdRef.current !== userId) {
      lastResolvedUserIdRef.current = userId;
      setSelectedOrganizationId(null);
    }
    clearWorkspace();
    setLoading(true);
    setLicenseLoading(true);

    void listUserMemberships(user).then(async (memberships) => {
      setHasMembership(memberships.length > 0);
      setMembershipSummaries(memberships.map((item) => ({ organizationId: item.organizationId, status: item.status, role: item.role })));
      const activeMemberships = memberships.filter((item) => item.status === 'active');
      let licenseLoadFailed = false;
      const resolved = await Promise.all(activeMemberships.map(async (item) => {
        const organization = await getOrganization(item.organizationId);
        let license: License | null = null;
        try {
          license = await getOrganizationLicense(item.organizationId);
        } catch (licenseLoadError) {
          console.error('Unable to resolve organization license', licenseLoadError);
          licenseLoadFailed = true;
        }
        return { organization, license };
      }));
      if (!isCurrentRequest() || userId !== user.uid) return;
      const organizations = resolved.map((item) => item.organization).filter((organization): organization is Organization => organization !== null);
      setAvailableOrganizations(organizations);
      const preferredOrganizationId = activeMemberships.length === 1 ? activeMemberships[0].organizationId : selectedOrganizationId;
      const selectedMembership = activeMemberships.find((item) => item.organizationId === preferredOrganizationId && organizations.some((organization) => organization.id === item.organizationId)) || null;
      setMembership(selectedMembership);
      const selectedOrganization = selectedMembership ? organizations.find((organization) => organization.id === selectedMembership.organizationId) || null : null;
      setCurrentOrganization(selectedOrganization);
      setLicense(selectedOrganization ? resolved.find((item) => item.organization?.id === selectedOrganization.id)?.license || null : null);
      setLicenseError(licenseLoadFailed ? 'Subscription status is not available yet.' : null);
    }).catch((workspaceError) => {
      console.error('Unable to resolve workspace memberships', workspaceError);
      if (isCurrentRequest() && userId === user.uid) {
        setError('Workspace information is not available yet.');
        setLicenseError('Subscription status is not available yet.');
      }
    }).finally(() => { if (isCurrentRequest()) { setLoading(false); setLicenseLoading(false); } });
    return () => { cancelled = true; };
  }, [authStatus, selectedOrganizationId, user, refreshToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const ready = !loading && currentOrganization !== null && ['trial', 'active', 'expired', 'suspended'].includes(currentOrganization.status) && membership?.status === 'active';
  const resolvedLicenseState = resolveLicenseState(license);
  const licenseState: ResolvedLicenseState = licenseError
    ? { ...resolvedLicenseState, canWrite: false, isReadOnly: true, reason: 'unavailable' }
    : resolvedLicenseState;
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);
  const selectOrganization = useCallback((organizationId: string) => {
    if (availableOrganizations.some((organization) => organization.id === organizationId)) setSelectedOrganizationId(organizationId);
  }, [availableOrganizations]);

  return <WorkspaceContext.Provider value={{ currentOrganization, currentOrganizationId: currentOrganization?.id || null, membership, organizationRole: membership?.role || null, organizationStatus: currentOrganization?.status || null, availableOrganizations, hasMembership, onboardingRequired: !loading && !hasMembership, membershipCount: membershipSummaries.length, activeMembershipCount: membershipSummaries.filter((item) => item.status === 'active').length, membershipSummaries, loading, ready, refresh, selectOrganization, error, license, licenseLoading, licenseError, licenseState, canWrite: !licenseLoading && licenseState.canWrite, isReadOnly: !licenseLoading && licenseState.isReadOnly, daysRemaining: licenseState.daysRemaining }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
}

'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getOrganization, listUserMemberships, subscribeToOrganization } from '@/lib/repositories/workspaces';
import { invalidateCachedRequest } from '@/lib/repositories/requestCache';
import { resolveLicenseState, subscribeToOrganizationLicense } from '@/lib/repositories/licenses';
import { firestoreWorkspaceErrorMessage, isFirestoreIndexError } from '@/lib/repositories/pagination';
import type { License, Organization, OrganizationMembership, ResolvedLicenseState } from '@/types/auth';
import { finishStartupStage, markStartup, startStartupStage } from '@/lib/startupTiming';

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
  const { firebaseUser } = useAuth();
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
  const [resolvedMemberships, setResolvedMemberships] = useState<OrganizationMembership[]>([]);
  const resolutionRequestRef = useRef(0);

  const clearWorkspace = () => {
    setCurrentOrganization(null);
    setMembership(null);
    setAvailableOrganizations([]);
    setHasMembership(false);
    setMembershipSummaries([]);
    setResolvedMemberships([]);
    setError(null);
    setLicense(null);
    setLicenseError(null);
    setLicenseLoading(false);
  };

  /* Workspace reset is intentionally synchronous so stale tenant state is invalidated immediately. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    const requestId = ++resolutionRequestRef.current;
    const userId = firebaseUser?.uid;
    let activeMembershipCount = 0;

    const isCurrentRequest = () => !cancelled && requestId === resolutionRequestRef.current;

    if (!firebaseUser) {
      setSelectedOrganizationId(null);
      clearWorkspace();
      setLoading(false);
      return () => { cancelled = true; };
    }

    setSelectedOrganizationId(null);
    clearWorkspace();
    setLoading(true);
    setLicenseLoading(false);

    void listUserMemberships(firebaseUser).then(async (memberships) => {
      if (!isCurrentRequest() || userId !== firebaseUser.uid) return;
      setHasMembership(memberships.length > 0);
      setMembershipSummaries(memberships.map((item) => ({ organizationId: item.organizationId, status: item.status, role: item.role })));
      setResolvedMemberships(memberships);
      const activeMemberships = memberships.filter((item) => item.status === 'active');
      activeMembershipCount = activeMemberships.length;
      if (!activeMemberships.length) return;
      if (activeMemberships.length === 1) {
        setSelectedOrganizationId(activeMemberships[0].organizationId);
        return;
      }
      const organizations = (await Promise.all(activeMemberships.map((item) => getOrganization(item.organizationId))))
        .filter((organization): organization is Organization => organization !== null);
      if (!isCurrentRequest() || userId !== firebaseUser.uid) return;
      setAvailableOrganizations(organizations);
    }).catch((workspaceError) => {
      if (isFirestoreIndexError(workspaceError)) {
        if (process.env.NODE_ENV !== 'production') console.info('[Workspace] Membership index is unavailable or still building.', workspaceError);
      } else {
        console.error('Unable to resolve workspace memberships', workspaceError);
      }
      if (isCurrentRequest() && userId === firebaseUser.uid) {
        setError(firestoreWorkspaceErrorMessage(workspaceError));
      }
    }).finally(() => {
      if (!isCurrentRequest()) return;
      // A single active membership is completed by the selected-workspace effect.
      if (activeMembershipCount === 1) return;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [firebaseUser, refreshToken]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    const requestId = resolutionRequestRef.current;
    const selectedMembership = resolvedMemberships.find((item) => item.organizationId === selectedOrganizationId && item.status === 'active') || null;
    if (!selectedOrganizationId || !selectedMembership || !firebaseUser) return undefined;

    setLoading(true);
    setLicenseLoading(true);
    setError(null);
    setLicenseError(null);
    startStartupStage('organization-resolution');
    const unsubscribeOrganization = subscribeToOrganization(selectedOrganizationId, (nextOrganization) => {
      if (cancelled || requestId !== resolutionRequestRef.current) return;
      if (!nextOrganization) {
        finishStartupStage('organization-resolution');
        setError('This workspace is no longer available.');
        setLoading(false);
        return;
      }
      finishStartupStage('organization-resolution');
      markStartup('organization-resolved');
      setMembership(selectedMembership);
      setCurrentOrganization(nextOrganization);
      setAvailableOrganizations((organizations) => organizations.some((organization) => organization.id === nextOrganization.id)
        ? organizations.map((organization) => organization.id === nextOrganization.id ? nextOrganization : organization)
        : [...organizations, nextOrganization]);
      setLoading(false);
    }, (snapshotError) => {
      if (cancelled || requestId !== resolutionRequestRef.current) return;
      finishStartupStage('organization-resolution');
      if (isFirestoreIndexError(snapshotError)) {
        if (process.env.NODE_ENV !== 'production') console.info('[Workspace] Organization index is unavailable or still building.', snapshotError);
      } else {
        console.error('Unable to resolve organization', snapshotError);
      }
      setError(firestoreWorkspaceErrorMessage(snapshotError, snapshotError.message));
      setLoading(false);
    });
    const unsubscribeLicense = subscribeToOrganizationLicense(selectedOrganizationId, (nextLicense) => {
      if (cancelled || requestId !== resolutionRequestRef.current) return;
      setLicense(nextLicense);
      setLicenseLoading(false);
    }, (snapshotError) => {
      if (cancelled || requestId !== resolutionRequestRef.current) return;
      console.error('Unable to resolve organization license', snapshotError);
      setLicenseError('Subscription status is not available yet.');
      setLicenseLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribeOrganization();
      unsubscribeLicense();
    };
  }, [firebaseUser, resolvedMemberships, selectedOrganizationId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const ready = !loading && currentOrganization !== null && ['trial', 'active', 'expired', 'suspended'].includes(currentOrganization.status) && membership?.status === 'active';
  const resolvedLicenseState = resolveLicenseState(license);
  const expectedLicenseExpiresAt = resolvedLicenseState.canWrite
    ? (license?.status === 'TRIAL' ? license.trialEndsAt?.toDate().toISOString() : license?.status === 'ACTIVE' ? license.subscriptionEndsAt?.toDate().toISOString() : null)
    : null;
  const mirrorsMatch = Boolean(currentOrganization && license && currentOrganization.licenseStatus === resolvedLicenseState.status
    && currentOrganization.licenseWriteEnabled === resolvedLicenseState.canWrite
    && (currentOrganization.licenseExpiresAt || null) === (expectedLicenseExpiresAt || null));
  const licenseState: ResolvedLicenseState = licenseError || !mirrorsMatch
    ? { ...resolvedLicenseState, plan: license ? resolvedLicenseState.plan : null, status: 'UNKNOWN', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'unavailable' }
    : resolvedLicenseState;

  const refresh = useCallback(() => {
    if (firebaseUser) invalidateCachedRequest(`workspace-memberships:${firebaseUser.uid}`);
    setRefreshToken((value) => value + 1);
  }, [firebaseUser]);
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

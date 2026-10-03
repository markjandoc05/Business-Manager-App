'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getOrganization, listUserMemberships, subscribeToOrganization, subscribeToOrganizationMembership } from '@/lib/repositories/workspaces';
import { invalidateCachedRequest } from '@/lib/repositories/requestCache';
import { resolveLicenseState, subscribeToOrganizationLicense } from '@/lib/repositories/licenses';
import { firestoreWorkspaceErrorMessage, isFirestoreIndexError, userFacingErrorMessage } from '@/lib/repositories/pagination';
import { recordClientLoginActivity } from '@/lib/auth/loginActivity';
import type { License, Organization, OrganizationMembership, ResolvedLicenseState } from '@/types/auth';
import { finishStartupStage, markStartup, markStartupEvent, startStartupStage } from '@/lib/startupTiming';

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
  const { firebaseUser, status: authStatus } = useAuth();
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
  const loginActivityKeysRef = useRef(new Set<string>());
  const loginActivityUidRef = useRef<string | null>(null);

  const recordLoginActivity = useCallback((organizationId: string, status: 'SUCCESS' | 'FAILED') => {
    if (!firebaseUser || !organizationId) return;
    const key = `${firebaseUser.uid}:${organizationId}:${status}`;
    if (loginActivityKeysRef.current.has(key)) return;
    loginActivityKeysRef.current.add(key);
    void recordClientLoginActivity(firebaseUser, organizationId, status).catch((activityError) => {
      loginActivityKeysRef.current.delete(key);
      if (process.env.NODE_ENV !== 'production') console.warn('[login-activity] best-effort recording failed', activityError);
    });
  }, [firebaseUser]);

  useEffect(() => {
    const nextUid = firebaseUser?.uid || null;
    if (loginActivityUidRef.current !== nextUid) {
      loginActivityKeysRef.current.clear();
      loginActivityUidRef.current = nextUid;
    }
  }, [firebaseUser?.uid]);

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

    if (!firebaseUser || authStatus !== 'active') {
      setSelectedOrganizationId(null);
      clearWorkspace();
      setLoading(authStatus === 'loading');
      return () => { cancelled = true; };
    }

    setSelectedOrganizationId(null);
    clearWorkspace();
    setLoading(true);
    setLicenseLoading(false);
    markStartupEvent('WORKSPACE_RESOLUTION_START');

    void listUserMemberships(firebaseUser, { profilePrevalidated: true }).then(async (memberships) => {
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
      markStartupEvent('WORKSPACE_RESOLUTION_COMPLETE');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [authStatus, firebaseUser, refreshToken]);

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
        markStartupEvent('WORKSPACE_RESOLUTION_COMPLETE');
        recordLoginActivity(selectedOrganizationId, 'FAILED');
        setError('This workspace is no longer available.');
        setLoading(false);
        return;
      }
      finishStartupStage('organization-resolution');
      markStartup('organization-resolved');
      markStartupEvent('WORKSPACE_RESOLUTION_COMPLETE');
      setMembership(selectedMembership);
      setCurrentOrganization(nextOrganization);
      recordLoginActivity(selectedOrganizationId, 'SUCCESS');
      setAvailableOrganizations((organizations) => organizations.some((organization) => organization.id === nextOrganization.id)
        ? organizations.map((organization) => organization.id === nextOrganization.id ? nextOrganization : organization)
        : [...organizations, nextOrganization]);
      setLoading(false);
    }, (snapshotError) => {
      if (cancelled || requestId !== resolutionRequestRef.current) return;
      finishStartupStage('organization-resolution');
      markStartupEvent('WORKSPACE_RESOLUTION_COMPLETE');
      if (isFirestoreIndexError(snapshotError)) {
        if (process.env.NODE_ENV !== 'production') console.info('[Workspace] Organization index is unavailable or still building.', snapshotError);
      } else {
        console.error('Unable to resolve organization', snapshotError);
      }
      recordLoginActivity(selectedOrganizationId, 'FAILED');
      setError(firestoreWorkspaceErrorMessage(snapshotError, userFacingErrorMessage(snapshotError, 'Workspace information is not available yet.')));
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
  }, [firebaseUser, recordLoginActivity, resolvedMemberships, selectedOrganizationId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* Keep the selected membership authoritative while retaining a listener after access is removed so reactivation can be observed. */
  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser || !selectedOrganizationId) return undefined;
    const userId = firebaseUser.uid;
    const updateResolvedMembership = (nextMembership: OrganizationMembership | null) => {
      setResolvedMemberships((previous) => {
        const index = previous.findIndex((item) => item.organizationId === selectedOrganizationId);
        if (!nextMembership) return index === -1 ? previous : previous.filter((_, itemIndex) => itemIndex !== index);
        if (index === -1) return [...previous, nextMembership];
        const current = previous[index];
        if (current.status === nextMembership.status && current.role === nextMembership.role && current.userId === nextMembership.userId) return previous;
        const updated = previous.slice(); updated[index] = nextMembership; return updated;
      });
      setMembershipSummaries((previous) => {
        const index = previous.findIndex((item) => item.organizationId === selectedOrganizationId);
        if (!nextMembership) return index === -1 ? previous : previous.filter((_, itemIndex) => itemIndex !== index);
        const summary = { organizationId: selectedOrganizationId, status: nextMembership.status, role: nextMembership.role };
        if (index === -1) return [...previous, summary];
        const current = previous[index];
        if (current.status === summary.status && current.role === summary.role) return previous;
        const updated = previous.slice(); updated[index] = summary; return updated;
      });
      if (!nextMembership || nextMembership.status !== 'active') {
        recordLoginActivity(selectedOrganizationId, 'FAILED');
        setMembership(null);
        setCurrentOrganization(null);
        setLicense(null);
        setLicenseLoading(false);
        setLicenseError(null);
        setAvailableOrganizations((organizations) => organizations.filter((organization) => organization.id !== selectedOrganizationId));
        setLoading(false);
        setError('You no longer have access to this workspace.');
        return;
      }
      setMembership(nextMembership);
      setError(null);
    };
    const unsubscribe = subscribeToOrganizationMembership(selectedOrganizationId, userId, (nextMembership) => {
      if (cancelled || userId !== firebaseUser.uid) return;
      updateResolvedMembership(nextMembership);
    }, (membershipError) => {
      if (cancelled || userId !== firebaseUser.uid) return;
      console.error('Unable to resolve workspace membership', membershipError);
      setMembership(null);
      setCurrentOrganization(null);
      setLicense(null);
      setLicenseLoading(false);
      recordLoginActivity(selectedOrganizationId, 'FAILED');
      setError('Workspace access is not available yet.');
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [firebaseUser, recordLoginActivity, selectedOrganizationId]);

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

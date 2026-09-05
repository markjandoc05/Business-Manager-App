import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const workspaces = fs.readFileSync(new URL('../lib/repositories/workspaces.ts', import.meta.url), 'utf8');
const context = fs.readFileSync(new URL('../context/WorkspaceContext.tsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
const bootstrapRequest = fs.readFileSync(new URL('../lib/auth/bootstrap-request.ts', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../lib/server/workspace-bootstrap.ts', import.meta.url), 'utf8');
const bootstrapRoute = fs.readFileSync(new URL('../app/api/auth/bootstrap/route.ts', import.meta.url), 'utf8');
const loginActivity = fs.readFileSync(new URL('../lib/server/login-activity.ts', import.meta.url), 'utf8');
const loginActivityRoute = fs.readFileSync(new URL('../app/api/auth/login-activity/route.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('selected membership has a canonical Firestore listener', () => {
  assert.match(workspaces, /export function subscribeToOrganizationMembership/);
  assert.match(workspaces, /onSnapshot\(doc\(db, 'organizations', organizationId, 'members', userId\)/);
  assert.match(context, /subscribeToOrganizationMembership/);
});

test('membership changes clear access and update roles without polling', () => {
  assert.match(context, /nextMembership\.status !== 'active'/);
  assert.match(context, /setMembership\(null\)/);
  assert.match(context, /setCurrentOrganization\(null\)/);
  assert.match(context, /setLicense\(null\)/);
  assert.match(context, /setMembership\(nextMembership\)/);
  assert.match(context, /cancelled = true; unsubscribe\(\)/);
  assert.match(context, /resolutionRequestRef\.current/);
  assert.doesNotMatch(context, /setInterval|setTimeout/);
  assert.match(rules, /userId == request\.auth\.uid && resource\.data\.userId == request\.auth\.uid/);
});

test('trusted profile bootstrap runs before protected membership discovery', () => {
  assert.match(auth, /requestBootstrapWithOneRefresh/);
  assert.ok(auth.indexOf('requestBootstrapWithOneRefresh') < auth.indexOf("getDoc(userRef)"));
  assert.match(bootstrapRequest, /fetchImpl\('\/api\/auth\/bootstrap'/);
  assert.match(bootstrapRequest, /response\.status === 401/);
  assert.match(bootstrapRequest, /getIdToken\(forceRefresh\)/);
  assert.match(bootstrap, /adminAuth\.getUser\(uid\)/);
  assert.match(bootstrap, /emailVerified/);
  assert.match(bootstrap, /organizationInvitations/);
  assert.doesNotMatch(auth, /setDoc\(userRef/);
});

test('bootstrap reuses the verified token identity and transaction profile', () => {
  assert.match(auth, /bootstrapResult\.data\?\.profile/);
  assert.match(bootstrapRoute, /authUser: authenticatedUser/);
  assert.match(bootstrap, /options\.authUser/);
  assert.match(bootstrap, /verifyIdToken\(\.\.\., true\)/);
  assert.match(bootstrap, /profile: nextProfile/);
});

test('auth bootstrap coalesces duplicate same-user startup callbacks', () => {
  assert.match(auth, /bootstrapInFlightRef/);
  assert.match(auth, /current auth-state callback.*same UID|same UID.*reuse the promise/s);
});

test('login activity is server-controlled and organization-scoped', () => {
  assert.match(loginActivity, /adminDb\.runTransaction/);
  assert.match(loginActivity, /FieldValue\.serverTimestamp\(\)/);
  assert.match(loginActivity, /lastLoginAt/);
  assert.match(loginActivity, /lastLoginStatus/);
  assert.match(loginActivity, /lastSuccessfulLoginAt/);
  assert.match(loginActivity, /lastFailedLoginAt/);
  assert.match(loginActivity, /lastLoginFailureCode/);
  assert.match(loginActivity, /memberSnapshot\.exists/);
  assert.match(loginActivityRoute, /getAuthenticatedUser/);
  assert.match(loginActivityRoute, /authenticatedUser\.uid/);
  assert.doesNotMatch(loginActivityRoute, /payload\.status|payload\.failureCode/);
  assert.doesNotMatch(loginActivityRoute, /request\.body.*uid|payload\.uid/);
  assert.doesNotMatch(auth, /lastLoginAt|lastSuccessfulLoginAt|lastFailedLoginAt/);
});

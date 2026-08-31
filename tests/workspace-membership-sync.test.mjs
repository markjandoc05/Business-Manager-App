import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const workspaces = fs.readFileSync(new URL('../lib/repositories/workspaces.ts', import.meta.url), 'utf8');
const context = fs.readFileSync(new URL('../context/WorkspaceContext.tsx', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../lib/server/workspace-bootstrap.ts', import.meta.url), 'utf8');
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
  assert.match(auth, /fetch\('\/api\/auth\/bootstrap'/);
  assert.ok(auth.indexOf("fetch('/api/auth/bootstrap'") < auth.indexOf("getDoc(userRef)"));
  assert.match(bootstrap, /adminAuth\.getUser\(uid\)/);
  assert.match(bootstrap, /emailVerified/);
  assert.match(bootstrap, /organizationInvitations/);
  assert.doesNotMatch(auth, /setDoc\(userRef/);
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

# BSM Client production deployment runbook

This runbook prepares the BSM Client deployment without executing production
changes. Run the commands below only after an explicit deployment approval.

## Discovered production topology

- Google Cloud/Firebase project: `bsm-client-app-web`
- Cloud Run service: `bsm-client-app`
- Region: `asia-southeast1`
- Domain: `https://app.aiph.tech`
- Current revision: `bsm-client-app-00003-pln`
- Current traffic: 100% to the current revision
- Runtime service account: `bsm-client-runtime@bsm-client-app-web.iam.gserviceaccount.com`
- Source deployment mechanism: Cloud Run source deployment/buildpack, with the
  image emitted to Artifact Registry
- Artifact Registry repository: `asia-southeast1-docker.pkg.dev/bsm-client-app-web/cloud-run-source-deploy`

Firebase Hosting is not the serving path for `app.aiph.tech`; the domain is
mapped to Cloud Run. The Firebase default Hosting site exists separately and
is not configured by this repository.

## Runtime identity and configuration

The server-side Firebase Admin SDK uses Application Default Credentials and
fails closed unless the resolved project is exactly `bsm-client-app-web`.
The authoritative runtime identity should be supplied by Cloud Run through
`GOOGLE_CLOUD_PROJECT=bsm-client-app-web`. `GCLOUD_PROJECT`, a parsed
`FIREBASE_CONFIG.projectId`, or the existing Admin app project ID may also
confirm the same identity. `FIREBASE_ADMIN_PROJECT_ID` and
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` are consistency checks, not substitutes for
an authoritative runtime identity.

Required Cloud Run runtime environment variables:

```text
GOOGLE_CLOUD_PROJECT=bsm-client-app-web
BSM_EXPECTED_PROJECT_ID=bsm-client-app-web
```

`BSM_EXPECTED_PROJECT_ID` is an optional explicit assertion and is not used as
the identity source. It is useful as a deployment-time guardrail, so the
prepared command includes it.

The browser Firebase configuration is build-time configuration. The six
approved public variable names must be provided to the Cloud Run source build
and must not be moved into server-only runtime configuration:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

`NEXT_PUBLIC_FIREBASE_PROJECT_ID` must be `bsm-client-app-web`. This document
does not contain any Firebase configuration values or credentials.

For local emulator tests, use only:

```text
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
GCLOUD_PROJECT=demo-bsm-client-app
```

The test commands enforce the demo project and refuse production project
fallback. Never set emulator hosts while pointing at production.

## No-traffic deployment (not executed)

Carry forward the approved existing values for the six public build variables
through the operator's environment. This preserves the existing Cloud Run
source-build mechanism without putting configuration values in source control
or this runbook.

```bash
: "${NEXT_PUBLIC_FIREBASE_API_KEY:?Set the approved production Firebase API key in the shell}"
: "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:?Set the approved production Firebase auth domain in the shell}"
: "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:?Set the approved production Firebase storage bucket in the shell}"
: "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:?Set the approved production Firebase sender ID in the shell}"
: "${NEXT_PUBLIC_FIREBASE_APP_ID:?Set the approved production Firebase app ID in the shell}"

gcloud run deploy bsm-client-app \
  --source . \
  --project=bsm-client-app-web \
  --region=asia-southeast1 \
  --no-traffic \
  --service-account=bsm-client-runtime@bsm-client-app-web.iam.gserviceaccount.com \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=bsm-client-app-web,BSM_EXPECTED_PROJECT_ID=bsm-client-app-web \
  --set-build-env-vars="NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},NEXT_PUBLIC_FIREBASE_PROJECT_ID=bsm-client-app-web,NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}"
```

After deployment, record the new revision name and verify it directly before
promoting traffic. Do not print the shell variables or place them in the
repository.

## Firebase rules and indexes (not executed)

From the repository root:

```bash
firebase deploy --project=bsm-client-app-web --only firestore:rules,firestore:indexes
firebase deploy --project=bsm-client-app-web --only storage
```

These commands deploy the checked-in `firestore.rules`,
`firestore.indexes.json`, and `storage.rules`. They are separate from Cloud
Run deployment and require approval.

## Traffic promotion and rollback (not executed)

Promote the reviewed revision by its exact name after smoke testing. If the
deployment command produced `<new-revision>`, use:

```bash
gcloud run services update-traffic bsm-client-app \
  --project=bsm-client-app-web \
  --region=asia-southeast1 \
  --to-revisions=<new-revision>=100
```

Rollback to the currently known-good revision:

```bash
gcloud run services update-traffic bsm-client-app \
  --project=bsm-client-app-web \
  --region=asia-southeast1 \
  --to-revisions=bsm-client-app-00002-lz6=100
```

## Post-deployment smoke test

1. Confirm the new revision is Ready and serving on port 8080 without any
   dependency or TypeScript installation log.
2. Open `https://app.aiph.tech` and confirm Google sign-in.
3. Confirm the existing organization resolves and Dashboard loads.
4. Confirm Leads, Clients, Deals/Pipeline, Tasks, Reports, Settings, and
   client documents load without permission or project-identity errors.
5. Verify one permitted read and one permitted write using a test record, then
   verify the record persists after refresh.
6. Verify an inactive or cross-organization user remains denied.
7. Confirm Cloud Run traffic is still on the reviewed revision and inspect
   logs for restarts, production fallback, or rejected identity assertions.

## Safety notes

- No deployment, traffic change, Firebase rules deployment, or production data
  change is performed by this document.
- Keep ADC/service-account identity in the runtime environment; do not add a
  service-account JSON key to the repository, image, or environment variables.
- Review the exact resolved build values through the approved deployment
  mechanism without printing them in logs or source control.

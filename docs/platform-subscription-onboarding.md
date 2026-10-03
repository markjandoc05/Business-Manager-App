# Platform subscription onboarding boundary

The Client App consumes the trusted Platform API through same-origin server
proxies. The Platform base URL is server-only (`VENTALE_PLATFORM_API_BASE_URL`)
and is never exposed to browser code. The Client contains no API key, pricing
authority, trial-eligibility logic, commercial mapping, or canonical-license
write path.

## Client flow prepared

When `NEXT_PUBLIC_ENABLE_PLATFORM_ONBOARDING=true`, onboarding is structured
as:

1. Business information (including locale preferences)
2. Plan selection
3. Review and start free trial
4. Platform workspace provisioning
5. Dashboard

The legacy browser-authoritative Firestore bootstrap has been retired. This
flag is now an availability gate only: when it is disabled, new workspace
onboarding is unavailable and fails closed. It can never restore direct
browser creation of an organization, membership, canonical license, slug, or
bootstrap guard.

With Platform onboarding enabled, the browser calls only the Client App proxy
routes; failed Platform provisioning never falls back to local Firestore
provisioning. The Platform/Admin SDK creates the tenant root, initial ADMIN
membership, settings, canonical license, slug mapping, and profile activation.
If it uses `workspaceBootstrap/{uid}` as its provisioning idempotency record,
that record is Platform-owned: the browser cannot create, modify, or delete it.

## Platform V1 contract consumed

The Client App proxies these authenticated, tenant-safe Platform operations:

- `GET /api/v1/plans` for publicly available plans.
- `POST /api/v1/trials` with Firebase ID token and persistent opaque
  `Idempotency-Key`. The Client sends only product code and workspace profile
  fields; the Platform derives all commercial and license authority.
- `GET /api/v1/subscription?workspaceId=…` with Firebase ID token after
  server-side Client membership verification.

Provisioning responses are validated before the workspace context refreshes.
Afterwards, `organizations/{organizationId}/license/current` remains the
Client's canonical, live, read-only authorization source.

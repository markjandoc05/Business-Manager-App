# Shared Firestore index strategy

The Client App's `firestore.indexes.json` is the canonical V1 composite-index manifest for both BSM Client App and BSM Console App. Both applications use Firebase project `bsm-client-app-web`.

The Console repository does not maintain a second index definition. Its Firebase configuration references this manifest. Console's current organization, member-status, license/settings, and createdAt-only audit-log queries require no additional composite indexes.

The current membership discovery index is collection-group scoped:

```text
collectionGroup: members
queryScope: COLLECTION_GROUP
userId ASCENDING
role ASCENDING
status ASCENDING
```

Validate locally with:

```bash
npm run test:indexes
```

Deploy explicitly from the Client App repository:

```bash
firebase deploy --project=bsm-client-app-web --only firestore:indexes
```

Index deployment is intentionally not part of local builds or tests. A deployment may leave newly added indexes in `CREATING` until Firestore reports them as `READY`.

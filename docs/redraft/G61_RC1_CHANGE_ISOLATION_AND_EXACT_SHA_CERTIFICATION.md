# G61 — RC1 Change Isolation and Exact-SHA Certification

## Preservation and base decision

The original mixed worktree remains in place at `F:\allfantasy-v2-main`, on `feat/fantasy-os-intelligence-coach-certified-wiring` at `3a61caf6ef7f37967d46bf7378bf3389224b342a`. It was not modified by the isolation workflow. Its status, 29 pre-existing stashes, worktree list and recent history were captured. Restoration is verified by its continued independent worktree/branch identity.

`origin/main` at `9d554d41fcad6e342c8deff42ade24af24b87411` was selected as the RC base. The current feature HEAD contains a long chain of unrelated Fantasy OS enterprise and sports-data commits; using it would have imported unrelated history. Local `main` was older (`55cbcd5d…`) and checked out in another worktree, so it was neither selected nor touched.

```text
ORIGINAL MIXED WORKTREE PRESERVED: YES
RESTORATION METHOD VERIFIED: YES
SAFE TO BEGIN ISOLATION: YES
```

## Isolation result

A separate worktree and branch were created from the accepted production baseline. The initial checkout was interrupted by a shell timeout and left a stale lock; after confirming only the timed-out Git process owned it, that process/lock was removed and the new worktree was restored from its own HEAD. The resulting initial RC status was clean. No original-worktree path was restored or deleted.

Only files in `NFL_INVITED_MVP_RC1_FILE_MANIFEST.md` were transferred. Clean-graph test failures identified three legitimate dependencies (Prisma generation for local tests, Sleeper import validation/status source, and survivor cast-size clamping). Generated Prisma files remain ignored.

## Review and safety

- No `.env`, credentials, database dump, build output, screenshot, log, local setting or generated artifact is included.
- No schema, migration, deployment or production infrastructure change is included.
- Trade reversal/Renewal, Fantasy OS enterprise/runtime and World Cup changes are excluded.
- The secret scanner exited 0 with baseline warnings only.
- The full proposed diff is reviewed by subsystem through the manifest and staged name-status list.

## Certification

Pre-commit dependency-graph evidence is recorded in `NFL_INVITED_MVP_RC1_CERTIFICATION_EVIDENCE.md`. Exact-SHA and fresh-checkout results are recorded after commit and reported in the G61 completion response.

## Runtime truth

Authenticated runtime, multiplayer draft, live provider and mobile runtime certification remain pending. This phase does not recommend launch.

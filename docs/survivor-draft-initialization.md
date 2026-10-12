# Survivor: completed native draft to game setup

The first Survivor milestone connects a completed native draft to the existing full-concept foundation. It does not certify a complete Survivor season or change the configured rules.

## Behavior

- New native Survivor leagues with `survivorFoundationSettingsVersion: 1` reconcile participants against the current completed native draft and real `Roster` owners. The historical `SurvivorPlayer.redraftRosterId` field stores the legacy `Roster.id`, as required by tribe membership and inventory.
- Unused creation-time open-seat placeholders are replaced by actual owners. Real players, progressed gameplay, assigned placeholders, and legacy hidden inventory are preserved rather than silently deleted or reassigned.
- Every roster needs a different real owner. A non-participating commissioner cannot also own a drafted team; the commissioner must resolve that mismatch before setup proceeds.
- Random assignment uses a repeatable seed for the draft. Draft-pattern assignment uses ordered draft slots, independent of traded pick ownership. Manual assignment stays pending until a complete balanced mapping is provided.
- Participant reconciliation, tribes, chat membership, enabled Vote Shields, the welcome message, and the phase transition share one transaction. A per-league transaction advisory lock serializes automatic and manual foundation setup. Database failure rolls everything back.
- A playing commissioner only joins their own tribe chat. A non-participating host joins tribe chats for oversight. Disabled tribe chats and idols are respected. Hidden inventory remains private.
- Existing welcome messages count as successful setup. Repeated initialization preserves the first start timestamps and avoids duplicate tribes, powers, chats, announcements, and completion audits.
- Setup runs in the awaited post-draft artifact path and can retry on subsequent completed-draft polls. Successful artifact polls are throttled for 60 seconds; immediate manual initialization remains available. Operational blockers appear only in administrator state. Older/imported bootstrap behavior remains on the original completion transition; repair polls only run the new native path.

## Verification

Focused Survivor/draft/Zombie regression suite: 93 tests passed. This includes behavioral checks for awaiting setup, retry after failure, and successful-poll throttling. Changed-file ESLint and whitespace checks pass.

The opt-in database proof creates unique, passwordless fixtures on an explicitly recognized non-production database and cleans up only its own IDs. It verifies concurrent setup, real roster links, private chat memberships, hidden inventory, repeated initialization, disabled features, host participation, draft-pattern/manual assignment, ownership recovery, draft guards, transaction rollback and retry, and preservation of progressed gameplay.

```powershell
node --env-file=.env.test --require ./scripts/_audit-preload.cjs --import tsx scripts/verify-survivor-draft-setup.ts --db
```

The script refuses production even if `ALLOW_PROD_SEED` is set. No schema migration is required.

## Release and remaining work

The repository's CI TypeScript ratchet is the release gate and passed with a freshly generated client. The local shared generated Prisma client is stale for unrelated models; local compiler output contains no errors in changed files. Do not update the error baseline to accommodate it.

Rollback is a code revert. It does not delete committed game setup. If setup fails, retries use the same persisted draft and avoid duplicating existing canonical state. Never use the development reset endpoint as a production rollback.

Next: complete and verify the weekly challenge → Tribal Council → actual roster release → configured Exile enrollment lifecycle, then merge/jury/finale and a full-season simulation. Survivor remains beta until those flows and the player/commissioner GUI are certified together. Zombie and Tournament follow the same shared draft, roster, transaction, and privacy foundations.

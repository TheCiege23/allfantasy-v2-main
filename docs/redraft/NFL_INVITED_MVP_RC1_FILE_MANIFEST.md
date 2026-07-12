# NFL Invited MVP RC1 File Manifest

## Base and preservation

- Base: `origin/main` at `9d554d41fcad6e342c8deff42ade24af24b87411`.
- RC branch: `release/nfl-redraft-invited-mvp-rc1`.
- RC worktree: `C:\Users\Guap_\OneDrive\Documents\AF\af-nfl-invited-mvp-rc1`.
- Original mixed worktree: `F:\allfantasy-v2-main`, branch `feat/fantasy-os-intelligence-coach-certified-wiring`, HEAD `3a61caf6ef7f37967d46bf7378bf3389224b342a`.
- Preservation: the original worktree was not switched, restored, staged, cleaned, stashed or committed. Its branch, tracked/untracked status, stash list and worktree list were captured before isolation.

## Included

The staged manifest (`git diff --cached --name-status`) is the exhaustive file-level authority. The included files are grouped below by ownership and purpose.

| Group | Included paths | Phase/purpose | Runtime/copy/DB-infra impact | Primary regression |
| --- | --- | --- | --- | --- |
| Schedule and league shell | `app/league/[leagueId]/LeagueShell.tsx`, `LeagueTabs.tsx`, canonical Schedule/Standings/Trades/Players/Team views; `components/league/LeagueSurfaceState.tsx`, league home and matchup container | G46/G47/G57/G58 canonical navigation, operations and safe states | Runtime UI and customer copy; no DB/infra change | canonical schedule, core tabs, league visual, standings/workspace tests |
| Commissioner workspace | `components/league-home/CommissionerOperationsWorkspace.tsx` | G47 operational map over existing handlers | Runtime UI/copy; authorization remains in existing APIs | commissioner workspace test |
| Create and import | create route, import commit/persistence, provider UI config, Sleeper validation/status, creation/import components, sport team limits | G54/G55/G60 source fixes and truthful provider selection | Runtime request/UI; existing DB transaction boundary; no migration/infra | create defaults, import validation/commit/dedupe tests |
| Draft integrity | `PickSubmissionService`, mock runtime/API, Draft Room and mock components | G53/G56 pick idempotency, sport isolation and customer UX | Runtime draft behavior/UI/copy; no schema/infra | pick transaction/auth, mock isolation, G56/G60 tests |
| Lineup/waiver/player hardening | roster hook, Team/Players views, waiver components | G58 reconciliation, customer-safe states and terminology | Runtime UI/copy; existing API/DB boundaries only | lineup lock/validation, waiver scope, G58 guardrail |
| Provider canonicalization | NFL orchestrator/wiring/score-injury projectors, canonical valuation gateway, migrated application consumers and legacy server consumers | G50/G51/G52A canonical provider boundary | Runtime provider routing/cache/fallback; no credentials, schema or infra | G49–G52 contracts and canonicalization tests |
| Types/config | `types/next-auth.d.ts`, `types/web-push.d.ts`, `vitest.invited-mvp.config.ts`, one `package.json` source-certification script | G58/G59 deterministic source checks | Type/test configuration only | G58–G60 guardrails |
| Tests | Curated 18-file suite plus focused G50/G51/G54–G60 contracts | All included phases | Test-only | `npm run certify:invited-mvp:source` |
| Documentation | Redraft reports G46–G61, freeze matrix, certification framework, release notes, risks/checklist/evidence | Release governance | Documentation only | G59/G60 document guardrails |

Customer-facing copy changes are limited to the audited AllFantasy-owned terminology and safe error/state messages. No database migration or infrastructure file is included.

## Excluded classifications

Every original changed/untracked item not present in the RC staged manifest is excluded and remains recoverable in the original worktree.

| Classification | Excluded examples/reason |
| --- | --- |
| Unrelated | Fantasy OS enterprise/sports-runtime/Decision OS work; Trade OS reversal and Renewal; World Cup/bracket work; other sports; landing/settings/auth redesigns not proven dependencies |
| Generated | `.next*`, build output, caches, Prisma generated client, coverage, test reports and compiled artifacts |
| Local-only | `.claude/settings.local.json`, editor state, local backups, temporary audits/scripts, screenshots and browser traces |
| Secret-sensitive | `.env*`, connection details, credentials, cookies, session material and private test identities; none transferred |
| Deferred | Database schema/migrations, infrastructure/deployment changes, provider expansion, auction, renewal and Trade P0 physical work |
| Investigated dependency | Sleeper validation/status, create route and survivor team-limit helper were added only after clean-graph tests proved the dependency; Prisma client was generated locally but remains ignored/untracked |

## Review controls

- No bulk copy of the original worktree was used.
- Main and the original branch were not modified.
- `npm run secret-scan` exited 0. Its 14 warnings are baseline repository warnings outside this RC diff; no hardcoded credential finding was reported.
- `git diff --check` passed before staging.
- The clean graph initially exposed missing Sleeper validation and survivor clamp dependencies; they were added deliberately and the 18-file suite then passed 136/136.

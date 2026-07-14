# NFL Invited MVP RC1 Checklist

Statuses: `PASS`, `PARTIAL`, `BLOCKED`, `NOT STARTED`. A source pass does not satisfy a runtime gate.

| Item | Owner | Status | Evidence | Blocker / exit action |
| --- | --- | --- | --- | --- |
| MVP feature scope frozen | Product owner | PASS | G58 feature matrix; G60 inventory | Changes require a separately reviewed phase |
| Every advertised feature mapped to implementation | Release engineer | PASS at source level | G60 inventory | Recheck on frozen SHA and authenticated routes |
| Unsupported providers/modes/types hidden or labeled | Product + QA | PARTIAL | Matrix, provider config, G60 copy guardrails | Authenticated negative-path inspection still required |
| Customer-copy audit | Product + UX | PASS for audited RC surfaces | G60 copy changes and guardrail | Browser-rendered copy review pending |
| Dead-feature audit | Release engineer | PARTIAL | G60 findings | Full reachable click audit requires browser; mixed worktree prevents immutable result |
| Source regression suite | Build owner | PASS on working tree | `npm run certify:invited-mvp:source` final G60 result | Must rerun on frozen commit |
| Full TypeScript | Build owner | BLOCKED | G58 304-second timeout without diagnostics | Complete on clean frozen SHA |
| Targeted ESLint | Build owner | PASS for G60 changes | G60 validation log | Rerun on frozen SHA |
| Diff hygiene | Release engineer | PARTIAL | G60 targeted `git diff --check` | Isolate candidate; remove temp/build/local artifacts; inspect full release diff |
| RC reproducible commit/SHA | Release owner | BLOCKED | Branch/HEAD/worktree capture | Create reviewed release commit; no force-push requirement inferred |
| Documentation package | Release engineer | PASS | G59/G60 docs | Bind final evidence to frozen SHA |
| Authenticated create/import/invite | Product QA | BLOCKED | G48/G48A reports | Trusted browser + safe non-prod DB + real identities |
| Authenticated full-season | League QA | BLOCKED | G48 report | Complete journey and persistence checks |
| Multiplayer draft | Draft QA | BLOCKED | G53B + G59 script | Three trusted authenticated clients |
| Live providers | Data QA | BLOCKED | G52A + provider matrix | Authorized credentials and live evidence packet |
| Mobile runtime | UX QA | BLOCKED | G58/G59 gates | Desktop and 390×844 real-browser execution |
| Production deployment/smoke | Operations | NOT STARTED | None | Only after gates and explicit owner approval |
| Owner launch approval | Product owner | NOT STARTED | None | Requires exact-SHA evidence and no open P0/P1 |

## Freeze rules

- No feature expansion after the frozen SHA. Only a release-blocking fix with focused regression and risk update may enter RC1.
- Do not include build output, screenshots, credentials, `.env*`, local backups, temporary files or unrelated feature work.
- Do not tag, deploy, merge or call RC1 launch-ready from this checklist alone.
- Record commit SHA, tree status, Node/npm versions, exact commands and timestamps for every final rerun.
- Any candidate change invalidates affected evidence and requires a new RC revision or explicitly documented rerun.

## Required final sequence

1. Isolate and review the intended release diff from the mixed worktree.
2. Commit a reproducible RC1 candidate and confirm a clean tree except explicitly excluded local state.
3. Complete full TypeScript and rerun the source runner/lint/diff checks on that SHA.
4. Execute authenticated create/import/full-season and multiplayer certification.
5. Execute live-provider and mobile runtime certification.
6. Resolve all P0/P1 and explicitly disposition P2.
7. Request explicit owner approval for the exact SHA.

# NFL Invited MVP RC1 Certification Evidence

## Candidate

- Branch: `release/nfl-redraft-invited-mvp-rc1`
- Base SHA: `9d554d41fcad6e342c8deff42ade24af24b87411`
- Final SHA: recorded in the G61 completion report after commit (a commit cannot contain its own SHA without changing it)
- Runtime certification: not performed

## Pre-commit clean-graph evidence

1. Locked dependency install: `npm ci --ignore-scripts` — exit 0; 1,017 packages installed. Audit reported 35 dependency advisories (2 low, 16 moderate, 17 high); no automatic fix was run.
2. Prisma client generation: `npm run prisma:generate` — exit 0; generated locally from the base schema; generated output is ignored and not committed.
3. First source run: 14/18 files passed; two suites failed to load without generated Prisma client, four import tests exposed a missing Sleeper validation module, and one create test exposed a missing survivor clamp dependency. Not counted as pass.
4. Second source run after Prisma/Sleeper dependencies: 17/18 files and 135/136 tests passed; survivor clamp still failed. Not counted as pass.
5. Third source run after the reviewed team-limit dependency: 18/18 files and 136/136 tests passed; 0 failures, skips, retries or timeouts; Vitest duration 101.50s.
6. `npm run secret-scan` — exit 0; no hardcoded-key finding; 14 baseline warnings outside the RC diff.
7. `git diff --check` — exit 0 before staging.

## Exact-SHA and reproducibility evidence

This section is completed by the post-commit certification run and the separate fresh-checkout run. Earlier dirty-worktree G60 results are not evidence for this candidate.

## Evidence boundary

No browser, authenticated session, database connection/mutation, live provider call, multiplayer session, mobile-runtime check, deployment or production action occurred.

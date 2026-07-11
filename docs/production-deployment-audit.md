# Production Deployment Audit

Last audited: 2026-06-12

Scope: production deployment verification and activation planning for `www.allfantasy.ai`.
This audit intentionally avoids implementation work in playoffs, champion finalization,
standings logic, trades, commissioner workflow, roster workflow, and league mechanics.

## Executive Answer

Production is not serving current `main`.

`www.allfantasy.ai` is owned by the Vercel project `allfantasy-v2`
(`prj_qKhVsRAthyaWAA3Orri6I6r5xyPp`) under `theciege23s-projects`. The domain is
currently aliased to deployment `dpl_CgQriyJXhDhrBGDJqfZTqCtiNF7c`, created on
2026-05-26 from `github.com/TheCiege23/allfantasy-v2-main`, branch
`visual/brackets-world-cup-premium-pass`, commit `5883720f4f24a271e30f6fff7b380b1c141caa8f`.

Current `origin/main` at audit time is
`c56f5e5111af77a5dde70d87d442047f055996db`. This means the production domain is
not merely behind `main`; it is serving a different branch lineage. The commit
that should be serving production is the latest vetted `origin/main` commit at
the time activation is performed. As of this audit, that is `c56f5e5111af77a5dde70d87d442047f055996db`.

Risk level: high for any blind production action. The safest fix is to reactivate
the Vercel account if needed, confirm `allfantasy-v2` is the only production
domain owner, set/confirm the Vercel Production Branch as `main`, deploy the
current `origin/main` commit through that project, and verify the build log says
it cloned `Branch: main, Commit: <origin/main>`.

## Evidence Collected

### Git State

- Repo remote: `https://github.com/TheCiege23/allfantasy-v2-main.git`
- Active branch: `main`
- `origin/main`: `c56f5e5111af77a5dde70d87d442047f055996db`
- Production deployment commit: `5883720f4f24a271e30f6fff7b380b1c141caa8f`
- `5883720` is contained by local branches `visual/brackets-world-cup-premium-pass`
  and `fix/world-cup-group-thirdplace-bracket-i18n`, not by current `main`.

Recent `main` commits after the production branch point include:

- `c56f5e511 fix: finalize redraft season champion`
- `98d58dcdb fix: align NFL NCAAF evidence readers with schema`
- `92095eb28 fix: advance redraft playoff winners`
- `d1e4f75f5 fix: route fantasy league standings through standings engine`
- `1c400a659 fix: stabilize roster page and keep league chat visible`
- `10f8b8a57 feat: verify NFL NCAAF provider ingestion and AI evidence`
- `44c1ac5c3 fix: make league dashboard full width with collapsible side panels`
- `d3d59670a fix: render league pages as full dashboard layout`
- `ccbae9392 feat(data): NFL/NCAAF fantasy data import layer and league AI grounding`

This audit does not evaluate the product logic in the off-limits commits; it only
uses commit identity to determine deployment freshness.

### Vercel Project And Domain Mapping

Local Vercel link:

```json
{
  "projectId": "prj_qKhVsRAthyaWAA3Orri6I6r5xyPp",
  "orgId": "team_DhoEuR3jgBRtapksk4lrIZ6y",
  "projectName": "allfantasy-v2"
}
```

Vercel project inspection:

- Account: `theciege23`
- Team/scope: `theciege23s-projects`
- Project: `allfantasy-v2`
- Project ID: `prj_qKhVsRAthyaWAA3Orri6I6r5xyPp`
- Root directory: `.`
- Framework: Next.js
- Project Node setting: `24.x`
- Current repo engines: `node 24.x`

Domain inspection:

- Domain: `allfantasy.ai`
- Registrar: third party
- Current nameservers: `ns25.domaincontrol.com`, `ns26.domaincontrol.com`
- Vercel domain mapping:
  - `allfantasy-v2` owns `www.allfantasy.ai`
  - `allfantasy-v2` owns `allfantasy.ai`

Current production deployment:

- Deployment ID: `dpl_CgQriyJXhDhrBGDJqfZTqCtiNF7c`
- Deployment URL: `https://allfantasy-v2-hw8mxwsu8-theciege23s-projects.vercel.app`
- Target: `production`
- Status: Ready
- Created: 2026-05-26 19:34:37 EDT
- Aliases:
  - `https://www.allfantasy.ai`
  - `https://allfantasy.ai`
  - `https://allfantasy-v2.vercel.app`
  - `https://allfantasy-v2-theciege23s-projects.vercel.app`
  - `https://allfantasy-v2-git-visual-brackets-w-48785a-theciege23s-projects.vercel.app`

Build log for the aliased production deployment:

```text
Cloning github.com/TheCiege23/allfantasy-v2-main
(Branch: visual/brackets-world-cup-premium-pass, Commit: 5883720)
```

Production HTTP checks:

- `GET https://www.allfantasy.ai/` returns `200 OK` from Vercel.
- `GET https://www.allfantasy.ai/api/health` returns `ok:true`,
  `database.connected:true`, and `env.valid:true`.

So the site is up, but it is serving the wrong source commit.

## Deployment Chain

Intended/documented chain:

```text
GitHub repo TheCiege23/allfantasy-v2-main
  -> Vercel project allfantasy-v2
  -> Production branch main
  -> Domains www.allfantasy.ai and allfantasy.ai
```

Observed production chain:

```text
GitHub repo TheCiege23/allfantasy-v2-main
  -> Vercel project allfantasy-v2
  -> Production deployment from branch visual/brackets-world-cup-premium-pass
  -> Commit 5883720f4f24a271e30f6fff7b380b1c141caa8f
  -> Domains www.allfantasy.ai and allfantasy.ai
```

Preview behavior:

- `docs/staging.md` documents `main -> Production` and feature branches as
  Vercel Preview deployments.
- Vercel deployment history confirms both Preview and Production targets exist.
- Preview deployments were observed for non-production branch builds.

Production branch setting:

- The repo documentation says `main` should be Production.
- The Vercel CLI project inspect output does not expose the Git Production Branch
  setting in this session.
- The effective production deployment is definitely from
  `visual/brackets-world-cup-premium-pass`. This means either the Vercel
  Production Branch was changed away from `main`, or a non-main branch deployment
  was manually promoted to Production. The remediation step must manually verify
  Vercel Dashboard -> Project -> Settings -> Git -> Production Branch.

Deploy hook usage:

- The previous NFL/NCAAF provider audit records a deploy hook accepting a job for
  project `prj_xMYOVacH6URCKx5ZDa8XbOFq4oHm`.
- That project is not listed by the currently linked Vercel account/project
  context, and it is not the project that owns `www.allfantasy.ai`.
- Do not use that deploy hook for production activation until its project,
  repo, branch, and domain ownership are inspectable.

## Other Vercel Projects

Accessible Vercel projects in the account include multiple AllFantasy-like
projects:

- `allfantasy-v2`: owns `www.allfantasy.ai` and `allfantasy.ai`; connected to
  `TheCiege23/allfantasy-v2-main` in the inspected production build logs.
- `allfantasyapp`: has production deployments but aliases only
  `allfantasyapp.vercel.app`; inspected build logs show it clones
  `github.com/TheCiege23/allfantasy-v2`, not `allfantasy-v2-main`.
- `allfantasy-worldcup-integration`: exists with no deployments found.

Only `allfantasy-v2` should be used for the public production domain unless the
domain is intentionally migrated.

## Latest Feature Visibility

Because `www.allfantasy.ai` serves commit `5883720`, users on the public domain
do not have the latest `main` changes below:

| Area requested for verification | Main commit evidence | Public production visibility |
| --- | --- | --- |
| Standings fix | `d1e4f75f5` | Not live on `www.allfantasy.ai` |
| Playoff advancement fix | `92095eb28` | Not live on `www.allfantasy.ai` |
| League layout fixes | `44c1ac5c3`, `d3d59670a`, `debf58b30` | Not live on `www.allfantasy.ai` |
| NFL/NCAAF evidence fixes | `10f8b8a57`, `98d58dcdb`, `ccbae9392` | Not live on `www.allfantasy.ai` |
| Chimmy grounding fixes | `10f8b8a57`, `98d58dcdb` | Not live on `www.allfantasy.ai` |

The production health endpoint is green, but green health only proves the stale
deployment can start and reach the database. It does not prove current `main`
features are accessible.

## Build And Deployment Architecture

Important files:

- `vercel.json`: declares a large Vercel Cron schedule, including many
  `/api/cron/*` import routes.
- `scripts/vercel-next-build.cjs`: Vercel build wrapper that temporarily moves
  selected routes out of the source tree before `next build` to stay under route
  limits and keep deferred/dev surfaces out of production.
- `package.json`: exposes `vercel-build` as `node scripts/vercel-next-build.cjs`.
- `docs/deployment.md`: production environment, deploy, health, and rollback
  checklist.
- `docs/staging.md`: states Vercel hosting uses `main -> Production` and feature
  branches create Preview deployments.
- `.github/workflows/wc-cron.yml`: GitHub Actions schedule for World Cup sync;
  comment says it replaces Vercel cron entries in `vercel.json` for that area.

Vercel project inspect displays the default Next.js build command, but inspected
deployment logs show Vercel ran:

```text
npm run vercel-build
```

That happens because the package defines a `vercel-build` script.

The project setting reports Node `24.x`. `package.json` engines is now `24.x`
as well, so the package constraint and the project setting agree and the build
resolves to Node 24. (Historically engines was `>=20.19.0 <21`, and because
Vercel honors package engine constraints over the project setting, the runtime
resolved to Node 20 despite the `24.x` project setting; the engines bump removes
that override.)

## Cron And Import Architecture

Current state:

- `vercel.json` declares many scheduled jobs under `/api/cron/*`, including
  players, injuries, schedules, news, standings, scores, depth charts, ADP, and
  other jobs.
- `scripts/vercel-next-build.cjs` includes `app/api/cron` in
  `routeDirsToDisable`.
- Its keep-list preserves only:
  - `app/api/cron/_auth.ts`
  - `app/api/cron/waivers/route.ts`
  - selected admin/waiver AI routes
- Therefore, most cron import routes declared in `vercel.json` are removed
  during the Vercel production build.
- Admin import/status routes remain available in source:
  - `POST /api/admin/fantasy-data/import`
  - `GET /api/admin/fantasy-data/status`
  - `POST /api/admin/sports/sync`
  - `POST /api/sports/sync`

Verdict: the route exclusion is intentional as a route-budget/build strategy,
but the mismatch with `vercel.json` looks accidental operational drift. The
codebase says "schedule these cron routes," while the Vercel build removes most
of those routes.

Safest production strategy:

- Do not rely on Vercel Cron for excluded `/api/cron/*` import routes.
- Short term: use authenticated admin import/status routes for manual or
  operator-triggered import verification after current `main` is deployed.
- Short term for World Cup only: continue using `.github/workflows/wc-cron.yml`
  if `APP_URL` points at the intended live host and the target routes are present.
- Medium term: choose one cron owner. Railway is a good candidate for worker-like
  import execution because imports are operational jobs, not page-serving
  traffic. Railway should either run direct worker scripts or call stable
  authenticated admin/import endpoints.
- If Vercel must own cron, re-include a minimal set of cron routes and remove or
  disable stale `vercel.json` schedules that point at routes excluded from the
  Vercel build.

## Deployment Risks

- Public production is serving a non-main branch commit from 2026-05-26.
- The production branch setting was not exposed by CLI inspection, and the live
  production deployment contradicts the documented `main -> Production` model.
- The Vercel team returned an account suspension error on a write-like alias
  command. Production deploy/promote/alias actions may be blocked until billing
  or account status is resolved.
- Multiple AllFantasy Vercel projects exist; `allfantasyapp` is connected to the
  older `TheCiege23/allfantasy-v2` repo and should not be used for the current
  public domain.
- A previously used deploy hook targets an uninspectable project ID and should
  not be trusted for production alignment.
- The Vercel cron configuration and Vercel build route exclusions disagree.
- Project Node setting and repo Node engine constraints differ; confirm the
  actual build runtime before relying on a deployment.

## Safest Fix

1. Resolve Vercel account/billing suspension so production write actions are
   permitted.
2. In Vercel, confirm the target project is `allfantasy-v2`
   (`prj_qKhVsRAthyaWAA3Orri6I6r5xyPp`).
3. Confirm `www.allfantasy.ai` and `allfantasy.ai` remain assigned to
   `allfantasy-v2`.
4. In Vercel Project Settings -> Git, confirm the Git repo is
   `TheCiege23/allfantasy-v2-main`.
5. In the same settings, set or confirm Production Branch is `main`.
6. Do not use the old/uninspectable deploy hook until it is proven to target
   `allfantasy-v2`.
7. Trigger a clean production deployment from `origin/main`. Prefer the Vercel
   Git integration or Dashboard redeploy from `main`; avoid `vercel deploy --prod`
   from a dirty local worktree.
8. Verify the production build log starts with:

   ```text
   Cloning github.com/TheCiege23/allfantasy-v2-main
   (Branch: main, Commit: <current origin/main>)
   ```

9. Verify the Ready deployment aliases include:
   - `https://www.allfantasy.ai`
   - `https://allfantasy.ai`
   - `https://allfantasy-v2.vercel.app`
10. Run post-deploy checks:
   - `GET https://www.allfantasy.ai/api/health`
   - `vercel inspect <new-production-url> --logs`
   - authenticated smoke for NFL/NCAAF evidence and Chimmy grounding
   - admin import/status route smoke
11. Decide cron ownership before treating import freshness as automated:
   - Railway/GitHub Actions calls stable authenticated endpoints, or
   - Vercel build includes the cron routes declared in `vercel.json`.

## Final Classification

- Is production actually on current `main`? No.
- Exact mismatch: `www.allfantasy.ai` maps to Vercel project `allfantasy-v2`,
  but its current Production alias serves deployment `dpl_CgQriyJXhDhrBGDJqfZTqCtiNF7c`
  from branch `visual/brackets-world-cup-premium-pass` at commit `5883720`,
  not `origin/main` at commit `c56f5e511`.
- Safest fix: restore Vercel write capability, confirm `allfantasy-v2` Git and
  domain settings, set/confirm Production Branch `main`, deploy current
  `origin/main`, then verify aliases and logs before declaring activation done.
- Risk level: high until the account state, production branch setting, and deploy
  hook/project ownership are corrected; moderate after those are confirmed and a
  current-main build is Ready; low only after alias inspection proves
  `www.allfantasy.ai` serves the current `origin/main` commit.

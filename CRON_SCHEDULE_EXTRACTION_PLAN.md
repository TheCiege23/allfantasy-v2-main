# Move the cron schedule out of `vercel.json`

**Status:** draft for review. Nothing in `scripts/` has been changed. Only
`cron-schedule.json` has been added, and it is inert until something reads it.

**Base this on `origin/main`,** not on the current working tree — the cron
scripts arrived in `#601` and are not in `fix/cron-freshness-seasonal-probes`.

---

## Why

The Hobby plan rejects any deployment declaring a cron that fires more than once
per day. `vercel.json` on `main` declares 42. Every deploy fails at build time:

```
Error: Hobby accounts are limited to daily cron jobs.
This cron expression (*/10 * * * *) would run more than once per day.
```

Vercel has not *executed* these since the Railway move — `cron-fast-tier.yml`
and `cron-slow-tier.yml` do, reading the list through `scripts/cron-tier.mjs`.
The declaration in `vercel.json` blocks deploys and buys nothing.

The workaround in use is emptying `vercel.json` to `{}` on local disk before
each `vercel --prod`. Three costs:

1. **Production matches no commit.** The current live build came from a working
   tree with a hand-edited config, on a branch several commits behind `main`.
2. **Merges to `main` cannot deploy**, so `#601`–`#611` are not in production.
3. **It silently disables the keep-line guard.** `vercel-next-build.cjs:296`
   reads `vercel.json` to verify no scheduled cron points at a route the build
   excludes. With `{}` it reads zero crons and passes vacuously — build logs
   have been printing `Cron keep-line guard: 0 scheduled cron(s) verified`.
   That guard exists because this has regressed twice (comment at :289).

---

## Design

Move the array to `cron-schedule.json` at the repo root — same shape, same
`crons` key. Consumers change one path and gain a fallback.

Keeping the key name means no consumer changes *how* it reads the data, only
*where from*. The `vercel.json` fallback keeps the change bisectable and lets it
land before or after the `vercel.json` edit without a flag day.

---

## Changes

### 1. `cron-schedule.json` — added (done)

42 jobs, generated verbatim from `origin/main:vercel.json`. **Already verified
byte-identical.** Re-verify after any rebase:

```bash
node -e "
const {execSync}=require('child_process');
const a=JSON.parse(execSync('git show origin/main:vercel.json',{maxBuffer:1e7})).crons;
const b=require('./cron-schedule.json').crons;
console.log(a.length, b.length, JSON.stringify(a)===JSON.stringify(b)?'IDENTICAL':'DRIFT');
"
```

Must print `42 42 IDENTICAL`. This check already caught one drift: an earlier
hand-copied version had 41 and was missing
`/api/cron/decision-os-activity-ingest?relayOnly=1` from `#605`.

### 2. `scripts/cron-tier.mjs` — the canonical loader

```js
export function readVercelCrons(cwd = process.cwd()) {
  const raw = fs.readFileSync(path.join(cwd, 'vercel.json'), 'utf8')
  const parsed = JSON.parse(raw)
  return (parsed.crons ?? [])
    .filter((c) => typeof c?.path === 'string' && typeof c?.schedule === 'string')
    .map((c) => ({ path: c.path, schedule: c.schedule }))
}
```

becomes:

```js
/**
 * Reads the schedule from cron-schedule.json, falling back to vercel.json.
 *
 * The schedule left vercel.json because the Hobby plan refuses to build any
 * deployment declaring a sub-daily cron. Vercel has not executed these since
 * the Railway move — the fast/slow tier workflows do — so the declaration was
 * blocking deploys for no benefit.
 *
 * Keep the fallback. It lets this land independently of the vercel.json edit
 * and keeps `git bisect` working across the change.
 */
export function readCronSchedule(cwd = process.cwd()) {
  for (const file of ['cron-schedule.json', 'vercel.json']) {
    let raw
    try {
      raw = fs.readFileSync(path.join(cwd, file), 'utf8')
    } catch {
      continue
    }
    const crons = JSON.parse(raw).crons ?? []
    if (crons.length === 0) continue
    return crons
      .filter((c) => typeof c?.path === 'string' && typeof c?.schedule === 'string')
      .map((c) => ({ path: c.path, schedule: c.schedule }))
  }
  // Empty is never correct here. Returning [] makes every consumer report
  // "nothing scheduled" — exactly how the keep-line guard went dark.
  throw new Error(
    'No cron schedule found. Expected a non-empty `crons` array in ' +
      'cron-schedule.json (preferred) or vercel.json.',
  )
}

/** @deprecated name kept so existing importers keep working. Prefer readCronSchedule. */
export const readVercelCrons = readCronSchedule
```

The throw matters. Every silent-failure bug in this system so far — the dead
cron reporting healthy (`#602`), the starved fast tier (`#607`), the keep-line
guard reading zero — came from something returning empty instead of failing.

Confirm the importer list before editing:

```bash
git grep -n "readVercelCrons" origin/main
```

### 3. `scripts/vercel-next-build.cjs` (~line 296) — restores the guard

```js
crons = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')).crons || []
```

becomes:

```js
// cron-schedule.json first; vercel.json is the pre-extraction fallback.
crons = []
for (const f of ['cron-schedule.json', 'vercel.json']) {
  try {
    const found = JSON.parse(fs.readFileSync(path.join(repoRoot, f), 'utf8')).crons || []
    if (found.length) { crons = found; break }
  } catch { /* try next */ }
}
```

Leave the `return` on the catch path at :298 — "neither file exists" is still a
legitimate no-op.

### 4. `scripts/cron-budget-check.mjs` (line 56)

```js
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
```

Import the loader instead of re-reading:

```js
import { readCronSchedule } from './cron-tier.mjs'
const crons = readCronSchedule(root)
```

Check how `config` is used below :56 — if it reads non-cron keys, keep that read
and redirect only the `.crons` access.

### 5. `scripts/route-budget-count.mjs` (line 119)

```js
try { crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons?.length || 0 } catch {}
```

```js
try { crons = JSON.parse(readFileSync('cron-schedule.json', 'utf8')).crons?.length || 0 } catch {}
if (!crons) { try { crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons?.length || 0 } catch {} }
```

Count only — the swallowed catch is fine here.

### 6. `scripts/audit-route-budget.cjs` (line 6)

`vercelConfigPath` may read non-cron config. **Read it first** — if it never
touches `.crons`, leave it alone.

### 7. `lib/` — two more readers, in runtime app code

`git grep -n "readVercelCrons" origin/main` turned up two implementations
outside `scripts/`. Both are **separate copies** of the same logic, not
importers of `cron-tier.mjs` — so there are three independent implementations of
"read the cron list" in this repo.

**`lib/production-health/cronRegistry.ts:177`**

```ts
export function readVercelCrons(cwd: string = process.cwd()): RawCron[] {
  try {
    const raw = fs.readFileSync(path.join(cwd, "vercel.json"), "utf8")
    ...
  } catch {
    return []
  }
}
```

**`lib/admin-dashboard/AdminProductionReadinessService.ts:223`** — a private
function with effectively identical behaviour.

Both need the same two-file lookup. Both `catch { return [] }`, which is the
silent-empty failure mode this plan exists to stop: with `vercel.json` at `{}`
they report "zero crons declared" and the production-health and admin-readiness
surfaces show a clean bill of health for a system that is entirely undeclared.
**They are almost certainly doing that right now** — the live deployment was
built from a tree with `vercel.json` emptied.

Prefer consolidating both onto one shared reader. If that is too much surface
for this change, at minimum give each the `cron-schedule.json` → `vercel.json`
fallback, and consider whether `return []` should become a throw here too.

> **Open question — does either file exist inside the lambda at runtime?**
> These run in deployed app code, where `process.cwd()` is `/var/task`. Next.js
> does not bundle `vercel.json` into the server output by default. If it is
> absent, these have been returning `[]` in production since they shipped and
> only ever worked locally and in CI. Verify before assuming this change alters
> their behaviour — it may be fixing something already broken, or may need
> `outputFileTracingIncludes` in `next.config` to ship `cron-schedule.json`.

### 8. `__tests__/` — three files, no change needed

`cron-fast-tier-loop.test.ts`, `cron-fast-tier-starvation.test.ts`, and
`cron-tier-and-freshness.test.ts` all import `readVercelCrons` from
`cron-tier.mjs`. The deprecated alias in item 2 keeps them compiling, and they
run with `cwd` at the repo root so they will pick up `cron-schedule.json`.

They are also the best regression net here: they assert the fast/slow split
against real data. Run them first after Commit A.

### 9. `.github/workflows/cron-slow-tier.yml` — comments

Line 28 says *"ADDING A CRON: add it to vercel.json."* Update to name
`cron-schedule.json`, or the next person adds a job to a file nothing reads.
Lines 3 and 6 need the same treatment.

Line 3 also says "25 hourly-or-slower crons" — it is now **26**, because `#605`
added `decision-os-activity-ingest?relayOnly=1` on `0 */6 * * *`. That drift
predates this change. Worth confirming that schedule is present in the
workflow's own `schedule:` block, or `cron-budget-check.mjs` will flag it.

### 10. `vercel.json` — becomes `{}`

Only after 2–9 are merged and green.

---

## Consumer inventory

Seven readers, three separate implementations. Found via
`git grep -n "readVercelCrons" origin/main` plus
`git grep -n "vercel\.json" origin/main -- scripts .github`. **Re-run both
before implementing** — this list grew from five to seven once `lib/` was
searched, and `#605` landed a new cron mid-draft.

| File | Kind | Behaviour on empty |
|---|---|---|
| `scripts/cron-tier.mjs:76` | canonical loader | returns `[]` |
| `scripts/vercel-next-build.cjs:296` | build guard | passes vacuously |
| `scripts/cron-budget-check.mjs:56` | CI check | own read |
| `scripts/route-budget-count.mjs:119` | count only | `0` |
| `scripts/audit-route-budget.cjs:6` | unverified | unknown |
| `lib/production-health/cronRegistry.ts:177` | **runtime** | `catch → []` |
| `lib/admin-dashboard/AdminProductionReadinessService.ts:223` | **runtime** | `catch → []` |

---

## Rollout order

Two commits, not one.

**Commit A — readers.** Items 1–9. `vercel.json` still holds all 42, so both
files agree and every consumer reads identical data whichever it picks. No
behavioural change; this is the safe half.

**Commit B — `vercel.json` → `{}`.** Only after A is on `main` and one
`cron-fast-tier` and one `cron-slow-tier` run have gone green against it.

Doing both at once means a bad reader takes the crons down with no way to tell
which half broke it.

---

## Verification

Verified against `origin/main`'s `cron-tier.mjs` and the new file:

```
total    42
fast     12
slow     26
excluded  4
```

Re-run after Commit A:

```bash
node -e "import('./scripts/cron-tier.mjs').then(m=>{
  const c=m.readCronSchedule(process.cwd());
  const {fast,slow,excluded}=m.classifyCrons(c);
  console.log('total',c.length,'fast',fast.length,'slow',slow.length,'excluded',excluded.length);
})"
```

Any other split means the loader is reading the wrong file or dropping entries.

The 4 excluded, for reference: `redraft/ai/weekly-recap`,
`redraft/ai/power-rankings`, `guillotine/ai/storyline`,
`brackets/world-cup/cron/sync`.

Then run both workflows via `workflow_dispatch` and confirm job counts match the
previous scheduled run.

After Commit B, the build log must read
`Cron keep-line guard: 42 scheduled cron(s) verified` — **not** `0`.

---

## Risks

- **Double-firing.** If `vercel.json` regains its crons on a paid plan while the
  workflows are enabled, every job runs twice. Whoever restores Vercel-native
  execution must disable both workflows in the same change.
- **A concurrent session owns this code.** `origin/fix/cron-freshness-seasonal-probes`
  was rebuilt on newer `main` while this was being written. Coordinate before
  pushing; do not rebase their branch.
- **This repo is public.** Secret-scan before pushing, per `CLAUDE.md`.

/**
 * Delete Neon `preview/pr-<n>-*` branches whose pull request is closed.
 *
 * ⚠ NO SHEBANG, DELIBERATELY — PUTTING ONE BACK STOPS THE TESTS PARSING THIS FILE. Vitest's SSR
 * transform hoists the `node:url` import to offset 0, landing it on top of a `#!` line:
 *   const pathToFileURL = __vite__cjsImport0_node_url["pathToFileURL"];#!/usr/bin/env node
 * `scripts/schema-drift-summary.mjs` — the other .mjs a test imports — carries no shebang for
 * the same reason, while the CLI-only ones (ts-error-ratchet, check-db-first-api-boundary) do.
 * This is always invoked as `node scripts/…`, so the shebang bought nothing.
 *
 * ── WHY A RECONCILER AND NOT ANOTHER FIX TO THE DELETE JOB ─────────────────────────────────────
 * `.github/workflows/neon-pr-branches.yml` already deletes a branch when its PR closes, and it
 * works: 295 of the last 300 runs succeeded, with the rest still in flight. But on 2026-09-20 the
 * project held 71 preview branches, 67 of them for PRs long since closed — 124 GB.
 *
 * 🛑 THE PER-EVENT CAUSE OF THOSE MISSES IS UNKNOWN, AND THIS DOES NOT PRETEND TO KNOW IT. Two
 * plausible explanations were checked and BOTH DISPROVEN: the delete job computes
 * `preview/pr-<n>-<head with / → ->`, and that string matches the stored Neon name exactly for all
 * nine leaked branches; and no run of that workflow has been cancelled in its retained history, so
 * concurrency eviction did not eat them either. The runs from the days that leaked (2026-07-19,
 * 08-18, 09-13) are past GitHub's retention, so the evidence is gone.
 *
 * An event handler is best-effort by nature: one missed webhook, one API blip, one re-run of an
 * old create job, and the branch outlives its PR with nothing to notice. This asserts the
 * invariant instead — "no preview branch outlives its PR" — so any miss self-heals on the next
 * run whatever caused it.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────────────────────────
 * It deletes DATABASES. Every rule below fails CLOSED:
 *   · only names matching /^preview\/pr-(\d+)-/ are ever candidates;
 *   · primary, default or protected branches are never candidates, whatever their name;
 *   · a PR that is OPEN, missing, or unreadable KEEPS its branch — unknown is not permission;
 *   · nothing is deleted without --apply. The default is a report.
 *   · at most MAX_DELETES per run, so a defect cannot empty the project in one pass.
 *
 * Usage:
 *   node scripts/neon-prune-preview-branches.mjs              # report only
 *   node scripts/neon-prune-preview-branches.mjs --apply      # delete
 *   NEON_API_KEY, NEON_PROJECT_ID, GITHUB_REPOSITORY, GH_TOKEN
 */

import { pathToFileURL } from 'node:url'

const NEON_API = 'https://console.neon.tech/api/v2'
const MAX_DELETES = 40

/** A branch is a candidate only if its NAME says PR and its FLAGS say disposable. */
export function candidatePrNumber(branch) {
  if (!branch || typeof branch.name !== 'string') return null
  if (branch.primary || branch.default || branch.protected) return null
  const m = branch.name.match(/^preview\/pr-(\d+)-/)
  return m ? Number(m[1]) : null
}

/**
 * CLOSED and MERGED are deletable. Everything else — OPEN, absent, a state this does not
 * recognise — keeps the branch. The default answer is "keep".
 */
export function isDeletable(prState) {
  return prState === 'CLOSED' || prState === 'MERGED'
}

export function classify(branches, prStateByNumber) {
  const del = []
  const keep = []
  for (const b of branches) {
    const pr = candidatePrNumber(b)
    if (pr === null) {
      keep.push({ branch: b, why: 'not a deletable preview/pr- branch' })
      continue
    }
    const state = prStateByNumber.get(pr)
    if (!state) {
      keep.push({ branch: b, pr, why: 'PR state unknown' })
      continue
    }
    if (!isDeletable(state)) {
      keep.push({ branch: b, pr, why: `PR ${state}` })
      continue
    }
    del.push({ branch: b, pr, state })
  }
  return { del, keep }
}

async function neon(path, init = {}) {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${process.env.NEON_API_KEY}`,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Neon ${init.method ?? 'GET'} ${path} -> ${res.status}`)
  return res.status === 204 ? null : res.json()
}

async function prState(repo, number) {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GH_TOKEN}`,
    },
  })
  if (res.status === 404) return null
  if (!res.ok) return null // unreadable is not permission
  const pr = await res.json()
  if (pr.state === 'open') return 'OPEN'
  return pr.merged_at ? 'MERGED' : 'CLOSED'
}

async function main() {
  const apply = process.argv.includes('--apply')
  const projectId = process.env.NEON_PROJECT_ID
  const repo = process.env.GITHUB_REPOSITORY
  if (!projectId || !process.env.NEON_API_KEY || !repo || !process.env.GH_TOKEN) {
    console.log('[prune] NEON_PROJECT_ID, NEON_API_KEY, GITHUB_REPOSITORY and GH_TOKEN are required')
    process.exit(2)
  }

  const { branches } = await neon(`/projects/${projectId}/branches`)
  const candidates = branches.map((b) => candidatePrNumber(b)).filter((n) => n !== null)
  const states = new Map()
  for (const n of [...new Set(candidates)]) states.set(n, await prState(repo, n))

  const { del, keep } = classify(branches, states)
  console.log(`[prune] ${branches.length} branches, ${del.length} deletable, ${keep.length} kept`)
  for (const k of keep.filter((x) => x.pr)) console.log(`   keep  #${k.pr}  ${k.why}`)

  if (del.length > MAX_DELETES) {
    console.log(`[prune] REFUSING: ${del.length} deletions exceeds the ${MAX_DELETES} cap for one run.`)
    process.exit(1)
  }
  if (!apply) {
    for (const d of del) console.log(`   would delete  #${d.pr} ${d.state}  ${d.branch.name}`)
    console.log('[prune] report only — pass --apply to delete')
    return
  }

  let done = 0
  for (const d of del) {
    await neon(`/projects/${projectId}/branches/${d.branch.id}`, { method: 'DELETE' })
    console.log(`   deleted  #${d.pr} ${d.state}  ${d.branch.name}`)
    done += 1
  }
  console.log(`[prune] deleted ${done}`)
}

/*
 * ⚠ `file://${argv[1]}` IS NOT THE ENTRY CHECK — IT SILENTLY DISABLES THE SCRIPT ON WINDOWS.
 * argv[1] is `C:\path\x.mjs` while import.meta.url is `file:///C:/path/x.mjs`: different
 * separators AND a third slash. The hand-rolled comparison failed, main() never ran, and the
 * script exited 0 having done nothing — indistinguishable from a clean report. `pathToFileURL`
 * is the comparison that holds on both platforms.
 */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[prune]', err.message)
    /*
     * ⚠ `process.exit()` HERE, NOT `exitCode`, EXITS 127. Calling it while a fetch's handles are
     * still closing trips a libuv assertion, and the shell then sees 127 — which in this repo's
     * conventions means "command not found", i.e. it reads as a broken invocation rather than a
     * caught failure. Setting exitCode lets the loop drain and reports the 2 that was meant.
     */
    process.exitCode = 2
  })
}

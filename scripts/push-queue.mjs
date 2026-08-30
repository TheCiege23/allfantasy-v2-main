#!/usr/bin/env node
/**
 * A first-in, first-out queue for pushes to `main`.
 *
 * WHY THIS EXISTS, AND WHY THE EXISTING GUARD IS NOT ENOUGH
 * `scripts/check-inflight-prod-build.mjs` refuses a push while a production
 * build is running. That stops the money leak, but it says nothing about ORDER:
 * every blocked session is told "retry in ~N min", so they all retry at once and
 * the winner is whoever's poll happened to land first. A session that has been
 * waiting twenty minutes loses to one that arrived thirty seconds ago, and it
 * can lose repeatedly. Starvation is not hypothetical here — the build guard's
 * own measurements record ~9 concurrent sessions on one checkout.
 *
 * This adds the missing half: a ticket per intended push, served in the order
 * the tickets were taken. The build guard answers "may anyone push right now";
 * this answers "and is it your turn". They compose — the queue runs first, so
 * only the head of the line ever calls Vercel.
 *
 * THE TICKET IS KEYED ON THE SHA YOU INTEND TO PUSH, not on a session id.
 * Sessions here are not distinguishable: ~9 of them share one checkout, and
 * shell state does not survive between commands, so there is no env var or pid
 * to hang identity on. The commit is the one thing that is genuinely yours. A
 * consequence worth knowing: amending after taking a ticket produces a new sha
 * and therefore a new ticket at the BACK. `rebind` moves an existing ticket onto
 * a new sha and keeps its place — use it, or use `push`, which does the whole
 * dance in one command.
 *
 * ⚠ IT FAILS OPEN, ON PURPOSE, AND FOR THE SAME REASON THE BUILD GUARD DOES.
 * An unreadable queue directory, a corrupt ticket, a git invocation that will
 * not run — every one of those exits 0 and lets the push through with a warning
 * on stderr. The only exit-1 is a positive, parsed confirmation that a live
 * ticket with a lower sequence number is ahead of yours. A queue that can strand
 * a deploy is worse than the duplicate builds it prevents.
 *
 * ⚠ AND IT CANNOT DEADLOCK ON AN ABANDONED SESSION. Two independent expiries,
 * both journaled rather than silent:
 *   - a ticket whose heartbeat is older than HEARTBEAT_TTL is reaped;
 *   - a ticket the hook has already waved through is released once the push
 *     LANDS (its sha is what `origin/main` now points at — verified by sha, per
 *     CLAUDE.md, never by reading push output) or once PUSH_GRACE elapses.
 *
 * Override for a genuine emergency:  AF_SKIP_PUSH_QUEUE=1 git push ...
 * Journal of every automatic release:  <git-common-dir>/af-push-queue/journal.jsonl
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

const HEARTBEAT_TTL_MS = Number(process.env.AF_PUSH_QUEUE_TTL_MS) || 15 * 60_000
const PUSH_GRACE_MS = Number(process.env.AF_PUSH_QUEUE_GRACE_MS) || 10 * 60_000
const POLL_MS = Number(process.env.AF_PUSH_QUEUE_POLL_MS) || 15_000
const WAIT_TIMEOUT_MS = 90 * 60_000 // `wait` gives up rather than hanging forever
const ZEROS = /^0+$/

const now = () => Date.now()

/** Exit 0 = the push may proceed. Every failure path lands here. */
function allow(warning) {
  if (warning) process.stderr.write(`  ⚠ push-queue: ${warning} — failing open, the push is allowed.\n`)
  process.exit(0)
}

function git(args, { timeout = 10_000 } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout, windowsHide: true }).trim()
  } catch {
    return null
  }
}

/**
 * The queue lives in the git COMMON dir, which every worktree shares — that is
 * what makes one queue cover all of them. A per-worktree `.git` would give each
 * checkout its own private line, which is exactly the situation being fixed.
 */
function queueDir() {
  if (process.env.AF_PUSH_QUEUE_DIR) return resolve(process.env.AF_PUSH_QUEUE_DIR)
  // `--path-format` needs git >= 2.31; the relative form is resolved against the
  // worktree root below, which answers the same question on older git.
  let common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common) common = git(['rev-parse', '--git-common-dir'])
  if (!common) return null
  const root = git(['rev-parse', '--show-toplevel']) || process.cwd()
  return join(resolve(root, common), 'af-push-queue')
}

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

function journal(dir, entry) {
  try {
    appendFileSync(
      join(dir, 'journal.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    )
  } catch {}
}

const pad = (n) => String(n).padStart(6, '0')
const mins = (ms) => `${Math.max(0, Math.round((Number(ms) || 0) / 60000))}m`

/**
 * Read every ticket. A ticket that will not parse marks the whole read DEGRADED
 * rather than being skipped quietly: a corrupt file silently dropped would
 * reorder the line, and reordering is the one thing this file exists to prevent.
 * A degraded read fails open.
 */
function readTickets(dir) {
  let names
  try {
    names = readdirSync(dir).filter((n) => /^\d{6}\.json$/.test(n))
  } catch {
    return { tickets: [], degraded: true, reason: `cannot read ${dir}` }
  }
  const tickets = []
  let degraded = false
  let reason = ''
  for (const name of names) {
    try {
      const t = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (typeof t.seq !== 'number' || typeof t.sha !== 'string') throw new Error('shape')
      t._file = join(dir, name)
      tickets.push(t)
    } catch {
      degraded = true
      reason = `ticket ${name} is unreadable`
    }
  }
  tickets.sort((a, b) => a.seq - b.seq)
  return { tickets, degraded, reason }
}

function writeTicket(t) {
  const { _file, ...body } = t
  writeFileSync(_file, `${JSON.stringify(body, null, 2)}\n`)
}

function release(dir, t, reason) {
  try {
    rmSync(t._file, { force: true })
  } catch {
    return false
  }
  journal(dir, { event: 'released', seq: t.seq, sha: t.sha, label: t.label, reason })
  return true
}

/**
 * THE PUSHER GATE — who is allowed to push at all, checked before the queue.
 *
 * The queue orders pushes. This says only one session should be MAKING them:
 * the designated pusher batches everyone's work and lands it, which is where the
 * build-minute saving actually lives (ordering ten pushes costs exactly what ten
 * unordered ones do).
 *
 * ⚠ IT IS A STOP SIGN, NOT A LOCK, AND SAYING SO MATTERS. Every session here
 * runs as the same user on the same filesystem, so the token below is readable
 * by anyone who goes looking. That is not a flaw to be fixed with cryptography —
 * a session that reads the token to get past the gate has deliberately
 * overridden it, which is exactly what the documented override is for. What the
 * gate buys is that you cannot push past the pusher BY ACCIDENT, and that is the
 * whole failure it exists to stop.
 *
 * No pusher file, or an unreadable one, means no gate.
 */
function readPusher(dir) {
  try {
    const p = JSON.parse(readFileSync(join(dir, 'pusher.json'), 'utf8'))
    return typeof p?.token === 'string' && p.token ? p : null
  } catch {
    return null
  }
}

/** One `ls-remote` per process, at most. Null means "could not tell". */
let remoteMainSha
function remoteMain() {
  if (remoteMainSha !== undefined) return remoteMainSha
  if (process.env.AF_PUSH_QUEUE_NO_REMOTE === '1') {
    remoteMainSha = null
    return remoteMainSha
  }
  const out = git(['ls-remote', 'origin', 'refs/heads/main'], { timeout: 15_000 })
  remoteMainSha = out ? out.split(/\s+/)[0] || null : null
  return remoteMainSha
}

/**
 * Drop tickets that can no longer be waiting for anything, and say so in the
 * journal. Returns the live queue in order.
 *
 * The `landed` check runs only for tickets already waved through, so the common
 * case — a queue of sessions none of which has been allowed yet — costs no
 * network at all.
 */
function reconcile(dir, tickets) {
  const t0 = now()
  const live = []
  for (const t of tickets) {
    const heartbeat = Number(t.heartbeatAt) || 0
    if (t0 - heartbeat > HEARTBEAT_TTL_MS) {
      release(dir, t, `heartbeat stale (${mins(t0 - heartbeat)})`)
      continue
    }
    if (t.state === 'pushing') {
      const landed = remoteMain()
      if (landed && landed === t.sha) {
        release(dir, t, 'landed on origin/main')
        continue
      }
      const allowedAt = Number(t.allowedAt) || 0
      if (t0 - allowedAt > PUSH_GRACE_MS) {
        release(dir, t, `waved through ${mins(t0 - allowedAt)} ago and never landed`)
        continue
      }
    }
    live.push(t)
  }
  return live
}

/**
 * Take the next sequence number. `wx` is the whole mutual-exclusion mechanism:
 * two sessions racing for the same number cannot both create the file, and the
 * loser simply tries the next one. No lock file, so nothing to leave behind.
 */
function createTicket(dir, { sha, label, branch, worktree }) {
  const { tickets } = readTickets(dir)
  let highest = tickets.reduce((m, t) => Math.max(m, t.seq), 0)
  try {
    const last = Number(JSON.parse(readFileSync(join(dir, 'counter.json'), 'utf8')).last)
    if (Number.isFinite(last)) highest = Math.max(highest, last)
  } catch {}

  for (let attempt = 0; attempt < 200; attempt++) {
    const seq = highest + 1 + attempt
    const file = join(dir, `${pad(seq)}.json`)
    const body = {
      seq,
      sha,
      label: label || '',
      branch: branch || '',
      worktree: worktree || '',
      state: 'waiting',
      createdAt: now(),
      heartbeatAt: now(),
    }
    try {
      writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' })
      try {
        writeFileSync(join(dir, 'counter.json'), `${JSON.stringify({ last: seq })}\n`)
      } catch {}
      journal(dir, { event: 'taken', seq, sha, label: body.label })
      return { ...body, _file: file }
    } catch (err) {
      if (err && err.code === 'EEXIST') continue
      return null
    }
  }
  return null
}

function describeContext() {
  return {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    worktree: git(['rev-parse', '--show-toplevel']),
    subject: git(['log', '-1', '--format=%s']),
  }
}

function renderQueue(live, mineSeq) {
  if (live.length === 0) return '  (queue empty)\n'
  return `${live
    .map((t, i) => {
      const mark = t.seq === mineSeq ? '→' : ' '
      const state = t.state === 'pushing' ? 'PUSHING' : 'waiting'
      const waited = mins(now() - (Number(t.createdAt) || now())).padStart(4)
      return `  ${mark} ${i + 1}. #${pad(t.seq)}  ${String(t.sha).slice(0, 9)}  ${state.padEnd(7)}  waited ${waited}  ${t.label || t.branch || ''}`
    })
    .join('\n')}\n`
}

/* ------------------------------------------------------------------ verbs */

function resolveDir() {
  const dir = queueDir()
  if (!dir || !ensureDir(dir)) return null
  return dir
}

/**
 * The stable patch-id of a commit, or null if it cannot be computed.
 *
 * 🛑 THIS IS THE PRIMARY "IS THIS THE SAME WORK UNDER A NEW NAME" TEST, AND AN
 * ANCESTOR CHECK IS NOT A SUBSTITUTE FOR IT. A rebase does not produce a
 * descendant — it produces a SIBLING: same patch, different parent, common
 * ancestor behind both. Measured on the pair that actually happened in this repo
 * on 2026-08-30:
 *
 *   git merge-base --is-ancestor cc8593229 e0e444030  → rc=1  (not an ancestor)
 *   git merge-base --is-ancestor e0e444030 cc8593229  → rc=1  (not one either)
 *   patch-id of both                                  → d0d63cd1621bf38e…
 *
 * So an ancestor test answers "no" in both directions for the exact case the
 * rebind exists to catch. The two tests see different things and neither
 * subsumes the other: patch-id catches a RENAME, ancestor catches an AMEND or an
 * extension. Both are consulted.
 *
 * ⚠ null NEVER MATCHES null. Two commits whose patch-id could not be computed
 * are not thereby the same commit, and treating them as equal would hand one
 * session's place in line to another.
 */
const patchIds = new Map()
function patchIdOf(sha) {
  if (patchIds.has(sha)) return patchIds.get(sha)
  let id = null
  const show = spawnSync('git', ['show', sha, '--format=', '--patch'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (!show.error && show.status === 0 && show.stdout) {
    const pid = spawnSync('git', ['patch-id', '--stable'], {
      input: show.stdout,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    if (!pid.error && pid.status === 0 && pid.stdout) {
      const first = pid.stdout.trim().split(/\s+/)[0]
      if (/^[0-9a-f]{40}$/.test(first || '')) id = first
    }
  }
  patchIds.set(sha, id)
  return id
}

/** Same work under a different name? Returns the signal that said so, or null. */
function sameWork(heldSha, sha) {
  const a = patchIdOf(heldSha)
  const b = patchIdOf(sha)
  if (a && b && a === b) return 'patch-id match (renamed by a rebase)'
  if (isAncestor(heldSha, sha) === true) return 'descendant of the held sha (amended or extended)'
  return null
}

/**
 * Is `older` an ancestor of `newer`? Three-valued on purpose.
 *
 * 🛑 `merge-base --is-ancestor` EXITS 0 FOR YES AND 1 FOR NO — AND ANYTHING ELSE
 * IS NOT A VERDICT. This repo has already read a `timeout`'s 124 as "not an
 * ancestor" and a missing `pgrep`'s 127 as "the process is gone". Both were
 * guards written the same day to prevent what they then caused. So this returns
 * null for every status that is neither 0 nor 1, and the caller treats null as
 * "do not act", never as "no".
 */
function isAncestor(older, newer) {
  const res = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  })
  if (res.error || res.signal) return null
  if (res.status === 0) return true
  if (res.status === 1) return false
  return null
}

/**
 * Find this sha's live ticket, creating one at the back if it has none.
 *
 * ⚠ A SHA-KEYED TICKET CAN BE ORPHANED BY WORK YOU DID NOT DO. Amending is the
 * obvious way, but this checkout also rewrites history under running sessions —
 * a peer's rebase renamed one session's commit today (5bc9cef07 → 4a84bc557),
 * and a ticket keyed on the old name would have silently lost its place through
 * no action of its owner. So before taking a NEW ticket at the back, look for a
 * live ticket from this same worktree that is the SAME WORK under another name —
 * `sameWork` tests patch-id first (a rebase makes a sibling, not a descendant,
 * so an ancestor test is blind to it) and ancestry second — and carry it
 * forward instead. That closes the honest case of the line-jumping hole
 * too: without it, one session can hold two live tickets under two SHAs and take
 * two turns.
 */
function ticketFor(dir, sha, ctx, { create = true } = {}) {
  const { tickets, degraded, reason } = readTickets(dir)
  if (degraded) return { degraded: true, reason }
  const live = reconcile(dir, tickets)
  let mine = live.find((t) => t.sha === sha)
  let created = false

  if (!mine && create && ctx.worktree) {
    let signal = null
    const inherited = live.find((t) => {
      if (t.sha === sha) return false
      // 🛑 PATCH-ID MATCHES ACROSS WORKTREES; ANCESTRY DOES NOT.
      // The prescribed recovery from a stale base is `git worktree add --detach
      // <tmp> origin/main && git cherry-pick <sha>` — which rebuilds the commit
      // in a DIFFERENT worktree. A same-worktree requirement therefore defeated
      // exactly the path this tool tells you to take: the rebuilt commit took a
      // fresh ticket and queued behind its own stale one. A cherry-pick that
      // applies cleanly preserves the patch-id, so that is strong enough
      // evidence on its own. Ancestry is weaker — a descendant is not
      // necessarily the same author's work — so it still requires the worktree
      // to match.
      const a = patchIdOf(t.sha)
      const b = patchIdOf(sha)
      if (a && b && a === b) {
        signal = 'patch-id match (renamed by a rebase, or rebuilt by a cherry-pick)'
        return true
      }
      if (t.worktree === ctx.worktree && isAncestor(t.sha, sha) === true) {
        signal = 'descendant of the held sha (amended or extended)'
        return true
      }
      return false
    })
    if (inherited) {
      const was = inherited.sha
      inherited.sha = sha
      inherited.state = 'waiting'
      delete inherited.allowedAt
      inherited.heartbeatAt = now()
      inherited.label = ctx.subject || inherited.label
      try {
        writeTicket(inherited)
        journal(dir, { event: 'rebound', seq: inherited.seq, from: was, to: sha, reason: signal })
        return { live, mine: inherited, created: false, inheritedFrom: was }
      } catch {
        // Fall through and take a fresh ticket rather than lose the push.
      }
    }
  }

  if (!mine && create) {
    mine = createTicket(dir, { sha, label: ctx.subject, branch: ctx.branch, worktree: ctx.worktree })
    if (!mine) return { degraded: true, reason: 'could not create a ticket' }
    live.push(mine)
    created = true
  }
  return { live, mine, created }
}

function heartbeat(t) {
  if (!t) return
  t.heartbeatAt = now()
  try {
    writeTicket(t)
  } catch {}
}

/**
 * Hook mode. Reads the pre-push stdin payload, and blocks only when a live
 * ticket with a lower sequence number is genuinely ahead of this one.
 */
function cmdCheck() {
  if (process.env.AF_SKIP_PUSH_QUEUE === '1') allow()

  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    allow() // No stdin means this was not invoked as a pre-push hook.
  }

  // `<localRef> <localSha> <remoteRef> <remoteSha>`; a delete has an all-zero
  // local sha and deploys nothing.
  const mainPush = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/))
    .find((f) => f[2] === 'refs/heads/main' && f[1] && !ZEROS.test(f[1]))

  if (!mainPush) allow()
  const sha = mainPush[1]

  const dir = resolveDir()
  if (!dir) allow('no queue directory')

  // The pusher gate runs BEFORE a ticket is taken: a session that is not
  // pushing today should not be occupying a place in the line either.
  const pusher = readPusher(dir)
  if (pusher && process.env.AF_PUSH_TOKEN !== pusher.token) {
    process.stderr.write(
      `\n  ✋ push blocked: ${pusher.name} is the designated pusher right now.\n\n` +
        `     holding since  ${new Date(pusher.since).toLocaleString()}\n` +
        `     reach them at  ${pusher.ref || pusher.name}  (SendMessage)\n\n` +
        `  One session batches and pushes, so several sessions' work rides one\n` +
        `  build instead of one build each. Ordering pushes does not save the\n` +
        `  money — batching them does.\n\n` +
        `  Hand your work over instead of pushing it:\n\n` +
        `     1. commit it (path-scoped; do not sweep a peer's files)\n` +
        `     2. SendMessage ${pusher.ref || pusher.name} with your SHA and your\n` +
        `        ATTESTATION — which checks you ran and what they said, by name\n` +
        `        and count. Attest to the COMMIT, not to your working tree.\n\n` +
        `  Not pushable on your say-so: anything carrying a migration.\n\n` +
        `  The pusher role is handed over explicitly:  npm run push:pusher -- --release\n` +
        `  Genuinely urgent?  AF_SKIP_PUSH_QUEUE=1 git push <args>\n\n`,
    )
    process.exit(1)
  }

  const ctx = describeContext()
  const { degraded, reason, live, mine, created } = ticketFor(dir, sha, ctx)
  if (degraded) allow(reason)

  heartbeat(mine)
  const ahead = live.filter((t) => t.seq < mine.seq)

  if (ahead.length === 0) {
    mine.state = 'pushing'
    mine.allowedAt = now()
    try {
      writeTicket(mine)
    } catch {}
    process.stderr.write(
      `\n  ✅ push-queue: ticket #${pad(mine.seq)}${created ? ' (taken just now)' : ''} is at the head of the line.\n`,
    )
    process.exit(0)
  }

  const head = ahead[0]
  process.stderr.write(
    `\n  ✋ push blocked: it is not your turn.\n\n` +
      `     your ticket   #${pad(mine.seq)}  ${sha.slice(0, 9)}${created ? '  (taken just now, at the back)' : ''}\n` +
      `     position      ${ahead.length + 1} of ${live.length}\n` +
      `     ahead of you  ${ahead.length} — head is #${pad(head.seq)} ${String(head.sha).slice(0, 9)} ${head.label || ''}\n\n` +
      `${renderQueue(live, mine.seq)}\n` +
      `  Your place is held. Retrying does NOT move you back, and nobody who\n` +
      `  arrives later can pass you. Wait for it properly with:\n\n` +
      `     npm run push:main            (take a ticket, wait, push, release)\n` +
      `     npm run push:wait            (block until it is your turn)\n` +
      `     npm run push:status          (see the line)\n\n` +
      `  A ticket whose session goes away expires after ${HEARTBEAT_TTL_MS / 60000} min, so the line\n` +
      `  always moves. Every automatic release is recorded in the queue journal.\n\n` +
      `  Genuinely urgent?  AF_SKIP_PUSH_QUEUE=1 git push <args>\n\n`,
  )
  process.exit(1)
}

function cmdTake(argv) {
  const dir = resolveDir()
  if (!dir) allow('no queue directory')
  const ctx = describeContext()
  const sha = argFor(argv, '--sha') || ctx.sha
  if (!sha) allow('cannot resolve a sha to queue')
  const { degraded, reason, live, mine, created } = ticketFor(dir, sha, ctx)
  if (degraded) allow(reason)
  const ahead = live.filter((t) => t.seq < mine.seq).length
  process.stdout.write(
    `${created ? 'took' : 'already held'} ticket #${pad(mine.seq)} for ${sha.slice(0, 9)} — position ${ahead + 1} of ${live.length}\n\n${renderQueue(live, mine.seq)}`,
  )
}

function cmdStatus() {
  const dir = resolveDir()
  if (!dir) {
    process.stdout.write('push-queue: no queue directory resolvable here.\n')
    return
  }
  const { tickets, degraded, reason } = readTickets(dir)
  if (degraded) {
    process.stdout.write(`  ⚠ ${reason} — the queue is degraded and is failing open.\n`)
  }
  const live = reconcile(dir, tickets)
  const head = git(['rev-parse', 'HEAD'])
  const mine = live.find((t) => t.sha === head)
  process.stdout.write(`push-queue (${dir})\n\n${renderQueue(live, mine ? mine.seq : -1)}`)
  if (mine) {
    const ahead = live.filter((t) => t.seq < mine.seq).length
    process.stdout.write(
      `\n  HEAD (${head.slice(0, 9)}) holds #${pad(mine.seq)} — position ${ahead + 1} of ${live.length}.\n`,
    )
  } else if (head) {
    process.stdout.write(
      `\n  HEAD (${head.slice(0, 9)}) holds no ticket. It gets one at the back on its first push.\n`,
    )
  }
}

function cmdDone(argv) {
  const dir = resolveDir()
  if (!dir) return
  const sha = argFor(argv, '--sha') || git(['rev-parse', 'HEAD'])
  const { tickets } = readTickets(dir)
  const mine = tickets.find((t) => t.sha === sha)
  if (!mine) {
    process.stdout.write(`push-queue: no ticket for ${String(sha).slice(0, 9)} — nothing to release.\n`)
    return
  }
  release(dir, mine, 'released by its holder')
  process.stdout.write(`push-queue: released #${pad(mine.seq)} (${String(sha).slice(0, 9)}).\n`)
}

/** Move an existing ticket onto a new sha WITHOUT losing its place in line. */
function cmdRebind(argv) {
  const dir = resolveDir()
  if (!dir) return
  const from = argFor(argv, '--from')
  const to = argFor(argv, '--to') || git(['rev-parse', 'HEAD'])
  const { tickets } = readTickets(dir)
  const t = from
    ? tickets.find((x) => x.sha === from || pad(x.seq) === pad(Number(from)))
    : tickets[0]
  if (!t) {
    process.stdout.write('push-queue: no ticket matched --from.\n')
    return
  }
  const was = t.sha
  t.sha = to
  t.state = 'waiting'
  delete t.allowedAt
  t.heartbeatAt = now()
  t.label = describeContext().subject || t.label
  writeTicket(t)
  journal(dir, { event: 'rebound', seq: t.seq, from: was, to })
  process.stdout.write(
    `push-queue: #${pad(t.seq)} now covers ${String(to).slice(0, 9)} (was ${String(was).slice(0, 9)}); place kept.\n`,
  )
}

function cmdDrop(argv) {
  const dir = resolveDir()
  if (!dir) return
  const which = argv[0]
  const reason = argFor(argv, '--reason') || 'dropped by hand'
  const { tickets } = readTickets(dir)
  const t = tickets.find((x) => pad(x.seq) === pad(Number(which)) || x.sha === which)
  if (!t) {
    process.stdout.write(`push-queue: no ticket ${which}.\n`)
    return
  }
  release(dir, t, reason)
  process.stdout.write(`push-queue: dropped #${pad(t.seq)} — ${reason}\n`)
}

/**
 * Claim, show, or hand over the designated-pusher role.
 *
 * ⚠ THE ROLE IS A ROLE, NOT A SESSION — SESSIONS END. A pusher who vanishes
 * silently blocks everyone, which is worse than the duplicate builds the role
 * prevents, so `--claim` prints the announcement you owe the other sessions and
 * `--release` exists to be used before you finish.
 */
function cmdPusher(argv) {
  const dir = resolveDir()
  if (!dir) {
    process.stdout.write('push-queue: no queue directory resolvable here.\n')
    return
  }
  const file = join(dir, 'pusher.json')

  if (argv.includes('--release')) {
    const held = readPusher(dir)
    try {
      rmSync(file, { force: true })
    } catch {}
    journal(dir, { event: 'pusher-released', name: held?.name })
    process.stdout.write(
      `push-queue: pusher role released${held ? ` (was ${held.name})` : ''}. Anyone may push again — tell the other sessions.\n`,
    )
    return
  }

  const claim = argFor(argv, '--claim')
  if (claim) {
    const token = randomUUID()
    const ref = argFor(argv, '--ref') || ''
    writeFileSync(file, `${JSON.stringify({ name: claim, ref, token, since: Date.now() }, null, 2)}\n`)
    journal(dir, { event: 'pusher-claimed', name: claim, ref })
    process.stdout.write(
      `push-queue: ${claim} now holds the pusher role.\n\n` +
        `  Push with the token so the gate lets you through:\n\n` +
        `     AF_PUSH_TOKEN=${token} npm run push:main\n\n` +
        `  ⚠ Announce it (ListAgents + SendMessage) and hand it over before you\n` +
        `    finish — a pusher who vanishes silently blocks everyone.\n` +
        `     npm run push:pusher -- --release\n`,
    )
    return
  }

  const held = readPusher(dir)
  if (!held) {
    process.stdout.write('push-queue: no designated pusher. Any session may push, in queue order.\n')
    return
  }
  process.stdout.write(
    `push-queue: ${held.name} holds the pusher role since ${new Date(held.since).toLocaleString()}.\n` +
      `  reach them at ${held.ref || held.name} (SendMessage) — hand over your SHA and attestation.\n`,
  )
}

function cmdReap() {
  const dir = resolveDir()
  if (!dir) return
  const { tickets } = readTickets(dir)
  const before = tickets.length
  const live = reconcile(dir, tickets)
  process.stdout.write(
    `push-queue: ${before - live.length} expired, ${live.length} live.\n\n${renderQueue(live, -1)}`,
  )
}

async function cmdWait(argv) {
  const dir = resolveDir()
  if (!dir) allow('no queue directory')
  const ctx = describeContext()
  const sha = argFor(argv, '--sha') || ctx.sha
  const timeoutMs = Number(argFor(argv, '--timeout-min') || 0) * 60_000 || WAIT_TIMEOUT_MS
  const started = now()
  let lastPosition = -1

  for (;;) {
    const { degraded, reason, live, mine } = ticketFor(dir, sha, ctx)
    if (degraded) allow(reason)
    heartbeat(mine)
    const ahead = live.filter((t) => t.seq < mine.seq)
    if (ahead.length === 0) {
      process.stdout.write(`push-queue: ticket #${pad(mine.seq)} is up. Push now.\n`)
      return 0
    }
    if (ahead.length + 1 !== lastPosition) {
      lastPosition = ahead.length + 1
      process.stdout.write(
        `push-queue: #${pad(mine.seq)} — position ${lastPosition} of ${live.length}, waiting…\n`,
      )
    }
    if (now() - started > timeoutMs) {
      process.stderr.write(
        `push-queue: still position ${lastPosition} after ${mins(now() - started)}. Giving up rather than hanging.\n` +
          `  The head ticket is #${pad(ahead[0].seq)}; it expires on its own once its heartbeat goes stale.\n`,
      )
      return 2
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

/**
 * take → wait → push → verify by sha → release. The whole convention in one
 * command, so following it is easier than not.
 */
async function cmdPush(argv) {
  const ctx = describeContext()
  if (!ctx.sha) {
    process.stderr.write('push-queue: cannot resolve HEAD.\n')
    return 1
  }

  // 🛑 PUSH THE SHA, NOT `HEAD`. Waiting your turn takes minutes, and HEAD moves
  // under a session in this checkout — a peer commits, a rebase lands, and
  // `HEAD:main` silently means something different from what you queued and
  // attested. One session pushed three other sessions' commits that way today.
  // A ticket is a promise about ONE commit, so the refspec names that commit.
  const passthrough = argv.length ? argv : ['origin', `${ctx.sha}:refs/heads/main`]

  const waited = await cmdWait([])
  if (waited !== 0) return waited

  // ⚠ AND RE-READ HEAD AFTER THE WAIT, comparing against the value captured
  // ONCE before it — never a fresh read against another fresh read, which is the
  // staleness guard that passes while the thing genuinely moves.
  const nowHead = git(['rev-parse', 'HEAD'])
  if (!argv.length && nowHead && nowHead !== ctx.sha) {
    process.stderr.write(
      `\n  ✋ push-queue: HEAD moved while you waited your turn — refusing to push.\n\n` +
        `     you queued   ${ctx.sha.slice(0, 9)}  ${ctx.subject || ''}\n` +
        `     HEAD is now  ${nowHead.slice(0, 9)}\n\n` +
        `  Pushing now would carry commits you never verified and never attested,\n` +
        `  including other sessions'. Your ticket is kept.\n\n` +
        `  Re-run once you have confirmed what you mean to land — your place in\n` +
        `  line carries forward automatically onto a descendant sha.\n` +
        `  To push the sha you queued anyway:\n` +
        `     npm run push:main -- origin ${ctx.sha}:refs/heads/main\n\n`,
    )
    return 1
  }

  // 🛑 AND RE-CHECK THE BASE. Pinning the sha stops you pushing the wrong RANGE;
  // it does nothing about a STALE BASE. While you sat in the queue, the batch
  // ahead of you landed — so the commit you pinned no longer descends from
  // `origin/main` and the push is rejected as a non-fast-forward. Pinning and
  // base-checking answer different questions and you need both.
  if (!argv.length) {
    remoteMainSha = undefined
    const base = remoteMain()
    if (!base) {
      process.stderr.write('  ⚠ push-queue: could not read origin/main — letting git decide the base.\n')
    } else if (base === ctx.sha) {
      process.stdout.write(`push-queue: ${ctx.sha.slice(0, 9)} is already origin/main. Nothing to push.\n`)
      cmdDone([`--sha=${ctx.sha}`])
      return 0
    } else {
      // The object has to be local for `--is-ancestor` to mean anything; a
      // missing one answers null, which is NOT "the base moved".
      if (spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { windowsHide: true }).status !== 0) {
        git(['fetch', '--quiet', 'origin', 'refs/heads/main'], { timeout: 60_000 })
      }
      const current = isAncestor(base, ctx.sha)
      if (current === false) {
        const landed = git(['rev-list', '--count', `${ctx.sha}..${base}`])
        process.stderr.write(
          `\n  ✋ push-queue: your base is stale — refusing to push.\n\n` +
            `     you queued    ${ctx.sha.slice(0, 9)}\n` +
            `     origin/main   ${base.slice(0, 9)}${landed ? `  (${landed} commit(s) landed since)` : ''}\n\n` +
            `  ${ctx.sha.slice(0, 9)} does not descend from origin/main, so this push would be\n` +
            `  rejected as a non-fast-forward. Rebuild it onto the current tip — and\n` +
            `  cherry-pick, do NOT merge in the shared checkout:\n\n` +
            `     git worktree add --detach <tmp> origin/main\n` +
            `     git cherry-pick ${ctx.sha.slice(0, 9)}\n` +
            `     npm run push:main\n\n` +
            `  Your ticket is kept. A clean cherry-pick keeps the same patch-id, so\n` +
            `  your place in line carries onto the rebuilt commit automatically —\n` +
            `  even from the temporary worktree. If the pick needed conflict\n` +
            `  resolution the patch-id changes, and you carry it by hand:\n\n` +
            `     npm run push:rebind -- --from=${ctx.sha.slice(0, 9)} --to=<newSha>\n\n`,
        )
        return 1
      }
      if (current === null) {
        process.stderr.write('  ⚠ push-queue: could not settle whether the base is current — letting git decide.\n')
      }
    }
  }

  process.stdout.write(`push-queue: pushing ${ctx.sha.slice(0, 9)} → git push ${passthrough.join(' ')}\n`)
  let pushStatus = 0
  try {
    execFileSync('git', ['push', ...passthrough], { stdio: 'inherit', windowsHide: true })
  } catch (err) {
    pushStatus = typeof err?.status === 'number' ? err.status : 1
  }

  // ⚠ VERIFY BY SHA. A rejected push prints `-> main` too, and its status read
  // through a pipe is the pipe's. `ls-remote` is the only check that holds.
  remoteMainSha = undefined
  const landed = remoteMain()

  if (landed && landed === ctx.sha) {
    cmdDone([`--sha=${ctx.sha}`])
    process.stdout.write(`push-queue: ✅ origin/main is now ${landed.slice(0, 9)}.\n`)
    return 0
  }
  process.stderr.write(
    `push-queue: ⚠ push did NOT land — origin/main is ${landed ? landed.slice(0, 9) : '(unreadable)'}, not ${ctx.sha.slice(0, 9)}.\n` +
      `  Your ticket is kept so you do not lose your place. Fix and re-run, or release it with:\n` +
      `     npm run push:done\n`,
  )
  return pushStatus || 1
}

/* -------------------------------------------------------------------- cli */

function argFor(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const [verb = 'status', ...rest] = process.argv.slice(2)
const passIdx = rest.indexOf('--')
const tail = passIdx >= 0 ? rest.slice(passIdx + 1) : []
const opts = passIdx >= 0 ? rest.slice(0, passIdx) : rest

try {
  switch (verb) {
    case 'check':
      cmdCheck()
      break
    case 'take':
      cmdTake(opts)
      break
    case 'status':
      cmdStatus()
      break
    case 'done':
    case 'release':
      cmdDone(opts)
      break
    case 'rebind':
      cmdRebind(opts)
      break
    case 'drop':
      cmdDrop(opts)
      break
    case 'pusher':
      cmdPusher(opts)
      break
    case 'reap':
      cmdReap()
      break
    case 'wait':
      process.exitCode = await cmdWait(opts)
      break
    // `npm run push:main -- origin HEAD:main` strips npm's own `--`, so the
    // refspec arrives in `rest` with no separator left to find.
    case 'push':
      process.exitCode = await cmdPush(passIdx >= 0 ? tail : rest)
      break
    default:
      process.stderr.write(
        `push-queue: unknown verb "${verb}".\n  verbs: check | take | status | wait | push | done | rebind | drop | reap | pusher\n`,
      )
      process.exitCode = 64
  }
} catch (err) {
  // The catch-all is the fail-open promise: an unexpected throw must never be
  // the reason a deploy cannot go out.
  if (verb === 'check') allow(`unexpected error: ${err?.message}`)
  process.stderr.write(`push-queue: ${err?.stack}\n`)
  process.exitCode = 1
}

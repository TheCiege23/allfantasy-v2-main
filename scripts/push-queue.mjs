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
 * ⚠ AND IT CANNOT DEADLOCK ON AN ABANDONED SESSION. Two expiries, applied to
 * DIFFERENT states and never to the same ticket at once, both journaled rather
 * than silent:
 *   - a WAITING ticket whose heartbeat is older than HEARTBEAT_TTL is reaped;
 *   - a PUSHING ticket is released once the push LANDS (its sha is what
 *     `origin/main` now points at — verified by sha, per CLAUDE.md, never by
 *     reading push output) or once PUSH_GRACE elapses.
 *
 * 🛑 A PUSHING TICKET IS NOT SUBJECT TO THE HEARTBEAT RULE, and that separation
 * is load-bearing rather than tidy: nothing refreshes `heartbeatAt` during a
 * push, so the two clocks would race and the SHORTER one would always win —
 * silently capping every push at HEARTBEAT_TTL no matter what PUSH_GRACE says.
 * See the note on PUSH_GRACE_MS for the six landings this cost.
 *
 * Override for a genuine emergency:  AF_SKIP_PUSH_QUEUE=1 git push ...
 * Journal of every automatic release:  <git-common-dir>/af-push-queue/journal.jsonl
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

const HEARTBEAT_TTL_MS = Number(process.env.AF_PUSH_QUEUE_TTL_MS) || 15 * 60_000

/**
 * 🛑 THE GRACE MUST OUTLAST THE GUARDS IT AUTHORISES, OR IT STARVES THE HEAD OF
 * THE LINE. This was 10 min flat, and `pre-push-smoke.mjs` takes up to 20 —
 * a cold, non-incremental compile of the whole repo, measured at 519s, 600s and
 * 1001s on a contended box. So the ticket authorising a push expired WHILE THE
 * PUSH WAS STILL INSIDE ITS OWN SMOKE RUN, freeing everyone behind it to push,
 * moving `main`, and bouncing the leader as non-fast-forward. The re-pick then
 * minted a new sha and took a new ticket at the BACK.
 *
 * Measured 2026-09-07 from the journal — the same patch lost six consecutive
 * attempts in ~90 minutes across two sessions while `main` moved seven times,
 * and its patch-id never changed once:
 *
 *   04:14:42  released  seq 192  reason "waved through 10m ago and never landed"
 *   04:15:36  taken     seq 195  <- same work, back of the line
 *
 * That is precisely the starvation this queue was written to remove, reappearing
 * one layer down: the queue ordered the CHECKS and then stopped protecting the
 * session while the slowest of them ran.
 *
 * ⚠ SO IT IS DERIVED, NOT PICKED. It reads the smoke guard's OWN timeout
 * variable, so raising one raises the other and the two cannot drift apart
 * again. The margin covers the cheaper guards ahead of it and the push itself.
 */
const SMOKE_TIMEOUT_MS = Number(process.env.AF_SMOKE_TIMEOUT_MS) || 20 * 60_000
const PUSH_GRACE_MARGIN_MS = 5 * 60_000
const PUSH_GRACE_MS =
  Number(process.env.AF_PUSH_QUEUE_GRACE_MS) || SMOKE_TIMEOUT_MS + PUSH_GRACE_MARGIN_MS

/**
 * 🛑 THE GRACE ABOVE IS THE RIGHT PRICE FOR A SMOKE RUN AND THE WRONG PRICE FOR
 * A CORPSE, AND UNTIL NOW EVERY WAVED-THROUGH TICKET PAID IT.
 *
 * `pre-push-smoke.mjs` skips itself when 2+ other `tsc.js` processes are already
 * running, which on a box carrying ~9 sessions is the common case, not the edge
 * one. So the 25 min above was being charged to pushes that were never going to
 * spend it — including pushes whose session had already died.
 *
 * That is what turns a slow queue into a stalled one, and it is a positive
 * feedback loop rather than a constant cost. Measured 2026-09-08:
 *
 *   - a background wait lane is killed at ~25 min (CLAUDE.md records this)
 *   - the queue was 6 deep with the oldest ticket 37 min in line — every one of
 *     them already past that kill line
 *   - so their lanes die while waiting, and each corpse then holds the HEAD for
 *     the full 25 min before this file gives up on it
 *   - 3 of the day's 15 releases expired without landing; `#269` burned three
 *     ticket numbers and never landed at all
 *   - nothing reached `origin/main` between 08:04 and 12:45, on a lane that had
 *     landed 27 commits the day before
 *
 * Each corpse lengthens the queue, which lengthens the wait, which kills the
 * next lane. The queue is stable while it is short and cannot recover on its own
 * once it is not.
 *
 * ⚠ SO THE EXPENSIVE GRACE IS NOW SOMETHING THE SMOKE ANNOUNCES, NEVER SOMETHING
 * THIS FILE ASSUMES. A ticket gets the full grace only while a marker written by
 * `pre-push-smoke.mjs` says a run is genuinely in progress for that exact sha.
 * Without one, a push has the cheaper guards and the push itself to do, and this
 * shorter clock applies.
 *
 * 🛑 DO NOT TIGHTEN THIS TOWARDS THE OBSERVED PUSH TIME. A no-smoke push was
 * measured at ~7 min from wave-through to landing, and the failure mode of being
 * WRONG here is not a slow queue — it is the six-lost-landings starvation the
 * long grace was written to fix, reappearing for every push that skips the smoke.
 * 10 min is a deliberately generous floor over that 7, in the same spirit as the
 * smoke's own 20-minute timeout, and it should be moved only from a measured
 * distribution of wave-through-to-landing times rather than from a tidier number.
 */
const SHORT_PUSH_GRACE_MS = Number(process.env.AF_PUSH_QUEUE_SHORT_GRACE_MS) || 10 * 60_000

/**
 * How long a pusher lock survives without a heartbeat.
 *
 * Deliberately much longer than a ticket's 15 min: a ticket covers one push,
 * while the ROLE is held across batches and a pusher legitimately goes quiet for
 * long stretches — verifying a tip, waiting on a ratchet, talking to authors. A
 * short TTL would evaporate the lock during exactly the careful work it exists
 * to protect. 45 min is long enough to cover a slow batch and short enough that
 * a vanished pusher does not block the room for a working day.
 */
const PUSHER_TTL_MS = Number(process.env.AF_PUSH_PUSHER_TTL_MS) || 45 * 60_000
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

/**
 * 🛑 WRITE THE WHOLE FILE SOMEWHERE ELSE, THEN MOVE IT INTO PLACE.
 *
 * This rewrote the ticket IN PLACE, and every heartbeat rewrites one — so with
 * a dozen live tickets there is a steady stream of partial files for a
 * concurrent `readTickets` to catch mid-write. It did, on 2026-09-11: a peer's
 * `000410.json` read as unparseable, the queue correctly declared itself
 * degraded and failed open, and the push then silently did not happen (see the
 * note in `cmdWait`). The same file parsed perfectly seconds later.
 *
 * A rename within one directory is atomic, so a reader sees either the old
 * ticket or the new one and never half of either. `readTickets` matches
 * `/^\d{6}\.json$/`, which the temp name deliberately does not.
 *
 * ⚠ The temp name carries the pid because two processes can heartbeat the same
 * ticket — a session and an orphan from its own earlier run — and a shared temp
 * name would put them back in the race this exists to remove.
 */
function writeTicket(t) {
  const { _file, ...body } = t
  const tmp = `${_file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`)
  renameSync(tmp, _file)
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

/**
 * 🛑 THE TOKEN IS THE IDENTITY. THE NAME IS A HINT FOR HUMANS.
 *
 * Session names in this room are REASSIGNED. On 2026-08-30 the holder's name
 * went from `allfantasy-v2-main-61` to `-9e` mid-session, so a peer found the
 * recorded name unreachable — `ListAgents` did not list it and `SendMessage` was
 * refused — concluded the session had ended, and released a lock that was being
 * actively held mid-batch. Two independent signals, both correct about the NAME,
 * both wrong about the SESSION.
 *
 * A name cannot be made reliable here, so liveness is measured instead of
 * inferred: the holder refreshes `heartbeatAt`, and a lock nobody has refreshed
 * for PUSHER_TTL_MS is stale and clears itself. That removes the judgement call
 * about someone else's existence, which is the thing that went wrong.
 */
/**
 * How old an advertised address may get before it is called out as possibly stale.
 *
 * 20 min, deliberately well under PUSHER_TTL_MS (45): the address is refreshed by
 * every gated push AND by an explicit heartbeat, so a working pusher renews it far
 * more often than this. Setting it equal to the TTL would mean the warning only
 * ever appeared on a lock that was about to clear itself anyway -- which is the one
 * case that already resolves without anybody reading a warning.
 */
const PUSHER_ADDRESS_WARN_MS = 20 * 60 * 1000

const pusherAge = (p) => now() - (Number(p?.heartbeatAt) || Number(p?.since) || 0)
const pusherIsStale = (p) => pusherAge(p) > PUSHER_TTL_MS
const holdsPusherToken = (p) => Boolean(p) && process.env.AF_PUSH_TOKEN === p.token

/**
 * How long ago the lock's ADVERTISED ADDRESS was last confirmed by its holder.
 *
 * 🛑 A DIFFERENT NUMBER FROM THE HEARTBEAT, AND THE DIFFERENCE IS THE DEFECT.
 * The heartbeat says the holder is ALIVE. It says nothing about whether the name
 * printed as "reach them at" is still the name they answer to, and those two come
 * apart the moment a session is renamed -- which happens routinely in this room.
 *
 * The 2026-08-30 fix stopped peers RELEASING a live lock whose recorded name had
 * died. It did not stop the lock ADVERTISING that dead name. So on 2026-09-02
 * three sessions in a row read `reach them at allfantasy-v2-main-b8`, had
 * SendMessage refused, and had nothing to do about it: the holder was genuinely
 * alive and pushing, so the self-clearing valve correctly never fired and there
 * was nothing to wait for.
 *
 * 🛑 THAT IS STRICTLY WORSE THAN THE BUG THAT WAS FIXED. A stale lock resolves
 * itself. A stale ADDRESS on a live lock has no expiry, because the thing that
 * would expire is exactly the thing that is healthy.
 *
 * `nameAt` falls back to `since`, so a lock claimed before this existed reports
 * its address as being as old as the claim -- which is precisely what it is.
 */
const pusherAddressAge = (p) => now() - (Number(p?.nameAt) || Number(p?.since) || 0)

/** Old enough that a rename could plausibly have happened since. */
const pusherAddressIsStale = (p) => pusherAddressAge(p) > PUSHER_ADDRESS_WARN_MS

/**
 * Refresh the lock's heartbeat, and optionally the address its holder answers to.
 * Only ever called for the token holder.
 *
 * ⚠ `advertise` CARRIES A NAME THE HOLDER SUPPLIED ABOUT ITSELF, and it is never
 * inferred from anywhere. A session is the only thing that knows its own current
 * name; guessing one would put a confidently WRONG address in front of every
 * blocked peer, which is worse than an old one -- an old address at least looks
 * suspect once its age is printed beside it.
 */
function touchPusher(dir, p, advertise) {
  try {
    const next = { ...p, heartbeatAt: now() }
    const name = typeof advertise?.name === 'string' ? advertise.name.trim() : ''
    if (name) {
      const ref = typeof advertise?.ref === 'string' && advertise.ref.trim() ? advertise.ref.trim() : name
      next.name = name
      next.ref = ref
      /* Stamped even when the name is UNCHANGED. "Still called this, confirmed a
         minute ago" is the useful signal for a blocked peer -- not merely that it
         changed, but that somebody vouched for it recently. */
      next.nameAt = now()
    }
    writeFileSync(join(dir, 'pusher.json'), `${JSON.stringify(next, null, 2)}\n`)
  } catch {}
}

/** The address, with the one fact that tells a reader whether to trust it: its age. */
function pusherAddress(p) {
  return `${p.ref || p.name}  (SendMessage, address confirmed ${Math.round(pusherAddressAge(p) / 60000)} min ago)`
}

/**
 * What to do when that address does not resolve -- the step that was missing.
 *
 * Every message here already said "a name that no longer resolves is not evidence
 * the session ended". True, and on 2026-09-02 three sessions read it, agreed with
 * it, and still had nowhere to go: it says what NOT to conclude and nothing about
 * what to DO. An instruction that only forbids is why careful people stall.
 */
function pusherAddressHelp(p) {
  if (!pusherAddressIsStale(p)) return ''
  return (
    `\n  ⚠ THAT ADDRESS IS ${Math.round(pusherAddressAge(p) / 60000)} MIN OLD AND MAY NO LONGER RESOLVE.` +
    ` Sessions are renamed here,` + `\n    and the lock records the name held at claim time.` +
    `\n\n    If SendMessage bounces, the holder has almost certainly been renamed. Do NOT` +
    `\n    release or claim the role on that basis -- a live heartbeat means a live holder,` +
    `\n    and releasing one mid-batch is the failure this lock exists to prevent.` +
    `\n\n    Post your handover where a human can route it, and ask the room. The holder` +
    `\n    can re-advertise in one command:  npm run push:pusher -- --heartbeat --as <name>` +
    `\n\n`
  )
}

/**
 * Drop a stale lock and say so. Returns the live lock, or null if there is none
 * (or it expired). A cleared lock means no gate — the same fail-open shape the
 * rest of this file uses, reached by measurement rather than by someone deciding
 * a peer is gone.
 */
function livePusher(dir) {
  const p = readPusher(dir)
  if (!p) return null
  if (pusherIsStale(p)) {
    try {
      rmSync(join(dir, 'pusher.json'), { force: true })
    } catch {
      return p // could not remove it; keep honouring it rather than half-clearing
    }
    journal(dir, {
      event: 'pusher-expired',
      name: p.name,
      ref: p.ref,
      staleFor: `${Math.round(pusherAge(p) / 60000)}m`,
    })
    process.stderr.write(
      `  ⚠ push-queue: the pusher lock held by ${p.name} went ${Math.round(pusherAge(p) / 60000)} min without a heartbeat — expired and cleared.\n`,
    )
    return null
  }
  return p
}

/** One `ls-remote` per process, at most. Null means "could not tell". */
let remoteMainSha
function remoteMain() {
  if (remoteMainSha !== undefined) return remoteMainSha
  if (process.env.AF_PUSH_QUEUE_NO_REMOTE === '1') {
    remoteMainSha = null
    return remoteMainSha
  }
  /**
   * Test affordance, and a sibling of `AF_PUSH_QUEUE_NO_REMOTE` above rather
   * than a new kind of thing: the ancestry release cannot be exercised without
   * naming what `origin/main` is, and reaching the network to find out would put
   * a flaky `ls-remote` in charge of whether the queue blocks.
   *
   * Safe to have in production for the same reason the rest of this file fails
   * open: the worst a bogus value can do is release a ticket early, letting one
   * session take a turn out of order. It cannot block a push.
   */
  if (process.env.AF_PUSH_QUEUE_REMOTE_SHA) {
    remoteMainSha = process.env.AF_PUSH_QUEUE_REMOTE_SHA
    return remoteMainSha
  }
  const out = git(['ls-remote', 'origin', 'refs/heads/main'], { timeout: 15_000 })
  remoteMainSha = out ? out.split(/\s+/)[0] || null : null
  return remoteMainSha
}

/**
 * Is `pre-push-smoke.mjs` genuinely mid-run for this exact sha?
 *
 * Read as a POSITIVE signal only. Every failure to answer — no marker, an
 * unreadable one, a truncated one, a clock that makes no sense — returns false
 * and buys the ticket the shorter grace, which is safe in that direction
 * precisely because the smoke refuses to run at all when it cannot write its
 * marker. Absence therefore means "no smoke is running" rather than "could not
 * tell", which is the property this whole mechanism rests on.
 *
 * ⚠ KEYED ON THE SHA, never on the worktree or the ticket. Two sessions can be
 * inside the guards at once, and a marker for someone else's commit says nothing
 * about this one.
 *
 * ⚠ AND A MARKER OLDER THAN THE SMOKE'S OWN CEILING IS A CORPSE, NOT A RUN. A
 * smoke killed hard enough to skip its own cleanup would otherwise grant the
 * long grace forever. Bounding it here degrades to the old behaviour — 25 min
 * and no worse — rather than to something new.
 */
/**
 * 🛑 THE MARKER ONLY EXISTS IF THE SMOKE THAT RAN KNOWS TO WRITE ONE, AND FOR A
 * WHILE AFTER THIS LANDS, MOST OF THEM WILL NOT.
 *
 * The pre-push hook resolves its scripts from `$root/scripts` and only falls
 * back to the primary checkout when the file is ABSENT. A linked worktree
 * sitting on an older commit therefore has the file, and runs its OWN older
 * `pre-push-smoke.mjs` — which writes no marker. Judging that run by the short
 * grace kills a genuine 20-minute compile at 10 minutes, which is exactly the
 * six-lost-landings starvation the long grace exists to prevent.
 *
 * Caught in production rather than in review: on 2026-09-08 `#272` was released
 * as "never landed (no smoke running, short grace)" 12 minutes into a push whose
 * commit is now `origin/main`. Its push was still in flight, and nothing in the
 * marker scheme could see it.
 *
 * So a compile that is running is treated as a smoke that could not announce
 * itself. Three-valued on purpose, and only `false` — a positive, parsed "no
 * compiler is running" — is allowed to shorten anything. An error, a timeout, a
 * platform this cannot inspect: all return null and keep the long grace, which
 * is the safe direction.
 *
 * ⚠ Called ONLY at the moment a ticket would be released on the short grace, so
 * the subprocess cost is paid once per expiry rather than once per reconcile.
 */
function typecheckIsRunning() {
  const forced = process.env.AF_PUSH_QUEUE_ASSUME_TSC
  if (forced === '1') return true
  if (forced === '0') return false
  if (process.platform !== 'win32') return null
  const res = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*tsc.js*' } | Measure-Object).Count",
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  )
  if (res.error || res.status !== 0) return null
  const n = Number.parseInt(String(res.stdout).trim(), 10)
  return Number.isFinite(n) ? n > 0 : null
}

function smokeIsRunningFor(dir, sha) {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'smoke-active', `${sha}.json`), 'utf8'))
    const startedAt = Number(m.startedAt) || 0
    if (!startedAt) return false
    return now() - startedAt < SMOKE_TIMEOUT_MS + PUSH_GRACE_MARGIN_MS
  } catch {
    return false
  }
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
    const allowedAt = Number(t.allowedAt) || 0

    /**
     * 🛑 A TICKET THAT IS PUSHING IS JUDGED BY ITS GRACE, NEVER BY ITS HEARTBEAT.
     * Nothing refreshes `heartbeatAt` between the wave-through and the end of the
     * push — `check` writes it once and then git runs the guards — so the
     * heartbeat of a perfectly healthy push ages exactly as fast as an abandoned
     * one. Reaping on it here would re-impose a 15 min ceiling and undo the grace
     * above, which is the whole bug: this branch ran FIRST and would have killed
     * the ticket five minutes before the grace was even consulted.
     *
     * The grace is the honest clock for this state because it starts when the
     * push was allowed to begin, which is the only moment we actually observed.
     * A ticket with no `allowedAt` is not really pushing (a hand-edited or
     * truncated ticket), so it falls through to the heartbeat rule rather than
     * being trusted forever.
     */
    if (t.state === 'pushing' && allowedAt) {
      /**
       * 🛑 "IS MY SHA THE TIP" IS THE WRONG QUESTION, AND ASKING IT COSTS THE
       * HEAD OF THE LINE ITS WHOLE GRACE.
       *
       * A push that lands is only the tip until the next one lands on top of it.
       * Between this ticket's push finishing and this reconcile running, any peer
       * can push — and then `landed === t.sha` is false forever, for a commit
       * that is sitting on `origin/main`. The ticket is not waiting for anything
       * at that point; it just cannot say so, and it holds the head until its
       * grace expires. On a queue that was 7 deep on 2026-09-08 this compounds
       * with every landing.
       *
       * Ancestry is the honest question — "is my work ON main" — and it subsumes
       * the tip case, which is kept only as a free fast path ahead of the git
       * call. `isAncestor` is deliberately three-valued: 0 is yes, 1 is no, and
       * anything else (a timeout, a killed process, a contended tree) is NOT a
       * verdict. This repo has already read a `timeout`'s 124 and a missing
       * `pgrep`'s 127 as answers; here a null must mean "do not act", never "no",
       * so the ticket simply keeps its grace and the next poll asks again.
       *
       * ⚠ THIS DOES NOT COVER A CHERRY-PICKED BATCH. A pick renames every commit,
       * so a batched landing leaves the picked-from tickets failing this test and
       * waiting out their (now 10 min) grace. That is bounded and survivable
       * rather than free: a session that batches peers' commits should `drop`
       * their tickets explicitly instead of leaving them to expire.
       */
      const landed = remoteMain()
      if (landed && (landed === t.sha || isAncestor(t.sha, landed) === true)) {
        release(dir, t, 'landed on origin/main')
        continue
      }
      /**
       * Which clock applies is decided by the smoke marker, and the journal
       * records which one fired. That naming is not decoration: this whole fix
       * was diagnosed by reading release reasons out of `journal.jsonl`, and a
       * reason that does not say which grace expired would have made the next
       * such diagnosis guesswork.
       */
      const smoking = smokeIsRunningFor(dir, t.sha)
      if (t0 - allowedAt > (smoking ? PUSH_GRACE_MS : SHORT_PUSH_GRACE_MS)) {
        /**
         * The short grace has run out, but an UNANNOUNCED smoke — one run by an
         * older worktree's copy of the guard — looks identical to no smoke at
         * all. A running compiler is the evidence that separates them, and only
         * a parsed `false` is allowed to shorten anything: null keeps the long
         * grace. Still capped by PUSH_GRACE_MS, so this can defer a release but
         * never prevent one.
         */
        if (!smoking && t0 - allowedAt <= PUSH_GRACE_MS && typecheckIsRunning() !== false) {
          live.push(t)
          continue
        }
        release(
          dir,
          t,
          `waved through ${mins(t0 - allowedAt)} ago and never landed ` +
            (smoking
              ? '(smoke run in progress, full grace)'
              : t0 - allowedAt > PUSH_GRACE_MS
                ? '(full grace, no smoke ever announced)'
                : '(no smoke running and no compile in flight, short grace)'),
        )
        continue
      }
      live.push(t)
      continue
    }

    if (t0 - heartbeat > HEARTBEAT_TTL_MS) {
      release(dir, t, `heartbeat stale (${mins(t0 - heartbeat)})`)
      continue
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

/**
 * ⚠ `subjectFor` TAKES THE SHA BEING PUSHED, NOT `HEAD`. The pusher routinely
 * pushes a cherry-picked batch tip that is not this checkout's HEAD, and HEAD
 * moves under every session here anyway. Labelling a ticket from HEAD wrote the
 * wrong commit subject into the journal twice on 2026-08-30 — the ticket was
 * right, the audit trail described someone else's work. A journal that names the
 * wrong commit is worse than one with no label.
 */
function describeContext(sha) {
  const head = git(['rev-parse', 'HEAD'])
  return {
    sha: head,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    worktree: git(['rev-parse', '--show-toplevel']),
    subject: git(['log', '-1', '--format=%s', sha || head || 'HEAD']),
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
 * Would this push add NOTHING that is not already on `origin/main`?
 *
 * ⚠ THE QUEUE'S DEPTH WAS MOSTLY NOT REAL WORK. Audited 2026-09-11: of ELEVEN
 * live tickets, SIX were already upstream — three copies of one docs commit under
 * renamed shas, plus two whose patch-id was on `main` hours earlier. Everyone in
 * that line, including the sessions that put them there, waited behind their own
 * orphaned churn. The refusal has to happen at TICKET time, not at push time:
 * refusing at the head of the line is a correct answer delivered forty minutes
 * late, and it does not stop the ticket occupying a place meanwhile.
 *
 * 🛑 AND THE OBVIOUS IMPLEMENTATION STRANDS WORK. Testing "the tip's patch-id is
 * already upstream" is WRONG, because a ticket is keyed on the TIP and a tip's
 * patch-id is only its top commit's. A tip of [new commit, duplicate on top]
 * would be refused and the new commit never landed — no conflict, no error, just
 * a push nobody let through. So the question is not about the tip at all: EVERY
 * commit in `origin/main..tip` must already be upstream before this refuses.
 * There is a control for exactly this case; do not "simplify" it back.
 *
 * Returns null — meaning ALLOW — for every uncertainty: no remote, git failed, a
 * patch-id that would not compute, or a range too large to scan. Same fail-open
 * contract as the rest of this file. A queue that blocks a real push to save a
 * wasted one is a worse trade than the noise it removes.
 */
/* ⚠ NOT `Number(env) || 200`. That swallows an explicit 0, because 0 is falsy —
   so the cap could never be lowered, and the control written to exercise the
   fail-open path silently tested the default instead and reported a refusal.
   Found by that control going the wrong way, which is the only reason it is
   parsed properly here. */
const capRaw = Number.parseInt(process.env.AF_PUSH_QUEUE_UPSTREAM_CAP ?? '', 10)
const UPSTREAM_SCAN_CAP = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : 200

function alreadyUpstream(sha) {
  if (process.env.AF_PUSH_QUEUE_ALLOW_DUPLICATE === '1') return null

  const main = remoteMain()
  if (!main) return null
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) return null

  // Literally contained: the orphan case. A re-taking orphan holds a landed sha
  // by definition, which is where most of the six came from.
  if (isAncestor(sha, main) === true) return { kind: 'contained', pairs: [] }

  const rangeOut = git(['rev-list', `${main}..${sha}`], { timeout: 20_000 })
  if (rangeOut === null) return null
  const commits = rangeOut.split('\n').map((s) => s.trim()).filter(Boolean)
  if (commits.length === 0) return { kind: 'contained', pairs: [] }
  if (commits.length > UPSTREAM_SCAN_CAP) return null

  const base = git(['merge-base', sha, main])
  if (!base) return null
  const upOut = git(['rev-list', `${base}..${main}`], { timeout: 20_000 })
  if (upOut === null) return null
  const upstream = upOut.split('\n').map((s) => s.trim()).filter(Boolean)
  if (upstream.length === 0 || upstream.length > UPSTREAM_SCAN_CAP) return null

  /* ⚠ null NEVER MATCHES null, the same rule `sameWork` carries. A commit whose
     patch-id would not compute is not thereby a duplicate of another one that
     also would not compute — and here that mistake refuses a real push. */
  const upstreamPids = new Map()
  for (const c of upstream) {
    const p = patchIdOf(c)
    if (p && !upstreamPids.has(p)) upstreamPids.set(p, c)
  }
  if (upstreamPids.size === 0) return null

  const pairs = []
  for (const c of commits) {
    const p = patchIdOf(c)
    if (!p) return null
    const landed = upstreamPids.get(p)
    if (!landed) return null // something here is genuinely new — allow the push
    pairs.push([c, landed])
  }
  return { kind: 'duplicate', pairs }
}

function upstreamRefusal(sha, found) {
  const lines =
    found.kind === 'contained'
      ? `     ${sha.slice(0, 9)} is already contained in origin/main\n`
      : found.pairs
          .map(([local, landed]) => `     ${local.slice(0, 9)}  already on main as  ${landed.slice(0, 9)}\n`)
          .join('')
  return (
    `\n  ✋ push-queue: this push would add nothing — refusing the TICKET, not just the push.\n\n` +
    lines +
    `\n  Matched by patch-id, not by sha, because a cherry-pick renames every commit\n` +
    `  it touches — which is why ancestry says "no" about work that is sitting\n` +
    `  right there on main. Nothing is wrong with your commit; it has landed.\n\n` +
    `  Audited 2026-09-11: 6 of 11 tickets in this queue were already upstream, so\n` +
    `  everyone waiting was mostly waiting behind duplicates. No ticket was taken.\n\n` +
    `  Confirm for yourself before doing anything else:\n` +
    `     git show <sha> --format='' --patch | git patch-id --stable\n\n` +
    `  ⚠ If a ticket for this sha was DROPPED rather than landed, the sha may be\n` +
    `  abandoned rather than shipped — ask its author before re-landing it.\n\n` +
    `  Genuinely re-landing it on purpose?  AF_PUSH_QUEUE_ALLOW_DUPLICATE=1\n\n`
  )
}

/**
 * Does git's rejection say this branch refuses DIRECT pushes as a matter of policy?
 *
 * ⚠ THE WHOLE QUEUE ASSUMES A DIRECT PUSH TO `refs/heads/main` — `cmdCheck` engages only for
 * that remote ref, and `cmdPush`'s default refspec names it. The moment branch protection
 * enforces required checks on everyone (GitHub's `enforce_admins`), that assumption is false and
 * the queue becomes actively misleading rather than merely idle: a session waits its full turn,
 * pays the ~25s secret scan and the smoke, reaches the head of the line, and is THEN refused —
 * having read nothing but advice about stale bases and rebuilding. Not one message says "open a
 * pull request".
 *
 * Matching on git's own text rather than asking an API keeps this dependency-free and
 * fail-closed-to-nothing: an unrecognised failure is simply not classified, and the existing
 * "did NOT land" path runs unchanged.
 */
/*
 * ⚠ EVERY MARKER HERE IS SPECIFIC TO BRANCH PROTECTION. `pre-receive hook declined` was in this
 * list and is NOT: git prints it for ANY rejecting server-side hook — a secret scan, a custom
 * policy hook, anything — so it misreported unrelated rejections as "open a PR" AND recorded that
 * for every other session. The negative control below caught it; the list shipped correct only
 * because that control was written to fail.
 */
const PROTECTION_MARKERS = [
  /GH006/i,
  /protected branch/i,
  /changes must be made through a pull request/i,
  /required status check/i,
]

function looksLikeBranchProtection(text) {
  if (!text) return false
  return PROTECTION_MARKERS.some((re) => re.test(String(text)))
}

/*
 * The first session to be refused TEACHES THE QUEUE, so the next one is told at ticket time
 * instead of after a forty-minute wait. No API call, no token, no new failure mode — the
 * evidence is a rejection we already had in hand.
 *
 * ⚠ IT IS SELF-CORRECTING IN BOTH DIRECTIONS, which is what makes it safe to act on:
 *   - a successful direct push CLEARS it (proof that direct pushes work again)
 *   - it expires on a TTL, so a marker written by a one-off server-side hiccup cannot wedge
 *     the queue for everyone indefinitely
 * and `AF_PUSH_QUEUE_IGNORE_PROTECTION=1` bypasses it outright.
 */
const ttlRaw = Number.parseInt(process.env.AF_PUSH_QUEUE_PROTECTION_TTL_MS ?? '', 10)
const PROTECTION_TTL_MS = Number.isFinite(ttlRaw) && ttlRaw >= 0 ? ttlRaw : 12 * 60 * 60_000

/*
 * 🛑 A MARKER THAT ONLY A SUCCESSFUL PUSH CAN CLEAR IS A DEADLOCK, BECAUSE THE MARKER PREVENTS
 * THE PUSH. Found the hard way: protection was enabled at 17:23, this recorded it correctly at
 * 17:30, protection was REVERTED at ~17:55 — and the marker then refused every session in the
 * room for a false reason, with only a 12h expiry and an env var nobody knew about to escape it.
 * It had to be deleted by hand. A guard whose stale state blocks work is worse than the waste it
 * prevents, and "clears on success" is not self-healing when the block is what stops success.
 *
 * So the marker now lets ONE push through every re-probe interval: the reading is refreshed by
 * the only thing that can actually answer the question — an attempted push. Cost is bounded to at
 * most one wasted attempt per interval; recovery is automatic and needs nobody to know anything.
 * `lastProbeAt` is stamped BEFORE the probe so nine concurrent sessions do not all probe at once.
 */
const probeRaw = Number.parseInt(process.env.AF_PUSH_QUEUE_PROTECTION_REPROBE_MS ?? '', 10)
const PROTECTION_REPROBE_MS = Number.isFinite(probeRaw) && probeRaw >= 0 ? probeRaw : 10 * 60_000

const protectionPath = (dir) => join(dir, 'direct-push-blocked.json')

function readProtection(dir) {
  if (process.env.AF_PUSH_QUEUE_IGNORE_PROTECTION === '1') return null
  try {
    const m = JSON.parse(readFileSync(protectionPath(dir), 'utf8'))
    const at = Number(m?.observedAt) || 0
    if (!at || now() - at > PROTECTION_TTL_MS) return null

    // Time to re-test? Stamp FIRST, then let this one push through to find out.
    const lastLook = Number(m?.lastProbeAt) || at
    if (now() - lastLook >= PROTECTION_REPROBE_MS) {
      try {
        writeFileSync(protectionPath(dir), JSON.stringify({ ...m, lastProbeAt: now() }, null, 2))
      } catch {
        return null // cannot stamp => cannot rate-limit the probe => do not block
      }
      process.stderr.write(
        `  ⚠ push-queue: main last refused direct pushes ${Math.round((now() - at) / 60_000)} min ago;\n` +
          `    re-testing with this push rather than refusing on a stale reading.\n`,
      )
      return null
    }
    return m
  } catch {
    return null // unreadable or absent: behave exactly as before
  }
}

function writeProtection(dir, evidence) {
  try {
    writeFileSync(
      protectionPath(dir),
      JSON.stringify({ observedAt: now(), evidence: String(evidence).slice(0, 800) }, null, 2),
    )
  } catch {}
}

function clearProtection(dir) {
  try {
    rmSync(protectionPath(dir), { force: true })
  } catch {}
}

function protectionRefusal(m) {
  const mins = Math.round((now() - (Number(m?.observedAt) || now())) / 60_000)
  return (
    `\n  ✋ push-queue: main refuses DIRECT pushes — this needs a pull request, not a place in line.\n\n` +
    `     observed  ${mins} min ago, from git's own rejection of a real push\n\n` +
    `  No ticket was taken. Queueing would cost you the wait, the secret scan and the\n` +
    `  typecheck smoke before GitHub refused you at the head of the line — which is exactly\n` +
    `  what happened to the session that recorded this.\n\n` +
    `  Open a PR instead:\n\n` +
    `     git push -u origin HEAD:refs/heads/<your-branch>\n` +
    `     gh pr create --base main --fill\n\n` +
    `  ⚠ Required status checks gate the MERGE, so they cannot have run on a commit that has\n` +
    `  not landed anywhere — a direct push is refused by construction, not by a red suite.\n\n` +
    `  This clears itself: a successful direct push removes it, and it expires after\n` +
    `  ${Math.round(PROTECTION_TTL_MS / 60_000)} min. Believe protection is off again?\n` +
    `     AF_PUSH_QUEUE_IGNORE_PROTECTION=1 git push …\n\n`
  )
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
      /*
       * 🛑 NEVER REBIND BACKWARDS. Patch-id equality is DIRECTION-BLIND: a
       * rebase leaves the old and new commits with the same patch-id, so the
       * test that recognises "my work under a new name" recognises the reverse
       * just as happily and walks the ticket back to the name it already left.
       *
       * That is not hypothetical. A `wait` loop holds the sha it was LAUNCHED
       * with and re-enters `ticketFor` every few seconds. Rebase, `rebind`, and
       * the still-running wait silently undoes it on its next tick — measured
       * 2026-09-09 on #000313, where `rebind` printed "now covers 482669cfb;
       * place kept" and the ticket file read `66621d0fb` moments later. The
       * status view showed the stale sha, which reads as a display quirk rather
       * than a lost rebind.
       *
       * ⚠ AND THE REVERT COSTS MORE THAN THE SHA. The branch below also sets
       * `state = 'waiting'` and deletes `allowedAt`, so a stale process can
       * DEMOTE a ticket that had already been waved through — losing a turn the
       * holder waited half an hour for.
       *
       * Ancestry cannot settle the direction either: a rebase produces a
       * SIBLING, so `--is-ancestor` answers "no" both ways (this file's own
       * rebind note records the measurement). The ticket's own history can,
       * because it is the one party that knows which names it has already
       * carried.
       */
      if (Array.isArray(t.shaHistory) && t.shaHistory.includes(sha)) return false
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
      /* The names this ticket has already carried, so the guard above can
         refuse to walk it back to one of them. Append-only and bounded — a
         ticket that rebinds more than a handful of times has a bigger problem
         than its history array. */
      const priorShas = Array.isArray(inherited.shaHistory) ? inherited.shaHistory : []
      inherited.shaHistory = [...priorShas, was].slice(-20)
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
    /*
     * 🛑 GOING TO THE BACK OF THE LINE MUST NOT BE SILENT. The inheritance rules above are
     * deliberately conservative — patch-id crosses worktrees, ancestry does not — and when they
     * all decline, this used to create a fresh ticket with no comment. Measured 2026-09-12: a
     * 3-commit tip rebuilt as a 4-commit tip in a DIFFERENT worktree matched neither rule
     * (the tip's patch-id changed, and the worktree gate blocked the ancestry path), so 84
     * minutes of queue position were lost without a word. The position was recoverable the
     * whole time, by `rebind`, which the author had no reason to run because nothing said so.
     *
     * ⚠ THE SAME SIGNAL HAS A SECOND, WORSE MEANING, which is why it is worth reporting even
     * when it is not your own ticket: a live ticket whose sha is an ANCESTOR of yours and is
     * NOT yet on origin/main means an unlanded queued commit is sitting inside your tip. If it
     * is not yours, you are about to push a peer's unattested work — the exact accident this
     * repo already records ("one session pushed three other sessions' commits").
     *
     * Advisory only: the ticket is still created and no ownership is changed. Fails silent on
     * any git trouble rather than inventing a warning.
     */
    try {
      const upstream = remoteMain()
      for (const t of live) {
        if (!t?.sha || t.sha === sha) continue
        if (isAncestor(t.sha, sha) !== true) continue
        if (upstream && isAncestor(t.sha, upstream) === true) continue // already landed: uninteresting
        const ownedHere = t.worktree === ctx.worktree
        process.stderr.write(
          `\n  ⚠ push-queue: #${pad(t.seq)} (${String(t.sha).slice(0, 9)}) is an UNLANDED commit inside the tip\n` +
            `    you are queueing, and it did not carry forward — so this takes a NEW ticket at the back.\n` +
            (ownedHere
              ? `    It is from THIS worktree, so it is almost certainly your own work under a new tip.\n` +
                `    Keep its place instead of starting again:\n` +
                `       npm run push:rebind -- --from=${String(t.sha).slice(0, 9)} --to=${String(sha).slice(0, 9)}\n`
              : `    It is from ANOTHER worktree (${String(t.worktree || 'unknown').split('/').pop()}), so your tip may\n` +
                `    carry a peer's unattested commit. Check ${'`'}git log ${String(t.sha).slice(0, 9)}~1..${String(sha).slice(0, 9)}${'`'} before pushing.\n`) +
            `\n`,
        )
        break
      }
    } catch {
      // no warning is better than a wrong one
    }

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
  const pusher = livePusher(dir)
  /*
   * The holder's own push refreshes BOTH the heartbeat and, when AF_PUSH_NAME is
   * set, the address. That is what makes this self-healing rather than a chore:
   * a working pusher pushes, so the address a blocked peer reads is at most one
   * push old. Nothing breaks when AF_PUSH_NAME is unset -- the address simply
   * keeps its previous value and reports its true age.
   */
  if (pusher && holdsPusherToken(pusher)) {
    touchPusher(dir, pusher, { name: process.env.AF_PUSH_NAME, ref: process.env.AF_PUSH_NAME })
  }
  if (pusher && !holdsPusherToken(pusher)) {
    process.stderr.write(
      `\n  ✋ push blocked: ${pusher.name} is the designated pusher right now.\n\n` +
        `     holding since  ${new Date(pusher.since).toLocaleString()}\n` +
        `     last heartbeat ${Math.round(pusherAge(pusher) / 60000)} min ago (expires at ${PUSHER_TTL_MS / 60000})\n` +
        `     reach them at  ${pusherAddress(pusher)}${pusherAddressHelp(pusher)}\n\n` +
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

  /* Also before ticketFor: if main is known to refuse direct pushes, a ticket is worthless and
     the wait is pure loss. Absent or expired marker => behaves exactly as it always did. */
  const blocked = readProtection(dir)
  if (blocked) {
    process.stderr.write(protectionRefusal(blocked))
    process.exit(1)
  }

  /* BEFORE ticketFor, deliberately: the whole point is that no place in the line
     is occupied by a push that would add nothing. Fails open on every doubt. */
  const upstream = alreadyUpstream(sha)
  if (upstream) {
    process.stderr.write(upstreamRefusal(sha, upstream))
    process.exit(1)
  }

  const ctx = describeContext(sha)
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
  /*
   * ⚠ RESOLVE `--sha` BEFORE BUILDING THE CONTEXT, OR THE LABEL DESCRIBES THE
   * CALLER'S HEAD. `describeContext` derives `subject` from the sha it is
   * given and falls back to HEAD when given nothing, and `ticketFor` writes
   * that subject as the ticket's label — so calling it bare labelled every
   * `take --sha` ticket with whatever this checkout happened to be sitting on.
   *
   * Measured 2026-09-09: tickets #313, #314 and #317 — three sessions, not
   * consecutive — all displayed "feat(core): the league rail said …", which was
   * the commit of none of them. #313 is the one traced end to end: its label
   * was the subject of HEAD in the checkout that ran `take`, not of the sha it
   * was queued for. The queue is how ~9 sessions see what is landing, so a
   * wrong label is not cosmetic — it is the queue confidently describing
   * someone else's work.
   *
   * This is the invariant `describeContext`'s own header already states; only
   * `cmdPush` was honouring it.
   */
  const argSha = argFor(argv, '--sha')
  const ctx = describeContext(argSha)
  const sha = argSha || ctx.sha
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

/**
 * Move an existing ticket onto a new sha WITHOUT losing its place in line.
 *
 * 🛑 THIS COMMAND USED TO HIJACK A PEER'S TICKET, AND THE MOST LIKELY VICTIM WAS
 * THE HEAD OF THE LINE. `--from` was optional and the fallback was `tickets[0]`
 * — the LOWEST sequence number, i.e. whoever was next to push. Nine sessions
 * share one checkout, so "my ticket" was never a safe default. Measured
 * 2026-09-07: a session ran rebind from the primary checkout and moved a
 * DIFFERENT session's ticket, twice, without either noticing at the time.
 *
 * 🛑 AND `--to` DEFAULTED TO `HEAD`, SO ANY UNRECOGNISED FLAG WAS A REBIND.
 * There is no `--help`; `push:rebind --help` parsed as "no --to", took the head
 * of the line, and pointed it at whatever the shared checkout's HEAD happened to
 * be. A command that reads as a request for documentation mutated shared state.
 * Both defaults are now refusals.
 *
 * ⚠ AND THE LABEL CAME FROM THE CALLER'S HEAD, NOT FROM THE TARGET. That is why
 * `push:status` spent a day describing tickets as work they did not contain —
 * a ticket holding the card-cache sha displayed a FantasyCalc subject. The label
 * is now read from the sha being rebound TO, which is the only thing it
 * describes. A ticket that cannot be identified from the queue is what sends
 * people looking for owners by guesswork.
 */
function cmdRebind(argv) {
  const dir = resolveDir()
  if (!dir) return

  const refuse = (msg) => {
    process.stderr.write(`\n  🛑 push-queue rebind: ${msg}\n\n`)
    process.exitCode = 1
  }

  const to = argFor(argv, '--to')
  if (!to) {
    return refuse(
      'no --to. This command moves a ticket onto a NEW sha and there is no safe\n' +
        '     default — it used to fall back to HEAD, which turned any unrecognised flag\n' +
        '     (there is no --help) into a rebind of somebody else\'s ticket.\n\n' +
        '     Usage:  npm run push:rebind -- --from=<40-char sha> --to=<40-char sha>',
    )
  }

  const from = argFor(argv, '--from')
  const { tickets } = readTickets(dir)

  /*
   * Without `--from`, accept ONLY an unambiguous match on the calling worktree.
   * Never `tickets[0]`: on a shared checkout that is the head of the line, which
   * belongs to whoever has waited longest — the worst possible thing to move.
   */
  let t
  if (from) {
    t = tickets.find((x) => x.sha === from || pad(x.seq) === pad(Number(from)))
    if (!t) return refuse(`no ticket matches --from=${String(from).slice(0, 12)}.`)
  } else {
    /*
     * ⚠ Normalise separators before comparing. `git rev-parse --show-toplevel`
     * returns forward slashes on Windows while most other sources of a path here
     * return backslashes; a literal === would silently never match, and this
     * branch would then refuse every time — a guard that always says no is as
     * useless as one that always says yes, just in the safer direction.
     */
    const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
    const wt = norm(describeContext().worktree)
    const mine = wt ? tickets.filter((x) => norm(x.worktree) === wt) : []
    if (mine.length !== 1) {
      return refuse(
        mine.length === 0
          ? `no ticket belongs to this worktree, so there is nothing to rebind.\n     Pass --from=<40-char sha> to name one explicitly.`
          : `${mine.length} tickets belong to this worktree; --from is required to say which.`,
      )
    }
    t = mine[0]
  }

  const was = t.sha
  /*
   * ⚠ RECORD THE NAME WE ARE LEAVING, OR THIS REBIND CAN BE UNDONE SECONDS
   * LATER. `ticketFor` rebinds on patch-id equality, which is direction-blind,
   * so any still-running `wait` or `check` holding the OLD sha will walk the
   * ticket straight back. The guard there reads this list; an explicit rebind
   * that does not append to it is the one path that stays vulnerable — and it
   * is the path a human takes precisely when they know the sha changed.
   */
  const priorShas = Array.isArray(t.shaHistory) ? t.shaHistory : []
  t.shaHistory = [...priorShas, was].slice(-20)
  t.sha = to
  t.state = 'waiting'
  delete t.allowedAt
  t.heartbeatAt = now()
  // The label describes the TARGET sha, never the caller's HEAD.
  t.label = git(['log', '-1', '--format=%s', to]) || t.label
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

  if (argv.includes('--heartbeat')) {
    const held = readPusher(dir)
    if (!held) return process.stdout.write('push-queue: no pusher lock to refresh.\n')
    if (!holdsPusherToken(held)) {
      return process.stdout.write(
        `push-queue: not your lock — ${held.name} holds it. Only the token holder can refresh it.\n`,
      )
    }
    /*
     * `--as` is how a RENAMED holder re-advertises. There is no way to detect the
     * rename from here -- the script cannot see ListAgents, and a name is not
     * derivable from a token -- so the holder has to say it. This is the manual
     * path; AF_PUSH_NAME on the push itself is the automatic one.
     */
    const as = argFor(argv, '--as')
    touchPusher(dir, held, as ? { name: as, ref: argFor(argv, '--ref') || as } : undefined)
    const after = readPusher(dir) || held
    return process.stdout.write(`push-queue: heartbeat refreshed for ${after.name}.\n`)
  }

  if (argv.includes('--release')) {
    const held = readPusher(dir)
    if (!held) {
      process.stdout.write('push-queue: no pusher lock to release.\n')
      return
    }

    // 🛑 A FRESH LOCK IS NOT YOURS TO RELEASE. This is the whole point of the
    // heartbeat: on 2026-08-30 a peer released a lock held by a session that was
    // mid-batch, because the holder's NAME had stopped resolving. Names are
    // reassigned here; liveness is not a thing to infer about someone else.
    // Three ways past this, in descending order of how much you should like them:
    // you hold the token (it is your own lock), the lock is stale (measured, not
    // judged), or you pass --force and own the consequences.
    const mine = holdsPusherToken(held)
    const stale = pusherIsStale(held)
    const forced = argv.includes('--force')

    if (!mine && !stale && !forced) {
      process.stderr.write(
        `\n  ✋ push-queue: ${held.name} holds the pusher role and the lock is LIVE.\n\n` +
          `     last heartbeat  ${Math.round(pusherAge(held) / 60000)} min ago\n` +
          `     expires after   ${PUSHER_TTL_MS / 60000} min without one\n` +
          `     reach them at   ${pusherAddress(held)}${pusherAddressHelp(held)}\n\n` +
          `  A quiet pusher is not an absent one — they may be verifying a tip or\n` +
          `  waiting on a ratchet, which is exactly when the lock matters most. A\n` +
          `  name that no longer resolves is NOT evidence the session ended: names\n` +
          `  are reassigned in this room, and that is how a live lock was released\n` +
          `  out from under a batch on 2026-08-30.\n\n` +
          `  Ask the room before overriding. If it really is abandoned, it clears\n` +
          `  itself once the heartbeat goes stale — no action needed.\n\n` +
          `  Genuinely stuck?  npm run push:pusher -- --release --force\n\n`,
      )
      process.exitCode = 1
      return
    }

    try {
      rmSync(file, { force: true })
    } catch {}
    const why = mine ? 'released by its holder' : stale ? `stale for ${Math.round(pusherAge(held) / 60000)}m` : 'FORCED by another session'
    journal(dir, { event: 'pusher-released', name: held.name, ref: held.ref, reason: why })
    process.stdout.write(
      `push-queue: pusher role released (was ${held.name}) — ${why}. Anyone may push again; tell the other sessions.\n`,
    )
    return
  }

  const claim = argFor(argv, '--claim')
  if (claim) {
    const token = randomUUID()
    const ref = argFor(argv, '--ref') || ''
    const existing = livePusher(dir)
    if (existing && !holdsPusherToken(existing)) {
      process.stderr.write(
        `\n  ✋ push-queue: ${existing.name} already holds the pusher role, heartbeat ${Math.round(pusherAge(existing) / 60000)} min ago.\n` +
          `     Claiming would take it from a live holder. Ask them, or wait for it to\n` +
          `     expire on its own after ${PUSHER_TTL_MS / 60000} min without a heartbeat.\n\n`,
      )
      process.exitCode = 1
      return
    }
    writeFileSync(
      file,
      `${JSON.stringify({ name: claim, ref, token, since: Date.now(), heartbeatAt: Date.now(), nameAt: Date.now() }, null, 2)}\n`,
    )
    journal(dir, { event: 'pusher-claimed', name: claim, ref })
    process.stdout.write(
      `push-queue: ${claim} now holds the pusher role.\n\n` +
        `  Push with the token so the gate lets you through:\n\n` +
        `     AF_PUSH_TOKEN=${token} AF_PUSH_NAME=${claim} npm run push:main\n\n` +
        `  ⚠ Your NAME is how blocked sessions reach you, and names are reassigned
` +
        `    here. AF_PUSH_NAME re-advertises it on every push, so the address
` +
        `    stays current without you remembering. If you are renamed between
` +
        `    pushes, say so explicitly:

` +
        `     npm run push:pusher -- --heartbeat --as <your-new-name>

` +
        `  ⚠ Announce it (ListAgents + SendMessage) and hand it over before you\n` +
        `    finish — a pusher who vanishes silently blocks everyone.\n` +
        `     npm run push:pusher -- --release\n`,
    )
    return
  }

  const held = livePusher(dir)
  if (!held) {
    process.stdout.write('push-queue: no designated pusher. Any session may push, in queue order.\n')
    return
  }
  const age = Math.round(pusherAge(held) / 60000)
  const expiresIn = Math.max(0, Math.round((PUSHER_TTL_MS - pusherAge(held)) / 60000))
  process.stdout.write(
    `push-queue: ${held.name} holds the pusher role since ${new Date(held.since).toLocaleString()}.\n` +
      `  last heartbeat  ${age} min ago — expires in ${expiresIn} min without one\n` +
      `  reach them at   ${pusherAddress(held)}\n` +
      `  hand over your SHA and your attestation${pusherAddressHelp(held)}\n` +
      `${holdsPusherToken(held) ? '  (this session holds the token)\n' : ''}` +
      `\n  ⚠ A quiet holder is not an absent one, and a name that no longer resolves\n` +
      `    is not evidence a session ended — names are reassigned here. The lock\n` +
      `    clears itself on a stale heartbeat; you do not need to judge that.\n`,
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
  /* Same reason as `cmdTake` — `wait` also reaches `ticketFor`, which writes
     `ctx.subject` as the label whenever it creates or rebinds a ticket. */
  const argSha = argFor(argv, '--sha')
  const ctx = describeContext(argSha)
  const sha = argSha || ctx.sha
  const timeoutMs = Number(argFor(argv, '--timeout-min') || 0) * 60_000 || WAIT_TIMEOUT_MS
  const started = now()
  let lastPosition = -1

  for (;;) {
    const { degraded, reason, live, mine } = ticketFor(dir, sha, ctx)
    /*
     * 🛑 RETURN, DO NOT `allow()` — `allow()` IS `process.exit(0)`, AND THAT IS
     * THE RIGHT ANSWER ONLY FOR THE GATE.
     *
     * In the hook, exiting 0 means "do not block git" and the push proceeds.
     * Reached from `cmdPush`, which calls this IN-PROCESS and then runs
     * `git push` itself, the same exit killed the program BEFORE the push — so
     * "failing open, the push is allowed" was printed by a program that then
     * did not push. Exit 0, ticket still `waiting`, origin/main unmoved, no
     * error anywhere. Observed 2026-09-11 and caught only because the result
     * was verified by `ls-remote` rather than by exit status.
     *
     * Returning 0 means the same thing to both callers and is true for both:
     * the CLI `wait` still exits 0, and `cmdPush` falls through and actually
     * pushes. A fail-open that skips the operation is not failing open.
     *
     * ⚠ The two other `if (degraded) allow(reason)` sites are gate paths where
     * terminating IS correct. This is the only one whose caller has work left.
     */
    if (degraded) {
      process.stderr.write(
        `  ⚠ push-queue: ${reason} — failing open; proceeding without a turn check.\n`,
      )
      return 0
    }
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
/**
 * The sha a push actually SENDS, which is not always `HEAD`.
 *
 * 🛑 THE VERIFIER WAS READING THE WRONG SHA ON THE PASSTHROUGH PATH. `cmdPush` pins
 * `HEAD` into its own refspec — correct, and the reason is three comments up. But when a caller
 * supplies the refspec themselves, which the stale-base message above explicitly tells them to do
 * and which the landing convention REQUIRES (you cherry-pick onto origin/main, so the tip you push
 * is by construction not your HEAD), the push sends one sha and the verifier compared another.
 *
 * Observed 2026-08-31 landing a five-commit batch: the push succeeded, `origin/main` moved to the
 * intended tip, and the wrapper reported
 *
 *     ⚠ push did NOT land — origin/main is 2eaab62b8, not cc7dcd142
 *
 * which is the wrapper stating that origin/main IS the commit that was asked for, and calling that
 * a failure. ⚠ THE COST IS A DUPLICATE PRODUCTION BUILD: told the push failed, the next thing
 * anyone does is push again — the exact spend this whole queue exists to remove.
 *
 * Falls back to `HEAD` when no refspec names main, so the default path is unchanged.
 */
function pushedSha(passthrough, fallback) {
  for (const arg of passthrough) {
    // `+src:refs/heads/main` and `src:main` both count; a delete (`:main`) has no source and
    // correctly does not match.
    const m = /^\+?([^:]+):(?:refs\/heads\/)?main$/.exec(arg)
    if (!m) continue
    const resolved = git(['rev-parse', `${m[1]}^{commit}`])
    if (resolved) return resolved
  }
  return fallback
}

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

  /* ⚠ BEFORE cmdWait, which is what takes the ticket. There is already an
     "is already origin/main. Nothing to push." check further down, but it runs
     AFTER the wait and tests only exact equality with the tip — so a duplicate
     under a renamed sha still sat in the line for its full turn first. This
     catches both, at the door. */
  if (!argv.length) {
    const dup = alreadyUpstream(ctx.sha)
    if (dup) {
      process.stderr.write(upstreamRefusal(ctx.sha, dup))
      return 1
    }
  }

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

  // ⚠ Resolved HERE rather than reused from elsewhere: `cmdPush` had no `dir` in scope, and the
  // protection marker is the first thing in this function to need one. `node --check` cannot see
  // an undefined identifier, so this was caught by reading scope, not by the syntax check.
  const dir = resolveDir()

  // What is actually being sent — see pushedSha. On the default path this IS ctx.sha.
  const target = pushedSha(passthrough, ctx.sha)
  process.stdout.write(`push-queue: pushing ${target.slice(0, 9)} → git push ${passthrough.join(' ')}\n`)
  let pushStatus = 0
  let pushErrText = ''
  /*
   * ⚠ stderr is PIPED rather than inherited, purely so the rejection can be CLASSIFIED — and it
   * is written straight back out, so the user sees byte-for-byte what git said. stdout stays
   * inherited. Losing git's live output to gain a better error message would be a bad trade.
   */
  {
    const res = spawnSync('git', ['push', ...passthrough], {
      stdio: ['inherit', 'inherit', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    })
    pushErrText = res.stderr || ''
    if (pushErrText) process.stderr.write(pushErrText)
    if (res.error) pushStatus = 1
    else pushStatus = typeof res.status === 'number' ? res.status : 1
  }

  // ⚠ VERIFY BY SHA. A rejected push prints `-> main` too, and its status read
  // through a pipe is the pipe's. `ls-remote` is the only check that holds.
  remoteMainSha = undefined
  const landed = remoteMain()

  if (landed && landed === target) {
    // ⚠ The TICKET is still keyed on ctx.sha — it was taken for HEAD, so that is what releases
    // it. Only the landed/not-landed VERDICT is about the pushed sha. Conflating the two would
    // strand the ticket on every passthrough push.
    cmdDone([`--sha=${ctx.sha}`])
    // A direct push just succeeded, which is the strongest possible evidence that direct pushes
    // are permitted. Clearing here is what stops a stale marker outliving the protection.
    clearProtection(dir)
    process.stdout.write(`push-queue: ✅ origin/main is now ${landed.slice(0, 9)}.\n`)
    return 0
  }

  /*
   * 🛑 "REBUILD AND RE-RUN" IS THE WRONG ADVICE WHEN THE BRANCH REFUSES DIRECT PUSHES AT ALL.
   * It sends a session round a loop that cannot terminate. Classify first, and record it so the
   * NEXT session is stopped at ticket time rather than after its own full wait.
   */
  if (looksLikeBranchProtection(pushErrText)) {
    writeProtection(dir, pushErrText)
    process.stderr.write(
      `\n  ✋ push-queue: that was not a stale base — main REFUSES direct pushes.\n\n` +
        `     git's own words are above; the marker matched is branch protection, not a\n` +
        `     non-fast-forward, so rebuilding onto a newer main will not help.\n\n` +
        `  Your ticket is KEPT — dropping it for you on a classification would be worse than a\n` +
        `  wasted place, and you may disagree with this reading. Release it yourself with\n` +
        `  \`npm run push:done\` once you have opened a PR:\n\n` +
        `     git push -u origin HEAD:refs/heads/<your-branch>\n` +
        `     gh pr create --base main --fill\n\n` +
        `  Recorded so the next session is told BEFORE it waits its turn. It clears on the next\n` +
        `  successful direct push and expires after ${Math.round(PROTECTION_TTL_MS / 60_000)} min.\n\n`,
    )
    return pushStatus || 1
  }

  process.stderr.write(
    `push-queue: ⚠ push did NOT land — origin/main is ${landed ? landed.slice(0, 9) : '(unreadable)'}, not ${target.slice(0, 9)}.\n` +
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

/**
 * 🛑 ANY COMMAND FROM THE TOKEN HOLDER IS A HEARTBEAT — NOT JUST A GATED PUSH.
 *
 * The first version refreshed only inside `check`, which meant the heartbeat
 * ticked only when the pusher actually pushed. That is precisely backwards: a
 * pusher goes quiet BECAUSE they are mid-batch — verifying a tip, waiting on a
 * ratchet — and does nothing gated for the whole wait.
 *
 * It failed on its first real outing, mine: the lock expired after 92 minutes
 * while its holder sat on a starved ratchet, during exactly the window the TTL
 * justification named. The TTL length was not the defect; what refreshed it was.
 *
 * Refreshing on every verb costs one file write and means `push:status`,
 * `push:wait`, `push:pusher` — anything the holder runs while working — all
 * count as liveness, which is what "is this session still here" should have
 * meant from the start.
 */
// `livePusher` rather than `readPusher`: a stale lock should clear on the next
// command ANYONE runs, not linger until someone happens to attempt a push. That
// makes expiry prompt, and it is still a measurement — nobody is judging whether
// the holder exists.
try {
  const hbDir = queueDir()
  if (hbDir) {
    const hbLock = livePusher(hbDir)
    if (hbLock && holdsPusherToken(hbLock)) touchPusher(hbDir, hbLock)
  }
} catch {}

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

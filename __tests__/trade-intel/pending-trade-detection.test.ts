/**
 * A trade OFFER reaches the manager it is waiting on.
 *
 * 🛑 THE BUG. `currentCompletedTradeIds` kept only `status === 'complete'`, so the one notification
 * with a decision attached — an offer awaiting your answer — was the one filtered out. Guap
 * received a trade in Draft Junkies and heard nothing; his league is swept every five minutes and
 * the sweep looked straight past it, because a pending offer was not a trade as far as this code
 * was concerned.
 *
 * Delivery was never the gap: `detectAndNotifyLeague` already sends email AND push per recipient.
 * Only detection was.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SYNC = readFileSync(join(process.cwd(), 'lib/trade-intel/sleeperTradeSync.ts'), 'utf8')
const NOTIFY = readFileSync(join(process.cwd(), 'lib/trade-intel/tradeNotifyService.ts'), 'utf8')
const EMAIL = readFileSync(join(process.cwd(), 'lib/trade-intel/tradeGradeEmail.ts'), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('🛑 the feed no longer hides pending offers', () => {
  it('the scans are reading the right files', () => {
    // Positive control: a scan matching nothing satisfies every assertion below vacuously.
    expect(SYNC).toContain('currentTradeIds')
    expect(NOTIFY).toContain('detectAndNotifyLeague')
    expect(EMAIL).toContain('buildTradeGradeEmail')
  })

  it('🛑 the completed-only filter is gone', () => {
    const code = strip(SYNC)
    expect(code).not.toMatch(/status\s*===\s*'complete'/)
    expect(code).toContain('NOTIFIABLE_STATUSES')
  })

  it('🛑 accepts complete AND pending, and nothing else', () => {
    /*
     * An allow-list, not a deny-list. A withdrawn offer is `failed` and must not buzz a phone, and
     * treating an unrecognised status as notifiable would turn any future Sleeper vocabulary change
     * into a spam incident.
     */
    const set = /NOTIFIABLE_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(strip(SYNC))
    expect(set).not.toBeNull()
    const listed = set![1]
    expect(listed).toContain("'complete'")
    expect(listed).toContain("'pending'")
    expect(listed).not.toContain("'failed'")
  })

  it('carries the status forward rather than just the id', () => {
    // The copy downstream depends on knowing WHICH kind of trade this was.
    expect(strip(SYNC)).toMatch(/out\.push\(\{\s*id:.*status:/)
    expect(strip(NOTIFY)).toContain('statusById')
  })
})

describe('🛑 the first run after this change must not spam', () => {
  it('the seen-record version is bumped, which IS the migration', () => {
    /*
     * A v1 record was built from completed trades only. Reading pending ones against it would make
     * every offer already open in every league look brand new on the first run — a burst of emails
     * and push notifications about trades days or weeks old, to real inboxes.
     *
     * `readSeen` accepting only v2 makes a v1 record read as ABSENT, so the existing bootstrap
     * records everything and notifies nothing. One quiet run per league, no migration script.
     */
    const code = strip(NOTIFY)
    expect(code).toMatch(/type SeenRecord = \{ version: 2/)
    expect(code).toMatch(/data\?\.version === 2/)
    expect(code).toMatch(/version: 2, seen:/)
    // v1 must not still be accepted, or the bootstrap never fires and the burst happens.
    expect(code).not.toMatch(/version === 1/)
  })

  it('the bootstrap path still records everything and notifies nothing', () => {
    const code = strip(NOTIFY)
    expect(code).toMatch(/if \(!seenRecord\)\s*\{[\s\S]{0,220}?bootstrap: true/)
  })
})

describe('🛑 the copy tells the truth about which it is', () => {
  it('the push title is not hardcoded to "accepted"', () => {
    const code = strip(NOTIFY)
    expect(code).toMatch(/isOffer \? `Trade offer in \$\{leagueName\}`/)
    expect(code).not.toMatch(/title: `Trade accepted in \$\{leagueName\}`,/)
  })

  it('🛑 the EMAIL SUBJECT is not hardcoded either — the harder half to notice', () => {
    /*
     * The subject deliberately carries the news so a manager at 61 leagues need not open the mail.
     * That is exactly why "Trade completed" on a deal awaiting their own answer is worse than
     * silence: it reports a decision that was in fact left to them.
     */
    const code = strip(EMAIL)
    expect(code).toContain("params.status === 'pending' ? 'offered' : 'completed'")
    expect(code).not.toMatch(/`Trade completed in \$\{leagueName\}/)
  })

  it('the notifier actually passes the status to the email builder', () => {
    // Threading it into the type but not the call is a silent no-op.
    expect(strip(NOTIFY)).toMatch(/status: isOffer \? 'pending' : 'complete'/)
  })

  it('defaults to completed, so every other caller is unchanged', () => {
    expect(strip(EMAIL)).toMatch(/status\?: 'complete' \| 'pending'/)
  })
})

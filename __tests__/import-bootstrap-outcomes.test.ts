import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { runBootstrapStep } from '@/lib/league-import/ImportedLeagueCommitService'
import type { ImportWarningRecord } from '@/lib/league-import/types'

/**
 * Item 6, first half — an import stops reporting success over work that did not happen.
 *
 * 🛑 THE DEFECT. Every post-create bootstrap step was `try { } catch { console.warn }` and
 * nothing else. `bootstrapLeagueFromImport` writes every LeagueTeam and Roster row; when it
 * threw, the league row still existed, the commit route still answered 200 with
 * `{ leagueId, name, sport }`, and the screen still said "Imported". The user got an empty
 * league. The only trace was a server console line they cannot reach — the same shape as the
 * bulk-import failure this whole piece of work started from.
 *
 * Swallowing was the RIGHT call: failing a whole import because a playoff default could not
 * be written would throw away a league that is otherwise fine. What was wrong is that the
 * swallow was total.
 */

const REPO = process.cwd()
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
/* Comments here describe the very defect these tests forbid — assert on code, not prose. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('runBootstrapStep', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('records nothing when the step succeeds', async () => {
    const into: ImportWarningRecord[] = []
    await runBootstrapStep('X_FAILED', 'x failed', 'warn', into, async () => {})
    expect(into).toEqual([])
  })

  /* Non-fatal is the whole point: a failed step must not take the import down with it. */
  it('does not rethrow, so one failed step cannot fail the import', async () => {
    const into: ImportWarningRecord[] = []
    await expect(
      runBootstrapStep('X_FAILED', 'x failed', 'warn', into, async () => {
        throw new Error('boom')
      }),
    ).resolves.toBeUndefined()
    expect(into).toHaveLength(1)
  })

  it('carries the underlying reason, not just that something failed', async () => {
    const into: ImportWarningRecord[] = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runBootstrapStep('ROSTERS', 'Teams and rosters could not be written', 'error', into, async () => {
      throw new Error('connection reset by peer')
    })
    expect(into[0]).toMatchObject({ code: 'ROSTERS', severity: 'error' })
    expect(into[0]!.message).toContain('Teams and rosters could not be written')
    // Without the underlying detail a retry is a coin flip — the same argument as the
    // per-league import reasons.
    expect(into[0]!.message).toContain('connection reset by peer')
    expect(into[0]!.metadata).toMatchObject({ step: 'ROSTERS' })
  })

  /* An operator greps the console during an incident; returning a record is not a substitute. */
  it('still logs, so the console trail is not lost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runBootstrapStep('X', 'x', 'warn', [], async () => {
      throw new Error('nope')
    })
    expect(warn).toHaveBeenCalled()
  })

  it('handles a non-Error throw without losing the value', async () => {
    const into: ImportWarningRecord[] = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runBootstrapStep('X', 'x', 'warn', into, async () => {
      throw 'a bare string'
    })
    expect(into[0]!.message).toContain('a bare string')
  })
})

describe('the outcome actually reaches the user', () => {
  it('no post-create step is left as a bare console.warn swallow', () => {
    const svc = code('lib/league-import/ImportedLeagueCommitService.ts')
    /*
     * 🛑 THE REGRESSION GUARD. `catch { console.warn(...) }` with nothing else is exactly the
     * shape that made an empty league look like a successful import. The historical-backfill
     * and rank catches are outside the persist's step set and legitimately still log-only.
     */
    for (const step of [
      'bootstrapLeagueFromImport',
      'materializeRedraftSeasonForImportedLeague',
      'bootstrapLeagueDraftConfig',
      'persistTradedPicks',
    ]) {
      expect(svc).toContain(step)
    }
    expect(svc).toMatch(/runBootstrapStep\(/)
    // The roster step is an error, not a warning: a league with no rosters is not a partial
    // success, it is a league that cannot be used.
    expect(svc).toMatch(/'BOOTSTRAP_ROSTERS_FAILED'[\s\S]{0,200}?'error'/)
  })

  it('folds the outcomes into the ImportWarning rows that already persist', () => {
    const persistence = code('lib/league-import/importPersistenceService.ts')
    expect(persistence).toMatch(/\.\.\.persisted\.incompleteSteps/)
  })

  it('returns them on the commit response', () => {
    const route = code('app/api/leagues/import/commit/route.ts')
    expect(route).toMatch(/incompleteSteps: persisted\.incompleteSteps/)
  })

  /* A short-circuited replay ran nothing, so nothing can be incomplete. */
  it('reports no incomplete steps for an idempotent replay', () => {
    const persistence = code('lib/league-import/importPersistenceService.ts')
    expect(persistence).toMatch(/incompleteSteps: \[\]/)
  })
})

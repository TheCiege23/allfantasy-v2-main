/**
 * Giving ESPN player ids names.
 *
 * An ESPN league imported perfectly and named nobody: 252 draft facts, zero rows
 * with `provider = 'espn'` in the identity table, and a board of "(not yet
 * mapped)". The import path could not fix it — `mRoster` returned bare ids, so the
 * roster directory was `Player <id>` placeholders with nothing to harvest.
 *
 * ESPN's core athlete list needs no credential and its ids ARE the fantasy ids,
 * checked against that board before any of this was written:
 * 4430737 -> Kyren Williams, 2577417 -> Dak Prescott, 12483 -> Matthew Stafford.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  espnDefenseIdentity,
  isRealEspnAthleteName,
  parseEspnAthletePage,
} from '@/lib/espn/espnAthleteFetch'

const CRON = readFileSync(
  resolve(process.cwd(), 'app/api/cron/import-players/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n')

/* ESPN's own ids, as returned by the endpoint. */
const TEAMS: Record<number, string> = { 12: 'KC', 26: 'SEA', 6: 'DAL' }

describe('⚠ most of ESPN’s athlete list is not people', () => {
  it('rejects the play-outcome pseudo-athletes', () => {
    /*
     * ` [Downed]`, ` [Touchback]`, ` [35]` — a large share of the 20,277 rows and
     * clustered at the start, so a first-page eyeball finds nothing else. They
     * arrive with a leading space and a bracketed body.
     */
    expect(isRealEspnAthleteName(' [Downed]')).toBe(false)
    expect(isRealEspnAthleteName(' [35]')).toBe(false)
    expect(isRealEspnAthleteName('[Touchback]')).toBe(false)
    expect(isRealEspnAthleteName('')).toBe(false)
    expect(isRealEspnAthleteName('   ')).toBe(false)
    expect(isRealEspnAthleteName(null)).toBe(false)
  })

  it('keeps real players, including ones ESPN marks inactive', () => {
    // Filtering on `active` would drop retired players a past draft still names.
    expect(isRealEspnAthleteName('Dak Prescott')).toBe(true)
    expect(isRealEspnAthleteName('Ka’imi Fairbairn')).toBe(true)
  })

  it('drops junk while parsing a page, keeping the rest', () => {
    const page = parseEspnAthletePage({
      count: 4,
      pageIndex: 1,
      pageCount: 2,
      items: [
        { id: '4246281', displayName: ' [Downed]' },
        { id: '2577417', displayName: 'Dak Prescott' },
        { id: '', displayName: 'No Id Here' },
        { id: '12483', fullName: 'Matthew Stafford' },
      ],
    })
    expect(page.items).toEqual([
      { id: '2577417', displayName: 'Dak Prescott' },
      { id: '12483', displayName: 'Matthew Stafford' },
    ])
    expect(page.pageCount).toBe(2)
  })

  it('survives a payload that is nothing like the contract', () => {
    expect(parseEspnAthletePage(null).items).toEqual([])
    expect(parseEspnAthletePage({ items: 'not an array' }).items).toEqual([])
    expect(parseEspnAthletePage({}).pageCount).toBe(1)
  })
})

describe('⚠ a team defence has a negative id and appears in no athlete list', () => {
  it('derives the defence from the id, rather than fetching it', () => {
    /*
     * `-16000 - proTeamId`. Without this the humans on a board all resolve while
     * -16012 stays blank for ever — visible on the real board that prompted this.
     */
    expect(espnDefenseIdentity('-16012', TEAMS)).toEqual({ id: '-16012', displayName: 'KC D/ST' })
    expect(espnDefenseIdentity('-16026', TEAMS)).toEqual({ id: '-16026', displayName: 'SEA D/ST' })
  })

  it('refuses anything that is not in the defence id range', () => {
    // A real athlete id must never be read as a defence.
    expect(espnDefenseIdentity('4430737', TEAMS)).toBeNull()
    expect(espnDefenseIdentity('-1', TEAMS)).toBeNull()
    expect(espnDefenseIdentity('-99999', TEAMS)).toBeNull()
    expect(espnDefenseIdentity('not-a-number', TEAMS)).toBeNull()
  })

  it('returns nothing rather than inventing a name for an unknown team', () => {
    expect(espnDefenseIdentity('-16099', TEAMS)).toBeNull()
  })
})

describe('⚠ it runs as a bounded phase, not as the job', () => {
  it('is budget-gated and deferrable like every other phase', () => {
    expect(CRON).toContain("deferredPhases.push('espnIdentities')")
    expect(CRON).toContain('isExhausted: () => budget.exhausted()')
  })

  it('cannot fail the import it rides on', () => {
    expect(CRON).toContain('espn identity ingest failed')
  })

  it('reports itself in the run summary', () => {
    // A phase whose result is not returned is a phase nobody can tell ran.
    expect(CRON).toContain('espnIdentities,')
  })
})

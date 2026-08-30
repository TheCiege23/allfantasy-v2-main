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
  parseEspnAthlete,
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

  it('drops a junk athlete document rather than storing it', () => {
    expect(parseEspnAthlete({ id: '4246281', displayName: ' [Downed]' }, '4246281')).toBeNull()
  })

  it('reads a real athlete, preferring displayName and falling back to fullName', () => {
    expect(parseEspnAthlete({ id: '2577417', displayName: 'Dak Prescott' }, '2577417')).toEqual({
      id: '2577417',
      displayName: 'Dak Prescott',
      position: null,
      team: null,
      dob: null,
    })
    expect(parseEspnAthlete({ id: '12483', fullName: 'Matthew Stafford' }, '12483')).toEqual({
      id: '12483',
      displayName: 'Matthew Stafford',
      position: null,
      team: null,
      dob: null,
    })
  })

  it('falls back to the id we asked for when the response omits one', () => {
    // The row is keyed on the id we hold, so a response without one is still usable.
    expect(parseEspnAthlete({ displayName: 'Puka Nacua' }, '4426515')).toEqual({
      id: '4426515',
      displayName: 'Puka Nacua',
      position: null,
      team: null,
      dob: null,
    })
  })

  it('keeps the position, team and birthday that make a name an identity', () => {
    /*
     * These were always in the document and the parser used to drop them, which is
     * the single reason ESPN ids could never be linked to a canonical player.
     */
    expect(
      parseEspnAthlete(
        {
          id: '2577417',
          displayName: 'Dak Prescott',
          position: { abbreviation: 'QB' },
          team: { abbreviation: 'DAL' },
          dateOfBirth: '1993-07-29T07:00Z',
        },
        '2577417',
      ),
    ).toEqual({
      id: '2577417',
      displayName: 'Dak Prescott',
      position: 'QB',
      team: 'DAL',
      dob: '1993-07-29T07:00Z',
    })
  })

  it('reads the numeric league shapes through the same tables the importer uses', () => {
    /* ESPN is not consistent with itself: the athlete document carries an object,
       league payloads carry `defaultPositionId` / `proTeamId`. Both must resolve, and
       through one mapping — two copies is how they come to disagree. */
    const parsed = parseEspnAthlete(
      { id: '3139477', displayName: 'Patrick Mahomes', defaultPositionId: 1, proTeamId: 12 },
      '3139477',
    )
    expect(parsed?.position).toBe('QB')
    expect(parsed?.team).toBe('KC')
  })

  it('reports an unreadable shape as unknown rather than as an empty string', () => {
    /* The whole safety argument rests on this: an unexpected payload must yield NO
       evidence, so the matcher refuses. An empty string could compare equal. */
    const parsed = parseEspnAthlete(
      { id: '1', displayName: 'Someone', position: {}, team: {}, dateOfBirth: '' },
      '1',
    )
    expect(parsed?.position).toBeNull()
    expect(parsed?.team).toBeNull()
    expect(parsed?.dob).toBeNull()
  })

  it('survives a payload that is nothing like the contract', () => {
    expect(parseEspnAthlete(null, '1')).toBeNull()
    expect(parseEspnAthlete('a string', '1')).toBeNull()
    expect(parseEspnAthlete({}, '1')).toBeNull()
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

describe('⚠ the list endpoint lies about pagination', () => {
  const ADAPTER = readFileSync(
    resolve(process.cwd(), 'lib/espn/espnAthleteFetch.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const INGEST = readFileSync(
    resolve(process.cwd(), 'lib/espn/ingestEspnAthleteIdentities.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('records the measurement, because the metadata invites the mistake', () => {
    /*
     * It reports count:20277 and pageCount:21, then serves the SAME first rows for
     * every page, ignores offset, and caps limit at 1000. A first version walked 21
     * "pages", fetched page one 21 times, and wrote 994 rows while reporting 20,874
     * seen. Anyone reading only the response would rebuild exactly that.
     */
    expect(ADAPTER).toContain('WHY PER ID, AND NOT THE LIST')
    expect(ADAPTER).toContain('pageCount')
    expect(ADAPTER).toContain('limit=25000 -> 1000 ids')
  })

  it('resolves one athlete at a time, not a page', () => {
    expect(ADAPTER).toContain('export async function fetchEspnAthleteById')
    expect(ADAPTER).not.toContain('fetchEspnAthletePage')
  })

  it('drives from the ids we hold rather than the provider catalogue', () => {
    // 252 ids across every imported ESPN league, against a catalogue of 20,277.
    expect(INGEST).toContain('from dw_draft_facts d')
    expect(INGEST).toContain("lower(l.platform) = 'espn'")
    expect(INGEST).toContain('ASKS ABOUT OUR IDS, NOT ESPN')
  })

  it('reads rosters as well as drafts, because a waiver add was never drafted', () => {
    /*
     * A draft-shaped query can never reach a player who was added off waivers.
     * Measured after the draft-only pass: 253 distinct ESPN roster ids, 7 still
     * unknown — exactly that class.
     */
    expect(INGEST).toContain(`jsonb_array_elements_text(r."playerData"->'players')`)
    expect(INGEST).toContain('BOTH SURFACES, BECAUSE A DRAFT IS NOT A ROSTER')
    expect(INGEST).toContain('union')
  })

  it('guards the JSON shape rather than trusting the column', () => {
    // A roster whose playerData is not an array would abort the whole query.
    expect(INGEST).toContain(`jsonb_typeof(r."playerData"->'players') = 'array'`)
  })

  it('excludes negative ids from the fetch, since no fetch can answer them', () => {
    // Defences are derived; asking ESPN for -16012 would only waste a request.
    expect(INGEST).toContain(`where pid !~ '^-'`)
  })

  it('treats a 404 as a fact about that id, not a failed run', () => {
    expect(ADAPTER).toContain('if (response.status === 404) return null')
  })
})

/*
 * 🛑 THE LINKER SPENT EVERY RUN ON THE SAME 400 UNLINKABLE ROWS.
 *
 * Only a SUCCESSFUL link clears `playerId`, so a refused row never leaves the
 * pending set. With `take: 400` and no ordering, Postgres returned the same
 * physical head every tick, and that head is retired players this module
 * already documents as correctly unmatchable.
 *
 * Measured by running the real cron against production 2026-08-29:
 * considered 400, attempted 353, linked 0 — with 826 rows behind it, where the
 * players on live ESPN rosters actually are, never once examined. Across the
 * whole pending set the same matcher links 222.
 */
describe('⚠ the pending set has no head to get stuck on', () => {
  const LINK = readFileSync(
    resolve(process.cwd(), 'lib/espn/linkEspnIdentities.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('records the measurement, because the cap looks harmless', () => {
    expect(LINK).toContain('THAT WAS THIS FUNCTION&apos;S CLAIM AND IT WAS FALSE'.replace('&apos;', "'"))
    expect(LINK).toContain('considered 400   attempted 353   linked 0')
  })

  it('defaults to covering the whole pending set, not a ration of it', () => {
    /* 1,226 rows pending on production; anything in the hundreds re-creates the
       head. `isExhausted` is what bounds the tick. */
    const m = LINK.match(/options\?\.maxRows \?\? (\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(2000)
  })

  it('keeps the runway check as the real bound', () => {
    expect(LINK).toContain('isExhausted')
  })
})

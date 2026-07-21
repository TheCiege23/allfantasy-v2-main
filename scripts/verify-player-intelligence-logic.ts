/**
 * Standalone assertions for the pure logic in playerIntelligenceService.
 * vitest cannot spawn a worker on this box, so this runs under tsx directly.
 */
import {
  dedupeBySleeperId,
  splitRosterAndInjuryStatus,
} from '../lib/players/playerIntelligenceService'
import {
  assessFreshness,
  getMetricAvailability,
  isMetricRenderable,
  getUnavailableMetrics,
} from '../lib/players/player-data-availability'

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`)
  }
}

const row = (over: Partial<any>) => ({
  id: 'r1', sport: 'NFL', name: 'Test Player', position: 'RB', team: null,
  number: null, age: null, height: null, weight: null, college: null,
  imageUrl: null, sleeperId: '123', status: null, source: 'sleeper',
  fetchedAt: new Date('2026-06-01'), ...over,
})

console.log('\n── dedupeBySleeperId ──')
{
  const rows = [
    row({ id: 'a', sleeperId: '4034', team: null, imageUrl: null }),
    row({ id: 'b', sleeperId: '4034', team: 'SF', imageUrl: 'x.png' }),
    row({ id: 'c', sleeperId: '9999', team: 'KC' }),
  ]
  const out = dedupeBySleeperId(rows as any)
  check('collapses per-source duplicates', out.length === 2, out.length)
  check('prefers the row with team + headshot', out.find(r => r.sleeperId === '4034')?.id === 'b')
}
{
  // Real production shape: 15,043 NFL rows carry 11,960 distinct sleeperIds.
  const rows = [
    row({ id: 'a', sleeperId: '1027', team: null, fetchedAt: new Date('2026-06-23') }),
    row({ id: 'b', sleeperId: '1027', team: null, fetchedAt: new Date('2026-01-01') }),
  ]
  const out = dedupeBySleeperId(rows as any)
  check('ties break toward the more recent row', out[0].id === 'a', out[0].id)
}
{
  const rows = [row({ id: 'x', sleeperId: null }), row({ id: 'y', sleeperId: null })]
  const out = dedupeBySleeperId(rows as any)
  check('null sleeperIds are NOT collapsed together', out.length === 2, out.length)
}
{
  const older = row({ id: 'old', sleeperId: '7', team: 'BUF', fetchedAt: new Date('2020-01-01') })
  const newer = row({ id: 'new', sleeperId: '7', team: null, fetchedAt: new Date('2026-07-01') })
  const out = dedupeBySleeperId([newer, older] as any)
  check('completeness outranks recency (team beats newer-but-teamless)', out[0].id === 'old', out[0].id)
}

console.log('\n── dedupe: the real production Justin Jefferson rows ──')
{
  // Verbatim from production: six rows, five sources, TWO different people.
  const jefferson = [
    row({ id: '468d', source: 'backfill',         name: 'Justin Jefferson', position: 'WR',             team: 'MIN', sleeperId: null,    imageUrl: 'a.png' }),
    row({ id: '0370', source: 'rolling_insights', name: 'Justin Jefferson', position: 'WR',             team: 'MIN', sleeperId: null,    imageUrl: 'b.png' }),
    row({ id: '31de', source: 'sleeper',          name: 'Justin Jefferson', position: 'LB',             team: 'CLE', sleeperId: '13524', imageUrl: 'c.png' }),
    row({ id: 'c4db', source: 'sleeper',          name: 'Justin Jefferson', position: 'LB',             team: 'CLE', sleeperId: '13524', imageUrl: 'd.png' }),
    row({ id: '7402', source: 'sleeper',          name: 'Justin Jefferson', position: 'WR',             team: 'MIN', sleeperId: '6794',  imageUrl: 'e.png' }),
    row({ id: 'bfd9', source: 'thesportsdb',      name: 'Justin Jefferson', position: 'Wide Receiver',  team: 'MIN', sleeperId: '6794',  imageUrl: 'f.png' }),
  ]
  const out = dedupeBySleeperId(jefferson as any)
  check('six source rows collapse to exactly two people', out.length === 2, out.map(r => `${r.position}/${r.team}`))

  const wr = out.filter(r => normalizeTeamish(r.team) === 'MIN')
  const lb = out.filter(r => normalizeTeamish(r.team) === 'CLE')
  check('the MIN wide receiver appears exactly once', wr.length === 1, wr.length)
  check('the CLE linebacker appears exactly once', lb.length === 1, lb.length)
  check('two different people are NOT merged', wr.length === 1 && lb.length === 1)
  check('id-less rows adopted the WR sleeperId 6794', wr[0]?.sleeperId === '6794', wr[0]?.sleeperId)
  check('long-form "Wide Receiver" collapsed into the WR bucket',
    !out.some(r => r.position === 'Wide Receiver'), out.map(r => r.position))
}
{
  // Two distinct unteamed players must NOT fuse — merging real people is worse
  // than showing a duplicate, so the fallback key requires a team.
  const rows = [
    row({ id: 'p1', name: 'John Smith', position: 'WR', team: null, sleeperId: null }),
    row({ id: 'p2', name: 'John Smith', position: 'WR', team: null, sleeperId: null }),
  ]
  check('unteamed same-name rows stay distinct', dedupeBySleeperId(rows as any).length === 2)
}

function normalizeTeamish(t: string | null) { return (t ?? '').toUpperCase() }

console.log('\n── splitRosterAndInjuryStatus (mixed column) ──')
{
  // ~10,930 NFL players carry status "Active"; treating that as an injury status
  // is the documented failure this function exists to prevent.
  const a = splitRosterAndInjuryStatus('Active')
  check('"Active" is a roster status, not an injury', a.injuryStatus === null && a.rosterStatus === 'Active', a)

  const q = splitRosterAndInjuryStatus('Questionable')
  check('"Questionable" is an injury designation', q.injuryStatus === 'Questionable' && q.rosterStatus === null, q)

  const ir = splitRosterAndInjuryStatus('Injured Reserve')
  check('"Injured Reserve" is an injury designation', ir.injuryStatus === 'Injured Reserve', ir)

  const fa = splitRosterAndInjuryStatus('Free Agent')
  check('"Free Agent" is a roster status', fa.rosterStatus === 'Free Agent' && fa.injuryStatus === null, fa)

  const empty = splitRosterAndInjuryStatus(null)
  check('null status yields both null', empty.rosterStatus === null && empty.injuryStatus === null)

  const cased = splitRosterAndInjuryStatus('  active  ')
  check('roster match is case/whitespace tolerant', cased.rosterStatus === 'active', cased)
}

console.log('\n── availability registry ──')
{
  check('NFL weekly projection has NO source', getMetricAvailability('NFL', 'weeklyProjection').state === 'no-source')
  check('NFL market value IS available', getMetricAvailability('NFL', 'marketValue').state === 'available')
  check('NFL ownership % has NO source', getMetricAvailability('NFL', 'ownershipPercent').state === 'no-source')
  check('NBA headshots have NO source', getMetricAvailability('NBA', 'headshot').state === 'no-source')
  check('NBA market value is unsupported-for-sport', getMetricAvailability('NBA', 'marketValue').state === 'unsupported-for-sport')
  check('SOCCER headshots are partial', getMetricAvailability('SOCCER', 'headshot').state === 'partial')
  check('WNBA (zero rows) is not supported', getMetricAvailability('WNBA', 'identity').state === 'no-source')
  check('partial counts as renderable', isMetricRenderable('NFL', 'seasonStats'))
  check('no-source is NOT renderable', !isMetricRenderable('NFL', 'weeklyProjection'))
  const unavailableNba = getUnavailableMetrics('NBA')
  check('NBA hides market columns wholesale', unavailableNba.includes('marketValue') && unavailableNba.includes('positionRank'))
  check('every unavailable metric carries a reason',
    (['NFL','NBA','SOCCER'] as const).every(s =>
      getUnavailableMetrics(s).every(m => Boolean(getMetricAvailability(s, m).reason))))
}

console.log('\n── freshness (production is materially stale) ──')
{
  const now = Date.parse('2026-07-19T00:00:00Z')
  // Verified production values: newest NFL fetchedAt 2026-06-23, others 2026-05-01.
  const nfl = assessFreshness(new Date('2026-06-23'), now)
  check('26-day-old NFL data is STALE, not "up to date"', nfl.level === 'stale', nfl)
  check('stale detail names the age', nfl.detail.includes('26 day'), nfl.detail)

  const others = assessFreshness(new Date('2026-05-01'), now)
  check('79-day-old data is stale', others.level === 'stale', others.level)

  check('2h old is fresh', assessFreshness(new Date(now - 2 * 3600_000), now).level === 'fresh')
  check('1 day old is aging', assessFreshness(new Date(now - 26 * 3600_000), now).level === 'aging')
  check('null timestamp is unknown, not fresh', assessFreshness(null, now).level === 'unknown')
  check('future timestamp does not read as fresh', assessFreshness(new Date(now + 9e8), now).level === 'unknown')
}

console.log(`\n${failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} ASSERTION(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)

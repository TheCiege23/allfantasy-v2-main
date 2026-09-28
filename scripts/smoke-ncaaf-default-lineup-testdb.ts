/**
 * NCAAF default lineups are legal, on the known test database.
 *
 * Creates native NCAAF leagues (redraft, dynasty, keeper, best ball) through the canonical path and
 * the post-create roster engine, then fills every starter slot the league STORED with a player whose
 * position exists in the NCAAF pool (QB, RB, WR, TE, K — there is no college team defense) and runs
 * the real lineup validator over it.
 *
 * Before 2026-09-28 a new NCAAF redraft league stored a required DEF starter. Nothing can fill it, and
 * `validateRedraftLineup` reports an unfilled starter slot as an error (`missing_starter_slot`, a 422
 * from the lineup route) — so no NCAAF redraft lineup could ever be saved. The control re-adds DEF:1
 * to the stored settings and must be refused.
 *
 * Never accepts a production host. Every row it creates is removed.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { resolveRedraftRosterConfig } from '../lib/redraft/rosterConfigResolver'
import { validateRedraftLineup, type RedraftLineupPlayer } from '../lib/redraft/lineupValidation'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

/** A pool position that can fill each starter slot. DEF/DST has none: no college team defense exists. */
const FILL: Record<string, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'RB', FLX: 'RB', SUPERFLEX: 'QB', SF: 'QB', K: 'K' }

function lineupFor(capacities: Map<string, number>): { players: RedraftLineupPlayer[]; unfillable: string[] } {
  const players: RedraftLineupPlayer[] = []
  const unfillable: string[] = []
  let n = 0
  for (const [slot, count] of capacities) {
    const position = FILL[slot.toUpperCase()]
    if (!position) { unfillable.push(slot); continue }
    for (let i = 0; i < count; i++) {
      n += 1
      players.push({ playerId: `p${n}`, playerName: `Player ${n}`, position, sport: 'NCAAF', slotType: slot })
    }
  }
  return { players, unfillable }
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'ncaafdef-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  try {
    users.push((await prisma.appUser.create({ data: { username: marker, email: `${marker}@example.invalid` } })).id)
    let controlSettings: Record<string, unknown> | null = null
    const mismatches: string[] = []

    for (const concept of ['redraft', 'dynasty', 'keeper', 'best_ball']) {
      const v = validateCreatePayload({ concept, sport: 'NCAAF', teamCount: 4, draftType: 'snake', scoringPreset: 'ncaaf_ppr', leagueName: `${marker}-${concept}`, timezone: 'America/Chicago', conceptSetup: {} })
      if (!v.ok) { report[concept] = { creationRefused: v.error }; continue }
      const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
      leagues.push(leagueId)
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, leagueType: true } })
      await createDefaultLeagueRosterConfig(leagueId, 'NCAAF', String(league.leagueType ?? concept))
      const settings = (await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })).settings as Record<string, unknown>

      const config = resolveRedraftRosterConfig('NCAAFB', settings)
      const { players, unfillable } = lineupFor(config.starterCapacities)
      const result = validateRedraftLineup({ sport: 'NCAAFB', week: 3, players, rosterConfig: config })
      const errors = result.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}:${i.slotType ?? ''}`)

      /*
       * The league must agree with itself. `roster.config` (written by the roster engine) is what the
       * lineup runs on; `starter_slots` / `bench_slots` (the concept contract) is what settings screens
       * show and what the draft's round count was computed from. Before 2026-09-28 the NCAAF keeper
       * league stored 2 WR + K + 8 bench in one and 3 WR + 10 bench (no K) in the other, and drafted
       * 16 rounds into 18 draftable spots.
       */
      const contract = resolveRedraftRosterConfig('NCAAFB', { starter_slots: settings.starter_slots })
      const draft = await prisma.draftSession.findFirst({ where: { leagueId }, select: { rounds: true } })
      const runtimeStarters = [...config.starterCapacities.values()].reduce((a, b) => a + b, 0)
      // A startup draft fills starters and bench; taxi is filled later (rookie drafts), not in it.
      const draftable = runtimeStarters + config.benchSlots
      const sameStarters = JSON.stringify([...config.starterCapacities].sort()) === JSON.stringify([...contract.starterCapacities].sort())
      const storedBench = Number(settings.bench_slots ?? NaN)
      report[concept] = {
        starters: Object.fromEntries(config.starterCapacities), unfillable, lineupOk: result.ok, errors,
        contractStarters: Object.fromEntries(contract.starterCapacities), sameStarters,
        bench: { runtime: config.benchSlots, stored: storedBench }, taxi: config.taxiSlots,
        draftRounds: draft?.rounds ?? null, draftableSpots: draftable,
      }
      check(unfillable.length === 0, `${concept.toUpperCase()}_HAS_UNFILLABLE_STARTER:${unfillable.join(',')}`)
      check(result.ok, `${concept.toUpperCase()}_DEFAULT_LINEUP_REFUSED:${errors.join(',')}`)
      if (concept === 'redraft') controlSettings = settings
      // Best ball's agreement is recorded, not enforced: its contract (bestBallDefaults) has no TE and no
      // superflex while its roster template has both, and which one is intended is an open question.
      if (concept === 'best_ball') { report.bestBallKnownGap = true; continue }
      mismatches.push(...[
        !sameStarters ? `${concept}:starters` : '',
        Number.isFinite(storedBench) && storedBench !== config.benchSlots ? `${concept}:bench` : '',
        draft?.rounds != null && draft.rounds !== draftable ? `${concept}:rounds(${draft.rounds} vs ${draftable})` : '',
      ].filter(Boolean))
    }
    check(controlSettings, 'REDRAFT_LEAGUE_NOT_CREATED')
    report.mismatches = mismatches
    check(mismatches.length === 0, 'LEAGUE_DISAGREES_WITH_ITSELF:' + mismatches.join(','))

    // Control: the pre-fix default — a required DEF starter — must still be refused by the validator.
    // Added to the RESOLVED config (what the validator reads), since that is the layer under test.
    const resolved = resolveRedraftRosterConfig('NCAAFB', controlSettings)
    const controlConfig = { ...resolved, starterCapacities: new Map([...resolved.starterCapacities, ['DEF', 1]]) }
    const { players: controlPlayers } = lineupFor(controlConfig.starterCapacities)
    const control = validateRedraftLineup({ sport: 'NCAAFB', week: 3, players: controlPlayers, rosterConfig: controlConfig })
    const controlErrors = control.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}:${i.slotType ?? ''}`)
    report.controlWithRequiredDef = { hasDefSlot: controlConfig.starterCapacities.has('DEF'), lineupOk: control.ok, errors: controlErrors }
    check(controlConfig.starterCapacities.has('DEF'), 'CONTROL_DID_NOT_ADD_DEF')
    check(!control.ok && controlErrors.some((e) => e.startsWith('missing_starter_slot:DEF')), 'CONTROL_NOT_REFUSED')
  } finally {
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(cleanup.leagues === 0 && cleanup.users === 0, 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('NCAAF default lineup smoke failed:', e.message); process.exitCode = 1 })

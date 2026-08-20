/**
 * E.1.5 — backfill SportsPlayer.imageUrl with real headshots from ClearSports + SportsDB.
 *
 * USAGE
 *   npm run backfill:player-headshots -- --league=<leagueId> --sport=NFL --limit=100
 *   npm run backfill:player-headshots -- --league=<leagueId> --sport=NFL --limit=100 --apply
 *   npm run backfill:player-headshots -- --league=<leagueId> --sport=NFL --apply --force
 *
 * Behavior:
 *   - Loads the resolved draft pool for the league.
 *   - For each player whose pool row lacks a real headshot, calls
 *     resolvePlayerHeadshot (ClearSports → SportsDB → SportsPlayer cache).
 *   - On --apply, upserts into SportsPlayer with sport+name as the natural key
 *     (since pool playerIds are synthetic name-keys today, externalId is the
 *     same synthetic key prefixed `name:`).
 *   - --force overwrites a non-null existing imageUrl.
 *   - Default mode is dry-run for the SportsPlayer upsert below.
 *
 * ⚠ --apply does NOT gate every write this script causes. `resolver.resolve()` runs before
 * the --apply check and performs its own `PlayerImage` write-through internally, so a
 * "dry run" still writes rows to `sports_core_player_images`. It also passes no `playerId`
 * — pool ids are synthetic name-keys (`name:<Name>:<Pos>:<Team>`), not `Player.id` — so the
 * resolver derives one, which is how this script contributed orphan image rows.
 * `writePrimaryPlayerImage` now refuses derived ids that match no `Player`, but the
 * dry-run-still-writes asymmetry is real: treat this script as a writer in every mode.
 */

/** server-only stub is loaded by scripts/_audit-preload.cjs (node --require). */

import { PrismaClient } from '@prisma/client'
import { getResolvedDraftPoolForLeague } from '../lib/draft-room/getResolvedDraftPoolForLeague'
import {
  createBatchPlayerHeadshotResolver,
  isValidHeadshotUrl,
  type ResolveHeadshotResult,
} from '../lib/player-assets/resolvePlayerHeadshot'

const prisma = new PrismaClient()

interface Args {
  leagueId: string
  sport: string
  limit: number
  apply: boolean
  force: boolean
  json: boolean
  /** E.1.6 — restrict to a comma-separated list of player names (e.g. punctuation outliers). */
  names: string[] | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    leagueId: '',
    sport: 'NFL',
    limit: 100,
    apply: false,
    force: false,
    json: false,
    names: null,
  }
  for (const raw of argv) {
    if (raw.startsWith('--league=')) out.leagueId = raw.slice('--league='.length)
    else if (raw.startsWith('--sport=')) out.sport = raw.slice('--sport='.length).toUpperCase() || 'NFL'
    else if (raw.startsWith('--limit=')) {
      const n = Number.parseInt(raw.slice('--limit='.length), 10)
      if (Number.isFinite(n) && n > 0) out.limit = Math.min(500, n)
    } else if (raw.startsWith('--names=')) {
      const list = raw
        .slice('--names='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      out.names = list.length ? list : null
    } else if (raw === '--apply') out.apply = true
    else if (raw === '--force') out.force = true
    else if (raw === '--json') out.json = true
  }
  return out
}

interface RowOutcome {
  name: string
  position: string
  team: string | null
  result: ResolveHeadshotResult
  poolHadValidUrl: boolean
  decision: 'skipped_already_valid' | 'updated' | 'no_match' | 'dry_run_would_update' | 'ambiguous'
}

interface BackfillResult {
  leagueId: string
  sport: string
  apply: boolean
  force: boolean
  checked: number
  poolEntriesWithValidUrl: number
  resolvedClearSports: number
  resolvedSportsDb: number
  resolvedApiSports: number
  resolvedSportsPlayerCache: number
  noMatch: number
  ambiguous: number
  providerErrors: number
  updated: number
  wouldUpdate: number
  sampleUpdated: RowOutcome[]
  sampleNoMatch: RowOutcome[]
  clearSportsCacheSize: number
  notes: string[]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.leagueId) {
    console.error('Missing --league=<leagueId>')
    process.exit(1)
  }

  const pool = await getResolvedDraftPoolForLeague(args.leagueId, { limit: args.limit })
  const sport = String(pool.sport || args.sport).toUpperCase()

  const resolver = await createBatchPlayerHeadshotResolver({ sport })

  const out: BackfillResult = {
    leagueId: args.leagueId,
    sport,
    apply: args.apply,
    force: args.force,
    checked: 0,
    poolEntriesWithValidUrl: 0,
    resolvedClearSports: 0,
    resolvedSportsDb: 0,
    resolvedApiSports: 0,
    resolvedSportsPlayerCache: 0,
    noMatch: 0,
    ambiguous: 0,
    providerErrors: 0,
    updated: 0,
    wouldUpdate: 0,
    sampleUpdated: [],
    sampleNoMatch: [],
    clearSportsCacheSize: resolver.stats().clearSportsCacheSize,
    notes: [],
  }

  if (out.clearSportsCacheSize === 0) {
    out.notes.push(
      `ClearSports returned 0 ${sport} players. Either CLEARSPORTS_API_KEY is missing or the provider has no data for this sport. SportsDB is the only working fallback.`,
    )
  }

  /** E.1.6 — restrict the pool to a specific name list when --names is passed.
   * Useful for targeted re-resolution of punctuation outliers (Ja'Marr Chase,
   * A.J. Brown, etc.). Match is case-insensitive on the resolved pool name. */
  let entries = pool.entries
  if (args.names && args.names.length) {
    const wanted = new Set(args.names.map((n) => n.trim().toLowerCase()))
    entries = entries.filter((e) => wanted.has((e.name ?? '').trim().toLowerCase()))
    out.notes.push(
      `--names filter: ${args.names.length} requested, ${entries.length} matched in pool`,
    )
  }
  entries = entries.slice(0, args.limit)
  for (const e of entries) {
    out.checked += 1
    const poolHadValidUrl = isValidHeadshotUrl(e.display?.assets?.headshotUrl ?? null)
    if (poolHadValidUrl) out.poolEntriesWithValidUrl += 1

    let result: ResolveHeadshotResult
    try {
      result = await resolver.resolve({
        name: e.name,
        sport,
        team: e.team,
        position: e.position,
      })
    } catch (err) {
      out.providerErrors += 1
      out.notes.push(`Provider error for ${e.name}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    if (result.source === 'clearsports') out.resolvedClearSports += 1
    else if (result.source === 'sportsdb') out.resolvedSportsDb += 1
    else if (result.source === 'apisports') out.resolvedApiSports += 1
    else if (result.source === 'sportsplayer') out.resolvedSportsPlayerCache += 1
    else out.noMatch += 1

    let decision: RowOutcome['decision']
    if (!result.imageUrl) {
      decision = 'no_match'
    } else if (poolHadValidUrl && !args.force) {
      decision = 'skipped_already_valid'
    } else if (args.apply) {
      decision = 'updated'
    } else {
      decision = 'dry_run_would_update'
    }

    if (decision === 'updated' && result.imageUrl) {
      // Upsert SportsPlayer with sport+(synthetic externalId)+source. The pool's playerId
      // for current NFL is `name:<Name>:<Pos>:<Team>`. We use that as the externalId so a
      // future resolver join (when it learns to look up by playerId) hits the same row.
      const externalId =
        e.playerId && String(e.playerId).trim().length > 0
          ? String(e.playerId)
          : `name:${e.name}:${e.position}:${e.team ?? ''}`
      const source = 'backfill'
      try {
        const existing = await prisma.sportsPlayer.findFirst({
          where: { sport, externalId, source },
          select: { id: true, imageUrl: true },
        })
        if (existing && isValidHeadshotUrl(existing.imageUrl) && !args.force) {
          decision = 'skipped_already_valid'
        } else {
          await prisma.sportsPlayer.upsert({
            where: {
              sport_externalId_source: { sport, externalId, source },
            },
            update: {
              imageUrl: result.imageUrl,
              name: e.name,
              position: e.position,
              team: e.team ?? null,
              fetchedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            create: {
              sport,
              externalId,
              source,
              name: e.name,
              position: e.position,
              team: e.team ?? null,
              imageUrl: result.imageUrl,
              fetchedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          })
          out.updated += 1
        }
      } catch (err) {
        out.providerErrors += 1
        out.notes.push(
          `DB upsert failed for ${e.name}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else if (decision === 'dry_run_would_update') {
      out.wouldUpdate += 1
    }

    const outcome: RowOutcome = {
      name: e.name,
      position: e.position,
      team: e.team,
      result,
      poolHadValidUrl,
      decision,
    }
    if ((decision === 'updated' || decision === 'dry_run_would_update') && out.sampleUpdated.length < 25) {
      out.sampleUpdated.push(outcome)
    }
    if (decision === 'no_match' && out.sampleNoMatch.length < 25) {
      out.sampleNoMatch.push(outcome)
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    printSummary(out)
    process.stdout.write('JSON_OUTPUT_BEGIN\n')
    process.stdout.write(JSON.stringify(out) + '\n')
    process.stdout.write('JSON_OUTPUT_END\n')
  }
}

function printSummary(r: BackfillResult): void {
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`E.1.5 — Backfill Player Headshots`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`League:          ${r.leagueId}`)
  console.log(`Sport:           ${r.sport}`)
  console.log(`Mode:            ${r.apply ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}${r.force ? ' --force' : ''}`)
  console.log(`ClearSports cache size: ${r.clearSportsCacheSize}`)
  console.log('')
  console.log(`Checked:                          ${r.checked}`)
  console.log(`  pool already had valid URL:     ${r.poolEntriesWithValidUrl}`)
  console.log(`  resolved via ClearSports:       ${r.resolvedClearSports}`)
  console.log(`  resolved via SportsDB:          ${r.resolvedSportsDb}`)
  console.log(`  resolved via TheSportsAPI:      ${r.resolvedApiSports}`)
  console.log(`  resolved via SportsPlayer cache:${r.resolvedSportsPlayerCache}`)
  console.log(`  no match:                       ${r.noMatch}`)
  console.log(`  ambiguous:                      ${r.ambiguous}`)
  console.log(`  provider errors:                ${r.providerErrors}`)
  console.log('')
  if (r.apply) {
    console.log(`Updated rows:    ${r.updated}`)
  } else {
    console.log(`Would update:    ${r.wouldUpdate}  (rerun with --apply to write)`)
  }
  console.log('')
  if (r.sampleUpdated.length > 0) {
    const heading = r.apply ? 'Sample updated:' : 'Sample matches that would update:'
    console.log(heading)
    for (const o of r.sampleUpdated) {
      const u = o.result.imageUrl ? (o.result.imageUrl.length > 90 ? o.result.imageUrl.slice(0, 87) + '...' : o.result.imageUrl) : '—'
      console.log(`  ${o.name.padEnd(28)} ${o.position.padEnd(4)} ${(o.team ?? '—').padEnd(4)} [${o.result.source.padEnd(13)}] ${u}`)
    }
    console.log('')
  }
  if (r.sampleNoMatch.length > 0) {
    console.log(`Sample no-match (no real headshot found):`)
    for (const o of r.sampleNoMatch) {
      console.log(`  ${o.name.padEnd(28)} ${o.position.padEnd(4)} ${(o.team ?? '—').padEnd(4)}`)
    }
    console.log('')
  }
  if (r.notes.length > 0) {
    console.log('Notes:')
    for (const n of r.notes) console.log(`  • ${n}`)
    console.log('')
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
}

main()
  .catch((err) => {
    console.error('[backfill-player-headshots] FAILED:', err)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })

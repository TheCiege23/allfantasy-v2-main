/**
 * Sync script: fetch Rolling Insights raw data for all 7 sports and write
 * normalized player valuations to SportsDataCache (DB-first).
 *
 * Usage:
 *   tsx scripts/sync-player-valuations.ts
 *   tsx scripts/sync-player-valuations.ts --sports=nfl,nba
 *   tsx scripts/sync-player-valuations.ts --ttlHours=12
 *
 * The writer itself lives in `lib/player-valuation-sync.ts` (moved there 2026-09-29) so that
 * `/api/cron/adp-refresh` can run it daily. This file is now only the CLI: env loading and
 * argument parsing. Behaviour is unchanged — same sports, same default 6h TTL, same per-sport
 * failure isolation.
 *
 * ⚠ It loads `.env.local` / `.env`, which point at PRODUCTION. Running it writes production rows.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_VALUATION_TTL_HOURS,
  PLAYER_VALUATION_SPORTS,
  syncPlayerValuations,
} from '@/lib/player-valuation-sync'
import type { ApiChainSport } from '@/lib/workers/api-config'

function loadDotenv(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName)
  if (!existsSync(filePath)) return

  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadDotenv('.env.local')
loadDotenv('.env')

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseSportsArg(): ApiChainSport[] {
  const arg = process.argv.find((v) => v.startsWith('--sports='))
  if (!arg) return PLAYER_VALUATION_SPORTS
  const requested = arg
    .split('=')[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as ApiChainSport[]
  const valid = requested.filter((s) => PLAYER_VALUATION_SPORTS.includes(s))
  return valid.length ? valid : PLAYER_VALUATION_SPORTS
}

function parseTtlArg(): number {
  const arg = process.argv.find((v) => v.startsWith('--ttlHours='))
  const hours = arg ? Number(arg.split('=')[1]) : DEFAULT_VALUATION_TTL_HOURS
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_VALUATION_TTL_HOURS
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sports = parseSportsArg()
  const ttlHours = parseTtlArg()
  const ttlMs = ttlHours * 60 * 60 * 1000

  console.log(
    `[player-valuations] starting sync (sports=${sports.join(',')}, ttl=${ttlHours}h)`
  )

  const summary = await syncPlayerValuations({ sports, ttlMs })

  console.log(`[player-valuations] sync complete — ${summary.total} total valuations written`)
}

main().catch((err) => {
  console.error('[player-valuations] fatal error:', err)
  process.exit(1)
})

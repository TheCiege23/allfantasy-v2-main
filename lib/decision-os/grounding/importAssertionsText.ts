import type { ImportAssertions } from '@/lib/decision-os/import/assertions'

/**
 * THE IMPORT SLICE, AS LINES CHIMMY CAN QUOTE (Import OS, 2026-11-20 re-score push).
 *
 * 🛑 THE GENERIC RENDERER CUT EXACTLY THE HALF THAT MATTERS. `serialize.ts`'s `renderObject` keeps the first 8
 * fields in key order — provider, external id, season, two timestamps, `staleMs`, `syncStatus` — and the loader
 * (`lib/decision-os/import/assertions.ts`) puts parity, coverage, player identity and the per-scope freshness
 * AFTER them. So Chimmy always knew when a league last synced and never whether the sync was complete, whether
 * it matched the host platform, or how many of the rostered players it could actually name. Those are the facts
 * that bound an answer ("I can only see 9 of 12 rosters"). This renders the typed assertions field by field.
 *
 * ⚠ NULL IS "UNKNOWN", NEVER ZERO — a coverage this loader could not measure (a native league has no external
 * ids) prints as not measured, the same null-vs-zero rule the loader itself draws.
 *
 * PURE: no IO, no clock (ages arrive as `staleMs`). Bounded: at most one line per scope, and scopes are capped.
 */

const MAX_SCOPES = 12

export function isImportAssertions(v: unknown): v is ImportAssertions {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.provider === 'string' && typeof o.externalLeagueId === 'string' && typeof o.parity === 'string' && Array.isArray(o.scopes)
}

function age(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'never'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const hrs = Math.round(min / 60)
  if (hrs < 48) return `${hrs} hr ago`
  return `${Math.round(hrs / 24)} days ago`
}

function share(part: number, whole: number | null | undefined, rate: number | null | undefined): string {
  if (rate == null || whole == null || !Number.isFinite(rate)) return 'not measured'
  return `${part} of ${whole} (${Math.round(rate * 100)}%)`
}

export function renderImportAssertions(a: ImportAssertions): string[] {
  const rows: string[] = []
  rows.push(`    platform: ${a.provider} league ${a.externalLeagueId}, season ${a.season}`)
  rows.push(
    `    last complete sync: ${a.lastSuccessfulSyncAt ? age(a.staleMs) : 'never'}` +
      ` · last attempt: ${a.lastAttemptedSyncAt ?? 'never'}` +
      ` · status: ${a.syncStatus ?? 'unknown'}` +
      (a.consecutiveFailures > 0 ? ` · ${a.consecutiveFailures} failed run(s) in a row` : ''),
  )
  if (a.activeLane) {
    rows.push(`    rosters/transactions lane: last complete ${a.activeLane.lastSuccessfulSyncAt ? age(a.activeLane.staleMs) : 'never'} (${a.activeLane.scopes.join(', ')})`)
  }

  const scopes = Array.isArray(a.scopes) ? a.scopes : []
  const incomplete = scopes.filter((s) => s.incomplete || !s.completedLastRun)
  if (scopes.length) {
    rows.push(
      incomplete.length === 0
        ? `    scopes: all ${scopes.length} completed on the last run`
        : `    scopes NOT complete on the last run: ${incomplete
            .slice(0, MAX_SCOPES)
            .map((s) => s.scope)
            .join(', ')}${incomplete.length > MAX_SCOPES ? ` (+${incomplete.length - MAX_SCOPES} more)` : ''}`,
    )
  }

  rows.push(`    matches the host platform: ${a.parity}${a.parityNote ? ` — ${a.parityNote}` : ''}`)
  rows.push(`    rosters held: ${share(a.rostersHeld, a.rostersExpected, a.rosterCoverage)}`)
  rows.push(`    managers linked to an account: ${share(a.managersMapped, a.managersTotal, a.managerIdentityCoverage)}`)
  rows.push(`    rostered players identified: ${share(a.playersResolved, a.playersTotal, a.playerIdentityCoverage)}`)
  rows.push(
    '    Use these limits when answering: say when the sync is stale or incomplete, or when rosters or players are missing, instead of answering as if the league were fully known.',
  )
  return rows
}

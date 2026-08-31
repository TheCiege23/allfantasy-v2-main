/**
 * Fantrax player ids → `PlayerIdentityMap.fantraxId`.
 *
 * 🛑 THIS IS THE BRIDGE A FANTRAX ROSTER HAS NEVER HAD. `PlayerIdentityMap` is
 * the registry `AFProjectionSnapshot.playerId` resolves to — verified 50/50 on a
 * sample of NFL projection ids, and the same holds for every sport — and it
 * carries one id per provider. It had none for Fantrax, so a Fantrax roster,
 * which stores nothing but Fantrax ids, met nothing: no headshot, no projection,
 * no valuation.
 *
 * ⚠ THE SLEEPER CROSSWALK CANNOT BE REUSED HERE, and that is structural rather
 * than a coverage gap. Measured on production 2026-08-31: 0 of 73,883 NCAAF
 * `SportsPlayer` rows carry a `sleeperId`, because those rows are
 * Rolling-Insights / TheSportsDB keyed. The path that serves Sleeper and ESPN
 * leagues is unavailable to a college league however good the matching gets.
 *
 * ⚠ INGESTION, NOT A REQUEST PATH. It calls a provider deliberately and writes
 * Postgres; request paths read what it wrote. Never call this from a route.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds, type FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { normalizePlayerName, normalizeSchool } from './ingestFantraxDevyAdp'

export type FantraxIdentityIngestResult = {
  /** Ids in Fantrax's CFB map. */
  provided: number
  linked: number
  /** No identity row at that name + school. */
  unmatched: number
  /** Name + school matched more than one identity row — never guessed. */
  ambiguous: number
  /** Already carried this exact id; no write needed. */
  unchanged: number
  skipped?: boolean
  reason?: string
  error?: string
}

/**
 * ⚠ A WEEK, NOT A DAY. A college player's Fantrax id does not change; only the
 * population does, as players enter and leave the map. The ADP feed moves on
 * news; this moves on roster churn, and re-walking 16,886 ids nightly to learn
 * nothing is the kind of cost that gets a job switched off rather than tuned.
 */
const CADENCE_MS = 7 * 24 * 60 * 60 * 1000
const MARKER_KEY = 'fantrax:player-identities:last-run'
const MARKER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Which identity row is this Fantrax player? Pure, so the rule is testable
 * without a database or a provider.
 *
 * ⚠ NAME AND SCHOOL, NEVER NAME ALONE. Two college players share a name far
 * more often than a name AND a school — a certainty across ~130 FBS programmes,
 * not a risk — and a wrong link here attaches another player's projection and
 * valuation to your roster spot. Ambiguity is reported, never resolved by
 * picking the first row.
 *
 * ⚠ SCHOOL IS COMPARED BY PREFIX, and that has a real limit worth stating.
 * Fantrax abbreviates by dropping letters from the MIDDLE — "TxSt" for Texas
 * State, "BGSU" for Bowling Green — which no prefix rule recovers. So when two
 * players share a name and their schools abbreviate past recognition, this
 * refuses and the pair goes uncounted rather than half-linked. That costs
 * coverage deliberately: a wrong link attaches another player's projection and
 * market price to a roster spot, where a refusal leaves a visible gap.
 *
 * Closing it properly needs a school alias table, not a cleverer comparison.
 * Note this only bites on DUPLICATE names — a name unique in the registry links
 * without consulting the school at all, which is the common case.
 */
export function chooseIdentityMatch(
  candidates: Array<{ id: string; canonicalName: string; currentTeam: string | null; fantraxId: string | null }>,
  want: { name: string; school: string },
): { kind: 'match'; id: string; alreadySet: boolean } | { kind: 'none' } | { kind: 'ambiguous' } {
  const wantName = normalizePlayerName(want.name)
  const wantSchool = normalizeSchool(want.school)
  if (!wantName) return { kind: 'none' }

  const byName = candidates.filter((c) => normalizePlayerName(c.canonicalName) === wantName)
  if (byName.length === 0) return { kind: 'none' }
  if (byName.length === 1) {
    return { kind: 'match', id: byName[0]!.id, alreadySet: byName[0]!.fantraxId === null ? false : true }
  }

  /* More than one player of this name — the school is what separates them. */
  if (!wantSchool) return { kind: 'ambiguous' }
  const bySchool = byName.filter((c) => {
    const have = normalizeSchool(c.currentTeam ?? '')
    if (!have) return false
    const shorter = Math.min(have.length, wantSchool.length)
    /* Four characters is enough to separate real schools and short enough to
       survive abbreviation; below that, refuse rather than coin-flip. */
    if (shorter < 4) return have === wantSchool
    return have.slice(0, shorter) === wantSchool.slice(0, shorter)
  })
  if (bySchool.length === 0) return { kind: 'none' }
  if (bySchool.length > 1) return { kind: 'ambiguous' }
  return { kind: 'match', id: bySchool[0]!.id, alreadySet: bySchool[0]!.fantraxId !== null }
}

export async function ingestFantraxPlayerIdentities(
  opts?: { force?: boolean },
): Promise<FantraxIdentityIngestResult> {
  const empty: FantraxIdentityIngestResult = {
    provided: 0,
    linked: 0,
    unmatched: 0,
    ambiguous: 0,
    unchanged: 0,
  }

  if (opts?.force !== true) {
    const marker = await prisma.sportsDataCache
      .findUnique({ where: { cacheKey: MARKER_KEY } })
      .catch(() => null)
    const at =
      marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data)
        ? (marker.data as Record<string, unknown>).at
        : null
    const lastMs = typeof at === 'string' ? new Date(at).getTime() : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
      const days = Math.round((Date.now() - lastMs) / 86_400_000)
      return { ...empty, skipped: true, reason: `ran ${days}d ago; cadence is 7d` }
    }
  }

  const mapRes = await getFantraxPlayerIds('CFB')
  if (!mapRes.ok) return { ...empty, error: mapRes.failure.message }

  const refs: FantraxPlayerRef[] = Object.values(mapRes.data)
  const result: FantraxIdentityIngestResult = { ...empty, provided: refs.length }

  for (const ref of refs) {
    const fantraxId = String(ref.fantraxId ?? '').trim()
    const name = String(ref.name ?? '').trim()
    if (!fantraxId || !name) {
      result.unmatched += 1
      continue
    }

    /*
     * Narrowed in SQL by surname, filtered on the normalized name and school in
     * JS — the two sources punctuate and abbreviate differently, so an equality
     * filter in SQL would miss the rows we most want.
     */
    const normalized = normalizePlayerName(name)
    const surname = normalized.split(' ').pop() ?? ''
    if (!surname) {
      result.unmatched += 1
      continue
    }

    const candidates = await prisma.playerIdentityMap
      .findMany({
        where: { sport: 'NCAAF', canonicalName: { contains: surname, mode: 'insensitive' } },
        select: { id: true, canonicalName: true, currentTeam: true, fantraxId: true },
        take: 60,
      })
      .catch(() => [])

    const decision = chooseIdentityMatch(candidates, { name, school: String(ref.team ?? '') })
    if (decision.kind === 'none') {
      result.unmatched += 1
      continue
    }
    if (decision.kind === 'ambiguous') {
      result.ambiguous += 1
      continue
    }

    const existing = candidates.find((c) => c.id === decision.id)
    if (existing?.fantraxId === fantraxId) {
      result.unchanged += 1
      continue
    }

    await prisma.playerIdentityMap
      .update({ where: { id: decision.id }, data: { fantraxId } })
      .then(() => {
        result.linked += 1
      })
      .catch(() => {
        result.unmatched += 1
      })
  }

  /* Marker written even on a run that linked nothing — the cost is the fetch and
     the walk, and repeating them tomorrow because coverage is poor is how a job
     burns quota learning the same answer. */
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: MARKER_KEY },
      update: {
        data: { at: new Date().toISOString(), ...result },
        expiresAt: new Date(Date.now() + MARKER_TTL_MS),
      },
      create: {
        cacheKey: MARKER_KEY,
        data: { at: new Date().toISOString(), ...result },
        expiresAt: new Date(Date.now() + MARKER_TTL_MS),
      },
    })
    .catch(() => {})

  return result
}

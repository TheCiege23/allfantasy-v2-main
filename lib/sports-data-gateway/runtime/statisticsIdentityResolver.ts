import 'server-only'
/**
 * Fantasy OS Phase 5F-b — deterministic ESPN athlete id → canonical player identity resolver for certified stats.
 *
 * COMPOSES the existing canonical identity resolver (lib/shared-services/player-identity, Phase 14) — it does NOT
 * duplicate resolver logic and NEVER touches a provider API (the resolver reads existing identity tables only).
 * STRICTLY DETERMINISTIC: only a `direct` provider-id match (PlayerIdentityMap.espnId) is classified `resolved`
 * and given a canonical id. Any name-based match is classified `ambiguous` with NO canonical id assigned — never
 * name-guessed into `resolved`. No fuzzy matching, no AI matching. Absent = unresolved.
 */
import { resolvePlayers } from '@/lib/shared-services/player-identity'
import type { StatIdentityResolution } from './statisticsRuntime'

/** Batch-resolve unique ESPN athlete ids into deterministic identity outcomes. Unresolved ids are simply absent. */
export async function resolveEspnAthleteIdentities(athleteIds: string[]): Promise<Map<string, StatIdentityResolution>> {
  const unique = [...new Set(athleteIds.filter((id) => id && id.trim()))]
  const out = new Map<string, StatIdentityResolution>()
  if (unique.length === 0) return out

  const results = await resolvePlayers(unique.map((id) => ({ provider: 'espn' as const, sourceId: id })))
  for (const r of results) {
    const id = String(r.input.sourceId ?? '')
    if (!id) continue
    if (r.confidence === 'direct' && r.player?.canonicalPlayerId) {
      // Deterministic direct-id match — the only outcome eligible to be `resolved` / future scoring.
      out.set(id, { canonicalPlayerId: r.player.canonicalPlayerId, state: 'resolved' })
    } else if (r.confidence === 'name_match_confident' || r.confidence === 'name_match_ambiguous') {
      // A non-deterministic (name) match exists — flag as ambiguous but assign NO canonical id.
      out.set(id, { state: 'ambiguous' })
    }
    // else 'unresolved' → leave absent (the sync lookup returns null → unresolved).
  }
  return out
}

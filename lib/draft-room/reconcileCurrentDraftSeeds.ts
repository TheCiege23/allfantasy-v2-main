import { strictIdentityKey, canonicalTeam } from './player-canonical-identity'
export type CurrentDraftSeed = { name: string; position: string; team: string | null; playerId: string; imageUrl?: string | null; age?: number | null; injuryStatus?: string | null; status?: string | null }
type Seed = { name?: string; playerName?: string; full_name?: string; position?: string; pos?: string; team?: string | null; teamAbbr?: string | null; playerId?: string | null }
/** Market seeds contribute rank only; verified current rows supply identity and roster fields. */
export function reconcileCurrentDraftSeeds<T extends Seed>(seeds: readonly T[], players: readonly CurrentDraftSeed[]): Array<T & CurrentDraftSeed> {
  const byKey = new Map<string, CurrentDraftSeed[]>()
  for (const player of players) {
    const key = strictIdentityKey(player.name, player.position)
    const bucket = byKey.get(key) ?? []
    bucket.push(player); byKey.set(key, bucket)
  }
  const seen = new Set<string>()
  const out: Array<T & CurrentDraftSeed> = []
  for (const seed of seeds) {
    const matches = byKey.get(strictIdentityKey(seed.name ?? seed.playerName ?? seed.full_name ?? '', seed.position ?? seed.pos ?? '')) ?? []
    const strict = matches.filter(p => canonicalTeam(p.team) === canonicalTeam(seed.team ?? seed.teamAbbr ?? null))
    const player = matches.length === 1 ? matches[0] : strict.length === 1 ? strict[0] : undefined
    if (!player || seen.has(player.playerId)) continue
    seen.add(player.playerId); out.push({ ...seed, ...player } as T & CurrentDraftSeed)
  }
  for (const player of players) {
    if (seen.has(player.playerId)) continue
    seen.add(player.playerId); out.push({ ...player } as T & CurrentDraftSeed)
  }
  return out
}

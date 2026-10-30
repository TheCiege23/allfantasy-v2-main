/**
 * Give board picks saved without a photo the face the player pool already has for them.
 *
 * Picks made before `resolveStoredPickHeadshot` ran at submit (every auto / AI pick outside the
 * NFL) were saved with a null `playerImageUrl`, so those boards showed initials even though the
 * pool entry for the same player carries a real headshot. Matching mirrors
 * `resolvePickAnnouncementAssets`: the pick's id first, then exact name + position + team.
 * Only a real photo URL is used - the pool's data: placeholder is not one.
 */

import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'

type PoolPlayerLike = {
  id?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
  display?: { playerId?: string | null; assets?: { headshotUrl?: string | null } | null } | null
}

type PickLike = {
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  playerImageUrl?: string | null
}

function trimmed(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t || null
}

function nameKey(name: string | null | undefined, position: string | null | undefined, team: string | null | undefined): string {
  return `${trimmed(name) ?? ''}|${trimmed(position) ?? ''}|${trimmed(team) ?? ''}`
}

export function fillPickHeadshotsFromPool<P extends PickLike>(picks: P[], players: PoolPlayerLike[]): P[] {
  if (picks.length === 0 || players.length === 0) return picks
  if (!picks.some((p) => !trimmed(p.playerImageUrl) && trimmed(p.playerName))) return picks

  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const pl of players) {
    const url = trimmed(pl.display?.assets?.headshotUrl)
    if (!url || classifyAvatarSource(url) !== 'headshot') continue
    for (const id of [trimmed(pl.display?.playerId), trimmed(pl.id)]) {
      if (id && !byId.has(id)) byId.set(id, url)
    }
    const nk = nameKey(pl.name, pl.position, pl.team)
    if (!byName.has(nk)) byName.set(nk, url)
  }

  return picks.map((p) => {
    if (trimmed(p.playerImageUrl) || !trimmed(p.playerName)) return p
    const pid = trimmed(p.playerId)
    const url = (pid ? byId.get(pid) : undefined) ?? byName.get(nameKey(p.playerName, p.position, p.team))
    return url ? { ...p, playerImageUrl: url } : p
  })
}

import type { ClipPlayer, MatchedXClip, XPost } from './x-types'

// Reviewed public handle. Never infer handles from names or fuzzy surname matches.
const HANDLES: Record<string, string[]> = { 'brock purdy': ['brockpurdy13'] }
function words(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
export function mentionsPlayer(post: XPost, player: ClipPlayer): boolean {
  const name = words(player.name).replace(/ (jr|sr|ii|iii|iv)$/, '')
  if (name.split(' ').length < 2) return false
  // Do not match the caption of an unrelated quoted URL.
  const text = post.text.replace(/https?:\/\/\S+/g, '')
  const caption = ' ' + words(text) + ' '
  return caption.includes(' ' + name + ' ') || (HANDLES[name] ?? []).some(handle =>
    new RegExp('(^|[^a-zA-Z0-9_])@' + handle + '(?![a-zA-Z0-9_])', 'i').test(text))
}
export function matchXClips(
  posts: XPost[],
  groups: Array<{ players: ClipPlayer[]; league?: { id: string; name: string } }>,
  now = Date.now(),
  spotlight = false,
): MatchedXClip[] {
  const out = new Map<string, MatchedXClip>()
  const recent = posts.filter(p => {
    const time = Date.parse(p.publishedAt)
    return time <= now && time > now - 24 * 60 * 60_000
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  for (const group of groups) {
    for (const post of recent) {
      const players = group.players.filter(player => mentionsPlayer(post, player))
      if (!players.length) continue
      const existing = out.get(post.id) ?? { ...post, players: [], leagues: [] }
      for (const player of players) if (!existing.players.some(p => p.id === player.id)) existing.players.push(player)
      if (group.league && !existing.leagues.some(l => l.id === group.league!.id)) existing.leagues.push(group.league)
      out.set(post.id, existing)
      if (spotlight) break // At most one recent clip per league; shared posts merge their badges.
    }
  }
  return [...out.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, spotlight ? 5 : 12)
}


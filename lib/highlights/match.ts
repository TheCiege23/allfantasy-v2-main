import { getTeamInfo } from '@/lib/team-abbrev'
import type { PlayerHighlight } from './types'

function words(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['’]s\b/g, '').replace(/['’‘.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Full-name title matches only; descriptions often list every player on a team. */
export function selectPlayerHighlights(
  videos: Omit<PlayerHighlight, 'kind'>[], name: string, team: string | null,
): PlayerHighlight[] {
  const fullName = words(name).replace(/\s+(jr|sr|ii|iii|iv)$/, '')
  if (fullName.split(' ').length < 2) return []
  const mascot = getTeamInfo(team)?.mascot
  const player: PlayerHighlight[] = []
  const games: PlayerHighlight[] = []
  for (const video of videos) {
    const title = ` ${words(video.title)} `
    if (!/\b(highlights?|touchdowns?|td|catch|catches|runs?|yards?|sacks?|interceptions?|best plays|top plays)\b/.test(title)) continue
    if (title.includes(` ${fullName} `)) {
      player.push({ ...video, kind: 'player' })
    } else if (mascot && title.includes(` ${words(mascot)} `)
      && /\bvs\b/.test(title) && /\bhighlights\b/.test(title)) {
      games.push({ ...video, kind: 'game' })
    }
  }
  // A recap is explicitly labeled as team context, never as proof this player appears.
  return [...player.slice(0, 3), ...games.slice(0, 2)].slice(0, 4)
}

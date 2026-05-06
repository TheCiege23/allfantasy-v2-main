/**
 * Defensive extraction for common TheSportsDB player/team JSON shapes.
 * Does not infer experience from dateBorn, college, or former teams.
 */

import { extractTheSportsDbExperienceSignals as scanTheSportsDbExperienceSignals } from '@/lib/player-data/providerExperienceFields'

export { extractTheSportsDbExperienceSignals } from '@/lib/player-data/providerExperienceFields'

function flattenPlayerish(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const root = input as Record<string, unknown>
  Object.assign(out, root)
  for (const nest of ['players', 'player', 'Player']) {
    const v = root[nest]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, v as Record<string, unknown>)
    }
  }
  const arr = root.players
  if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object' && !Array.isArray(arr[0])) {
    Object.assign(out, arr[0] as Record<string, unknown>)
  }
  return out
}

export function extractTheSportsDbPlayerIdentity(payload: unknown): {
  idPlayer: string | null
  strPlayer: string | null
  strTeam: string | null
  strLeague: string | null
  strSport: string | null
  strPosition: string | null
  strNumber: string | null
  strNationality: string | null
  dateBorn: string | null
  strBirthLocation: string | null
  strHeight: string | null
  strWeight: string | null
  strCollege: string | null
  strDescriptionEN: string | null
} {
  const o = flattenPlayerish(payload)
  const pick = (k: string) => (typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]) : null)
  return {
    idPlayer: pick('idPlayer') ?? pick('idAPIfootball') ?? null,
    strPlayer: pick('strPlayer'),
    strTeam: pick('strTeam'),
    strLeague: pick('strLeague'),
    strSport: pick('strSport'),
    strPosition: pick('strPosition'),
    strNumber: pick('strNumber'),
    strNationality: pick('strNationality'),
    dateBorn: pick('dateBorn'),
    strBirthLocation: pick('strBirthLocation'),
    strHeight: pick('strHeight'),
    strWeight: pick('strWeight'),
    strCollege: pick('strCollege'),
    strDescriptionEN: pick('strDescriptionEN'),
  }
}

/** Image preference aligned with `lib/workers/providers/thesportsdb.ts`. */
export function extractTheSportsDbPlayerImages(payload: unknown): {
  cutout: string | null
  render: string | null
  thumb: string | null
  fanart: string | null
  primary: string | null
} {
  const o = flattenPlayerish(payload)
  const s = (k: string) => (typeof o[k] === 'string' && o[k]!.trim() ? String(o[k]).trim() : null)
  const cutout = s('strCutout')
  const render = s('strRender')
  const thumb = s('strThumb')
  const fanart = s('strFanart1') ?? s('strFanart2')
  const primary = cutout ?? render ?? thumb ?? fanart
  return { cutout, render, thumb, fanart, primary }
}

export function extractTheSportsDbTeamImages(payload: unknown): {
  badge: string | null
  logo: string | null
  primary: string | null
} {
  const o = flattenPlayerish(payload)
  const s = (k: string) => (typeof o[k] === 'string' && o[k]!.trim() ? String(o[k]).trim() : null)
  const badge = s('strTeamBadge') ?? s('strBadge')
  const logo = s('strTeamLogo') ?? s('strLogo')
  return { badge, logo, primary: badge ?? logo }
}

export function extractTheSportsDbProfileEnrichment(payload: unknown): {
  identity: ReturnType<typeof extractTheSportsDbPlayerIdentity>
  playerImages: ReturnType<typeof extractTheSportsDbPlayerImages>
  teamImages: ReturnType<typeof extractTheSportsDbTeamImages>
} {
  return {
    identity: extractTheSportsDbPlayerIdentity(payload),
    playerImages: extractTheSportsDbPlayerImages(payload),
    teamImages: extractTheSportsDbTeamImages(payload),
  }
}

export function hasTheSportsDbExperienceSignal(payload: unknown): boolean {
  const s = scanTheSportsDbExperienceSignals(payload)
  return s.reason !== 'no_matching_fields'
}

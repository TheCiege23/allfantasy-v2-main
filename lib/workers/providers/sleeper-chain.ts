/**
 * Final fallback in the api-chain: Sleeper public NFL player blob (injury_status, team, etc.).
 * Does not replace Rolling Insights for scoring — only fills gaps when upstream providers return empty.
 */
import { getPlayersBySport } from '@/lib/sleeper-client'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { ApiFetchParams, ApiProvider } from '@/lib/workers/api-config'
import { toApiChainSport } from '@/lib/workers/api-config'
import { pickSleeperHeadshotPlayer } from '@/lib/player-assets/headshotCandidateMatch'

export const sleeperChainProvider: ApiProvider = {
  name: 'sleeper',
  supports: ({ sport, dataType }: ApiFetchParams) => {
    const chain = toApiChainSport(sport as string)
    if (chain !== 'nfl') return false
    return ['injuries', 'players', 'player_headshots', 'team_logos'].includes(String(dataType))
  },
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const searchRaw = typeof query.search === 'string' ? query.search.trim() : ''
    const playerNameRaw = typeof query.playerName === 'string' ? query.playerName.trim() : ''
    const search = searchRaw.toLowerCase()
    const playerName = playerNameRaw.toLowerCase()
    const teamCode = normalizeTeamAbbrev(String(query.teamCode ?? query.team ?? ''))

    const players = await getPlayersBySport('nfl')
    if (!players || typeof players !== 'object') return null

    if (String(dataType) === 'team_logos') {
      const code = teamCode || normalizeTeamAbbrev(String(query.teamName ?? ''))
      if (!code) return null
      const abbr = code.toLowerCase()
      const logoUrl = `https://sleepercdn.com/images/team_logos/nfl/${abbr}.png`
      return {
        teamCode: code,
        teamName: String(query.teamName ?? code),
        logoUrl,
        logoUrlSm: logoUrl,
        logoUrlLg: logoUrl,
        logoSource: 'sleeper',
      }
    }

    if (String(dataType) === 'player_headshots') {
      // Identity rules live in `pickSleeperHeadshotPlayer`: the subject's own Sleeper id when the
      // caller has one, else exact name + position group + team, refusing ambiguity. This used to
      // be a substring match that let a team-less free agent through — see that helper's header.
      const sleeperId = typeof query.sleeperId === 'string' ? query.sleeperId.trim() : ''
      const name = searchRaw || playerNameRaw
      if (!name && !sleeperId) return null
      const candidates = Object.entries(players).map(([id, raw]) => {
        const p = raw as unknown as Record<string, unknown>
        return {
          id,
          name: String(p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()),
          position: p.position != null ? String(p.position) : null,
          team: normalizeTeamAbbrev(String(p.team ?? '')),
        }
      })
      const picked = pickSleeperHeadshotPlayer(candidates, {
        sleeperId,
        name,
        position: typeof query.position === 'string' ? query.position : null,
        team: teamCode,
      })
      if (!picked) return null
      const best = { ...picked, img: `https://sleepercdn.com/content/nfl/players/thumb/${picked.id}.jpg` }
      return {
        playerId: best.id,
        playerName: best.name,
        teamCode: best.team,
        headshotUrl: best.img,
        headshotUrlSm: best.img,
        headshotUrlLg: best.img,
        headshotSource: 'sleeper',
      }
    }

    if (String(dataType) === 'injuries') {
      const rows: Array<Record<string, unknown>> = []
      for (const [id, raw] of Object.entries(players)) {
        const p = raw as unknown as Record<string, unknown>
        const inj = p.injury_status as string | undefined
        if (!inj || String(inj).trim() === '') continue
        rows.push({
          playerId: id,
          externalId: `sleeper:${id}`,
          playerName: String(p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ?? 'Unknown'),
          team: normalizeTeamAbbrev(String(p.team ?? '')) ?? String(p.team ?? ''),
          status: String(inj),
          notes: p.injury_notes != null ? String(p.injury_notes) : null,
          reportDate: new Date().toISOString(),
          source: 'sleeper',
        })
      }
      return rows.slice(0, 800)
    }

    if (String(dataType) === 'players') {
      const q = search || playerName
      const out: Array<Record<string, unknown>> = []
      for (const [id, raw] of Object.entries(players)) {
        const p = raw as unknown as Record<string, unknown>
        const name = String(p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim())
        if (q && !name.toLowerCase().includes(q)) continue
        out.push({
          id,
          name,
          position: String(p.position ?? ''),
          team: normalizeTeamAbbrev(String(p.team ?? '')) ?? String(p.team ?? ''),
          status: p.injury_status != null ? String(p.injury_status) : null,
          imageUrl: p.avatar != null ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : null,
          source: 'sleeper',
        })
        if (out.length >= 250) break
      }
      return out.length ? out : null
    }

    return null
  },
}

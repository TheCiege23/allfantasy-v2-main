/** Public portfolio evidence. No private roster inputs or model-provided identifiers. */
export type PortfolioHorizon = 'week' | 'season' | 'dynasty'
export type PortfolioIntent = 'compare' | 'attention' | 'weakness' | 'injuries' | 'championship' | 'explain'
export type PortfolioState = {
  version: 1
  horizon: PortfolioHorizon
  orderedLeagueIds: string[]
  focusLeagueId: string | null
  checkedLeagueIds?: string[]
  scopeLeagueIds?: string[]
  focusPlayer?: string | null
}
export type PortfolioMetric = { key: string; label: string; value: number | null; detail: string }
export type PortfolioTeam = {
  leagueId: string
  leagueName: string
  teamName: string | null
  sport: string
  season: number
  status: 'ready' | 'partial' | 'unclaimed' | 'empty' | 'unavailable' | 'not_drafted'
  lastSyncedAt: string | null
  stale: boolean
  rank: number | null
  outOf: number | null
  percentile: number | null
  metrics: PortfolioMetric[]
  weakestPosition: string | null
  injuryPlayers?: Array<{ name: string; status: string; reportedAt: string | null; starter: boolean; stale: boolean }>
  rosterNames?: string[]
  gaps: string[]
  actions: Array<{ label: string; href?: string; prompt?: string }>
}
export type PortfolioEvidence = {
  version: 1
  status: 'ready' | 'partial' | 'blocked'
  intent: PortfolioIntent
  horizon: PortfolioHorizon
  scopeLabel: string
  compared: number
  total: number
  remaining: number
  generatedAt: string
  teams: PortfolioTeam[]
  state: PortfolioState
  methodology: string[]
  caveats: string[]
  followUps: string[]
  focusPlayer?: string | null
}

const horizons = new Set(['week', 'season', 'dynasty'])
export function readPortfolioState(raw: unknown): PortfolioState | null {
  if (typeof raw === 'string') {
    if (raw.length > 64_000) return null
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.version !== 1 || !horizons.has(String(s.horizon)) || !Array.isArray(s.orderedLeagueIds)) return null
  const ids = s.orderedLeagueIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160)
  if (ids.length > 400 || ids.length !== s.orderedLeagueIds.length) return null
  return { version: 1, horizon: s.horizon as PortfolioHorizon, orderedLeagueIds: [...new Set(ids)],
    focusLeagueId: typeof s.focusLeagueId === 'string' && ids.includes(s.focusLeagueId) ? s.focusLeagueId : null,
    checkedLeagueIds: Array.isArray(s.checkedLeagueIds) ? s.checkedLeagueIds.filter((id): id is string => typeof id === 'string' && id.length <= 160).slice(0, 400) : [],
    scopeLeagueIds: Array.isArray(s.scopeLeagueIds) ? s.scopeLeagueIds.filter((id): id is string => typeof id === 'string' && id.length <= 160).slice(0, 400) : ids,
    focusPlayer: typeof s.focusPlayer === 'string' && s.focusPlayer.length <= 120 ? s.focusPlayer : null }
}

/** Validate hydrated/network evidence before rendering actionable links or carrying scope. */
export function readPortfolioEvidence(raw: unknown): PortfolioEvidence | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as PortfolioEvidence
  if (e.version !== 1 || !['ready', 'partial', 'blocked'].includes(e.status) || !horizons.has(e.horizon) ||
      !['compare', 'attention', 'weakness', 'injuries', 'championship', 'explain'].includes(e.intent) ||
      typeof e.scopeLabel !== 'string' || typeof e.generatedAt !== 'string' || !Number.isFinite(Date.parse(e.generatedAt)) ||
      !Number.isInteger(e.compared) || e.compared < 0 || !Number.isInteger(e.total) || e.total < e.compared ||
      !Number.isInteger(e.remaining) || e.remaining < 0 || !Array.isArray(e.teams) || e.teams.length > 40 ||
      !readPortfolioState(e.state) || !Array.isArray(e.methodology) || !Array.isArray(e.caveats) || !Array.isArray(e.followUps)) return null
  const strings = (values: unknown[]) => values.every(v => typeof v === 'string' && v.length <= 2000)
  if (!strings(e.methodology) || !strings(e.caveats) || !strings(e.followUps)) return null
  for (const t of e.teams) {
    if (t?.rosterNames && (!Array.isArray(t.rosterNames) || t.rosterNames.length > 200 || !strings(t.rosterNames))) return null
    if (t?.injuryPlayers && (!Array.isArray(t.injuryPlayers) || t.injuryPlayers.length > 200 || t.injuryPlayers.some(p => !p || typeof p.name !== 'string' || typeof p.status !== 'string' || typeof p.stale !== 'boolean' || typeof p.starter !== 'boolean'))) return null
    if (!t || typeof t.leagueId !== 'string' || typeof t.leagueName !== 'string' || typeof t.sport !== 'string' ||
        !Number.isInteger(t.season) || !['ready', 'partial', 'unclaimed', 'empty', 'unavailable', 'not_drafted'].includes(t.status) ||
        typeof t.stale !== 'boolean' || (t.lastSyncedAt != null && !Number.isFinite(Date.parse(t.lastSyncedAt))) ||
        (t.percentile != null && (!Number.isFinite(t.percentile) || t.percentile < 0 || t.percentile > 100)) ||
        (t.rank != null && (!Number.isInteger(t.rank) || t.rank < 1 || !t.outOf || t.rank > t.outOf)) ||
        !Array.isArray(t.metrics) || t.metrics.length > 15 || !Array.isArray(t.gaps) || !strings(t.gaps) || !Array.isArray(t.actions)) return null
    for (const m of t.metrics) if (!m || typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.detail !== 'string' ||
      (m.value != null && !Number.isFinite(m.value))) return null
    for (const a of t.actions) {
      if (!a || typeof a.label !== 'string' || (a.prompt != null && (typeof a.prompt !== 'string' || a.prompt.length > 1000))) return null
      if (a.href != null && (typeof a.href !== 'string' || !/^\/core(?:[/?#]|$)/.test(a.href) || a.href.includes('\\'))) return null
    }
  }
  return e
}

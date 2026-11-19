import type { NormalizedImportResult } from '@/lib/league-import/types'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'

export type ImportedAlertEvent = {
  category: NotificationCategoryId
  title: string
  body: string
  /** Stable facts used for retry-safe delivery. */
  identity: string
}

type Score = { week: number; team: number; opponent: number | null; opponentId: string }
type Draft = { status: string; picks: string[] }
export type SleeperAlertSnapshot = {
  version: 1
  observedAt: string
  rosterId: string | null
  score: Score | null
  starters: string[] | null
  completedTrades: string[]
  drafts: Record<string, Draft>
}

const liveDraft = (status: string) => ['drafting', 'in_progress', 'paused'].includes(status)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const points = (v: number) => v.toFixed(2)
const validPlayer = (id: string) => id !== '' && id !== '0'

/** Pure diff over an authoritative provider observation. No API calls or writes. */
export function deriveSleeperAlerts(
  normalized: NormalizedImportResult,
  previous: SleeperAlertSnapshot | null,
  rosterId: string | null,
  now: Date,
): { snapshot: SleeperAlertSnapshot; events: ImportedAlertEvent[] } {
  const roster = normalized.rosters.find((r) => r.source_team_id === rosterId)
  const week = normalized.league.current_week
  const period = normalized.schedule.find((s) => s.week === week && s.season === normalized.league.season)
  const matchup = rosterId ? period?.matchups.find((m) => m.roster_id_1 === rosterId || m.roster_id_2 === rosterId) : undefined
  const first = matchup?.roster_id_1 === rosterId
  const own = first ? matchup?.points_1 : matchup?.points_2
  const other = first ? matchup?.points_2 : matchup?.points_1
  const score: Score | null = matchup && finite(week) && finite(own)
    ? { week, team: own, opponent: finite(other) ? other : null, opponentId: (first ? matchup.roster_id_2 : matchup.roster_id_1) || '' }
    : null
  const completed = normalized.transactions.filter((t) => t.type === 'trade' && t.status.toLowerCase() === 'complete')
  // The transaction window moves between weeks; retain earlier IDs to prevent replay.
  const completedTrades = [...new Set([...(previous?.completedTrades ?? []), ...completed.map((t) => t.source_transaction_id)])]
  const drafts: Record<string, Draft> = { ...previous?.drafts }
  for (const d of normalized.drafts ?? []) {
    drafts[d.source_draft_id] = {
      status: d.status.toLowerCase(),
      picks: normalized.draft_picks.filter((p) => p.source_draft_id === d.source_draft_id)
        .map((p) => `${p.pick_no}:${p.source_roster_id}:${p.source_player_id}`).sort(),
    }
  }
  const snapshot: SleeperAlertSnapshot = {
    version: 1, observedAt: now.toISOString(), rosterId,
    // Absent data is not an empty lineup or a zero score.
    score: score ?? (previous?.rosterId === rosterId ? previous.score : null),
    starters: roster && roster.fetch_status !== 'failed' ? [...roster.starter_ids] : previous?.rosterId === rosterId ? previous.starters : null,
    completedTrades, drafts,
  }
  const events: ImportedAlertEvent[] = []
  // First observation, archived seasons, and long disconnects establish a quiet baseline.
  if (!previous || normalized.league.status === 'complete' || now.getTime() - Date.parse(previous.observedAt) > 48 * 60 * 60_000) {
    return { snapshot, events }
  }
  const sameRoster = rosterId !== null && previous.rosterId === rosterId
  const before = previous.score
  if (sameRoster && score && before && score.week === before.week && score.opponentId === before.opponentId &&
      (Math.abs(score.team - before.team) >= 0.005 || score.opponent !== before.opponent)) {
    const opponentName = normalized.rosters.find((r) => r.source_team_id === score.opponentId)?.team_name || 'Opponent'
    events.push({
      category: 'imported_scoring', title: 'Matchup score updated',
      body: `Week ${score.week}: ${roster?.team_name || 'Your team'} ${points(score.team)}${score.opponent === null ? '' : ` - ${opponentName} ${points(score.opponent)}`}.`,
      identity: JSON.stringify(score),
    })
  }
  if (sameRoster && roster && roster.fetch_status !== 'failed' && previous.starters &&
      JSON.stringify(previous.starters) !== JSON.stringify(snapshot.starters)) {
    const priorPlayers = new Set(previous.starters.filter(validPlayer))
    const currentPlayers = new Set(roster.starter_ids.filter(validPlayer))
    const name = (id: string) => normalized.player_map[id]?.name || `Player ${id}`
    const added = [...currentPlayers].filter((id) => !priorPlayers.has(id)).map(name)
    const removed = [...priorPlayers].filter((id) => !currentPlayers.has(id)).map(name)
    const positions = normalized.league.roster_positions
    const startingSlots = Array.isArray(positions)
      ? positions.filter((p) => !['BN', 'IR', 'TAXI'].includes(String(p))).length : roster.starter_ids.length
    const empty = Math.max(0, startingSlots - roster.starter_ids.filter(validPlayer).length)
    events.push({
      category: 'imported_lineup', title: 'Your starting lineup changed',
      body: [added.length ? `Starting: ${added.slice(0, 4).join(', ')}.` : '', removed.length ? `Removed: ${removed.slice(0, 4).join(', ')}.` : '',
        !added.length && !removed.length ? 'Your starting slot assignments changed.' : '',
        empty ? `${empty} empty starting slot${empty === 1 ? '' : 's'}.` : ''].filter(Boolean).join(' '),
      identity: JSON.stringify(roster.starter_ids),
    })
  }
  const seen = new Set(previous.completedTrades)
  const newTrades = completed.filter((t) => {
    // Ignore historical backfill; status_updated reflects acceptance, not proposal time.
    const changedAt = Date.parse(t.status_updated_at ?? t.created_at)
    return !seen.has(t.source_transaction_id) && changedAt > Date.parse(previous.observedAt) && changedAt <= now.getTime()
  })
  if (newTrades.length) {
    const teamName = (id: string) => normalized.rosters.find((r) => r.source_team_id === id)?.team_name || `Team ${id}`
    events.push({
      category: 'imported_trade', title: newTrades.length === 1 ? 'League trade completed' : `${newTrades.length} league trades completed`,
      body: newTrades.slice(0, 3).map((t) => t.roster_ids.map(teamName).join(' / ')).join('; ') + '.',
      identity: newTrades.map((t) => t.source_transaction_id).sort().join(':'),
    })
  }
  const draftMessages: string[] = []
  const draftIdentities: string[] = []
  for (const d of normalized.drafts ?? []) {
    const beforeDraft = previous.drafts[d.source_draft_id]
    const current = drafts[d.source_draft_id]
    // An unseen existing draft is its own baseline, not a new event.
    if (!beforeDraft) continue
    let message = ''
    if (!liveDraft(beforeDraft.status) && liveDraft(current.status)) message = 'Your league draft has started.'
    else if (beforeDraft.status !== 'complete' && current.status === 'complete') message = 'Your league draft is complete.'
    else if (liveDraft(current.status)) {
      const picks = new Set(beforeDraft.picks)
      const added = current.picks.filter((p) => !picks.has(p)).length
      if (added) message = `${added} new draft pick${added === 1 ? '' : 's'} since the last sync.`
    }
    if (message) {
      draftMessages.push(message)
      draftIdentities.push(`${d.source_draft_id}:${current.status}:${current.picks.join(',')}`)
    }
  }
  if (draftMessages.length) events.push({
    category: 'imported_draft', title: 'Draft activity', body: draftMessages.slice(0, 3).join(' '), identity: draftIdentities.sort().join('|'),
  })
  return { snapshot, events }
}

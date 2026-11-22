/**
 * "What changed since the last import" — compares the league AF holds now with what the
 * platform just sent, so a re-import or sync shows its effect instead of silently overwriting.
 *
 * Teams are keyed on the SOURCE team id (`LeagueTeam.externalId` / roster `source_team_id`), which
 * is stable across seasons on every provider we import; names are not.
 */

import type {
  ImportReviewChange,
  ImportReviewChanges,
  ImportReviewPreviewInput,
  PreviousImportSnapshot,
} from './types'

/** Keep the list readable; the headline counts stay exact. */
const MAX_PLAYER_CHANGES = 60

function sameList(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].map((s) => String(s).toUpperCase()).sort()
  const sb = [...b].map((s) => String(s).toUpperCase()).sort()
  return sa.every((v, i) => v === sb[i])
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'not set'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

export function diffImportAgainstPrevious(
  next: ImportReviewPreviewInput,
  previous: PreviousImportSnapshot,
): ImportReviewChanges {
  const items: ImportReviewChange[] = []
  const facts = next.reviewFacts ?? {}

  // ── Settings ────────────────────────────────────────────────────────────────────────────
  const settingChecks: Array<[string, unknown, unknown, ((a: unknown, b: unknown) => boolean)?]> = [
    ['League size', previous.settings.teamCount, next.league.teamCount],
    ['Scoring type', previous.settings.scoringFormat, facts.leagueScoring],
    ['Playoff teams', previous.settings.playoffTeamCount, facts.playoffTeamCount ?? next.league.playoffTeams],
    ['Regular season weeks', previous.settings.regularSeasonLength, facts.regularSeasonLength],
    ['Dynasty', previous.settings.isDynasty, facts.isDynasty],
  ]
  for (const [label, before, after] of settingChecks) {
    // A value the new payload does not carry is "not reported", not "removed".
    if (after === undefined || after === null) continue
    if (before === undefined || before === null) continue
    if (String(before).toLowerCase() !== String(after).toLowerCase()) {
      items.push({ kind: 'changed', scope: 'setting', label, detail: `${show(before)} → ${show(after)}` })
    }
  }
  if (previous.settings.rosterPositions && next.rosterPositions.length > 0 && !sameList(previous.settings.rosterPositions, next.rosterPositions)) {
    items.push({
      kind: 'changed',
      scope: 'setting',
      label: 'Lineup spots',
      detail: `${previous.settings.rosterPositions.length} → ${next.rosterPositions.length} spots`,
    })
  }
  const settingsChanged = items.length

  // ── Teams ───────────────────────────────────────────────────────────────────────────────
  const prevTeams = new Map(previous.teams.map((t) => [t.teamId, t]))
  const nextTeams = new Map(next.managers.map((m) => [m.rosterId, m]))
  let teamsChanged = 0
  for (const m of next.managers) {
    const before = prevTeams.get(m.rosterId)
    const name = m.teamName || m.displayName || m.rosterId
    if (!before) {
      items.push({ kind: 'added', scope: 'team', label: name, detail: 'New team' })
      teamsChanged++
      continue
    }
    if (before.teamName && m.teamName && before.teamName !== m.teamName) {
      items.push({ kind: 'changed', scope: 'team', label: name, detail: `Renamed from “${before.teamName}”` })
      teamsChanged++
    }
    const ownerNow = m.displayName || m.username || ''
    if (before.ownerName && ownerNow && before.ownerName !== ownerNow) {
      items.push({ kind: 'changed', scope: 'team', label: name, detail: `Owner changed from ${before.ownerName} to ${ownerNow}` })
      teamsChanged++
    }
  }
  for (const t of previous.teams) {
    if (!nextTeams.has(t.teamId)) {
      items.push({ kind: 'removed', scope: 'team', label: t.teamName || t.ownerName || t.teamId, detail: 'No longer in the source league — AF will archive it, not delete it' })
      teamsChanged++
    }
  }

  // ── Players ─────────────────────────────────────────────────────────────────────────────
  let playersAdded = 0
  let playersRemoved = 0
  const playerItems: ImportReviewChange[] = []
  const nameOf = (id: string) =>
    next.playerMap[id]?.name ?? previous.playerNames?.[id] ?? `Player ${id}`
  for (const m of next.managers) {
    const prevRoster = previous.rosters[m.rosterId]
    if (!prevRoster) continue // a brand-new team is already reported above
    const before = new Set(prevRoster)
    const after = new Set(m.players ?? [])
    const teamLabel = m.teamName || m.displayName || m.rosterId
    for (const id of after) {
      if (!before.has(id)) {
        playersAdded++
        playerItems.push({ kind: 'added', scope: 'player', label: nameOf(id), detail: `Added to ${teamLabel}` })
      }
    }
    for (const id of before) {
      if (!after.has(id)) {
        playersRemoved++
        playerItems.push({ kind: 'removed', scope: 'player', label: nameOf(id), detail: `Dropped from ${teamLabel}` })
      }
    }
  }
  items.push(...playerItems.slice(0, MAX_PLAYER_CHANGES))

  return {
    lastImportedAt: previous.lastImportedAt,
    items,
    playersAdded,
    playersRemoved,
    settingsChanged,
    teamsChanged,
  }
}

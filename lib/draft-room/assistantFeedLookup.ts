import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'

/**
 * Indexes headlines + injury rows from `/draft/assistant-context` by normalized player name
 * so the live draft room can attach real news/injury context per player without N+1 API calls.
 */

export type AssistantFeedSnapshot = {
  headlineTitle?: string
  headlineAt?: string | null
  headlineTeam?: string | null
  injuryStatus?: string | null
  injuryNote?: string | null
  /**
   * Every injury row under this name, with its club. The status above is resolved per lookup from
   * these by `getAssistantFeedForPlayer` — never "last row under the name wins".
   */
  injuries?: Array<{ team: string | null; status: string | null; note: string | null }>
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Headline shape from GET /draft/assistant-context */
export type AssistantHeadlineRow = {
  title?: string | null
  playerName?: string | null
  team?: string | null
  publishedAt?: string | null
}

/** Injury shape from GET /draft/assistant-context */
export type AssistantInjuryRow = {
  playerName?: string | null
  team?: string | null
  status?: string | null
  note?: string | null
}

export function buildAssistantFeedByPlayerName(
  headlines: AssistantHeadlineRow[],
  injuries: AssistantInjuryRow[],
): Map<string, AssistantFeedSnapshot> {
  const m = new Map<string, AssistantFeedSnapshot>()
  for (const h of headlines) {
    const pn = typeof h.playerName === 'string' ? h.playerName.trim() : ''
    if (!pn || !h.title?.trim()) continue
    const k = nameKey(pn)
    const prev = m.get(k)
    if (!prev?.headlineTitle) {
      m.set(k, {
        ...(prev ?? {}),
        headlineTitle: h.title!.trim(),
        headlineAt: h.publishedAt ?? null,
        headlineTeam: typeof h.team === 'string' ? h.team.trim() || null : null,
      })
    }
  }
  for (const inj of injuries) {
    const pn = typeof inj.playerName === 'string' ? inj.playerName.trim() : ''
    if (!pn) continue
    const k = nameKey(pn)
    const prev = m.get(k) ?? {}
    m.set(k, {
      ...prev,
      injuries: [
        ...(prev.injuries ?? []),
        { team: inj.team?.trim() || null, status: inj.status?.trim() || null, note: inj.note?.trim() || null },
      ],
    })
  }
  return m
}

/**
 * The injury rows under a name that belong to THIS player.
 *
 * 🛑 THIS WAS "LAST ROW UNDER THE NAME WINS" (2026-10-11), so a healthy Vikings WR Justin Jefferson
 * showed the Browns LB's injury in the draft room and its copilot. With the player's club, only that
 * club's rows (and club-less ones) count; without it, only a name every row agrees on one club for.
 */
function ownInjury(
  rows: NonNullable<AssistantFeedSnapshot['injuries']>,
  team: string | null | undefined,
): { status: string | null; note: string | null } | null {
  const fold = (t: string | null | undefined) => foldInjuryTeam(t, 'NFL')
  const ours = fold(team)
  const clubs = new Set(rows.map((r) => fold(r.team)).filter(Boolean))
  const mine = ours
    ? rows.filter((r) => !fold(r.team) || fold(r.team) === ours)
    : clubs.size <= 1
      ? rows
      : []
  if (mine.length === 0) return null
  return {
    status: mine.find((r) => r.status)?.status ?? null,
    note: mine.find((r) => r.note)?.note ?? null,
  }
}

export function getAssistantFeedForPlayer(
  map: Map<string, AssistantFeedSnapshot>,
  playerName: string,
  team?: string | null,
): AssistantFeedSnapshot | null {
  const found = map.get(nameKey(playerName))
  if (!found) return null
  const injury = found.injuries ? ownInjury(found.injuries, team) : null
  const snap: AssistantFeedSnapshot = {
    ...found,
    injuryStatus: injury?.status ?? null,
    injuryNote: injury?.note ?? null,
  }
  if (
    !snap.headlineTitle &&
    !snap.injuryStatus &&
    !snap.injuryNote
  ) {
    return null
  }
  return snap
}

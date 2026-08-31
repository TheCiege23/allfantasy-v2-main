/**
 * Who a tournament message is for, and which half of them it can actually reach.
 *
 * 🛑 A BROADCAST IN AN IMPORTED TOURNAMENT REACHES A MINORITY OF ITS AUDIENCE.
 * AllFantasy cannot post into Sleeper, and most of a 240-manager field has never
 * signed up here — so "send to everyone" delivers to the few with accounts and
 * silently misses the rest. Reporting that as a successful send to 240 people is
 * the failure mode this module exists to prevent: the commissioner believes the
 * message went out, and 200 managers never hear about the redraft.
 *
 * So an audience always resolves into TWO lists. The reachable get a
 * notification. The unreachable get a paste-ready block, with their handles, for
 * the commissioner to post where those managers actually are.
 *
 * Pure functions — no prisma, no `server-only`. The filtering rules decide who
 * is told their season is over, and they are worth asserting directly.
 */
import type { StandingsBoard, BoardRow } from '@/lib/tournament/standingsBoard'

/**
 * The audience vocabulary, stored in `TournamentAnnouncement.targetAudience`.
 *
 * ⚠ A STRING RATHER THAN COLUMNS, because that is the column the schema already
 * has — and a league target has nowhere else to live: `TournamentAnnouncement`
 * carries `conferenceId` but no league id.
 */
export type AudienceFilter =
  | { kind: 'all' }
  | { kind: 'conference'; conferenceId: string }
  | { kind: 'league'; tournamentLeagueId: string }
  | { kind: 'standing'; standing: 'in' | 'bubble' | 'out' }
  | { kind: 'unlinked' }

export function serializeAudience(filter: AudienceFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'all'
    case 'conference':
      return `conference:${filter.conferenceId}`
    case 'league':
      return `league:${filter.tournamentLeagueId}`
    case 'standing':
      return `standing:${filter.standing}`
    case 'unlinked':
      return 'unlinked'
  }
}

/** Parse a stored audience string. Returns null for anything unrecognised. */
export function parseAudience(value: string): AudienceFilter | null {
  const raw = (value ?? '').trim()
  if (raw === 'all') return { kind: 'all' }
  if (raw === 'unlinked') return { kind: 'unlinked' }
  const cut = raw.indexOf(':')
  if (cut <= 0) return null
  const head = raw.slice(0, cut)
  const tail = raw.slice(cut + 1)
  if (!tail) return null
  if (head === 'conference') return { kind: 'conference', conferenceId: tail }
  if (head === 'league') return { kind: 'league', tournamentLeagueId: tail }
  if (head === 'standing' && (tail === 'in' || tail === 'bubble' || tail === 'out')) {
    return { kind: 'standing', standing: tail }
  }
  /*
   * ⚠ AN UNRECOGNISED AUDIENCE IS NOT "EVERYONE". Defaulting a typo or an
   * audience from a future version to `all` sends a message meant for eight
   * eliminated managers to all 240.
   */
  return null
}

export type AudienceMember = {
  participantId: string
  displayName: string
  appUserId: string | null
  conferenceId: string
  tournamentLeagueId: string
  leagueName: string
  standing: BoardRow['standing']
  unmatched: boolean
}

export type ResolvedAudience = {
  /** Everyone the filter selected, reachable or not. */
  members: AudienceMember[]
  /** Distinct AllFantasy accounts a notification can be delivered to. */
  reachableUserIds: string[]
  /** Selected managers with no AllFantasy account behind them. */
  unreachable: AudienceMember[]
}

/**
 * Apply an audience filter to a board.
 *
 * ⚠ AN UNMATCHED MANAGER IS SELECTABLE BUT NEVER IN A STANDING GROUP. Their
 * record could not be read, so they are not "in", "bubble" or "out" — including
 * them in an elimination message would tell someone their season ended on
 * evidence we do not have. `unlinked` is how you address them on purpose.
 */
export function resolveAudience(board: StandingsBoard, filter: AudienceFilter): ResolvedAudience {
  const members: AudienceMember[] = []

  for (const conference of board.conferences) {
    if (filter.kind === 'conference' && conference.id !== filter.conferenceId) continue
    for (const league of conference.leagues) {
      if (filter.kind === 'league' && league.tournamentLeagueId !== filter.tournamentLeagueId) {
        continue
      }
      for (const row of league.rows) {
        if (filter.kind === 'standing') {
          if (row.unmatched || row.standing !== filter.standing) continue
        }
        if (filter.kind === 'unlinked' && !row.unmatched) continue

        members.push({
          participantId: row.participantId,
          displayName: row.displayName,
          appUserId: row.appUserId,
          conferenceId: conference.id,
          tournamentLeagueId: league.tournamentLeagueId,
          leagueName: league.name,
          standing: row.standing,
          unmatched: row.unmatched,
        })
      }
    }
  }

  /* One notification per ACCOUNT, not per entry — a manager reachable through
     two teams should not be messaged twice about the same thing. */
  const reachableUserIds = [
    ...new Set(members.map((m) => m.appUserId).filter((id): id is string => Boolean(id))),
  ]

  return {
    members,
    reachableUserIds,
    unreachable: members.filter((m) => !m.appUserId),
  }
}

/**
 * The block a commissioner pastes where the unreachable managers actually are.
 *
 * ⚠ GROUPED BY LEAGUE, because that is how the destination is organised. One
 * flat list of 200 handles cannot be pasted into anything — each league's chat
 * needs its own block, and its own managers.
 */
export function buildPasteBlocks(
  message: string,
  unreachable: AudienceMember[],
): Array<{ leagueName: string; text: string; handleCount: number }> {
  const byLeague = new Map<string, AudienceMember[]>()
  for (const m of unreachable) {
    const arr = byLeague.get(m.leagueName) ?? []
    arr.push(m)
    byLeague.set(m.leagueName, arr)
  }

  return [...byLeague.entries()].map(([leagueName, group]) => {
    const handles = group.map((m) => `@${m.displayName}`).join(' ')
    return {
      leagueName,
      text: `${message.trim()}\n\n${handles}`,
      handleCount: group.length,
    }
  })
}

/** A short human summary of who a filter selected, for the confirm step. */
export function describeAudience(board: StandingsBoard, filter: AudienceFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'everyone in the tournament'
    case 'conference': {
      const c = board.conferences.find((x) => x.id === filter.conferenceId)
      return c ? `everyone in ${c.name}` : 'a conference'
    }
    case 'league': {
      for (const c of board.conferences) {
        const l = c.leagues.find((x) => x.tournamentLeagueId === filter.tournamentLeagueId)
        if (l) return `everyone in ${l.name}`
      }
      return 'a league'
    }
    case 'standing':
      return filter.standing === 'in'
        ? 'managers currently advancing'
        : filter.standing === 'bubble'
          ? 'managers on the bubble'
          : 'managers currently eliminated'
    case 'unlinked':
      return 'managers whose team could not be matched'
  }
}

'use client'

import Link from 'next/link'
import { ZombieEventCard, type ZombieFeedEvent } from './ZombieEventCard'

function mapAnimationType(t: string): ZombieFeedEvent['kind'] {
  if (t.includes('maul')) return 'mauling_event'
  if (t.includes('bash')) return 'bashing_event'
  if (t.includes('revive') || t === 'player_revived') return 'revival_event'
  if (t.includes('infect') || t === 'zombie_turn') return 'infection_event'
  if (t.includes('weapon')) return 'weapon_event'
  if (t.includes('serum')) return 'serum_event'
  if (t.includes('ambush')) return 'ambush_event'
  if (t.includes('whisperer')) return 'whisperer_replaced'
  if (t.includes('horde')) return 'horde_milestone'
  if (t.includes('last_survivor')) return 'last_survivor'
  if (t.includes('bomb')) return 'bomb_event'
  return 'animation'
}

export function ZombieEventFeed({
  animations,
  announcements,
  maxItems = 10,
  compact,
  leagueId,
  leagueName,
  animate,
}: {
  animations: Array<{
    id: string
    animationType: string
    week: number
    metadata: unknown
    createdAt: string | Date
  }>
  announcements: Array<{
    id: string
    type: string
    title: string
    content: string
    week: number | null
    createdAt: string | Date
  }>
  maxItems?: number
  compact?: boolean
  leagueId?: string
  leagueName?: string | null
  animate?: boolean
}) {
  type Enriched = ZombieFeedEvent & { _ts: number }
  const events: Enriched[] = []

  for (const a of animations) {
    const meta = (a.metadata ?? {}) as Record<string, unknown>
    events.push({
      id: `anim-${a.id}`,
      kind: mapAnimationType(a.animationType),
      title: formatAnimationTitle(a.animationType, meta),
      subtitle: formatAnimationSubtitle(a.animationType, meta),
      week: a.week,
      leagueName: leagueName ?? null,
      timestamp: typeof a.createdAt === 'string' ? a.createdAt : a.createdAt.toISOString(),
      metadata: meta,
      _ts: new Date(a.createdAt).getTime(),
    })
  }

  for (const n of announcements) {
    const isUpdate = n.type === 'weekly_update' || n.type === 'weekly_recap'
    events.push({
      id: `ann-${n.id}`,
      kind: isUpdate ? 'weekly_update' : 'announcement',
      title: n.title,
      subtitle: n.content.slice(0, 140) + (n.content.length > 140 ? '...' : ''),
      week: n.week,
      leagueName: leagueName ?? null,
      timestamp: typeof n.createdAt === 'string' ? n.createdAt : n.createdAt.toISOString(),
      _ts: new Date(n.createdAt).getTime(),
    })
  }

  events.sort((x, y) => y._ts - x._ts)

  const slice = events.slice(0, maxItems).map(({ _ts: _t, ...rest }) => rest)

  if (slice.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-6 text-center">
        <p className="text-[12px] text-[var(--zombie-text-dim)]">No events yet. The island is quiet... for now.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {slice.map((e, i) => (
        <ZombieEventCard
          key={e.id}
          event={e}
          compact={compact}
          animate={animate && i === 0}
        />
      ))}
      {leagueId && !compact ? (
        <Link
          href={`/zombie/${leagueId}/history`}
          className="block text-center text-[12px] font-medium text-sky-400/90 hover:text-sky-300"
          data-testid="zombie-view-all-events"
        >
          View all events
        </Link>
      ) : null}
    </div>
  )
}

function formatAnimationTitle(type: string, meta: Record<string, unknown>): string {
  const victim = typeof meta.victimName === 'string' ? meta.victimName : null
  const winner = typeof meta.winnerName === 'string' ? meta.winnerName : null
  const loser = typeof meta.loserName === 'string' ? meta.loserName : null

  if (type === 'zombie_turn') {
    return victim
      ? `🧟 ${victim} has been turned.`
      : '🧟 The infection spreads.'
  }
  if (type === 'player_revived') {
    return victim
      ? `⚡ ${victim} has returned from the dead.`
      : '⚡ A player has returned from the dead.'
  }
  if (type === 'mauling') {
    return winner && loser
      ? `💀 ${winner} mauled ${loser}.`
      : '💀 A mauling shook the island.'
  }
  if (type === 'bashing') {
    return winner && loser
      ? `🔥 ${winner} bashed ${loser}.`
      : '🔥 A bashing dominated the scoreboard.'
  }
  if (type === 'weapon_acquired') return '⚔️ A weapon was claimed.'
  if (type === 'weapon_stolen') return '⚔️ A weapon was stolen.'
  if (type === 'serum_used') {
    return victim
      ? `🧪 ${victim} used a serum and survived.`
      : '🧪 A serum was consumed. One Survivor lives.'
  }
  if (type === 'ambush_triggered') return '⚠️ The Whisperer stirred. Something changed.'
  if (type === 'whisperer_selected') return '🎭 A Whisperer has been chosen. The island holds its breath.'
  if (type === 'whisperer_replaced') return '🎭 The old Whisperer has fallen. A new shadow rises.'
  if (type === 'horde_grows') {
    const size = meta.hordeSize != null ? ` ${String(meta.hordeSize)} strong.` : ''
    return `🧟 The Horde grows.${size}`
  }
  if (type === 'last_survivor') {
    const count = typeof meta.survivorCount === 'number' ? meta.survivorCount : null
    return count != null
      ? `🧍 Only ${count} Survivor${count === 1 ? '' : 's'} remain.`
      : '🧍 Only a few Survivors remain.'
  }
  if (type === 'bomb_detonated') return '💣 A bomb detonated in the league.'
  return `📣 ${type.replace(/_/g, ' ')}`
}

function formatAnimationSubtitle(type: string, meta: Record<string, unknown>): string | undefined {
  const margin = typeof meta.margin === 'number' ? meta.margin : null
  if (type === 'zombie_turn' && typeof meta.infectorName === 'string') {
    return `Infected by ${meta.infectorName}${margin != null ? ` — ${margin.toFixed(1)} pt margin` : ''}`
  }
  if ((type === 'mauling' || type === 'bashing') && margin != null) {
    return `Winning margin: ${margin.toFixed(1)} pts`
  }
  return undefined
}

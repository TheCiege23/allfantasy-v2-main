'use client'

import { useEffect, useMemo, useState } from 'react'
import { Shield } from 'lucide-react'
import { PlayerImage } from '@/app/components/PlayerImage'
import { FallbackImg } from '@/components/core-app/FallbackImg'

/**
 * Shared player-headshot component for the NFL redraft league dashboard
 * (Roster + Players/Waivers) and any other surface that wants the canonical
 * fallback chain.
 *
 * Two modes:
 *
 *  - "Rich" mode — pass `playerId` (or `sleeperId`) and (optionally) `playerName`,
 *    `headshotUrl`, `position`, `team`, `espnId`, `nbaId`, `sport`. When `useResolver`
 *    is enabled for NFL dashboard surfaces, the component first asks the
 *    authenticated server resolver for the best provider-backed headshot:
 *      1. TheSportsDB
 *      2. ClearSports
 *      3. Sleeper CDN
 *      4. ESPN fallback (via `<PlayerImage>`, only when `espnId` already exists)
 *      5. Initials placeholder (final, never errors)
 *    The rich mode still delegates rendering to `<PlayerImage>` from
 *    `app/components/PlayerImage.tsx`, so `onError` fallback remains bounded and
 *    safe with no infinite-error-loop risk.
 *
 *  - "Legacy" mode — pass `src` only. Renders a plain `<img>` with a shield
 *    silhouette when `src` is null. Preserves the original 33-line component's
 *    contract for the 10+ existing callers (ActivityFeed, PlayerRow, TradeCard,
 *    StandingsRow, PlayoffBracket, CollegePlayerRow, StartVsComparisonCard,
 *    PlayerComparisonPremiumView, components/league/tabs/{TeamTab,PlayersTab}).
 *    No fallback chain — by design — because legacy callers already pass a
 *    pre-resolved URL.
 *
 * `team` is accepted today for accessibility / future routing but is not yet
 * forwarded to the chain (NFL chain doesn't take a team code).
 */
export type PlayerHeadshotProps = {
  /** Rich mode — Sleeper player id (or any AllFantasy id usable as a Sleeper-key fallback). */
  playerId?: string
  /** Rich mode — explicit Sleeper id alias; takes precedence over `playerId`. */
  sleeperId?: string
  /** Rich mode — player display name. Drives initials placeholder + alt text. */
  playerName?: string
  /** Rich mode — pre-resolved headshot URL, tried first in the fallback chain. */
  headshotUrl?: string | null
  /** Rich mode — NFL team abbreviation (currently informational only). */
  team?: string | null
  /** Rich mode — player position; drives initials placeholder color. */
  position?: string | null
  /** Rich mode — ESPN player id; appended to the chain. */
  espnId?: string
  /** Rich mode — NBA player id; appended to the chain for NBA headshots. */
  nbaId?: string
  /** Rich mode — sport key (default NFL). */
  sport?: string
  /** Rich mode — opt into the server-side NFL resolver for dashboard surfaces. */
  useResolver?: boolean
  /** Rich mode — circular vs rounded card. */
  variant?: 'round' | 'card'

  /** Legacy mode — pre-resolved src. Ignored when `playerId`/`sleeperId` is set. */
  src?: string | null

  /** Accessibility text. Required for legacy mode; in rich mode falls back to playerName. */
  alt?: string
  /** Pixel size for the rendered image / placeholder. */
  size?: number
  /** Additional className. */
  className?: string
}

type ResolvedHeadshotEntry = {
  headshotUrl: string | null
}

const resolvedHeadshotCache = new Map<string, Promise<ResolvedHeadshotEntry> | ResolvedHeadshotEntry>()

function resolverCacheKey(props: PlayerHeadshotProps): string {
  return JSON.stringify({
    sport: String(props.sport ?? 'NFL').trim().toUpperCase(),
    sleeperId: props.sleeperId ?? props.playerId ?? '',
    playerName: props.playerName ?? '',
    team: props.team ?? '',
    position: props.position ?? '',
  })
}

async function fetchResolvedHeadshot(props: PlayerHeadshotProps): Promise<ResolvedHeadshotEntry> {
  const name = String(props.playerName ?? '').trim()
  const sport = String(props.sport ?? 'NFL').trim().toUpperCase()
  if (!name || sport !== 'NFL') {
    return { headshotUrl: null }
  }

  const url = new URL('/api/player/resolve-headshot', window.location.origin)
  url.searchParams.set('name', name)
  url.searchParams.set('sport', sport)
  if (props.team?.trim()) url.searchParams.set('team', props.team.trim())
  if (props.position?.trim()) url.searchParams.set('position', props.position.trim())
  if ((props.sleeperId ?? props.playerId)?.trim()) {
    url.searchParams.set('sleeperId', (props.sleeperId ?? props.playerId ?? '').trim())
  }

  const response = await fetch(url.toString(), {
    credentials: 'same-origin',
    method: 'GET',
  })
  if (!response.ok) {
    return { headshotUrl: null }
  }
  const data = (await response.json()) as { headshotUrl?: string | null }
  return { headshotUrl: typeof data.headshotUrl === 'string' && data.headshotUrl.trim() ? data.headshotUrl : null }
}

function loadResolvedHeadshot(props: PlayerHeadshotProps): Promise<ResolvedHeadshotEntry> {
  const key = resolverCacheKey(props)
  const cached = resolvedHeadshotCache.get(key)
  if (cached) {
    return cached instanceof Promise ? cached : Promise.resolve(cached)
  }
  const pending = fetchResolvedHeadshot(props)
    .then((result) => {
      resolvedHeadshotCache.set(key, result)
      return result
    })
    .catch(() => {
      const fallback = { headshotUrl: null }
      resolvedHeadshotCache.set(key, fallback)
      return fallback
    })
  resolvedHeadshotCache.set(key, pending)
  return pending
}

function isRichMode(props: PlayerHeadshotProps): boolean {
  return Boolean(props.playerId || props.sleeperId)
}

function RichPlayerHeadshot(props: PlayerHeadshotProps) {
  const playerId = props.playerId
  const sleeperId = props.sleeperId
  const playerName = props.playerName
  const headshotUrl = props.headshotUrl
  const team = props.team
  const position = props.position
  const sportValue = props.sport
  const id = sleeperId ?? playerId ?? ''
  const sport = String(sportValue ?? 'NFL').trim().toUpperCase()
  const resolverEnabled = Boolean(props.useResolver && sport === 'NFL' && playerName?.trim())
  const initialHeadshotUrl = useMemo(() => headshotUrl ?? null, [headshotUrl])
  const [resolvedHeadshotUrl, setResolvedHeadshotUrl] = useState<string | null>(initialHeadshotUrl)

  useEffect(() => {
    setResolvedHeadshotUrl(headshotUrl ?? null)
  }, [headshotUrl])

  useEffect(() => {
    if (!resolverEnabled) {
      return
    }
    let cancelled = false
    void loadResolvedHeadshot({
      playerId,
      sleeperId,
      playerName,
      team,
      position,
      sport: sportValue,
    }).then((result) => {
      if (!cancelled && result.headshotUrl) {
        setResolvedHeadshotUrl(result.headshotUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [resolverEnabled, playerId, sleeperId, playerName, team, position, sportValue])

  return (
    <PlayerImage
      sleeperId={id}
      sport={sportValue ?? 'NFL'}
      name={playerName ?? props.alt ?? ''}
      position={position ?? undefined}
      headshotUrl={resolvedHeadshotUrl ?? undefined}
      espnId={props.espnId}
      nbaId={props.nbaId}
      size={props.size ?? 32}
      variant={props.variant ?? 'round'}
      className={props.className ?? ''}
    />
  )
}

export function PlayerHeadshot(props: PlayerHeadshotProps) {
  if (isRichMode(props)) {
    return <RichPlayerHeadshot {...props} />
  }

  const size = props.size ?? 40
  const alt = props.alt ?? ''
  const className = props.className ?? ''

  const placeholder = (
    <div
      className={`flex items-center justify-center rounded-full border border-white/10 bg-[#1C2539] text-[#8B9DB8] ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={alt || 'Player'}
    >
      <Shield size={Math.max(16, Math.floor(size / 2))} />
    </div>
  )

  if (props.src) {
    /*
     * ⚠ A DEAD URL FALLS BACK TO THE SAME SHIELD AS A MISSING ONE. This raw `<img>` had no
     * `onError`, so the ~15 legacy callers (league Trades tab, player rows, activity feed,
     * bracket…) drew a broken-image glyph wherever Sleeper's CDN refused an id.
     */
    return (
      <FallbackImg
        src={props.src}
        alt={alt}
        width={size}
        height={size}
        className={`rounded-full border border-white/10 object-cover ${className}`}
        fallback={placeholder}
      />
    )
  }

  return placeholder
}

export default PlayerHeadshot

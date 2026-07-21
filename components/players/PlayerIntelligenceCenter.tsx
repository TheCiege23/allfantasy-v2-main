'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, AlertCircle, Info, ExternalLink, X } from 'lucide-react'
import { PlayerAvatar } from '@/components/app/draft-room/PlayerAvatar'
import {
  SPORTS_WITH_PLAYERS,
  SPORTS_WITHOUT_DATA,
  getMetricAvailability,
  type SupportedSport,
} from '@/lib/players/player-data-availability'
import { MetricSlot, formatMarketValue, formatTrend } from './MetricSlot'
import type { PlayerIntelligenceRecord } from '@/lib/players/playerIntelligenceService'
import './players-intelligence.css'

/**
 * Player Intelligence Center — search any player, understand what they are worth in
 * a specific league, and move into the right tool.
 *
 * Presentation only: every figure shown here arrives from
 * `/api/players/intelligence` already paired with its availability state, and the
 * component renders that state rather than deciding what is trustworthy. Metrics
 * with no production source are rendered as explicitly absent by `MetricSlot`.
 */

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  MLB: 'MLB',
  NHL: 'NHL',
  SOCCER: 'Soccer',
  NBA: 'NBA',
}

interface ValuationContext {
  leagueSpecific: boolean
  leagueName: string | null
  settings: { isDynasty: boolean; numQbs: number; numTeams: number; ppr: number }
  derivedFrom: string
}

interface ApiResponse {
  players: PlayerIntelligenceRecord[]
  dataGaps: string[]
  marketDataAgeMs: number | null
  valuationContext: ValuationContext
}

export interface LeagueOption {
  id: string
  name: string
  platform: string | null
}

export interface PlayerIntelligenceCenterProps {
  /** Leagues the signed-in user can value players against. */
  leagues: LeagueOption[]
}

export default function PlayerIntelligenceCenter({ leagues }: PlayerIntelligenceCenterProps) {
  const [sport, setSport] = useState<SupportedSport>('NFL')
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [leagueId, setLeagueId] = useState<string>('')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Debounce so typing does not fire a request per keystroke against a 95k-row table.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 250)
    return () => clearTimeout(id)
  }, [rawQuery])

  // A stale in-flight response must never overwrite a newer one; without this,
  // fast typing can leave the results showing an earlier query's players.
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setStatus('loading')

    const params = new URLSearchParams({ sport })
    if (query.length >= 2) params.set('q', query)
    if (leagueId) params.set('leagueId', leagueId)

    try {
      const res = await fetch(`/api/players/intelligence?${params.toString()}`)
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const json = (await res.json()) as ApiResponse
      if (seq !== requestSeq.current) return
      setData(json)
      setStatus('idle')
    } catch {
      if (seq !== requestSeq.current) return
      setStatus('error')
    }
  }, [sport, query, leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const players = data?.players ?? []
  const selected = useMemo(
    () => players.find((p) => p.key === selectedKey) ?? null,
    [players, selectedKey],
  )

  const activeLeague = leagues.find((l) => l.id === leagueId) ?? null

  return (
    <div className="af-players">
      <div className="afp-shell">
        <header className="afp-header-row">
          <div>
            <h1 className="afp-title">Player Intelligence Center</h1>
            <p className="afp-subtitle">
              Search every player. Understand their value. Take the right action.
            </p>
          </div>
          <ValuationBadge context={data?.valuationContext ?? null} />
        </header>

        <SportRail sport={sport} onChange={(next) => { setSport(next); setSelectedKey(null) }} />

        <div className="afp-search-sticky">
          <label className="afp-sr-only" htmlFor="afp-search">
            Search players by name
          </label>
          <div style={{ position: 'relative', maxWidth: 520 }}>
            <Search
              size={16}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 14,
                top: 14,
                color: 'var(--color-neutral-600)',
                pointerEvents: 'none',
              }}
            />
            <input
              id="afp-search"
              className="afp-input"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={`Search ${SPORT_LABELS[sport] ?? sport} players by name…`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <LeagueSelector
          leagues={leagues}
          value={leagueId}
          onChange={(next) => setLeagueId(next)}
          context={data?.valuationContext ?? null}
        />

        {data?.dataGaps?.length ? <DataGapNotice gaps={data.dataGaps} /> : null}

        <div className="afp-layout">
          <section aria-label="Player results">
            <div
              className="afp-kicker"
              style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {query.length >= 2
                ? `Results for “${query}”`
                : sport === 'NFL'
                  ? 'Top of the trade market'
                  : 'Players'}
              {status === 'idle' && players.length > 0 && (
                <span style={{ color: 'var(--color-neutral-700)' }}>({players.length})</span>
              )}
            </div>

            {status === 'loading' && <ResultSkeleton />}

            {status === 'error' && (
              <div className="afp-card afp-empty">
                <AlertCircle
                  size={20}
                  aria-hidden="true"
                  style={{ color: 'var(--status-critical)', marginBottom: 8 }}
                />
                <div>Player data could not be loaded.</div>
                <button
                  type="button"
                  className="afp-btn"
                  style={{ marginTop: 12 }}
                  onClick={() => void load()}
                >
                  Try again
                </button>
              </div>
            )}

            {status === 'idle' && players.length === 0 && (
              <EmptyResults query={query} sport={sport} />
            )}

            {status === 'idle' && players.length > 0 && (
              <div className="afp-grid">
                {players.map((player) => (
                  <PlayerCard
                    key={player.key}
                    player={player}
                    selected={player.key === selectedKey}
                    onSelect={() =>
                      setSelectedKey((current) => (current === player.key ? null : player.key))
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="afp-detail" aria-label="Player detail">
            {selected ? (
              <PlayerDetail
                player={selected}
                league={activeLeague}
                onClose={() => setSelectedKey(null)}
              />
            ) : (
              <div className="afp-card afp-empty" style={{ padding: '28px 18px' }}>
                Select a player to see their full profile, market context, and next actions.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

/**
 * Sports with zero player rows are shown but disabled, rather than silently omitted.
 * A user who expects the product to cover the WNBA learns that it does not, instead
 * of wondering where the tab went.
 */
function SportRail({
  sport,
  onChange,
}: {
  sport: SupportedSport
  onChange: (next: SupportedSport) => void
}) {
  return (
    <div className="afp-tablist" role="tablist" aria-label="Sport">
      {SPORTS_WITH_PLAYERS.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          className="afp-tab"
          aria-selected={sport === option}
          onClick={() => onChange(option)}
        >
          {SPORT_LABELS[option] ?? option}
        </button>
      ))}

      {SPORTS_WITHOUT_DATA.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          className="afp-tab"
          aria-selected={false}
          disabled
          title={`${option} is not supported yet — no ${option} players are available.`}
        >
          {option}
          <span className="afp-sr-only"> — not supported yet</span>
        </button>
      ))}
    </div>
  )
}

function LeagueSelector({
  leagues,
  value,
  onChange,
  context,
}: {
  leagues: LeagueOption[]
  value: string
  onChange: (next: string) => void
  context: ValuationContext | null
}) {
  if (leagues.length === 0) {
    return (
      <div className="afp-card afp-card-tight" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <Info size={16} aria-hidden="true" style={{ color: 'var(--color-accent-400)', flex: 'none', marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
          Values below are generic. <Link href="/import" style={{ color: 'var(--color-accent-300)' }}>Import a league</Link>{' '}
          to see what each player is worth in your actual scoring and roster settings.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label htmlFor="afp-league" className="afp-kicker">
        Value for
      </label>
      <select
        id="afp-league"
        className="afp-input"
        style={{ width: 'auto', minWidth: 220, padding: '0 12px', minHeight: 38 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Generic settings (no league)</option>
        {leagues.map((league) => (
          <option key={league.id} value={league.id}>
            {league.name}
            {league.platform ? ` · ${league.platform}` : ''}
          </option>
        ))}
      </select>
      {context && (
        <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{context.derivedFrom}</span>
      )}
    </div>
  )
}

function ValuationBadge({ context }: { context: ValuationContext | null }) {
  if (!context) return null

  return (
    <div className="afp-card afp-card-tight" style={{ minWidth: 230 }}>
      <div className="afp-kicker" style={{ marginBottom: 6 }}>
        Valuation basis
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {context.leagueSpecific ? context.leagueName : 'Generic settings'}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>
        {context.leagueSpecific
          ? context.derivedFrom
          : 'Not tied to one of your leagues — select a league for contextual values.'}
      </div>
    </div>
  )
}

/**
 * Surfaces every source that failed or was empty. Reporting these is what keeps a
 * shorter-than-expected result list from reading as "there is nothing here".
 */
function DataGapNotice({ gaps }: { gaps: string[] }) {
  return (
    <div className="afp-notice" role="status">
      <AlertCircle size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
      <div>
        {gaps.length === 1 ? (
          gaps[0]
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PlayerCard({
  player,
  selected,
  onSelect,
}: {
  player: PlayerIntelligenceRecord
  selected: boolean
  onSelect: () => void
}) {
  const market = player.market.value
  const trend = market ? formatTrend(market.trend30Day) : null
  const injury = player.injuryStatus.value

  return (
    <button
      type="button"
      className="afp-card-button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="afp-player-head">
        <PlayerAvatar
          headshotUrl={player.headshotUrl.value}
          displayName={player.name}
          teamAbbr={player.team.value}
          position={player.position.value}
          size={42}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="afp-player-name">{player.name}</div>
          <div className="afp-player-meta">
            {[player.position.value, player.team.value ?? 'Free agent']
              .filter(Boolean)
              .join(' · ')}
            {player.age ? ` · ${player.age}yo` : ''}
          </div>
        </div>
        {injury && (
          <span className="afp-tag afp-tag-critical" title={injury.description ?? undefined}>
            {injury.status}
          </span>
        )}
      </div>

      <div className="afp-metrics">
        <MetricSlot
          label="Market value"
          availability={player.market.availability}
          value={market ? formatMarketValue(market.value) : null}
        />
        <MetricSlot
          label="Pos rank"
          availability={getMetricAvailability(player.sport, 'positionRank')}
          value={market ? `${player.position.value ?? ''}${market.positionRank}` : null}
        />
        <MetricSlot
          label="30d trend"
          availability={getMetricAvailability(player.sport, 'valueTrend30Day')}
          value={trend ? trend.text : null}
          tone={trend?.tone}
        />
      </div>

      {/*
        Weekly projection is the metric users most expect on a card like this, and it
        has no production source. It is shown as explicitly unavailable rather than
        omitted, so its absence is legible instead of looking like an oversight.
      */}
      <div className="afp-metrics">
        <MetricSlot
          label="Proj pts"
          availability={getMetricAvailability(player.sport, 'weeklyProjection')}
          value={null}
        />
        <MetricSlot
          label="Pts/game"
          availability={player.seasonStats.availability}
          value={
            player.seasonStats.value?.fantasyPointsPerGame != null
              ? player.seasonStats.value.fantasyPointsPerGame.toFixed(1)
              : null
          }
          hint={player.seasonStats.value ? player.seasonStats.value.season : undefined}
        />
        <MetricSlot
          label="Rostered"
          availability={getMetricAvailability(player.sport, 'ownershipPercent')}
          value={null}
        />
      </div>
    </button>
  )
}

function PlayerDetail({
  player,
  league,
  onClose,
}: {
  player: PlayerIntelligenceRecord
  league: LeagueOption | null
  onClose: () => void
}) {
  const market = player.market.value
  const stats = player.seasonStats.value
  const injury = player.injuryStatus.value

  return (
    <div className="afp-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <PlayerAvatar
          headshotUrl={player.headshotUrl.value}
          displayName={player.name}
          teamAbbr={player.team.value}
          position={player.position.value}
          size={56}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 18, marginBottom: 3 }}>{player.name}</h2>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {[player.position.value, player.team.value ?? 'Free agent', player.jerseyNumber ? `#${player.jerseyNumber}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <button
          type="button"
          className="afp-btn"
          style={{ minHeight: 30, padding: '0 8px' }}
          onClick={onClose}
          aria-label="Close player detail"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <FreshnessLine player={player} />

      {injury && (
        <div className="afp-notice" style={{ marginTop: 12 }}>
          <AlertCircle size={15} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
          <div>
            <strong>{injury.status}</strong>
            {injury.description ? ` — ${injury.description}` : ''}
            <div style={{ color: 'var(--color-neutral-600)', marginTop: 2, fontSize: 11.5 }}>
              Reported by {injury.source}
              {injury.reportedAt ? ` · ${new Date(injury.reportedAt).toLocaleDateString()}` : ''}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div className="afp-kicker" style={{ marginBottom: 8 }}>
          {league ? `Value in ${league.name}` : 'Market value'}
        </div>

        {market ? (
          <>
            <DetailRow label="Market value" value={formatMarketValue(market.value)} />
            <DetailRow label="Overall rank" value={`#${market.overallRank}`} />
            <DetailRow
              label="Position rank"
              value={`${player.position.value ?? ''}${market.positionRank}`}
            />
            <DetailRow label="30-day trend" value={formatTrend(market.trend30Day).text} />
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--color-neutral-600)',
                marginTop: 10,
                lineHeight: 1.45,
              }}
            >
              {market.leagueSpecific
                ? 'Valued under this league’s real scoring and roster settings.'
                : 'Generic settings — pick a league above for a value that reflects your scoring.'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {player.market.availability.reason ?? 'No market value available for this player.'}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="afp-kicker" style={{ marginBottom: 8 }}>
          Production
        </div>
        {stats ? (
          <>
            <DetailRow label={`${stats.season} fantasy points`} value={stats.fantasyPoints?.toFixed(1) ?? '—'} />
            <DetailRow label="Per game" value={stats.fantasyPointsPerGame?.toFixed(1) ?? '—'} />
            <DetailRow label="Games played" value={stats.gamesPlayed != null ? String(stats.gamesPlayed) : '—'} />
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {player.seasonStats.availability.reason ?? 'No season statistics for this player.'}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/*
          Links into the existing player surfaces rather than reimplementing them.
          `/player/[playerId]` is the established deep profile (game log, news,
          outlook, depth chart) and already handles its own data gaps.
        */}
        <Link
          href={`/player/${encodeURIComponent(player.sleeperId ?? player.sportsPlayerId)}`}
          className="afp-btn afp-btn-primary"
        >
          Full profile
          <ExternalLink size={13} aria-hidden="true" />
        </Link>
        <Link href="/my-players" className="afp-btn">
          My players
        </Link>
      </div>
    </div>
  )
}

function FreshnessLine({ player }: { player: PlayerIntelligenceRecord }) {
  const { level, label, detail } = player.freshness
  return (
    <div className="afp-freshness" title={detail}>
      <span className={`afp-dot afp-dot-${level}`} aria-hidden="true" />
      <span>
        {label}
        <span style={{ color: 'var(--color-neutral-600)' }}> · {detail}</span>
      </span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="afp-detail-row">
      <span className="afp-detail-label">{label}</span>
      <span className="afp-detail-value">{value}</span>
    </div>
  )
}

function EmptyResults({ query, sport }: { query: string; sport: SupportedSport }) {
  const searching = query.length >= 2
  return (
    <div className="afp-card afp-empty">
      {searching ? (
        <>
          <div style={{ marginBottom: 6 }}>
            No {SPORT_LABELS[sport] ?? sport} player matches “{query}”.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
            Check the spelling, or try another sport — player coverage differs by sport.
          </div>
        </>
      ) : (
        <div>No players available for {SPORT_LABELS[sport] ?? sport} right now.</div>
      )}
    </div>
  )
}

function ResultSkeleton() {
  return (
    <div className="afp-grid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="afp-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
            <div className="afp-skeleton" style={{ width: 42, height: 42, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div className="afp-skeleton" style={{ height: 13, width: '60%', marginBottom: 6 }} />
              <div className="afp-skeleton" style={{ height: 10, width: '40%' }} />
            </div>
          </div>
          <div className="afp-metrics">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="afp-skeleton" style={{ height: 46 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

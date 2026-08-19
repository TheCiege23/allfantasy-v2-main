'use client'

/**
 * Dynasty Planet player search — real search-as-you-type
 * (`/api/players/search`), real season box-score totals (new
 * `/api/players/season-stats`, reading `player_season_stats` the same way
 * `PlayerStatsResolver.ts` already does for Trade/Draft tools), real
 * headshot (`getPlayerImage`) and team logo (`teamLogoUrl`), and real
 * cross-league exposure via `/api/player-portfolio?search=` (the Cross-
 * League Player Intelligence service) — grouped by platform against the
 * user's own real league list. A player absent from every league shows an
 * honest 0% exposure, never omitted or faked.
 */

import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { teamLogoUrl } from '@/lib/media-url'
import styles from './universal-dashboard.module.css'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

type SearchResult = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  sleeperId: string | null
  age: number | null
  number: number | null
  college: string | null
}

type SeasonStats = {
  season: string
  position: string | null
  team: string | null
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  receptions: number | null
  targets: number | null
  receivingYards: number | null
  receivingTouchdowns: number | null
  rushingYards: number | null
  rushingTouchdowns: number | null
  passingYards: number | null
  passingTouchdowns: number | null
  interceptions: number | null
}

type PortfolioAppearance = { provider: string; teamName: string; canonicalLeagueId: string }
type PortfolioItem = { displayName: string; leagueAppearances: PortfolioAppearance[]; exposure: { leagueCount: number; percentageOfUserLeagues: number } }

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  allfantasy: 'AllFantasy',
  af: 'AllFantasy',
  manual: 'AllFantasy',
  native: 'AllFantasy',
}

function statGridForPosition(s: SeasonStats): { label: string; value: string }[] {
  const pos = (s.position || '').toUpperCase()
  const ppg = s.fantasyPointsPerGame != null ? s.fantasyPointsPerGame.toFixed(1) : '—'
  if (pos === 'QB') {
    return [
      { label: 'Pass Yds', value: s.passingYards?.toLocaleString() ?? '—' },
      { label: 'Pass TD', value: String(s.passingTouchdowns ?? '—') },
      { label: 'INT', value: String(s.interceptions ?? '—') },
      { label: 'Rush Yds', value: s.rushingYards?.toLocaleString() ?? '—' },
      { label: 'PPG', value: ppg },
    ]
  }
  if (pos === 'RB') {
    return [
      { label: 'Rush Yds', value: s.rushingYards?.toLocaleString() ?? '—' },
      { label: 'Rush TD', value: String(s.rushingTouchdowns ?? '—') },
      { label: 'Rec', value: String(s.receptions ?? '—') },
      { label: 'Rec Yds', value: s.receivingYards?.toLocaleString() ?? '—' },
      { label: 'PPG', value: ppg },
    ]
  }
  return [
    { label: 'Rec', value: String(s.receptions ?? '—') },
    { label: 'Yds', value: s.receivingYards?.toLocaleString() ?? '—' },
    { label: 'TD', value: String(s.receivingTouchdowns ?? '—') },
    { label: 'Tgt', value: String(s.targets ?? '—') },
    { label: 'PPG', value: ppg },
  ]
}

export function DynastyPlanetSearch({ leagues }: { leagues: BoardLeague[] }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [seasons, setSeasons] = useState<SeasonStats[]>([])
  const [seasonIdx, setSeasonIdx] = useState(0)
  const [portfolioItem, setPortfolioItem] = useState<PortfolioItem | null>(null)
  const [connectedLeagueCount, setConnectedLeagueCount] = useState(0)
  const [loadingResult, setLoadingResult] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`/api/players/search?q=${encodeURIComponent(query.trim())}&sport=NFL&limit=8`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((results: SearchResult[]) => {
          if (!cancelled) setSuggestions(Array.isArray(results) ? results : [])
        })
        .catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const platformTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of leagues) {
      const key = String(l.platform ?? '').toLowerCase()
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [leagues])

  async function selectPlayer(player: SearchResult) {
    setSelected(player)
    setQuery(player.name)
    setShowSuggestions(false)
    setLoadingResult(true)
    setSeasons([])
    setSeasonIdx(0)
    setPortfolioItem(null)
    try {
      const [statsRes, portfolioRes] = await Promise.all([
        fetch(`/api/players/season-stats?name=${encodeURIComponent(player.name)}&sport=NFL`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/player-portfolio?search=${encodeURIComponent(player.name)}&sport=NFL`, { cache: 'no-store', credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      ])
      if (statsRes?.seasons) setSeasons(statsRes.seasons)
      if (portfolioRes) {
        setConnectedLeagueCount(portfolioRes.connectedLeagueCount ?? 0)
        const match = (portfolioRes.items as PortfolioItem[] | undefined)?.find((i) => i.displayName.toLowerCase() === player.name.toLowerCase())
        setPortfolioItem(match ?? null)
      }
    } finally {
      setLoadingResult(false)
    }
  }

  const season = seasons[seasonIdx] ?? null
  const headshot = selected ? getPlayerImage({ id: selected.sleeperId ?? selected.id, name: selected.name, imageUrl: selected.imageUrl }, 'nfl') : null
  const logo = selected?.team ? teamLogoUrl(selected.team, 'nfl') : null

  const exposureByPlatform = useMemo(() => {
    // Always show every platform the user actually has, even when this specific
    // player isn't rostered anywhere (0 of N is real information, not a reason
    // to hide the breakdown) -- selected != null gates this, not portfolioItem.
    if (!selected) return []
    const byPlatform = new Map<string, PortfolioAppearance[]>()
    for (const a of portfolioItem?.leagueAppearances ?? []) {
      const key = String(a.provider ?? '').toLowerCase()
      const arr = byPlatform.get(key)
      if (arr) arr.push(a)
      else byPlatform.set(key, [a])
    }
    return Array.from(platformTotals.entries()).map(([platform, total]) => {
      const rostered = byPlatform.get(platform) ?? []
      return { platform, total, rostered: rostered.length, appearances: rostered }
    })
  }, [selected, portfolioItem, platformTotals])

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <h2>🪐 Dynasty Planet · Player Search</h2>
          <span className={styles.betaTag}>Beta</span>
        </div>
      </div>
      <div className={styles.dpCard}>
        <div className={styles.dpSuggestions}>
          <div className={styles.dpSearch}>
            <span aria-hidden>🔍</span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search any NFL player…"
            />
            <button type="button" className={styles.dpGo} onClick={() => suggestions[0] && selectPlayer(suggestions[0])}>
              Search
            </button>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className={styles.dpSuggestList}>
              {suggestions.map((p) => (
                <button key={p.id} type="button" className={styles.dpSuggestItem} onClick={() => selectPlayer(p)}>
                  {p.name} <span style={{ color: 'var(--faint)' }}>{p.position ? `· ${p.position}` : ''}{p.team ? ` · ${p.team}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {loadingResult && <p style={{ marginTop: 14, fontSize: 12, color: 'var(--faint)' }}>Loading…</p>}

        {selected && !loadingResult && (
          <div className={styles.dpResult}>
            <div>
              <div className={styles.dpHero}>
                <div className={styles.dpShot}>
                  {headshot ? <img src={headshot} alt="" /> : selected.name.slice(0, 2).toUpperCase()}
                  {logo && (
                    <div className={styles.dpTeamLogo}>
                      <img src={logo} alt="" />
                    </div>
                  )}
                </div>
                <div>
                  <div className={styles.dpName}>{selected.name}</div>
                  <div className={styles.dpMeta}>
                    {[selected.position, selected.team, selected.age ? `Age ${selected.age}` : null, selected.number ? `#${selected.number}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>

              {seasons.length > 0 ? (
                <>
                  <select className={styles.dpSeason} value={seasonIdx} onChange={(e) => setSeasonIdx(Number(e.target.value))}>
                    {seasons.map((s, i) => (
                      <option key={s.season} value={i}>
                        {s.season} Season
                      </option>
                    ))}
                  </select>
                  {season && (
                    <div className={styles.dpStatGrid}>
                      {statGridForPosition(season).map((stat) => (
                        <div key={stat.label} className={styles.dpStat}>
                          <div className={styles.dpStatLabel}>{stat.label}</div>
                          <div className={styles.dpStatVal}>{stat.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ marginTop: 12, fontSize: 11.5, color: 'var(--faint)' }}>No season stats on file for this player yet.</p>
              )}
            </div>

            <div className={styles.dpExposure}>
              <div className={styles.dpExposureHead}>
                Your exposure ·{' '}
                <b>
                  {portfolioItem?.exposure.leagueCount ?? 0} of {connectedLeagueCount} leagues (
                  {connectedLeagueCount > 0 ? Math.round(((portfolioItem?.exposure.leagueCount ?? 0) / connectedLeagueCount) * 100) : 0}%)
                </b>
              </div>
              {exposureByPlatform.map((row) => (
                <div key={row.platform} className={styles.platExp}>
                  <div className={styles.platExpRow}>
                    <span>{PLATFORM_LABELS[row.platform] ?? row.platform}</span>
                    <span>
                      {row.rostered} / {row.total} · {row.total > 0 ? Math.round((row.rostered / row.total) * 100) : 0}%
                    </span>
                  </div>
                  <div className={styles.expBar}>
                    <span className={styles.expBarFill} style={{ width: `${row.total > 0 ? (row.rostered / row.total) * 100 : 0}%` }} />
                  </div>
                  <div className={styles.expLeagues}>
                    {row.appearances.map((a) => (
                      <span key={a.canonicalLeagueId} className={styles.expLeagueChip}>
                        {a.teamName}
                      </span>
                    ))}
                    {row.rostered === 0 && (
                      <span className={`${styles.expLeagueChip} ${styles.expLeagueChipNone}`}>Not rostered in any {PLATFORM_LABELS[row.platform] ?? row.platform} league</span>
                    )}
                  </div>
                </div>
              ))}
              {exposureByPlatform.length === 0 && (
                <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}>Connect leagues to see cross-league exposure.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

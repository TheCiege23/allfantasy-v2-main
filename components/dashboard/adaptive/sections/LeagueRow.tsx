'use client'

/**
 * Row 2 — My Leagues · Matchup Preview · Power Rankings.
 *
 * Desktop 3-up; tablet and mobile stack to a single column (design).
 *
 * Data honesty notes, because two of these look like they should have more than they do:
 *  - League rows carry NO win/loss record and NO standing. `getDashboardLeagueListForUser`
 *    never selects those columns for any of its four row shapes, so the design's
 *    "9-4 · 2nd place" meta line is rendered from the fields that DO exist (size, scoring,
 *    season) and the record is sourced separately, per-league, only where we really have it.
 *  - `/api/dashboard/live-scores` only covers native in-season leagues, so a Sleeper-only
 *    account legitimately gets an empty matchup card. That's stated in the card, not hidden.
 */

import Link from 'next/link'
import type { DeviceKind } from '../hooks/useDeviceKind'
import type { LeagueAnalytics } from '../hooks/useLeagueAnalytics'
import { NoMetric } from '../ui/Gating'

export type DashboardLeague = {
  id: string
  name: string
  platform: string
  sport: string | null
  teamCount: number | null
  scoring: string | null
  format: string | null
  season: number | null
  isCommissioner: boolean
  /** Only unified leagues resolve on /league/[id]; legacy board rows 404 there. */
  unified: boolean
  /**
   * The PROVIDER's league id (Sleeper). Distinct from `id`, which is AllFantasy's internal
   * id — `app/api/rankings/*` is legacy id-space and looks leagues up by this, so the two
   * are not interchangeable. Null for native leagues with no provider behind them.
   */
  platformLeagueId: string | null
  accent: string
}

export type LiveScore = {
  leagueId: string
  leagueName: string
  week: number | null
  myPts: number | null
  oppPts: number | null
  oppTeamName: string | null
  myRecord: { wins: number; losses: number; ties: number } | null
  myRank: number | null
  totalTeams: number | null
  matchupStatus: string | null
}

export function LeagueRow({
  device, leagues, totalLeagueCount, liveScore, liveScoresEmpty, analytics, selectedLeagueId,
}: {
  device: DeviceKind
  leagues: DashboardLeague[]
  totalLeagueCount: number
  liveScore: LiveScore | null
  /** True when live-scores returned successfully but covers none of this user's leagues. */
  liveScoresEmpty: boolean
  analytics: LeagueAnalytics | null
  selectedLeagueId: string | null
}) {
  const columns = device === 'desktop' ? 'repeat(3,1fr)' : '1fr'

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: columns, marginBottom: 22 }}>
      {/* ── My Leagues ───────────────────────────────────────────────────── */}
      <div className="af-card">
        <CardHead label="My Leagues" action={{ label: `View All (${totalLeagueCount})`, href: '/leagues' }} />
        {leagues.length === 0 ? (
          <NoMetric
            reason="No leagues yet. Import one to fill in your dashboard."
            action={{ label: 'Import a league', href: '/import' }}
          />
        ) : (
          leagues.slice(0, 4).map((l) => (
            <LeagueLine key={l.id} league={l} isSelected={l.id === selectedLeagueId} />
          ))
        )}
      </div>

      {/* ── Matchup Preview ──────────────────────────────────────────────── */}
      <div className="af-card">
        <CardHead
          label="Matchup Preview"
          meta={liveScore?.week != null ? `Week ${liveScore.week}` : undefined}
        />
        {liveScore ? (
          <MatchupBody score={liveScore} />
        ) : (
          <NoMetric
            reason={
              liveScoresEmpty
                ? 'Live matchups cover in-season AllFantasy leagues. Your imported leagues don’t report live scores.'
                : 'No live matchup right now.'
            }
            action={selectedLeagueId ? { label: 'Open league', href: `/league/${selectedLeagueId}/matchups` } : undefined}
          />
        )}
      </div>

      {/* ── Power Rankings ───────────────────────────────────────────────── */}
      <div className="af-card">
        <CardHead label="Power Rankings" action={{ label: 'View All', href: '/power-rankings' }} />
        {analytics && analytics.powerRankings.length > 0 ? (
          <>
            {analytics.powerRankings.map((t) => (
              <div key={`${t.rank}-${t.name}`} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '7px 2px 7px 8px',
                background: t.isMe ? 'var(--af-surface-2)' : undefined,
                borderRadius: t.isMe ? 8 : undefined, marginBottom: 3,
              }}>
                <div className="af-stat" style={{ fontSize: 16, width: 16, color: t.isMe ? 'var(--af-cyan)' : 'var(--af-text-dim)' }}>
                  {t.rank}
                </div>
                <div style={{
                  flex: 1, fontSize: 12, fontWeight: 600, minWidth: 0,
                  color: t.isMe ? '#fff' : 'rgba(255,255,255,.8)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--af-text-dim)' }}>{t.record}</div>
                <TrendArrow delta={t.delta} />
              </div>
            ))}
            <Link href="/power-rankings" className="af-btn af-btn-ghost"
              style={{ display: 'block', textAlign: 'center', padding: 9, marginTop: 6, fontSize: 12, borderRadius: 8 }}>
              View Full Rankings
            </Link>
          </>
        ) : (
          <NoMetric
            reason={
              selectedLeagueId
                ? 'No power rankings for this league yet — they need synced weekly results.'
                : 'Select a league to see its power rankings.'
            }
          />
        )}
      </div>
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────────
function CardHead({
  label, action, meta,
}: {
  label: string
  action?: { label: string; href: string }
  meta?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
      <div className="af-card-label">{label}</div>
      {action && (
        <Link href={action.href} style={{ fontSize: 11, color: 'var(--af-cyan)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {action.label}
        </Link>
      )}
      {meta && <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)' }}>{meta}</div>}
    </div>
  )
}

function LeagueLine({ league, isSelected }: { league: DashboardLeague; isSelected: boolean }) {
  // Legacy board rows have no unified record, so /league/[id] 404s for them — link to the
  // leagues index instead of a page that can't exist.
  const href = league.unified ? `/league/${league.id}` : '/leagues'
  const meta = [
    league.teamCount ? `${league.teamCount}-Team` : null,
    league.scoring,
    league.format,
    league.season ? String(league.season) : null,
  ].filter(Boolean).join(' · ')

  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: 9, borderRadius: 9,
      marginBottom: 5, background: isSelected ? 'var(--af-surface-2)' : undefined,
    }}>
      <div style={{ width: 3, alignSelf: 'stretch', background: league.accent, borderRadius: 2 }} />
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: 'var(--af-surface-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0,
      }}>
        {sportEmoji(league.sport)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12.5, fontWeight: 700, color: '#fff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {league.name}
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)' }}>{meta || league.platform}</div>
      </div>
      {league.isCommissioner && (
        <span className="af-badge af-badge-violet" style={{ fontSize: 9 }}>COMM</span>
      )}
    </Link>
  )
}

function MatchupBody({ score }: { score: LiveScore }) {
  const mine = score.myPts ?? 0
  const opp = score.oppPts ?? 0
  const total = mine + opp
  // Share of points scored so far — a real ratio, explicitly NOT a win probability (no
  // win-probability model runs on dashboard load).
  const sharePct = total > 0 ? Math.round((mine / total) * 100) : 50

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <TeamBadge name="You" emoji="🏈" />
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--af-text-faint)' }}>VS</div>
        <TeamBadge name={score.oppTeamName ?? 'Opponent'} emoji="🛡️" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 4px' }}>
        <div>
          <div className="af-stat" style={{ fontSize: 26 }}>{mine.toFixed(1)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--af-text-faint)', textTransform: 'uppercase' }}>You</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="af-stat" style={{ fontSize: 26 }}>{opp.toFixed(1)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--af-text-faint)', textTransform: 'uppercase' }}>Opp</div>
        </div>
      </div>
      <div style={{ height: 7, borderRadius: 4, overflow: 'hidden', display: 'flex', background: 'var(--af-surface-2)', marginBottom: 4 }}>
        <div style={{ width: `${sharePct}%`, background: 'linear-gradient(90deg,var(--af-emerald),var(--af-cyan))' }} />
        <div style={{ width: `${100 - sharePct}%`, background: '#3a2f52' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--af-text-faint)', marginBottom: 10 }}>
        <span>{sharePct}%</span>
        <span>Points share{score.matchupStatus ? ` · ${score.matchupStatus}` : ''}</span>
        <span>{100 - sharePct}%</span>
      </div>
      <Link href={`/league/${score.leagueId}/matchups`} className="af-btn af-btn-primary"
        style={{ display: 'block', textAlign: 'center', padding: 9, fontSize: 12, borderRadius: 8 }}>
        View Full Matchup
      </Link>
    </>
  )
}

function TeamBadge({ name, emoji }: { name: string; emoji: string }) {
  return (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: 'var(--af-surface-3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, margin: '0 auto 6px',
      }}>
        {emoji}
      </div>
      <div style={{
        fontSize: 11.5, fontWeight: 700, color: '#fff',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </div>
    </div>
  )
}

function TrendArrow({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) {
    return <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 700, width: 22, textAlign: 'right' }}>–</div>
  }
  const up = delta > 0
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, width: 22, textAlign: 'right',
      color: up ? 'var(--af-emerald)' : 'var(--af-red)',
    }}>
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </div>
  )
}

const SPORT_EMOJI: Record<string, string> = {
  nfl: '🏈', ncaaf: '🎓', nba: '🏀', ncaab: '🏀', mlb: '⚾', nhl: '🏒', soccer: '⚽', golf: '⛳',
}
function sportEmoji(sport: string | null): string {
  return SPORT_EMOJI[(sport ?? '').toLowerCase()] ?? '🏈'
}

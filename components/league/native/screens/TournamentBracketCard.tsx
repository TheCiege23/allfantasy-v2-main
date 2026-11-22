'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { readConferenceSeasonPlan } from '@/lib/tournament/divisions/conferenceSeasonPlan'
import type { LeagueBracketEntry, LeagueBracketWeek } from '@/lib/tournament/divisions/leagueBracketWeek'
import { Card } from './NativeScreenParts'

/**
 * Tournament bracket card for a divisions conference league's matchup screen, in bracket weeks only.
 * Read-only and additive: the league's own round-robin matchup above it is unchanged. Data comes from
 * `GET /api/leagues/[id]/tournament-bracket` (Postgres, the same view the tournament hub renders).
 */
const seed = (n: number) => `#${n}`
const pts = (n: number | null) => (n == null ? '—' : n.toFixed(1))

function EntryLine({ e }: { e: LeagueBracketEntry }) {
  const result = e.result === 'won' ? 'Advanced' : e.result === 'lost' ? 'Out' : null
  return (
    <li data-mine={e.isMe || undefined}>
      <div className="nls-board-line" data-lead={e.result === 'won'}>
        <span>{seed(e.seedLine)} {e.name}{e.isMe ? ' (you)' : ''}</span>
        <span>{pts(e.score)}</span>
      </div>
      <div className="nls-board-line">
        <span className="nls-muted">vs {e.opponent ? `${seed(e.opponent.seedLine)} ${e.opponent.name}` : 'opponent to be decided'}</span>
        <span className="nls-muted">{result ?? pts(e.opponentScore)}</span>
      </div>
    </li>
  )
}

export function TournamentBracketCardView({ bracket }: { bracket: LeagueBracketWeek }) {
  const hub = `/tournament-hub/${encodeURIComponent(bracket.tournamentId)}`
  const meLine =
    bracket.me === 'out' ? 'You are out of the tournament bracket. Your league game still counts in this league.'
      : bracket.me === 'waiting' ? 'Your bracket opponent is set once the previous round is decided.'
        : bracket.me === 'playing' ? 'Your league score this week is your bracket score.'
          : null
  return (
    <Card label={`${bracket.tournamentName} · ${bracket.label}`} right={`Wk ${bracket.week}`} className="nls-tournament-bracket">
      {bracket.projected ? <p className="nls-muted">Projected pairings. The bracket is set when the commissioner commits seeding.</p> : null}
      {meLine ? <p style={{ marginBottom: 12 }}>{meLine}</p> : null}
      {bracket.entries.length ? (
        <ul className="nls-board" aria-label="This league’s bracket games">
          {bracket.entries.map((e) => <EntryLine key={e.teamId} e={e} />)}
        </ul>
      ) : (
        <p className="nls-muted">No one from this league is in a bracket game this week.</p>
      )}
      <Link href={hub} className="nls-btn" data-block="true" style={{ minHeight: 44, marginTop: 16 }}>Open the tournament bracket</Link>
    </Card>
  )
}

/** Fetches and shows the card when `week` is a bracket week of this league's tournament; nothing otherwise. */
export function TournamentBracketCard({ leagueId, settings, week }: { leagueId: string; settings: unknown; week: number }) {
  const plan = readConferenceSeasonPlan(settings)
  const bracketWeek = Boolean(plan?.bracketWeeks.includes(week))
  const [bracket, setBracket] = useState<LeagueBracketWeek | null>(null)

  useEffect(() => {
    setBracket(null)
    if (!bracketWeek) return
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/tournament-bracket?week=${week}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { bracket?: LeagueBracketWeek | null } | null) => { if (live) setBracket(j?.bracket ?? null) })
      .catch(() => undefined)
    return () => { live = false }
  }, [leagueId, week, bracketWeek])

  if (!bracketWeek || !bracket) return null
  return <TournamentBracketCardView bracket={bracket} />
}

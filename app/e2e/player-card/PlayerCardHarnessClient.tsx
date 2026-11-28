'use client'

import { useEffect, useState } from 'react'
import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import type { PlayerCardMore } from '@/lib/core-app/playerCardMore'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-player-card.css'
import { harnessGameLog } from '@/app/e2e/_shared/gameLogFixture'

const NO = (reason: string) => ({ available: false as const, reason })
const OK = <T,>(data: T) => ({ available: true as const, data })

type Fixture = {
  player: PlayerCardData['player']
  bio: PlayerCardData['bio']
  rank: number
  posRank: number
  perGame: number
  weekly: number | null
  rest: number | null
  owner: string
  news: Array<{ title: string; source: string }>
  more: PlayerCardMore
}

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

const FIXTURES: Record<string, Fixture> = {
  NFL: {
    player: { externalId: 'sleeper:4984', sleeperId: '4984', sport: 'NFL', name: 'Josh Allen', position: 'QB', team: 'BUF', number: 17, imageUrl: 'https://sleepercdn.com/content/nfl/players/4984.jpg' },
    bio: { age: 30, height: '6\'5"', weight: '237 lb', yearsExp: 8, college: 'Wyoming' },
    rank: 5, posRank: 2, perGame: 24.6, weekly: 25.8, rest: 147.6, owner: 'TheCiege24',
    news: [
      { title: 'Josh Allen throws for 304 yards Sunday', source: 'Rotowire' },
      { title: 'Allen limited in practice with a sore foot', source: 'ESPN' },
    ],
    more: {
      gameLog: [
        { season: 2026, week: 12, date: day(4), opponent: 'MIA', points: 21.6 },
        { season: 2026, week: 11, date: day(11), opponent: 'KC', points: 31.2 },
        { season: 2026, week: 10, date: day(18), opponent: 'NE', points: 25.3 },
        { season: 2026, week: 9, date: day(25), opponent: 'LAR', points: 39.7 },
      ],
      career: [
        { season: '2025', team: 'BUF', games: 17, points: 385.2, perGame: 22.7 },
        { season: '2024', team: 'BUF', games: 17, points: 379.4, perGame: 22.3 },
        { season: '2023', team: 'BUF', games: 17, points: 392.6, perGame: 23.1 },
      ],
      depthChart: { position: 'QB', rows: [{ name: 'Josh Allen', rank: 1, isSubject: true }, { name: 'Mitchell Trubisky', rank: 2, isSubject: false }] },
    },
  },
  NBA: {
    player: { externalId: 'ri:4396907', source: 'rolling_insights', sleeperId: null, sport: 'NBA', name: 'Darius Garland', position: 'PG', team: 'LAC', number: 10, imageUrl: 'https://a.espncdn.com/i/headshots/nba/players/full/4396907.png' },
    bio: { age: 26, height: '6\'1"', weight: '192 lb', yearsExp: 7, college: 'Vanderbilt' },
    rank: 95, posRank: 32, perGame: 18.8, weekly: 56.4, rest: 1090.4, owner: 'TheCiege24',
    news: [
      { title: 'Darius Garland scores 27 as Clippers run win streak to 17', source: 'ESPN' },
      { title: 'Clippers beat Pelicans to end 7-game losing streak', source: 'ESPN' },
    ],
    more: {
      gameLog: [
        { season: 2026, week: 0, date: day(1), opponent: 'NOP', points: 34.5 },
        { season: 2026, week: 0, date: day(3), opponent: 'GSW', points: 22.0 },
        { season: 2026, week: 0, date: day(5), opponent: 'PHX', points: 41.2 },
      ],
      career: [
        { season: '2025', team: 'CLE', games: 75, points: 2280.0, perGame: 30.4 },
        { season: '2024', team: 'CLE', games: 57, points: 1630.2, perGame: 28.6 },
      ],
      depthChart: null,
    },
  },
  MLB: {
    player: { externalId: 'ri:33192', source: 'rolling_insights', sleeperId: null, sport: 'MLB', name: 'Aaron Judge', position: 'OF', team: 'NYY', number: 99, imageUrl: 'https://a.espncdn.com/i/headshots/mlb/players/full/33192.png' },
    bio: { age: 34, height: '6\'7"', weight: '282 lb', yearsExp: 10, college: 'Fresno State' },
    rank: 3, posRank: 1, perGame: 4.1, weekly: null, rest: null, owner: 'TheCiege24',
    news: [{ title: 'Judge named AL MVP for a third time', source: 'MLB.com' }],
    more: {
      gameLog: [],
      career: [
        { season: '2026', team: 'NYY', games: 152, points: 612.0, perGame: 4.0 },
        { season: '2025', team: 'NYY', games: 158, points: 655.4, perGame: 4.1 },
      ],
      depthChart: null,
    },
  },
  // The daily sports' per-game box log (2026-11-28) shows on every one of these through the fetch stub below.
  NHL: {
    player: { externalId: 'ri:3895074', source: 'rolling_insights', sleeperId: null, sport: 'NHL', name: 'Connor McDavid', position: 'C', team: 'EDM', number: 97, imageUrl: null },
    bio: { age: 29, height: '6\'1"', weight: '194 lb', yearsExp: 11, college: null },
    rank: 1, posRank: 1, perGame: 4.4, weekly: 13.2, rest: 260.0, owner: 'TheCiege24',
    news: [{ title: 'McDavid extends point streak to 12 games', source: 'NHL.com' }],
    more: { gameLog: [], career: [], depthChart: null },
  },
  NCAAB: {
    player: { externalId: 'ri:201', source: 'rolling_insights', sleeperId: null, sport: 'NCAAB', name: 'Cooper Flagg', position: 'F', team: 'DUKE', number: 2, imageUrl: null },
    bio: { age: 19, height: '6\'9"', weight: '205 lb', yearsExp: 1, college: 'Duke' },
    rank: 4, posRank: 2, perGame: 31.2, weekly: 62.4, rest: 640.0, owner: 'TheCiege24',
    news: [{ title: 'Flagg posts double-double in ACC opener', source: 'ESPN' }],
    more: { gameLog: [], career: [], depthChart: null },
  },
}

/**
 * Answers the card's own reads with no database: the box-score game log (sample rows, real columns)
 * and the table-layout preference as signed out (401 → this browser's storage). Everything else
 * goes to the real fetch, which the card already treats as optional.
 */
function installHarnessFetch(sport: string) {
  const w = window as unknown as { __pcHarnessSport?: string; __pcHarnessFetch?: boolean; fetch: typeof fetch }
  w.__pcHarnessSport = sport
  if (w.__pcHarnessFetch) return
  w.__pcHarnessFetch = true
  const real = w.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/api/players/game-log')) return json(harnessGameLog(w.__pcHarnessSport ?? sport))
    if (url.startsWith('/api/user/table-layout')) return json({ error: 'Unauthorized' }, 401)
    return real(input, init)
  }
}

function cardFor(sport: string, who: 'mine' | 'fa' | 'theirs'): { data: PlayerCardData; more: PlayerCardMore } {
  const f = FIXTURES[sport] ?? FIXTURES.NFL!
  const rosterId = f.player.sleeperId ?? f.player.externalId
  const data = {
    context: 'league',
    player: f.player,
    bio: f.bio,
    market: NO('none'),
    ownership: OK({ ownPct: 0.99, startPct: 0.95, rosteredIn: 99, startedIn: 95, leaguesCounted: 100 }),
    schedule: NO('none'),
    byeWeek: null,
    trades: NO('none'),
    comps: NO('none'),
    news: OK(f.news.map((n, i) => ({ ...n, url: null, publishedAt: new Date(Date.now() - (i + 1) * 7_200_000).toISOString() }))),
    injury: NO('none'),
    injuryFeed: NO('none'),
    insight: null,
    afLeagueProjection: { rank: f.rank, positionRank: f.posRank, perGame: f.perGame, weekly: f.weekly, fullSeason: null, restOfSeason: f.rest, tradeValue: null, unit: 'fantasy points' },
    follow: { following: false },
    league: {
      leagueId: 'e2e-league',
      leagueName: `The Ciege ${sport} Redraft`,
      platform: 'allfantasy',
      slot: who === 'fa' ? 'NOT ROSTERED' : 'STARTER',
      isYours: who === 'mine',
      ...(who === 'fa' ? {} : { rosterPlayerId: rosterId }),
      owner: who === 'fa' ? null : { teamName: who === 'mine' ? 'Ciege' : 'Gridiron Gang', ownerName: who === 'mine' ? f.owner : 'KBI_Smoke' },
      price: NO('none'),
      yourRoster: [],
      trades: [],
      playoffSchedule: NO('none'),
      watched: false,
      tradeBlock: { supported: false, note: '', listed: false, byYou: false, teamName: null, since: null },
    },
  } as unknown as PlayerCardData
  return { data, more: f.more }
}

export default function PlayerCardHarnessClient({ sport, who, confirm }: { sport: string; who: 'mine' | 'fa' | 'theirs'; confirm: boolean }) {
  const { data, more } = cardFor(sport, who)
  if (typeof window !== 'undefined') installHarnessFetch(sport)
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => (document.querySelector('[data-testid="player-card-drop"]') as HTMLButtonElement | null)?.click(), 300)
    return () => clearTimeout(t)
  }, [confirm])
  return (
    <div className="af-core" style={{ minHeight: '100vh' }}>
      {open ? (
        <PlayerCardSheet
          subject={{ sport, sleeperId: data.player.sleeperId, externalId: data.player.externalId, name: data.player.name, position: data.player.position }}
          data={data}
          more={more}
          status="ready"
          onClose={() => setOpen(false)}
          onOpen={() => {}}
        />
      ) : null}
    </div>
  )
}

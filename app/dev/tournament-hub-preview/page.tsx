/**
 * Dev-only preview of the tournament commissioner hub.
 *
 * 🛑 THE HUB CANNOT OTHERWISE BE LOOKED AT. `/tournament-hub/[id]` needs a
 * signed-in commissioner AND a `TournamentShell` with conferences, leagues,
 * participants and matched team rows — and this checkout's `.env.local` points
 * at the PRODUCTION database (`ep-curly-block-…`), where the hub's own buttons
 * would advance a real tournament and end real seasons. So the screen shipped
 * having never been rendered.
 *
 * This mounts the board with synthetic rows so the layout, the standing chips,
 * the bubble split and every panel can be seen without touching a database.
 *
 * ⚠ THE FIXTURE IS INVENTED AND SAYS SO ON SCREEN. It exists to exercise the
 * layout, not to demonstrate data the product has.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it. Same
 * guard as /dev/leagues-preview and /dev/states-preview.
 */
import { notFound } from 'next/navigation'
import { TournamentStandingsBoard } from '@/app/tournament-hub/[tournamentId]/TournamentStandingsBoard'
import type { BoardRow, StandingsBoard } from '@/lib/tournament/standingsBoard'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tournament hub preview (dev)',
  robots: { index: false, follow: false },
}

const FIRST_NAMES = [
  'TyT1', 'emmae', 'Dallasjones44', 'A1Saucy', 'Spokee', 'zedlav', 'Targaryen', 'dyap',
  'KingGingerBeard', 'flsIII', 'DanielAgami', 'Lightning77',
]
const SECOND_NAMES = [
  'RICO3', 'KingGustov', 'r0bles', 'BKChosen306', 'Omega_Tron', 'Shihomachi',
  'KDubTheMagnificent', 'seany_bravo', 'GaryHubert', '123eman', 'Nikokmc', 'dross2448',
]

function row(name: string, i: number, offset: number): BoardRow {
  const wins = Math.max(0, 9 - Math.floor((i + offset) / 2))
  return {
    leagueParticipantId: `lp-${name}`,
    participantId: `p-${name}`,
    userId: `sleeper-${i + offset}`,
    displayName: name,
    wins,
    losses: 9 - wins,
    ties: 0,
    pointsFor: 1400 - (i + offset) * 17.37,
    pointsAgainst: 1200,
    appUserId: i === 0 ? 'af-commissioner' : null,
    leagueRank: i + 1,
    conferenceRank: 0,
    unmatched: false,
    matchedBy: i === 1 ? 'ownerName' : 'platformUserId',
    standing: 'out',
  }
}

/* One unmatched manager, because that state changes half the screen. */
function unmatchedRow(name: string): BoardRow {
  return {
    ...row(name, 11, 0),
    unmatched: true,
    matchedBy: null,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    standing: 'out',
  }
}

function buildBoard(): StandingsBoard {
  const beast = FIRST_NAMES.map((n, i) => row(n, i, 0))
  const goat = SECOND_NAMES.slice(0, 11).map((n, i) => row(n, i, 3))
  goat.push(unmatchedRow('CaptainCanucks'))

  /* Ranked across the conference, then split by the real rule: the bottom of the
     cut defends, and the top scorers below it attack. */
  const all = [...beast, ...goat].filter((r) => !r.unmatched)
  all.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
  const CUT = 8
  const BUBBLE = 3
  all.forEach((r, i) => {
    r.conferenceRank = i + 1
  })
  all.slice(0, CUT - BUBBLE).forEach((r) => (r.standing = 'in'))
  all.slice(CUT - BUBBLE, CUT).forEach((r) => (r.standing = 'bubble'))
  const below = all.slice(CUT)
  ;[...below].sort((a, b) => b.pointsFor - a.pointsFor).slice(0, BUBBLE).forEach((r) => (r.standing = 'bubble'))
  below.filter((r) => r.standing !== 'bubble').forEach((r) => (r.standing = 'out'))

  return {
    tournamentId: 'preview',
    name: 'King Buffalo Invitational (preview)',
    roundNumber: 1,
    advancersPerLeague: 0,
    wildcardCount: CUT,
    bubbleEnabled: true,
    bubbleSize: BUBBLE,
    tiebreakerMode: 'points_for',
    unmatchedTotal: 1,
    oldestUpdatedAt: new Date(Date.now() - 1000 * 60 * 60 * 30),
    conferences: [
      {
        id: 'c-black',
        name: 'BLACK',
        colorHex: null,
        qualifyingCount: CUT,
        conferencePoints: beast.reduce((s, r) => s + r.pointsFor, 0),
        leagues: [
          {
            tournamentLeagueId: 'tl-beast',
            leagueId: 'lg-beast',
            name: 'BEAST',
            unmatchedCount: 0,
            unclaimedTeams: [],
            oldestUpdatedAt: null,
            rows: beast,
          },
          {
            tournamentLeagueId: 'tl-goat',
            leagueId: 'lg-goat',
            name: 'GOAT',
            unmatchedCount: 1,
            unclaimedTeams: [
              {
                externalId: '12',
                ownerName: 'Bosto23',
                teamName: 'Bosto23',
                wins: 3,
                losses: 6,
                ties: 0,
                pointsFor: 980,
              },
            ],
            oldestUpdatedAt: null,
            rows: goat,
          },
        ],
      },
      {
        id: 'c-gold',
        name: 'GOLD',
        colorHex: null,
        qualifyingCount: CUT,
        conferencePoints: 0,
        leagues: [],
      },
    ],
  }
}

export default function TournamentHubPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <>
      {/*
        ⚠ Stated on screen, not only in this file's header. Anyone who reaches
        this page should know within a second that none of it is real.
      */}
      <p
        style={{
          margin: 0,
          padding: '8px 16px',
          background: '#f59e0b',
          color: '#111',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        DEV PREVIEW — every name, record and point total below is invented to exercise the layout.
      </p>
      <TournamentStandingsBoard board={buildBoard()} />
    </>
  )
}

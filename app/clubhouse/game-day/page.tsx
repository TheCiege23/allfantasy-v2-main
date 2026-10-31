import type { Metadata } from 'next'
import Link from 'next/link'
import { CLUBHOUSE_NAME, GAME_DAY_CHANNEL, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { easternDate, easternDayLabel } from '@/lib/community/schedule'
import { getGameDaySlate, todayGameDayPostId, type SlateGame } from '@/lib/community/scheduled'
import { getCommunityViewer, listRepliesSince } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, loginHref } from '@/components/community/CommunityBits'
import { GameDayChat } from '@/components/community/GameDayChat'

export const dynamic = 'force-dynamic'

const channel = getChannel(GAME_DAY_CHANNEL)

export const metadata: Metadata = {
  title: `Game Day | ${CLUBHOUSE_NAME} | AllFantasy`,
  description: channel?.blurb,
}

const FINAL = /final|post|complete|closed|ended|ft\b/i
const LIVE = /live|in ?progress|in_progress|halftime|half|quarter|period|inning|\bq[1-4]\b|\bot\b/i

function phaseOf(g: SlateGame, now: number): 'final' | 'live' | 'upcoming' {
  const s = g.status ?? ''
  if (FINAL.test(s)) return 'final'
  if (LIVE.test(s)) return 'live'
  if (g.startTime && Date.parse(g.startTime) <= now && (g.homeScore !== null || g.awayScore !== null)) return 'live'
  return 'upcoming'
}

function startClock(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso)) + ' ET'
}

function Slate({ games, now }: { games: SlateGame[]; now: number }) {
  if (games.length === 0) {
    return (
      <p className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        No games on today&apos;s slate yet. The chat is open anyway.
      </p>
    )
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Today's games">
      {games.map((g) => {
        const phase = phaseOf(g, now)
        const scored = g.homeScore !== null && g.awayScore !== null
        return (
          <li key={g.key} className="mode-panel rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
              <span style={{ color: 'var(--muted)' }}>{g.sport}</span>
              <span
                style={{
                  color: phase === 'live' ? '#ef4444' : 'var(--muted)',
                }}
              >
                {phase === 'live' ? `● ${g.status || 'Live'}` : phase === 'final' ? 'Final' : startClock(g.startTime)}
              </span>
            </div>
            {[
              [g.awayTeam, g.awayScore],
              [g.homeTeam, g.homeScore],
            ].map(([team, score]) => (
              <div key={String(team)} className="flex justify-between gap-2" style={{ color: 'var(--text)' }}>
                <span className="truncate">{team}</span>
                {scored && phase !== 'upcoming' && <span className="font-semibold tabular-nums">{score}</span>}
              </div>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

export default async function GameDayPage() {
  const viewer = await getCommunityViewer()
  const now = new Date()
  const [postId, games] = await Promise.all([todayGameDayPostId(now), getGameDaySlate(now).catch(() => [])])
  const initial = postId ? await listRepliesSince(viewer, postId, null) : []
  const here = '/clubhouse/game-day'

  return (
    <ClubhouseFrame crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            {channel?.emoji} Game Day
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {easternDayLabel(easternDate(now))}. {channel?.blurb}
          </p>
        </div>
        <Link href="/live" className="text-sm font-semibold underline" style={{ color: 'var(--accent)' }}>
          Full live scoreboard →
        </Link>
      </header>

      <div className="mb-5">
        <Slate games={games} now={now.getTime()} />
      </div>

      {postId ? (
        <>
          <GameDayChat postId={postId} initial={initial} signedIn={Boolean(viewer.userId)} loginHref={loginHref(here)} />
          <p className="mt-3 text-center text-xs">
            <Link href={clubhousePostHref(postId)} className="underline" style={{ color: 'var(--muted)' }}>
              Open as a thread (reactions, reports, full history)
            </Link>
          </p>
        </>
      ) : (
        <EmptyState title="Today's room isn't open yet" body="Check back in a few minutes." />
      )}
    </ClubhouseFrame>
  )
}

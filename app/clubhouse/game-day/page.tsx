import type { Metadata } from 'next'
import Link from 'next/link'
import { CLUBHOUSE_NAME, GAME_DAY_CHANNEL, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { easternDate, easternDayLabel } from '@/lib/community/schedule'
import { getGameDaySlate, slatePhase, todayGameDayPostId, type SlateGame } from '@/lib/community/scheduled'
import { getCommunityViewer, listRepliesSince } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, GhostButtonLink, PageHeader, loginHref } from '@/components/community/CommunityBits'
import { GameDayChat } from '@/components/community/GameDayChat'

export const dynamic = 'force-dynamic'

const channel = getChannel(GAME_DAY_CHANNEL)

export const metadata: Metadata = {
  title: `Game Day | ${CLUBHOUSE_NAME} | AllFantasy`,
  description: channel?.blurb,
}

function startClock(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso)) + ' ET'
}

function Scoreboard({ games, now }: { games: SlateGame[]; now: number }) {
  if (games.length === 0) {
    return (
      <p className="ch-rail-card text-sm" style={{ color: 'var(--muted)' }}>
        No games on today&apos;s slate yet. The chat is open anyway.
      </p>
    )
  }
  // Live first, then upcoming by start, then finals: the order a fan scans in.
  const order = { live: 0, upcoming: 1, final: 2 } as const
  const sorted = [...games].sort(
    (a, b) => order[slatePhase(a, now)] - order[slatePhase(b, now)] || (a.startTime ?? '').localeCompare(b.startTime ?? ''),
  )
  return (
    <ul className="ch-stack" aria-label="Today's games">
      {sorted.map((g) => {
        const phase = slatePhase(g, now)
        const scored = g.homeScore !== null && g.awayScore !== null && phase !== 'upcoming'
        const lead = scored ? Math.sign((g.homeScore ?? 0) - (g.awayScore ?? 0)) : 0
        const sides = [
          { team: g.awayTeam, score: g.awayScore, leading: lead < 0 },
          { team: g.homeTeam, score: g.homeScore, leading: lead > 0 },
        ]
        return (
          <li key={g.key} className="ch-score" data-phase={phase}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="ch-pill ch-mono">{g.sport}</span>
              {phase === 'live' ? (
                <span className="ch-live">{g.status || 'Live'}</span>
              ) : (
                <span className="ch-eyebrow" style={{ color: 'var(--faint)' }}>
                  {phase === 'final' ? 'Final' : startClock(g.startTime)}
                </span>
              )}
            </div>
            {sides.map((side) => (
              <div
                key={side.team}
                className="ch-score-row"
                style={scored && lead !== 0 && !side.leading ? { color: 'var(--muted)' } : undefined}
              >
                <span className="truncate">{side.team}</span>
                {scored && <span className="ch-score-num">{side.score}</span>}
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
  const live = games.filter((g) => slatePhase(g, now.getTime()) === 'live').length

  return (
    <ClubhouseFrame active={here} crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <PageHeader
        channel={GAME_DAY_CHANNEL}
        icon={channel?.emoji}
        eyebrow={easternDayLabel(easternDate(now))}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Game Day
            {live > 0 && (
              <span className="ch-live" style={{ fontSize: 13 }}>
                {live} live
              </span>
            )}
          </span>
        }
        sub={channel?.blurb}
        actions={<GhostButtonLink href="/live">Full live scoreboard →</GhostButtonLink>}
      />

      <div className="ch-cols" style={{ marginTop: 0 }}>
        <main className="min-w-0">
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
            <EmptyState icon="🏟️" title="Today's room isn't open yet" body="Check back in a few minutes." />
          )}
        </main>
        <aside className="ch-rail" aria-label="Today's slate">
          <div className="ch-section-label" style={{ marginBottom: 0 }}>
            <h2 className="ch-h2">Today&apos;s slate</h2>
            <span className="ch-eyebrow" style={{ color: 'var(--faint)' }}>
              {games.length} {games.length === 1 ? 'game' : 'games'}
            </span>
          </div>
          <Scoreboard games={games} now={now.getTime()} />
        </aside>
      </div>
    </ClubhouseFrame>
  )
}

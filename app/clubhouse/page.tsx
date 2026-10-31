import type { Metadata } from 'next'
import Link from 'next/link'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import {
  CLUBHOUSE_NAME,
  COMMUNITY_CHANNELS,
  clubhouseChannelHref,
  clubhouseMemberHref,
  clubhousePostHref,
} from '@/lib/community/channels'
import { displayNameOf, timeAgo } from '@/lib/community/format'
import { IDEA_CHANNEL, IDEA_STATUS_COPY, NEW_IDEA_HREF } from '@/lib/community/ideas'
import { getGameDaySummary } from '@/lib/community/scheduled'
import {
  getChannelStats,
  getClubhouseOverview,
  getCommunityViewer,
  hasEverPosted,
  listPosts,
} from '@/lib/community/service'
import {
  AuthorBadges,
  Avatar,
  ClubhouseFrame,
  EmptyState,
  GhostButtonLink,
  PostCard,
  PrimaryButtonLink,
  loginHref,
} from '@/components/community/CommunityBits'

export const dynamic = 'force-dynamic'

const TITLE = `${CLUBHOUSE_NAME} | AllFantasy Community for Commissioners and Managers`
const DESCRIPTION =
  'Talk shop with fantasy commissioners and managers: running a league, wild league formats, sports news, other fantasy apps, and questions for the AllFantasy founder.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/clubhouse' },
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="ch-stat">
      <div className="ch-stat-num">{value.toLocaleString('en-US')}</div>
      <div className="ch-stat-label">{label}</div>
    </div>
  )
}

export default async function ClubhousePage() {
  const viewer = await getCommunityViewer()
  const [stats, feed, posted, overview, gameDay] = await Promise.all([
    getChannelStats(),
    listPosts({ viewer, limit: 15 }),
    viewer.userId ? hasEverPosted(viewer.userId) : Promise.resolve(true),
    getClubhouseOverview(viewer),
    getGameDaySummary(),
  ])
  const statBySlug = new Map(stats.map((s) => [s.slug, s]))
  const now = Date.now()
  const signedIn = Boolean(viewer.userId)
  const newPostHref = signedIn ? '/clubhouse/new' : loginHref('/clubhouse/new')
  const pitchHref = signedIn ? NEW_IDEA_HREF : loginHref(NEW_IDEA_HREF)
  // The pinned weekly prompt gets its own card in the rail, so it is not repeated above the feed.
  const pinned = feed.pinned.filter((p) => p.id !== overview.weeklyPrompt?.id)

  return (
    <ClubhouseFrame active="/clubhouse" cta={<PrimaryButtonLink href={newPostHref} small>＋ New post</PrimaryButtonLink>}>
      <section className="ch-hero" aria-labelledby="clubhouse-title">
        <p className="ch-eyebrow">AllFantasy community</p>
        <h1 id="clubhouse-title" className="ch-h1 mt-3">
          The <span className="ch-grad-text">Clubhouse</span>
        </h1>
        <p className="ch-hero-sub">
          Where commissioners and managers talk shop. Pitch league formats, settle settings debates, talk the games live,
          and tell us what to build next.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <PrimaryButtonLink href={newPostHref}>＋ Start a post</PrimaryButtonLink>
          <GhostButtonLink href={pitchHref}>💡 Pitch a league idea</GhostButtonLink>
          {gameDay.live > 0 && <GhostButtonLink href="/clubhouse/game-day">🏟️ Game Day is live</GhostButtonLink>}
        </div>
        <div className="ch-stats">
          <Stat value={overview.stats.activeMembers} label="members active this month" />
          <Stat value={overview.stats.postsThisWeek} label="new threads this week" />
          <Stat value={overview.stats.ideas} label="league ideas pitched" />
          <Stat value={overview.stats.shippedIdeas} label="ideas shipped" />
        </div>
      </section>

      <div className="ch-cols">
        <main className="min-w-0">
          {signedIn && !posted && (
            <Link href="/clubhouse/new?channel=introductions" className="ch-nudge mb-6">
              <span className="text-3xl" aria-hidden>
                👋
              </span>
              <span className="text-sm" style={{ color: 'var(--text)' }}>
                <strong className="font-extrabold">New here? Introduce yourself.</strong>{' '}
                <span style={{ color: 'var(--muted)' }}>
                  Tell everyone what you play and your league&apos;s weirdest rule. We&apos;ll start you off with a few prompts.
                </span>
              </span>
            </Link>
          )}
          {!signedIn && (
            <p className="ch-nudge mb-6 text-sm" style={{ color: 'var(--muted)' }}>
              <span className="text-2xl" aria-hidden>
                👀
              </span>
              <span>
                Anyone can read along.{' '}
                <Link href={loginHref('/clubhouse')} className="font-bold underline" style={{ color: 'var(--accent)' }}>
                  Sign in
                </Link>{' '}
                to post, reply, react and vote on league ideas.
              </span>
            </p>
          )}

          <section aria-labelledby="channels-heading" className="mb-9">
            <div className="ch-section-label">
              <h2 id="channels-heading" className="ch-h2">
                Channels
              </h2>
              <span className="ch-eyebrow" style={{ color: 'var(--faint)' }}>
                {COMMUNITY_CHANNELS.length} rooms
              </span>
            </div>
            <div className="ch-tiles">
              {COMMUNITY_CHANNELS.map((c) => {
                const s = statBySlug.get(c.slug)
                const href = c.slug === 'game-day' ? '/clubhouse/game-day' : clubhouseChannelHref(c.slug)
                return (
                  <Link key={c.slug} href={href} data-channel={c.slug} className="ch-card ch-card-link ch-tile">
                    <span className="ch-icon" aria-hidden>
                      {c.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="ch-tile-title">{c.label}</span>
                        {c.slug === 'game-day' && gameDay.live > 0 && <span className="ch-live">Live</span>}
                      </span>
                      <span className="ch-tile-blurb">{c.blurb}</span>
                      <span className="ch-tile-meta">
                        {s?.postCount ? (
                          <>
                            <span>
                              <strong>{s.postCount}</strong> {s.postCount === 1 ? 'thread' : 'threads'}
                            </span>
                            {s.lastActivityAt && <span>active {timeAgo(s.lastActivityAt, now)}</span>}
                          </>
                        ) : (
                          <span>No threads yet. Be first.</span>
                        )}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>

          {pinned.length > 0 && (
            <section aria-labelledby="pinned-heading" className="mb-9">
              <div className="ch-section-label">
                <h2 id="pinned-heading" className="ch-h2">
                  📌 Pinned
                </h2>
              </div>
              <div className="ch-stack">
                {pinned.map((p) => (
                  <PostCard key={p.id} post={p} now={now} showChannel />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="latest-heading">
            <div className="ch-section-label">
              <h2 id="latest-heading" className="ch-h2">
                Latest conversations
              </h2>
            </div>
            {feed.posts.length === 0 ? (
              <EmptyState
                icon="💬"
                title="It's quiet in here, for now"
                body="Start the first conversation: introduce yourself, pitch a league idea, or ask the founder anything."
                action={<PrimaryButtonLink href={newPostHref}>Start a post</PrimaryButtonLink>}
              />
            ) : (
              <div className="ch-stack">
                {feed.posts.map((p) => (
                  <PostCard key={p.id} post={p} now={now} showChannel />
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="ch-rail" aria-label="Around the Clubhouse">
          {overview.weeklyPrompt && (
            <Link
              href={clubhousePostHref(overview.weeklyPrompt.id)}
              data-channel={overview.weeklyPrompt.channel}
              className="ch-card ch-card-link ch-rail-card block"
              style={{ background: 'radial-gradient(300px 160px at 100% 0%, var(--tone-soft), transparent 75%), var(--surface)' }}
            >
              <p className="ch-eyebrow" style={{ color: 'var(--tone)' }}>
                This week&apos;s prompt
              </p>
              <p className="mt-2 text-[17px] font-extrabold leading-snug" style={{ color: 'var(--text)' }}>
                {censorProfanity(overview.weeklyPrompt.title.replace(/^Weekly prompt:\s*/, ''))}
              </p>
              <p className="mt-3 text-sm font-bold" style={{ color: 'var(--tone)' }}>
                {overview.weeklyPrompt.replyCount > 0
                  ? `Join ${overview.weeklyPrompt.replyCount} ${overview.weeklyPrompt.replyCount === 1 ? 'reply' : 'replies'} →`
                  : 'Be the first to answer →'}
              </p>
            </Link>
          )}

          <Link href="/clubhouse/game-day" data-channel="game-day" className="ch-card ch-card-link ch-rail-card block">
            <div className="ch-rail-head">
              <p className="ch-eyebrow" style={{ color: 'var(--tone)' }}>
                Game Day
              </p>
              {gameDay.live > 0 ? <span className="ch-live">{gameDay.live} live</span> : null}
            </div>
            {gameDay.preview.length > 0 ? (
              <ul className="grid gap-2">
                {gameDay.preview.map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-semibold" style={{ color: 'var(--text)' }}>
                      {g.awayTeam} <span style={{ color: 'var(--faint)' }}>at</span> {g.homeTeam}
                    </span>
                    {g.homeScore !== null && g.awayScore !== null ? (
                      <span className="ch-mono shrink-0 text-xs font-bold" style={{ color: 'var(--muted)' }}>
                        {g.awayScore}–{g.homeScore}
                      </span>
                    ) : (
                      <span className="ch-mono shrink-0 text-xs" style={{ color: 'var(--faint)' }}>
                        {g.sport}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No games on today&apos;s slate yet. The chat room is open anyway.
              </p>
            )}
            <p className="mt-3 text-sm font-bold" style={{ color: 'var(--tone)' }}>
              {gameDay.messages > 0 ? `${gameDay.messages} messages today · join the chat →` : 'Open the live chat →'}
            </p>
          </Link>

          <section className="ch-rail-card" data-channel={IDEA_CHANNEL} aria-labelledby="top-ideas">
            <div className="ch-rail-head">
              <h2 id="top-ideas" className="ch-eyebrow" style={{ color: 'var(--tone)' }}>
                Top league ideas
              </h2>
              <Link href={clubhouseChannelHref(IDEA_CHANNEL)} className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
                See all
              </Link>
            </div>
            {overview.topIdeas.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No ideas yet.{' '}
                <Link href={pitchHref} className="font-bold underline" style={{ color: 'var(--tone)' }}>
                  Pitch the first one
                </Link>
                .
              </p>
            ) : (
              <ol className="grid">
                {overview.topIdeas.map((p) => (
                  <li key={p.id}>
                    <Link href={clubhousePostHref(p.id)} className="ch-list-row">
                      <span className="ch-vote" style={{ minWidth: 44, padding: '5px 4px' }} aria-label={`${p.idea?.upvotes ?? 0} upvotes`}>
                        <span className="ch-vote-arrow" aria-hidden>
                          ▲
                        </span>
                        <span className="ch-vote-num" style={{ fontSize: 14 }}>
                          {p.idea?.upvotes ?? 0}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" style={{ color: 'var(--text)' }}>
                          {censorProfanity(p.title)}
                        </span>
                        <span className="block truncate text-xs" style={{ color: 'var(--faint)' }}>
                          {p.idea?.status ? `${IDEA_STATUS_COPY[p.idea.status].emoji} ${IDEA_STATUS_COPY[p.idea.status].label}` : 'Open'} ·{' '}
                          {displayNameOf(p.author)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {overview.activeMembers.length > 0 && (
            <section className="ch-rail-card" aria-labelledby="active-members">
              <div className="ch-rail-head">
                <h2 id="active-members" className="ch-eyebrow">
                  Most active this month
                </h2>
              </div>
              <ol className="grid">
                {overview.activeMembers.map((m, i) => (
                  <li key={m.author.id}>
                    <Link href={clubhouseMemberHref(m.author.username)} className="ch-list-row">
                      <span className="ch-rank">{i + 1}</span>
                      <Avatar author={m.author} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="truncate text-sm font-bold" style={{ color: 'var(--text)' }}>
                            {displayNameOf(m.author)}
                          </span>
                          <AuthorBadges badges={m.author.badges.filter((b) => b !== 'new')} />
                        </span>
                      </span>
                      <span className="ch-mono text-xs font-bold" style={{ color: 'var(--muted)' }}>
                        {m.contributions}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {viewer.isModerator && (
            <Link href="/clubhouse/moderation" className="ch-btn ch-btn-ghost ch-btn-sm">
              🛡️ Moderation queue
            </Link>
          )}
        </aside>
      </div>
    </ClubhouseFrame>
  )
}

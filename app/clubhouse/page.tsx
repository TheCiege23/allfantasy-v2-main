import type { Metadata } from 'next'
import Link from 'next/link'
import { CLUBHOUSE_NAME, COMMUNITY_CHANNELS, clubhouseChannelHref } from '@/lib/community/channels'
import { timeAgo } from '@/lib/community/format'
import { getChannelStats, getCommunityViewer, hasEverPosted, listPosts } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, PostCard, PrimaryButtonLink, loginHref } from '@/components/community/CommunityBits'

export const dynamic = 'force-dynamic'

const TITLE = `${CLUBHOUSE_NAME} | AllFantasy Community for Commissioners and Managers`
const DESCRIPTION =
  'Talk shop with fantasy commissioners and managers: running a league, wild league formats, sports news, other fantasy apps, and questions for the AllFantasy founder.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/clubhouse' },
}

export default async function ClubhousePage() {
  const viewer = await getCommunityViewer()
  const [stats, feed, posted] = await Promise.all([
    getChannelStats(),
    listPosts({ viewer, limit: 15 }),
    viewer.userId ? hasEverPosted(viewer.userId) : Promise.resolve(true),
  ])
  const statBySlug = new Map(stats.map((s) => [s.slug, s]))
  const now = Date.now()
  const newPostHref = viewer.userId ? '/clubhouse/new' : loginHref('/clubhouse/new')

  return (
    <ClubhouseFrame>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: 'var(--text)' }}>
            🏟️ {CLUBHOUSE_NAME}
          </h1>
          <p className="mt-1 max-w-xl text-sm" style={{ color: 'var(--muted)' }}>
            Where commissioners and managers talk shop. Swap league ideas, settle settings debates, talk sports, and
            tell us what to build next.
          </p>
        </div>
        <PrimaryButtonLink href={newPostHref}>＋ Start a post</PrimaryButtonLink>
      </header>

      {viewer.userId && !posted && (
        <Link
          href="/clubhouse/new?channel=introductions"
          className="mb-6 flex items-center gap-3 rounded-xl border p-4 hover:opacity-90"
          style={{ borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
        >
          <span className="text-2xl" aria-hidden>
            👋
          </span>
          <span className="text-sm" style={{ color: 'var(--text)' }}>
            <strong>New here? Introduce yourself.</strong> Tell everyone what you play and your league's weirdest rule.
            We'll start you off with a few prompts.
          </span>
        </Link>
      )}
      {!viewer.userId && (
        <p
          className="mb-6 rounded-xl border p-3 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Anyone can read along.{' '}
          <Link href={loginHref('/clubhouse')} className="font-semibold underline" style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>{' '}
          to post, reply and react.
        </p>
      )}

      <section aria-labelledby="channels-heading" className="mb-8">
        <h2 id="channels-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Channels
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMMUNITY_CHANNELS.map((c) => {
            const s = statBySlug.get(c.slug)
            return (
              <Link
                key={c.slug}
                href={clubhouseChannelHref(c.slug)}
                className="mode-panel rounded-xl border p-4 transition hover:border-[color:var(--border-strong)]"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden>
                    {c.emoji}
                  </span>
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>
                    {c.label}
                  </span>
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                  {c.blurb}
                </p>
                <p className="mt-2 text-xs" style={{ color: 'var(--muted2)' }}>
                  {s?.postCount ? `${s.postCount} ${s.postCount === 1 ? 'post' : 'posts'}` : 'No posts yet. Be first.'}
                  {s?.lastActivityAt ? ` · active ${timeAgo(s.lastActivityAt, now)}` : ''}
                </p>
              </Link>
            )
          })}
        </div>
      </section>

      {feed.pinned.length > 0 && (
        <section aria-labelledby="pinned-heading" className="mb-8">
          <h2 id="pinned-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Pinned
          </h2>
          <div className="space-y-3">
            {feed.pinned.map((p) => (
              <PostCard key={p.id} post={p} now={now} showChannel />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Latest conversations
        </h2>
        {feed.posts.length === 0 ? (
          <EmptyState
            title="It's quiet in here, for now"
            body="Start the first conversation: introduce yourself or ask the founder anything."
            action={<PrimaryButtonLink href={newPostHref}>Start a post</PrimaryButtonLink>}
          />
        ) : (
          <div className="space-y-3">
            {feed.posts.map((p) => (
              <PostCard key={p.id} post={p} now={now} showChannel />
            ))}
          </div>
        )}
      </section>

      {viewer.isModerator && (
        <p className="mt-8 text-center text-xs">
          <Link href="/clubhouse/moderation" className="underline" style={{ color: 'var(--muted)' }}>
            Moderation queue
          </Link>
        </p>
      )}
    </ClubhouseFrame>
  )
}

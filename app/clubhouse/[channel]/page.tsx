import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CLUBHOUSE_NAME, clubhouseChannelHref, getChannel } from '@/lib/community/channels'
import { getCommunityViewer, listPosts } from '@/lib/community/service'
import { ClubhouseFrame, EmptyState, PostCard, PrimaryButtonLink, loginHref } from '@/components/community/CommunityBits'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ channel: string }>
  searchParams: Promise<{ before?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const channel = getChannel((await params).channel)
  if (!channel) return { title: `${CLUBHOUSE_NAME} | AllFantasy` }
  const title = `${channel.label} | ${CLUBHOUSE_NAME} | AllFantasy`
  return { title, description: channel.blurb, openGraph: { title, description: channel.blurb, url: clubhouseChannelHref(channel.slug) } }
}

export default async function ClubhouseChannelPage({ params, searchParams }: Props) {
  const channel = getChannel((await params).channel)
  if (!channel) notFound()
  const { before } = await searchParams

  const viewer = await getCommunityViewer()
  const page = await listPosts({ viewer, channel: channel.slug, before: before ?? null })
  const now = Date.now()
  const composeHref = `/clubhouse/new?channel=${channel.slug}`
  const newPostHref = viewer.userId ? composeHref : loginHref(composeHref)

  return (
    <ClubhouseFrame crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            {channel.emoji} {channel.label}
          </h1>
          <p className="mt-1 max-w-xl text-sm" style={{ color: 'var(--muted)' }}>
            {channel.blurb}
          </p>
        </div>
        <PrimaryButtonLink href={newPostHref}>＋ New post</PrimaryButtonLink>
      </header>

      {channel.slug === 'league-lab' && (
        <div
          className="mb-6 rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Got a full league format worked out, with scoring, weekly flow and edge cases?{' '}
          <Link href="/submit-league" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
            Submit it to the AllFantasy team
          </Link>{' '}
          and we may build it, with credit to you. Or post the rough version here first and let people help shape it.
        </div>
      )}

      {page.pinned.length > 0 && (
        <div className="mb-4 space-y-3">
          {page.pinned.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}

      {page.posts.length === 0 && page.pinned.length === 0 ? (
        <EmptyState
          title="No posts here yet"
          body="Start the first one. Early posts set the tone for everyone who follows."
          action={<PrimaryButtonLink href={newPostHref}>Start the conversation</PrimaryButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {page.posts.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {before ? (
          <Link href={clubhouseChannelHref(channel.slug)} className="underline" style={{ color: 'var(--muted)' }}>
            ← Newest
          </Link>
        ) : (
          <span />
        )}
        {page.nextCursor && (
          <Link
            href={`${clubhouseChannelHref(channel.slug)}?before=${encodeURIComponent(page.nextCursor)}`}
            className="underline"
            style={{ color: 'var(--muted)' }}
          >
            Older posts →
          </Link>
        )}
      </div>
    </ClubhouseFrame>
  )
}

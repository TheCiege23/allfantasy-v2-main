import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { CLUBHOUSE_NAME, clubhouseChannelHref, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { getCommunityViewer, getPost } from '@/lib/community/service'
import {
  AuthorLine,
  Avatar,
  ChannelPill,
  ClubhouseFrame,
  PostBody,
  TagPills,
  loginHref,
} from '@/components/community/CommunityBits'
import { PostActions, ReactionBar, ReplyActions, ReplyComposer } from '@/components/community/ClubhouseClient'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ postId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { postId } = await params
  const post = await getPost(postId, { userId: null, isModerator: false }).catch(() => null)
  if (!post) return { title: `${CLUBHOUSE_NAME} | AllFantasy` }
  const title = `${censorProfanity(post.title)} | ${CLUBHOUSE_NAME}`
  const description = censorProfanity(post.excerpt)
  return { title, description, openGraph: { title, description, url: clubhousePostHref(post.id) } }
}

export default async function ClubhousePostPage({ params }: Props) {
  const { postId } = await params
  const viewer = await getCommunityViewer()
  const post = await getPost(postId, viewer)
  if (!post) notFound()

  const channel = getChannel(post.channel)
  const now = Date.now()
  const signedIn = Boolean(viewer.userId)
  const here = clubhousePostHref(post.id)
  const login = loginHref(here)

  return (
    <ClubhouseFrame
      crumbs={[
        { href: '/clubhouse', label: CLUBHOUSE_NAME },
        ...(channel ? [{ href: clubhouseChannelHref(channel.slug), label: channel.label }] : []),
      ]}
    >
      {post.removed && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          This post is removed. Only moderators can see it.
        </p>
      )}

      <article className="mode-panel rounded-xl border p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <ChannelPill slug={post.channel} />
          <TagPills tags={post.tags} />
          {post.isPinned && (
            <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              📌 Pinned
            </span>
          )}
          {post.isLocked && (
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              🔒 Locked
            </span>
          )}
        </div>
        <h1 className="mb-3 text-xl font-bold leading-snug sm:text-2xl" style={{ color: 'var(--text)' }}>
          {censorProfanity(post.title)}
        </h1>
        <div className="mb-4 flex items-center gap-2.5">
          <Avatar author={post.author} size={36} />
          <AuthorLine author={post.author} at={post.createdAt} edited={Boolean(post.editedAt)} now={now} />
        </div>
        <PostBody text={post.body} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <ReactionBar targetType="post" targetId={post.id} initial={post.reactions} signedIn={signedIn} loginHref={login} />
        </div>
        <div className="mt-2">
          <PostActions
            postId={post.id}
            canEdit={post.canEdit}
            isModerator={viewer.isModerator}
            isPinned={post.isPinned}
            isLocked={post.isLocked}
            removed={post.removed}
            signedIn={signedIn}
            initialTitle={post.title}
            initialBody={post.body}
            initialTags={post.tags}
          />
        </div>
      </article>

      <section aria-labelledby="replies-heading" className="mt-6">
        <h2 id="replies-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
        </h2>

        {post.replies.length === 0 && (
          <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
            No replies yet. Be the first to weigh in.
          </p>
        )}

        <ol className="mb-5 space-y-3">
          {post.replies.map((r) => (
            <li
              key={r.id}
              id={`reply-${r.id}`}
              className="mode-panel scroll-mt-20 rounded-xl border p-3 sm:p-4 target:ring-2 target:ring-[color:var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            >
              {r.removed ? (
                <p className="text-sm italic" style={{ color: 'var(--muted2)' }}>
                  This reply was removed.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <Avatar author={r.author} size={28} />
                    <AuthorLine author={r.author} at={r.createdAt} edited={Boolean(r.editedAt)} now={now} />
                  </div>
                  <PostBody text={r.body} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ReactionBar targetType="reply" targetId={r.id} initial={r.reactions} signedIn={signedIn} loginHref={login} />
                    <ReplyActions
                      replyId={r.id}
                      canEdit={r.canEdit}
                      isModerator={viewer.isModerator}
                      signedIn={signedIn}
                      initialBody={r.body}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>

        {!post.removed && (
          <ReplyComposer
            postId={post.id}
            signedIn={signedIn}
            loginHref={login}
            locked={post.isLocked}
            canReplyWhenLocked={viewer.isModerator}
          />
        )}
      </section>
    </ClubhouseFrame>
  )
}

import Link from 'next/link'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { clubhousePostHref } from '@/lib/community/channels'
import { IDEA_STATUS_COPY, type IdeaStatus } from '@/lib/community/ideas'
import { displayNameOf, timeAgo } from '@/lib/community/format'
import type { CommunityAuthor, IdeaView, PostSummary } from '@/lib/community/service'
import { AuthorLine, TagPills } from './CommunityBits'
import { UpvoteButton } from './IdeaClient'

/** Display pieces for League Lab ideas. Server components; the upvote is the only client part. */

const STATUS_TONE: Record<IdeaStatus, string> = {
  under_review: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  building: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  shipped: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
}

export function IdeaStatusPill({ status }: { status: IdeaStatus | null }) {
  if (!status) return null
  const copy = IDEA_STATUS_COPY[status]
  return (
    <span
      title={copy.blurb}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
    >
      <span aria-hidden>{copy.emoji}</span>
      {copy.label}
    </span>
  )
}

/** Sport · teams · draft, whichever were given. */
export function IdeaFacts({ idea }: { idea: IdeaView }) {
  const facts = [
    idea.teamSize ? `${idea.teamSize} teams` : null,
    idea.draftType ? `${idea.draftType} draft` : null,
  ].filter(Boolean) as string[]
  if (facts.length === 0) return null
  return (
    <span className="text-xs capitalize" style={{ color: 'var(--muted)' }}>
      {facts.join(' · ')}
    </span>
  )
}

/** The public credit on a shipped idea. */
export function IdeaCredit({ idea, author, now }: { idea: IdeaView; author: CommunityAuthor; now: number }) {
  if (idea.status !== 'shipped') return null
  return (
    <p
      className="rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: 'color-mix(in srgb, #10b981 40%, transparent)', color: 'var(--text)' }}
    >
      🚀 Shipped{idea.statusAt ? ` ${timeAgo(idea.statusAt, now)}` : ''}. Idea by{' '}
      <span className="font-semibold">{displayNameOf(author)}</span> (@{author.username}). Thank you!
    </p>
  )
}

export function IdeaCard({
  post,
  now,
  signedIn,
  viewerId,
  loginHref,
}: {
  post: PostSummary & { idea: IdeaView }
  now: number
  signedIn: boolean
  viewerId: string | null
  loginHref: string
}) {
  const { idea } = post
  return (
    <article className="mode-panel flex gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
      <UpvoteButton
        postId={post.id}
        initialUpvotes={idea.upvotes}
        initialVoted={idea.votedByMe}
        signedIn={signedIn}
        isAuthor={viewerId === post.author.id}
        loginHref={loginHref}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <IdeaStatusPill status={idea.status} />
          <TagPills tags={post.tags} />
          <IdeaFacts idea={idea} />
        </div>
        <Link href={clubhousePostHref(post.id)} className="block">
          <h3 className="text-[15px] font-semibold leading-snug hover:underline" style={{ color: 'var(--text)' }}>
            {censorProfanity(post.title)}
          </h3>
          {idea.hook && (
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              {censorProfanity(idea.hook)}
            </p>
          )}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <AuthorLine author={post.author} at={post.createdAt} now={now} />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            💬 {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </span>
        </div>
      </div>
    </article>
  )
}

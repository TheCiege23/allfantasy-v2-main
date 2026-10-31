import Link from 'next/link'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { clubhouseChannelHref, clubhouseMemberHref, clubhousePostHref, getChannel } from '@/lib/community/channels'
import { displayNameOf, linkifySegments, timeAgo } from '@/lib/community/format'
import type { AuthorBadge, CommunityAuthor, PostSummary } from '@/lib/community/service'

/**
 * Display pieces for the Clubhouse. No hooks, no `'use client'`: they render on the
 * server and inside client components alike.
 */

/**
 * Plain text, as typed. Line breaks kept, URLs made clickable, swearing masked at render
 * (never at write — see censorProfanity.ts). There is no HTML path at all, so nothing a
 * stranger types can become markup.
 */
export function PostBody({ text, className = '' }: { text: string; className?: string }) {
  const segments = linkifySegments(censorProfanity(text))
  return (
    <div className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${className}`} style={{ color: 'var(--text)' }}>
      {segments.map((s, i) =>
        s.kind === 'link' ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="nofollow ugc noopener noreferrer"
            className="underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  )
}

const BADGE_COPY: Record<AuthorBadge, { label: string; title: string; className: string }> = {
  staff: {
    label: 'AllFantasy',
    title: 'Part of the AllFantasy team',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  },
  commish: {
    label: 'Commish',
    title: 'Runs a league on AllFantasy',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  },
  shipped: {
    label: 'Idea Shipped',
    title: 'Pitched a League Lab idea that AllFantasy built',
    className: 'bg-fuchsia-500/15 text-fuchsia-500 border-fuchsia-500/30',
  },
  new: {
    label: 'New',
    title: 'Joined in the last week. Say hi!',
    className: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  },
}

export function AuthorBadges({ badges }: { badges: AuthorBadge[] }) {
  if (badges.length === 0) return null
  return (
    <>
      {badges.map((b) => (
        <span
          key={b}
          title={BADGE_COPY[b].title}
          className={`rounded-full border px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${BADGE_COPY[b].className}`}
        >
          {BADGE_COPY[b].label}
        </span>
      ))}
    </>
  )
}

export function Avatar({ author, size = 32 }: { author: CommunityAuthor | null; size?: number }) {
  const name = author ? displayNameOf(author) : '?'
  if (author?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={author.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ width: size, height: size, background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function AuthorLine({
  author,
  at,
  edited,
  now,
}: {
  author: CommunityAuthor | null
  at: string
  edited?: boolean
  now: number
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
      {author ? (
        <Link href={clubhouseMemberHref(author.username)} className="font-semibold hover:underline" style={{ color: 'var(--text)' }}>
          {displayNameOf(author)}
        </Link>
      ) : (
        <span className="font-semibold" style={{ color: 'var(--text)' }}>
          Removed
        </span>
      )}
      {author && author.displayName && <span>@{author.username}</span>}
      {author && <AuthorBadges badges={author.badges} />}
      <span aria-hidden>·</span>
      <time dateTime={at}>{timeAgo(at, now)}</time>
      {edited && <span>(edited)</span>}
    </div>
  )
}

export function ChannelPill({ slug }: { slug: string }) {
  const channel = getChannel(slug)
  if (!channel) return null
  return (
    <Link
      href={clubhouseChannelHref(channel.slug)}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
      style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      <span aria-hidden>{channel.emoji}</span>
      {channel.label}
    </Link>
  )
}

export function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <>
      {tags.map((t) => (
        <span
          key={t}
          className="rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide"
          style={{ background: 'var(--panel2)', color: 'var(--muted)' }}
        >
          {t}
        </span>
      ))}
    </>
  )
}

export function PostCard({ post, now, showChannel }: { post: PostSummary; now: number; showChannel?: boolean }) {
  const reactionTotal = post.reactions.reduce((n, r) => n + r.count, 0)
  return (
    <article
      className="mode-panel rounded-xl border p-4 transition hover:border-[color:var(--border-strong)]"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-start gap-3">
        <Avatar author={post.author} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
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
            {post.idea && (
              <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                💡 Idea · ▲ {post.idea.upvotes}
              </span>
            )}
            {showChannel && <ChannelPill slug={post.channel} />}
            <TagPills tags={post.tags} />
          </div>
          <Link href={clubhousePostHref(post.id)} className="block">
            <h3 className="text-[15px] font-semibold leading-snug hover:underline" style={{ color: 'var(--text)' }}>
              {censorProfanity(post.title)}
            </h3>
            {post.excerpt && (
              <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--muted)' }}>
                {censorProfanity(post.excerpt)}
              </p>
            )}
          </Link>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <AuthorLine author={post.author} at={post.createdAt} now={now} />
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
              {reactionTotal > 0 && <span>❤ {reactionTotal}</span>}
              <span>
                💬 {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
              </span>
              {post.replyCount > 0 && <span>active {timeAgo(post.lastActivityAt, now)}</span>}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export function ClubhouseFrame({ children, crumbs }: { children: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
          <Link href="/" className="hover:underline">
            Home
          </Link>
          {(crumbs ?? []).map((c) => (
            <span key={c.href} className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={c.href} className="hover:underline">
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mode-panel rounded-xl border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
      <p className="font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function loginHref(callbackPath: string): string {
  return `/login?callbackUrl=${encodeURIComponent(callbackPath)}`
}

export function PrimaryButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm hover:opacity-90"
      // Inline colour, not `text-white`: light mode's `.mode-readable` rule rewrites text-white to dark.
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      {children}
    </Link>
  )
}

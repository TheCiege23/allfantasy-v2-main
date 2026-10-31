import Link from 'next/link'
import {
  IDEA_STATUSES,
  IDEA_STATUS_COPY,
  NEW_IDEA_HREF,
  ideaBoardHref,
  type IdeaFilter,
  type IdeaSort,
} from '@/lib/community/ideas'
import type { IdeaBoardPage, IdeaView, PostSummary } from '@/lib/community/service'
import { EmptyState, PrimaryButtonLink, loginHref } from './CommunityBits'
import { IdeaCard } from './IdeaBits'

/** The League Lab idea board: sort, status filter, cards, paging. */
export function IdeaBoard({
  board,
  sort,
  filter,
  viewerId,
  now,
}: {
  board: IdeaBoardPage
  sort: IdeaSort
  filter: IdeaFilter
  viewerId: string | null
  now: number
}) {
  const signedIn = Boolean(viewerId)
  const here = ideaBoardHref({ sort, status: filter, page: board.page })
  const pitchHref = signedIn ? NEW_IDEA_HREF : loginHref(NEW_IDEA_HREF)
  const filters: { value: IdeaFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    ...IDEA_STATUSES.map((s) => ({ value: s, label: `${IDEA_STATUS_COPY[s].emoji} ${IDEA_STATUS_COPY[s].label}` })),
  ]
  const chip = (active: boolean) => ({
    borderColor: active ? 'var(--accent)' : 'var(--border)',
    background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
    color: 'var(--text)',
  })

  return (
    <section aria-labelledby="ideas-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="ideas-heading" className="text-lg font-bold" style={{ color: 'var(--text)' }}>
          💡 League ideas
        </h2>
        <div className="flex gap-1 text-sm" role="group" aria-label="Sort ideas">
          {(['top', 'new'] as const).map((s) => (
            <Link
              key={s}
              href={ideaBoardHref({ sort: s, status: filter })}
              aria-current={sort === s ? 'page' : undefined}
              className="rounded-md border px-2.5 py-1"
              style={chip(sort === s)}
            >
              {s === 'top' ? 'Top' : 'Newest'}
            </Link>
          ))}
        </div>
      </div>

      <nav aria-label="Filter ideas by status" className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={ideaBoardHref({ sort, status: f.value })}
            aria-current={filter === f.value ? 'page' : undefined}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={chip(filter === f.value)}
          >
            {f.label} <span style={{ color: 'var(--muted)' }}>{board.counts[f.value]}</span>
          </Link>
        ))}
      </nav>

      {board.ideas.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No ideas yet' : 'Nothing with this status yet'}
          body={
            filter === 'all'
              ? 'Pitch the league format you have always wanted to play. The best-upvoted ones get built.'
              : 'Try another filter, or pitch a new idea.'
          }
          action={<PrimaryButtonLink href={pitchHref}>Pitch an idea</PrimaryButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {board.ideas.map((p) =>
            p.idea ? (
              <IdeaCard
                key={p.id}
                post={p as PostSummary & { idea: IdeaView }}
                now={now}
                signedIn={signedIn}
                viewerId={viewerId}
                loginHref={loginHref(here)}
              />
            ) : null,
          )}
        </div>
      )}

      {(board.page > 1 || board.hasMore) && (
        <div className="mt-4 flex justify-between text-sm">
          {board.page > 1 ? (
            <Link href={ideaBoardHref({ sort, status: filter, page: board.page - 1 })} className="underline" style={{ color: 'var(--muted)' }}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {board.hasMore && (
            <Link href={ideaBoardHref({ sort, status: filter, page: board.page + 1 })} className="underline" style={{ color: 'var(--muted)' }}>
              More ideas →
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

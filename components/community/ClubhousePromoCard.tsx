import Link from 'next/link'

/**
 * A small "come to the Clubhouse" card for the moments a commissioner is already thinking about
 * how their league runs: the commissioner overview, the sheet after a league is created, and the
 * draft recap. One component so the copy and links stay consistent; each caller passes its own
 * surface class so the card matches the screen it sits on.
 */

const COPY = {
  commish: {
    title: 'Got a league format your group loves?',
    body: 'Pitch it in League Lab. Commissioners upvote the ones they would play, and the top ideas get built, with your name on them.',
    primary: { href: '/clubhouse/ideas/new', label: '💡 Pitch an idea' },
  },
  'league-created': {
    title: 'Wish a setting existed?',
    body: 'Tell other commissioners in the Clubhouse, or pitch it in League Lab so it can get built.',
    primary: { href: '/clubhouse/league-lab', label: '🧪 Open League Lab' },
  },
  'draft-done': {
    title: 'Draft done. Talk it over.',
    body: 'Best picks, reaches and who won the draft: the Clubhouse is where managers and commissioners compare notes.',
    primary: { href: '/clubhouse', label: '🏟️ Visit the Clubhouse' },
  },
} as const

export type ClubhousePromoVariant = keyof typeof COPY

export function ClubhousePromoCard({ variant, className = '' }: { variant: ClubhousePromoVariant; className?: string }) {
  const c = COPY[variant]
  return (
    <aside className={className} data-testid={`clubhouse-promo-${variant}`} aria-label="The AllFantasy Clubhouse">
      <p className="text-sm font-bold">{c.title}</p>
      <p className="mt-1 text-sm" style={{ opacity: 0.8 }}>
        {c.body}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={c.primary.href}
          className="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-bold"
          style={{ background: 'var(--accent, #22d3ee)', color: 'var(--accent-ink, #06121f)' }}
        >
          {c.primary.label}
        </Link>
        {variant !== 'draft-done' && (
          <Link href="/clubhouse" className="text-sm font-semibold underline-offset-2 hover:underline" style={{ opacity: 0.85 }}>
            Visit the Clubhouse
          </Link>
        )}
      </div>
    </aside>
  )
}

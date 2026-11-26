import Link from 'next/link'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { clubhousePostHref } from '@/lib/community/channels'
import { displayNameOf } from '@/lib/community/format'
import type { ShippedIdea } from '@/lib/community/service'

/**
 * "Shipped from League Lab": ideas members pitched that are now live, with the member's name on
 * each. Renders nothing until the first idea ships, so it never shows an empty promise.
 */
export function ShippedFromLeagueLab({ ideas, compact = false }: { ideas: ShippedIdea[]; compact?: boolean }) {
  if (ideas.length === 0) return null
  return (
    <section aria-labelledby="shipped-heading" className="ch-card ch-card-pad" data-testid="shipped-from-lab">
      <h2 id="shipped-heading" className="ch-eyebrow mb-2" style={{ color: 'var(--accent)' }}>
        🚀 Shipped from League Lab
      </h2>
      <ul className="grid gap-2">
        {ideas.map((i) => (
          <li key={i.id}>
            <Link href={clubhousePostHref(i.id)} className="font-semibold hover:underline" style={{ color: 'var(--text)' }}>
              {censorProfanity(i.title)}
            </Link>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>
              {' '}pitched by @{i.author.username}
              {!compact && i.author.displayName ? ` (${displayNameOf(i.author)})` : ''}
            </span>
            {!compact && i.hook && (
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                {censorProfanity(i.hook)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

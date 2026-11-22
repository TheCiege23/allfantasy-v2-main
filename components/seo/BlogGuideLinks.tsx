import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { blogGuideHref, type BlogGuideLink } from '@/lib/seo-landing/blog-guides'

/**
 * A lander's "Guides" section: plain links to the blog posts about this format or sport. No hooks,
 * so it renders on the server for the league-type landers and inside the sport lander's client tree.
 * Renders nothing when there is no guide, so a lander without one shows no empty heading.
 */
export default function BlogGuideLinks({
  guides,
  testIdPrefix,
}: {
  guides: readonly BlogGuideLink[] | undefined
  testIdPrefix: string
}) {
  if (!guides || guides.length === 0) return null
  return (
    <section className="mt-10" aria-labelledby="guides" data-testid={`${testIdPrefix}-guides`}>
      <h2 id="guides" className="text-lg font-semibold">
        {guides.length === 1 ? 'Read the guide' : 'Guides'}
      </h2>
      <ul className="mt-3 space-y-2">
        {guides.map((g) => (
          <li key={g.slug}>
            <Link
              href={blogGuideHref(g.slug)}
              className="flex min-h-[44px] items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium hover:opacity-90"
              style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
              data-testid={`${testIdPrefix}-guide-${g.slug}`}
            >
              <BookOpen className="h-4 w-4 shrink-0" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
              {g.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Rule templates library (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 11): league rule sets other
 * commissioners have shared, most-used first. "Use" opens the create wizard with the rules filled in.
 * Readable signed out — it lists names, tags and use counts, never a league's settings.
 */
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listPublicTemplates } from '@/lib/rule-templates/templateService'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'League rule templates — AllFantasy', description: 'Start a fantasy league from rule sets other commissioners run and share.' }

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

export default async function LeagueTemplatesPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = (await props.searchParams) ?? {}
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const sport = SPORTS.find((s) => s === pick(sp.sport)?.toUpperCase()) ?? null
  const sort = pick(sp.sort) === 'new' ? 'new' : 'popular'
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const templates = await listPublicTemplates(session?.user?.id ?? null, { sport, sort, limit: 48 }).catch(() => [])
  const href = (next: { sport?: string | null; sort?: string }) => {
    const q = new URLSearchParams()
    const s = next.sport === undefined ? sport : next.sport
    if (s) q.set('sport', s)
    if ((next.sort ?? sort) === 'new') q.set('sort', 'new')
    const qs = q.toString()
    return `/league-templates${qs ? `?${qs}` : ''}`
  }
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${active ? 'border-violet-500 bg-violet-600 text-[#ffffff]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-secondary)]'}`

  return (
    <main className="min-h-screen bg-[color:var(--surface-app)] px-4 py-8 text-[color:var(--text-primary)] sm:px-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-black tracking-tight">League rule templates</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">
          Rule sets commissioners run and share. Pick one and the create wizard fills in the format, scoring, draft and dynasty or keeper rules — you can change anything before you create. Share your own from your league&rsquo;s settings → Templates.
        </p>
        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filter">
          <Link className={chip(!sport)} href={href({ sport: null })}>All sports</Link>
          {SPORTS.map((s) => (
            <Link key={s} className={chip(sport === s)} href={href({ sport: s })}>{s}</Link>
          ))}
          <span className="mx-1 hidden sm:inline" />
          <Link className={chip(sort === 'popular')} href={href({ sort: 'popular' })}>Most used</Link>
          <Link className={chip(sort === 'new')} href={href({ sort: 'new' })}>Newest</Link>
        </nav>
        {templates.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-6 text-sm text-[color:var(--text-secondary)]">
            No shared templates {sport ? `for ${sport} ` : ''}yet. Be the first: open a league you run, go to Settings → Templates, save it and switch on sharing.
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="template-library">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-col rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4">
                <h2 className="break-words text-base font-bold">{t.name}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                  by {t.author}{t.isMine ? ' (you)' : ''} · {t.uses === 1 ? 'used once' : `used ${t.uses} times`}
                </p>
                {t.description && <p className="mt-2 break-words text-sm text-[color:var(--text-secondary)]">{t.description}</p>}
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {t.tags.map((tag) => (
                    <li key={tag} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-400">{tag}</li>
                  ))}
                </ul>
                <Link href={`/create-league?template=${encodeURIComponent(t.id)}`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-black text-[#ffffff] hover:bg-violet-500">
                  Start a league with these rules
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

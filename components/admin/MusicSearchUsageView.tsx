import Link from 'next/link'
import {
  UNITS_PER_SEARCH,
  YOUTUBE_DAILY_UNITS,
  type MusicSearchUsage,
} from '@/lib/admin-dashboard/MusicSearchUsageService'

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'))

/** The /admin/music-search readout. Presentational: the page owns the admin gate and the read. */
export function MusicSearchUsageView({
  data,
  error,
  windows,
}: {
  data: MusicSearchUsage | null
  error: string | null
  windows: number[]
}) {
  const days = data?.days ?? 7
  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-music-search">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Music search</h1>
            <p className="text-sm text-white/60">YouTube searches from the chat&apos;s Music tab, against the daily limits.</p>
          </div>
          <nav className="flex gap-2 text-sm">
            {windows.map((w) => (
              <Link key={w} href={`/admin/music-search?days=${w}`}
                className={`rounded-lg border px-3 py-1 ${w === days ? 'border-cyan-300 text-cyan-200' : 'border-white/15 text-white/70'}`}>
                {w === 1 ? 'Today' : `${w}d`}
              </Link>
            ))}
          </nav>
        </div>

        {error || !data ? (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error ?? 'No data.'}</p>
        ) : (
          <>
            <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4 text-base font-semibold text-cyan-50" data-testid="music-search-headline">
              {data.headline}
            </p>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [data.totals.uncountedDays ? 'Searches (counted days)' : 'Searches', fmt(data.totals.searches)],
                ['Answered from cache (free)', fmt(data.totals.fromCache)],
                ['Sent to YouTube', fmt(data.totals.fresh)],
                ['Turned away by a limit', fmt(data.totals.refused)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs text-white/55">{label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
                </div>
              ))}
            </section>

            <Section
              title="By day"
              hint={`Limits: ${data.perPersonLimit} new searches a person, ${data.appLimit} for music as a whole. Each one sent to YouTube costs ${UNITS_PER_SEARCH} of the ${YOUTUBE_DAILY_UNITS.toLocaleString('en-US')} daily units that player highlights also use. Days are UTC.`}
            >
              <Table
                head={['Day', 'Searches', 'From cache', `Sent (of ${data.appLimit})`, 'People', `Used all ${data.perPersonLimit}`, 'Turned away']}
                rows={data.daily.map((d) => [
                  d.day,
                  fmt(d.searches),
                  fmt(d.fromCache),
                  fmt(d.fresh),
                  fmt(d.people),
                  fmt(d.peopleAtLimit),
                  fmt(d.refusedPerson + d.refusedApp),
                ])}
              />
            </Section>

            <p className="text-xs text-white/45">
              &ldquo;People&rdquo; counts only people who searched something new that day; someone who only got cached answers isn&apos;t counted.
              {data.totals.uncountedDays > 0
                ? ` Counting every search started recently: ${data.totals.uncountedDays} ${data.totals.uncountedDays === 1 ? 'day' : 'days'} in this window (shown with a dash) only have YouTube sends, and are left out of the Searches and cache totals.`
                : ''}
            </p>
          </>
        )}
      </div>
    </main>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-bold">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-white/55">{hint}</p> : null}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) return <p className="text-sm text-white/50">Nothing in this window.</p>
  return (
    <table className="w-full min-w-[560px] text-left text-sm">
      <thead className="text-xs uppercase text-white/50">
        <tr>{head.map((h) => <th key={h} className="py-1 pr-3 font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-white/5">{r.map((c, j) => <td key={j} className="py-1.5 pr-3">{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

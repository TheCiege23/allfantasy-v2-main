'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type ProfileResponse = {
  playerId: string
  sport: string
  profile: {
    name: string
    team: string | null
    position: string | null
    height: string | null
    weight: string | null
    age: number | null
    college: string | null
    headshotUrl: string | null
    injuryStatus: string | null
    injuryNotes: string | null
    adp: number | null
    dynastyValue: number | null
  }
  stats: Record<string, unknown> | null
  projections: Record<string, unknown> | null
  news: Array<{
    id: string
    title: string
    content: string | null
    source: string
    sourceUrl: string | null
    publishedAt: string | null
    category: string | null
  }>
  injuries: Array<{
    status: string | null
    type: string | null
    description: string | null
    date: string | null
    source: string
  }>
  sources: {
    profile: string | null
    news: string | null
    injuries: string | null
  }
}

type Props = {
  open: boolean
  playerId: string | null
  sport?: string
  onClose: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function DraftPlayerModal({ open, playerId, sport, onClose }: Props) {
  const [data, setData] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !playerId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    const url = `/api/draft/player-detail?playerId=${encodeURIComponent(playerId)}${sport ? `&sport=${encodeURIComponent(sport)}` : ''}`
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: ProfileResponse) => {
        if (!cancelled) setData(j)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Failed to load player')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, playerId, sport])

  // ESC to close.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open || !playerId) return null

  const p = data?.profile

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      data-testid="draft-player-modal"
    >
      <div
        className="my-8 w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0a1228] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-full border border-white/[0.12] bg-[#07071a]">
              {p?.headshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.headshotUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] text-white/30">—</div>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold leading-tight">{p?.name ?? 'Loading…'}</h2>
              {p ? (
                <p className="text-[12px] text-white/55">
                  {p.position ?? '—'} · {p.team ?? 'FA'}
                  {p.injuryStatus ? (
                    <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase text-rose-200">
                      {p.injuryStatus}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/[0.1] p-1.5 text-white/60 hover:bg-white/[0.06]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Profile</h3>
            {loading ? (
              <p className="mt-2 text-[11px] text-white/40">Loading profile…</p>
            ) : error ? (
              <p className="mt-2 text-[11px] text-amber-300/85">{error}</p>
            ) : p ? (
              <dl className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
                <Cell label="Age" value={p.age ?? 'N/A'} />
                <Cell label="Height" value={p.height ?? 'N/A'} />
                <Cell label="Weight" value={p.weight ? `${p.weight} lbs` : 'N/A'} />
                <Cell label="College" value={p.college ?? 'N/A'} />
                <Cell label="ADP" value={p.adp != null ? p.adp.toFixed(1) : 'N/A'} />
                <Cell label="Dynasty" value={p.dynastyValue != null ? String(p.dynastyValue) : 'N/A'} />
              </dl>
            ) : null}
            {p?.injuryNotes ? (
              <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-100/85">
                {p.injuryNotes}
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Latest news</h3>
            {loading ? (
              <p className="mt-2 text-[11px] text-white/40">Loading news…</p>
            ) : data?.news.length ? (
              <ul className="mt-2 space-y-2">
                {data.news.map((n) => (
                  <li key={n.id} className="rounded-lg border border-white/[0.07] bg-black/25 px-2.5 py-2">
                    <p className="text-[11px] font-semibold text-white">{n.title}</p>
                    <p className="text-[11px] uppercase tracking-wider text-white/40">
                      {formatDate(n.publishedAt)} · {n.source}
                    </p>
                    {n.content ? (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-white/65">{n.content}</p>
                    ) : null}
                    {n.sourceUrl ? (
                      <a
                        href={n.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[11px] text-cyan-300/85 hover:text-cyan-200"
                      >
                        Read source →
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-white/40">No recent news.</p>
            )}
          </section>

          <section className="md:col-span-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Injury history</h3>
            {data?.injuries.length ? (
              <ul className="mt-2 space-y-1.5">
                {data.injuries.map((i, idx) => (
                  <li
                    key={`${i.date ?? 'd'}-${idx}`}
                    className="flex flex-wrap items-baseline gap-2 rounded border border-white/[0.06] bg-black/20 px-2 py-1.5 text-[11px]"
                  >
                    <span className="font-semibold text-white">{i.status ?? '—'}</span>
                    <span className="text-white/55">{i.type ?? ''}</span>
                    {i.description ? <span className="text-white/45">— {i.description}</span> : null}
                    <span className="ml-auto text-[11px] text-white/35">{formatDate(i.date)} · {i.source}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-white/40">No injuries recorded.</p>
            )}
          </section>

          {data?.sources ? (
            <p className="md:col-span-2 text-center text-[11px] text-white/25">
              Sources: profile {data.sources.profile ?? '—'} · news {data.sources.news ?? '—'} · injuries{' '}
              {data.sources.injuries ?? '—'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="text-[12px] font-semibold text-white">{value}</dd>
    </div>
  )
}

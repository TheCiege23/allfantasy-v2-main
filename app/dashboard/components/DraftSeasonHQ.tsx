'use client'

/**
 * DraftSeasonHQ — the seasonal draft command surface on the dashboard, showing
 * ONLY drafts that still matter to act on: leagues that haven't drafted yet
 * (pre_draft) and drafts happening right now (drafting/paused). Completed
 * drafts are deliberately excluded — their report cards live in Legacy.
 *
 * Interaction model: tap a tile to SELECT it (highlight), the detail box below
 * fills with that draft's real facts, and the "Open draft →" button navigates
 * to the league dashboard's draft cockpit. Un-imported leagues get an honest
 * "Import to open draft →" that deep-links the prefilled import instead.
 * Renders nothing outside draft season (no pre-draft or live drafts).
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { DraftListItem } from '@/lib/draft-intel/sleeperDraftIntelService'
import type { UserLeague } from '../types'
import { WarRoomCard } from './warroom/WarRoomCard'
import { SectionHeading } from './warroom/SectionHeading'
import '@/components/decide/broadcast-deck.css'

type ListResponse =
  | { linked: false; drafts: null }
  | { linked: true; season?: string; drafts: DraftListItem[] | null; error?: string }

function countdown(startTime: string): string {
  const ms = new Date(startTime).getTime() - Date.now()
  if (ms <= 0) return 'due now'
  const hours = ms / 3_600_000
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))}m`
  if (hours < 48) return `in ${Math.round(hours)}h`
  return `in ${Math.round(hours / 24)}d`
}

export function DraftSeasonHQ({ leagues }: { leagues: UserLeague[] }) {
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/draft/intel', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<ListResponse>) : null))
      .then((payload) => {
        if (!cancelled && payload?.linked && Array.isArray(payload.drafts)) setDrafts(payload.drafts)
      })
      .catch(() => {
        /* additive */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const afLeagueFor = (sleeperLeagueId: string | null): UserLeague | null =>
    sleeperLeagueId ? leagues.find((l) => l.sleeperLeagueId === sleeperLeagueId) ?? null : null

  // Only drafts still to be commanded: not-yet-drafted and live/paused. Completed
  // drafts are excluded by request — this is a pre-game surface, not an archive.
  const live = (drafts ?? []).filter((d) => d.status === 'drafting' || d.status === 'paused')
  const upcoming = (drafts ?? [])
    .filter((d) => d.status === 'pre_draft')
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const relevant = [...live, ...upcoming]
  if (!loading && relevant.length === 0) return null

  const selected = relevant.find((d) => d.draftId === selectedId) ?? null
  const selectedAf = selected ? afLeagueFor(selected.leagueId) : null
  const selectedHref = selected
    ? selectedAf
      ? `/league/${selectedAf.id}?view=draft_intel`
      : selected.leagueId
        ? `/import?provider=sleeper&leagueId=${encodeURIComponent(selected.leagueId)}&returnTo=/dashboard`
        : '/import?returnTo=/dashboard'
    : null

  const Tile = ({ d }: { d: DraftListItem }) => {
    const af = afLeagueFor(d.leagueId)
    const isLive = d.status === 'drafting'
    const isSelected = d.draftId === selectedId
    return (
      <button
        type="button"
        onClick={() => setSelectedId((cur) => (cur === d.draftId ? null : d.draftId))}
        aria-pressed={isSelected}
        className="min-w-[190px] shrink-0 cursor-pointer rounded-xl border border-[#262c6a] bg-[#12163e]/70 p-3 text-left transition hover:bg-[#12163e]"
        style={{
          ...(isLive ? { borderColor: '#3ddc97', boxShadow: '0 0 18px rgba(61,220,151,0.14)' } : undefined),
          ...(isSelected
            ? { borderColor: '#ff3d81', boxShadow: '0 0 0 2px rgba(255,61,129,0.35), 0 0 22px rgba(255,61,129,0.18)', background: '#171c4d' }
            : undefined),
        }}
      >
        <div className="truncate text-[11px] font-extrabold text-[#f0f2ff]">{af?.name ?? d.name}</div>
        <div className="mt-1">
          {isLive ? (
            <span className="bdx-sev ok">● LIVE now</span>
          ) : d.status === 'paused' ? (
            <span className="bdx-sev warn">⏸ paused</span>
          ) : (
            <span className="text-[16px] font-black italic text-[#ff8a3d]">
              {d.startTime ? countdown(d.startTime) : 'scheduled'}
            </span>
          )}
        </div>
        <div className="mt-1 text-[9.5px] text-[#5d64a3]">
          {d.teams || '—'} teams · {d.rounds || '—'} rounds
          {d.startTime && d.status === 'pre_draft'
            ? ` · ${new Date(d.startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
            : ''}
          {!af ? ' · not imported' : ''}
        </div>
      </button>
    )
  }

  return (
    <WarRoomCard className="p-4 sm:p-5" data-testid="draft-season-hq">
      <SectionHeading
        trailing={
          <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
            {live.length} live · {upcoming.length} upcoming
          </span>
        }
      >
        Draft season HQ
      </SectionHeading>
      {loading ? (
        <div className="bdx-skel" style={{ height: 56, marginTop: 12 }} />
      ) : (
        <div className="bdx" style={{ background: 'transparent', padding: 0 }}>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {relevant.map((d) => (
              <Tile key={d.draftId} d={d} />
            ))}
          </div>

          {/* ── Selected-draft detail box — fills on tile tap, holds the real CTA ── */}
          {selected ? (
            <div
              className="mt-3 rounded-xl border p-4"
              style={{ borderColor: '#ff3d81', background: 'linear-gradient(180deg, rgba(255,61,129,0.08), rgba(18,22,62,0.7))' }}
              data-testid="draft-hq-detail"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-black italic text-[#f0f2ff]">
                    {selectedAf?.name ?? selected.name}
                  </div>
                  <div className="mt-1 text-[11px] text-[#8a91c9]">
                    {selected.status === 'drafting' ? (
                      <span className="bdx-sev ok">● LIVE now</span>
                    ) : selected.status === 'paused' ? (
                      <span className="bdx-sev warn">⏸ paused</span>
                    ) : (
                      <>Starts {selected.startTime ? `${new Date(selected.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${countdown(selected.startTime)})` : 'TBD'}</>
                    )}
                    {' · '}{selected.teams || '—'} teams · {selected.rounds || '—'} rounds
                    {selected.season ? ` · ${selected.season} season` : ''}
                  </div>
                  {!selectedAf && (
                    <div className="mt-1 text-[10.5px] text-[#ff8a3d]">
                      Not imported yet — import it to unlock the draft cockpit (needs, market values, run detection in your exact format).
                    </div>
                  )}
                </div>
                <Link
                  href={selectedHref!}
                  className="shrink-0 rounded-lg px-4 py-2 text-[12px] font-extrabold text-white"
                  style={{ background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
                  data-testid="draft-hq-open"
                >
                  {selectedAf ? 'Open draft →' : 'Import to open draft →'}
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[10px] leading-snug text-[#5d64a3]">
              Tap a draft to see its details and open the Live Intel cockpit (needs, market values,
              run detection pre-loaded from your league&apos;s exact format).
            </p>
          )}
        </div>
      )}
    </WarRoomCard>
  )
}

export default DraftSeasonHQ

'use client'

import { useCallback, useState } from 'react'
import {
  fetchTradeDiscovery,
  fetchTradePackages,
  type TradePartnerMatch,
  type TradePackageSuggestion,
} from '@/lib/redraft/client'

function flag(f: string) {
  return f.toLowerCase().replace(/_/g, ' ')
}

/**
 * T7 "Find a Trade" — deterministic partner matching + package ideas for the viewer's own roster.
 * Suggestions only; "Build proposal" preselects the partner in the Trade Center modal (never
 * auto-submits). No AI, no value mutation.
 */
export function TradeDiscoveryPanel({
  leagueId,
  myRosterId,
  onBuildProposal,
}: {
  leagueId: string
  myRosterId: string
  onBuildProposal: (partnerRosterId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [partners, setPartners] = useState<TradePartnerMatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pkgFor, setPkgFor] = useState<string | null>(null)
  const [packages, setPackages] = useState<TradePackageSuggestion[]>([])
  const [pkgLoading, setPkgLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchTradeDiscovery({ leagueId, rosterId: myRosterId })
      setPartners(res.partners)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trade discovery')
    } finally {
      setLoading(false)
    }
  }, [leagueId, myRosterId])

  const loadPackages = useCallback(
    async (partnerRosterId: string) => {
      setPkgFor(partnerRosterId)
      setPkgLoading(true)
      setPackages([])
      try {
        const res = await fetchTradePackages({ leagueId, myRosterId, partnerRosterId })
        setPackages(res.suggestedPackages)
      } catch {
        setPackages([])
      } finally {
        setPkgLoading(false)
      }
    },
    [leagueId, myRosterId],
  )

  return (
    <div className="rounded-lg border border-[#ff9ec0]/15 bg-[#ff3d81]/[0.05]" data-testid="trade-discovery-panel">
      <button
        type="button"
        data-testid="trade-discovery-toggle"
        onClick={() => {
          setOpen((v) => !v)
          if (!partners && !loading) void load()
        }}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-[#ffd7e5]"
      >
        <span>Find a Trade — best partners &amp; package ideas</span>
        <span className="text-[#ffb8d1]/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-[#ff9ec0]/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">Finding partners…</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : partners && partners.length ? (
            partners.slice(0, 5).map((p) => (
              <div key={p.rosterId} className="rounded border border-white/10 bg-black/20 p-2" data-testid="discovery-partner-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{p.teamName}</span>
                  <span className="rounded border border-[#ff9ec0]/40 bg-[#ff3d81]/10 px-1.5 py-0.5 text-[10px] text-[#ffd7e5]">Match {p.matchScore}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                  {p.partnerNeeds.map((n) => (
                    <span key={`n${n}`} className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-200/80">needs {n}</span>
                  ))}
                  {p.partnerSurpluses.map((s) => (
                    <span key={`s${s}`} className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-200/80">has {s}</span>
                  ))}
                </div>
                <ul className="mt-1 space-y-0.5 text-[10px] text-white/60">
                  {p.matchReasons.slice(0, 2).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid={`discovery-packages-${p.rosterId}`}
                    onClick={() => void loadPackages(p.rosterId)}
                    className="rounded border border-white/20 px-2 py-1 text-[10px] text-white/80"
                  >
                    Package ideas
                  </button>
                  <button
                    type="button"
                    data-testid={`discovery-build-${p.rosterId}`}
                    onClick={() => onBuildProposal(p.rosterId)}
                    className="rounded bg-[#ff3d81]/85 px-2 py-1 text-[10px] font-semibold text-black"
                  >
                    Build proposal
                  </button>
                </div>

                {pkgFor === p.rosterId ? (
                  <div className="mt-1.5 border-t border-white/10 pt-1.5" data-testid="discovery-packages">
                    {pkgLoading ? (
                      <p className="text-white/45">Generating packages…</p>
                    ) : packages.length ? (
                      packages.map((pkg) => (
                        <div key={pkg.packageId} className="mb-1 text-[10px] text-white/70">
                          <span className="text-white/80">
                            {pkg.giveAssets.map((a) => (a.kind === 'faab' ? `$${a.faabAmount} FAAB` : a.playerName)).join(' + ')}
                            {' → '}
                            {pkg.receiveAssets.map((a) => a.playerName).join(' + ')}
                          </span>
                          <span className="ml-2 text-white/45">[{pkg.fairnessBand}]</span>
                          {pkg.warningFlags.length ? (
                            <span className="ml-1 text-amber-200/70">{pkg.warningFlags.map(flag).join(', ')}</span>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-white/45">No clean package ideas yet — try building manually.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-white/45">No trade partners surfaced yet.</p>
          )}
          <p className="text-[9px] text-white/35">Suggestions only. You always review and send the trade. No values are changed.</p>
        </div>
      ) : null}
    </div>
  )
}

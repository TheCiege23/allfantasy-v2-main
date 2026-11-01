'use client'

import { useCallback, useState } from 'react'
import {
  fetchTradeDiscovery,
  fetchTradePackages,
  type TradePartnerMatch,
  type TradePackageSuggestion,
} from '@/lib/redraft/client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tOr } from '@/lib/i18n/tInterpolate'
import { matchReasonsText, serverErrorText } from '@/lib/i18n/trade-center-server-text'

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
  const { t, tInterpolate, language } = useOptionalLanguage()
  // Codes with copy translate; an unknown one keeps its old readable form rather than a raw key.
  const flagLabel = (f: string) => tOr(t, `tradeCenter.discovery.flag.${f}`, flag(f))
  const fairnessLabel = (band: string) => tOr(t, `tradeCenter.discovery.fairness.${band.replace(/ /g, '_')}`, band)
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
      setError(e instanceof Error ? serverErrorText(e as Error & { code?: string | null }, e.message, t, language) : t('tradeCenter.discovery.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [leagueId, myRosterId, t, language])

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
        <span>{t('tradeCenter.discovery.toggle')}</span>
        <span className="text-[#ffb8d1]/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-[#ff9ec0]/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">{t('tradeCenter.discovery.finding')}</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : partners && partners.length ? (
            partners.slice(0, 5).map((p) => (
              <div key={p.rosterId} className="rounded border border-white/10 bg-black/20 p-2" data-testid="discovery-partner-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{p.teamName}</span>
                  <span className="rounded border border-[#ff9ec0]/40 bg-[#ff3d81]/10 px-1.5 py-0.5 text-[11px] text-[#ffd7e5]">{tInterpolate('tradeCenter.discovery.match', { score: p.matchScore })}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {p.partnerNeeds.map((n) => (
                    <span key={`n${n}`} className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-200/80">{tInterpolate('tradeCenter.discovery.needs', { position: n })}</span>
                  ))}
                  {p.partnerSurpluses.map((s) => (
                    <span key={`s${s}`} className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-200/80">{tInterpolate('tradeCenter.discovery.has', { position: s })}</span>
                  ))}
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-white/60">
                  {matchReasonsText(p, t, language).slice(0, 2).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid={`discovery-packages-${p.rosterId}`}
                    onClick={() => void loadPackages(p.rosterId)}
                    className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/80"
                  >
                    {t('tradeCenter.discovery.packageIdeas')}
                  </button>
                  <button
                    type="button"
                    data-testid={`discovery-build-${p.rosterId}`}
                    onClick={() => onBuildProposal(p.rosterId)}
                    className="rounded bg-[#ff3d81]/85 px-2 py-1 text-[11px] font-semibold text-black"
                  >
                    {t('tradeCenter.discovery.buildProposal')}
                  </button>
                </div>

                {pkgFor === p.rosterId ? (
                  <div className="mt-1.5 border-t border-white/10 pt-1.5" data-testid="discovery-packages">
                    {pkgLoading ? (
                      <p className="text-white/45">{t('tradeCenter.discovery.generating')}</p>
                    ) : packages.length ? (
                      packages.map((pkg) => (
                        <div key={pkg.packageId} className="mb-1 text-[11px] text-white/70">
                          <span className="text-white/80">
                            {pkg.giveAssets.map((a) => (a.kind === 'faab' ? `$${a.faabAmount} FAAB` : a.playerName)).join(' + ')}
                            {' → '}
                            {pkg.receiveAssets.map((a) => a.playerName).join(' + ')}
                          </span>
                          <span className="ml-2 text-white/45">[{fairnessLabel(pkg.fairnessBand)}]</span>
                          {pkg.warningFlags.length ? (
                            <span className="ml-1 text-amber-200/70">{pkg.warningFlags.map(flagLabel).join(', ')}</span>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-white/45">{t('tradeCenter.discovery.noPackages')}</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-white/45">{t('tradeCenter.discovery.noPartners')}</p>
          )}
          <p className="text-[11px] text-white/35">{t('tradeCenter.discovery.footer')}</p>
        </div>
      ) : null}
    </div>
  )
}

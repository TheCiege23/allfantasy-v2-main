'use client'

/**
 * WaiverIntel — the FAAB bid suggester: league bid history (real winning
 * claims since founding) + market-value-anchored suggestions for available
 * players, needs-tagged. Every formula renders verbatim from the payload.
 */

import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useWaiverIntel } from './useWaiverIntel'
import './broadcast-deck.css'

/**
 * `surface="core"` when mounted on the /core Waivers screen. Every rule in broadcast-deck.css is
 * scoped under `.bdx`, which only the Decide deck provides — so on /core this panel rendered as raw,
 * unstyled HTML (browser fonts, labels running into their values). The wrapper supplies `.bdx`
 * without the deck's full-page ground and maps its palette onto /core's own tokens.
 */
export function WaiverIntel({ leagueId, surface = 'deck' }: { leagueId: string; surface?: 'deck' | 'core' }) {
  /* Shared with the lineup list on the same screen — one request between them (useWaiverIntel). */
  const { data, loading } = useWaiverIntel(leagueId)
  /*
   * Spanish, including the service's own sentences — the reasoning lines and formula notes are written
   * on the server in English whatever the reader chose, so each goes through `copy`, whose patterns
   * rebuild the templated ones around their numbers.
   */
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)

  if (data && !data.supported) return null
  const intel = data && data.supported ? data.intel : null

  return (
    <div
      data-testid="waiver-intel"
      className={surface === 'core' ? 'bdx bdx-embed bdx-embed-core' : undefined}
      style={{ marginTop: 18 }}
    >
      <div className="bdx-kick">
        <h2 className="bdx-disp">{es ? 'Inteligencia de agentes libres' : 'Waiver intelligence'}</h2>
        <span className="bdx-sub">
          {intel
            ? es
              ? `${intel.budget != null ? `presupuesto de $${intel.budget}` : 'sin presupuesto FAAB'}${intel.myRemaining != null ? ` · te quedan $${intel.myRemaining}` : ''}`
              : `${intel.budget != null ? `$${intel.budget} budget` : 'no FAAB budget set'}${intel.myRemaining != null ? ` · you have $${intel.myRemaining} left` : ''}`
            : es
              ? 'ofertas calibradas con esta liga y el mercado'
              : 'bids calibrated to this room + the market'}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : !intel ? (
        <div className="bdx-empty">
          <div className="t">{es ? 'Inteligencia de agentes libres no disponible por ahora' : 'Waiver intelligence temporarily unavailable'}</div>
          <div className="m">
            {es
              ? 'La primera sincronización revisa todos los reclamos de la historia de la liga: inténtalo de nuevo en un momento.'
              : 'The first sync scans every waiver claim in league history — try again shortly.'}
          </div>
        </div>
      ) : (
        /*
          ⚠ A CLASS, NOT AN INLINE `gridTemplateColumns`. The inline style beat the deck's own
          `@media (max-width: 960px) { .bdx-support { 1fr } }`, so on a phone the targets and the
          bid history stayed two cramped columns side by side. See `.bdx-support--wide`.
        */
        <div className="bdx-support bdx-support--wide">
          {/* Targets */}
          <div className="bdx-panelbox">
            {/*
              Named by source. The Chimmy panel further down this screen suggests its own FAAB
              figure from a different model; two bare "bid" numbers on one page read as one
              system contradicting itself.
            */}
            <h3>{es ? 'Mejores disponibles · ofertas según el historial de esta liga' : "Top available · bids from this room's history"}</h3>
            {intel.targets.length > 0 ? (
              <div className="bdx-rows">
                {intel.targets.slice(0, 8).map((t) => {
                  const src = sleeperPlayerHeadshot(t.playerId)
                  const reasons = t.reasoning.map(copy).join(' · ')
                  return (
                    <div className="bdx-row" key={t.playerId} style={{ alignItems: 'center' }}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: '#1c2153', flex: 'none' }}
                          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
                        />
                      ) : null}
                      <span className="x" style={{ textAlign: 'left', flex: 1 }} title={reasons}>
                        {t.name}
                        <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
                          {' '}
                          {t.position ?? ''}
                          {t.team ? ` · ${t.team}` : ''}
                          {t.marketValue != null ? ` · ${es ? 'valor' : 'value'} ${t.marketValue.toLocaleString()}` : ''}
                        </span>{' '}
                        {t.fillsSlots.length > 0 ? (
                          <span className="bdx-sev ok">▲ {es ? 'ocupa' : 'fills'} {t.fillsSlots.join(' / ')}</span>
                        ) : null}
                        {/* Before the bid, on the row itself: a manager surviving one week must not
                            read "bid ~$600" on a player who cannot play this week. */}
                        {t.unavailable ? (
                          <span className={`bdx-sev ${t.unavailable.kind === 'bye' ? 'warn' : 'crit'}`} data-testid="waiver-intel-unavailable">
                            {t.unavailable.kind === 'bye'
                              ? es
                                ? 'descansa esta semana'
                                : 'bye this week'
                              : es
                                ? `${copy(t.unavailable.status)} · no juega esta semana`
                                : `${t.unavailable.status} · can't play this week`}
                          </span>
                        ) : null}
                        {/*
                          The why, on the page — it used to live only in `title`, and a phone or a
                          tablet has no hover, so iOS and Android readers never saw it.
                        */}
                        {t.reasoning.length > 0 ? <span className="bdx-reason">{reasons}</span> : null}
                      </span>
                      <span className="k" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {t.suggestedBid != null ? `${es ? 'oferta' : 'bid'} ~$${t.suggestedBid}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bdx-rail-empty">
                {es
                  ? 'Ahora no hay agentes libres con valor de mercado: ya se los llevaron a todos.'
                  : 'No market-relevant free agents right now — the pool is picked clean.'}
              </div>
            )}
          </div>

          {/* League history */}
          <div className="bdx-panelbox">
            <h3>
              {es ? `Cómo oferta esta liga · ${intel.history.claims} reclamos ganados` : `How this room bids · ${intel.history.claims} winning claims`}
            </h3>
            <div className="bdx-rows" style={{ marginBottom: 8 }}>
              <div className="bdx-row"><span className="k">{es ? 'Oferta ganadora mediana' : 'Median winning bid'}</span><span className="x">{intel.history.medianBid != null ? `$${intel.history.medianBid}` : '—'}</span></div>
              <div className="bdx-row"><span className="k">{es ? 'Percentil 75' : '75th percentile'}</span><span className="x">{intel.history.p75Bid != null ? `$${intel.history.p75Bid}` : '—'}</span></div>
              <div className="bdx-row"><span className="k">{es ? 'La oferta más alta' : 'Biggest bid ever'}</span><span className="x">{intel.history.topBid != null ? `$${intel.history.topBid}` : '—'}</span></div>
            </div>
            {intel.history.recent.length > 0 ? (
              <>
                <div className="bdx-sub" style={{ marginBottom: 3 }}>{es ? 'Ganadores recientes' : 'Recent winners'}</div>
                <div className="bdx-rows">
                  {intel.history.recent.map((b, i) => (
                    <div className="bdx-row" key={i}>
                      <span className="x" style={{ textAlign: 'left', flex: 1, fontSize: 12 }}>
                        {b.playerName}
                        <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
                          {' '}{b.position ?? ''} · {b.season} {es ? 'sem' : 'wk'} {b.week}
                        </span>
                      </span>
                      <span className="k">${b.bid}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="bdx-rail-empty" style={{ marginTop: 8 }}>
              {intel.formulaNotes.map(copy).join(' ')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WaiverIntel

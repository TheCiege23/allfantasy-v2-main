'use client'

import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import type { TradePickPreviewBook } from '@/lib/trade-value-console/pickPreview'
import type { PickCoverage, RosterPick } from './useLeagueRosters'
import { rosterPickAsset, type PickedAsset } from './TradeAssetPicker'
import '@/components/core-app/af-trade-dynasty.css'

/**
 * The Trades screen's "Your draft capital" panel — dynasty leagues only. In dynasty, picks are half the
 * market, and the builder only showed them one at a time inside the asset picker. This lays out every
 * pick you hold by draft year, first-rounders in gold, and a tap puts one on your side of the deal.
 *
 * ⚠ NO NEW READ AND NO SECOND PRICING. The picks are the viewer's roster from the SAME
 * `/trades/rosters` read the builder already makes (`myRoster.picks`), and a tap goes through
 * `rosterPickAsset` — the mapping the asset picker uses — so a pick added here is priced and proposed
 * exactly as one added there. An imported league's pick is listed but marked "analysis only", as the
 * picker marks it, because its id cannot be sent in an offer.
 */

/**
 * One pick's identity in the deal. Not `pickId`: an imported league's pick goes into the deal with a
 * null id (it cannot be proposed), so the id alone would let the same pick be added twice.
 */
export function pickDealKey(a: { year: number; round: number; label: string }): string {
  return `${a.year}|${a.round}|${a.label}`
}

const ORDINAL_EN = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']

const dynastyPickCapitalMessages = defineMessages({
  en: {
    title: 'Your draft capital',
    total: (n: number): string => (n === 1 ? 'pick held' : 'picks held'),
    firsts: (n: number) => (n === 1 ? '1 first-rounder' : `${n} first-rounders`),
    hint: 'Tap a pick to offer it.',
    hintAnalysis: 'Tap a pick to add it to the deal. Picks in this league are traded on its own platform, so they are for analysis here.',
    via: (team: string) => `via ${team}`,
    inDeal: 'In deal',
    add: (label: string) => `Offer ${label}`,
    added: (label: string) => `${label} is already in the deal`,
    tradedOnly: 'Only picks that changed hands are on file — your own picks are not listed.',
    none: 'You hold no picks in the next drafts on file.',
    round: (n: number): string => ORDINAL_EN[n] ?? `R${n}`,
  },
  es: {
    title: 'Tu capital de draft',
    total: (n) => (n === 1 ? 'selección en tu poder' : 'selecciones en tu poder'),
    firsts: (n) => (n === 1 ? '1 de primera ronda' : `${n} de primera ronda`),
    hint: 'Toca una selección para ofrecerla.',
    hintAnalysis: 'Toca una selección para añadirla al intercambio. En esta liga las selecciones se intercambian en su propia plataforma, así que aquí son solo para análisis.',
    via: (team) => `vía ${team}`,
    inDeal: 'En el trato',
    add: (label) => `Ofrecer ${label}`,
    added: (label) => `${label} ya está en el intercambio`,
    tradedOnly: 'Solo están registradas las selecciones que cambiaron de manos; las tuyas propias no aparecen.',
    none: 'No tienes selecciones en los próximos drafts registrados.',
    round: (n) => `${n}.ª`,
  },
})

export function DynastyPickCapitalPanel(props: {
  picks: RosterPick[]
  coverage: PickCoverage | null | undefined
  leagueId: string | null | undefined
  book: TradePickPreviewBook | null | undefined
  /** `pickDealKey`s already on your side of the deal, so their chips read "In deal" instead of adding twice. */
  inDeal: ReadonlySet<string>
  onAdd: (asset: PickedAsset) => void
}) {
  const m = useMessages(dynastyPickCapitalMessages)
  const held = props.picks.filter((p) => p.season != null && p.round != null)
  if (held.length === 0 && props.coverage !== 'traded_only') return null
  const bySeason = new Map<number, RosterPick[]>()
  for (const p of [...held].sort((a, b) => (a.season! - b.season!) || (a.round! - b.round!))) {
    const list = bySeason.get(p.season!) ?? []
    list.push(p)
    bySeason.set(p.season!, list)
  }
  const firsts = held.filter((p) => p.round === 1).length
  const analysisOnly = held.length > 0 && held.every((p) => p.proposable === false)
  return (
    <section className="af-tc-dyn" aria-labelledby="af-tc-dyn-title" data-testid="dynasty-pick-capital">
      <header className="af-tc-dyn-head">
        <h2 id="af-tc-dyn-title">{m.title}</h2>
        <p className="af-tc-dyn-total">
          <strong>{held.length}</strong> <span>{m.total(held.length)}</span>
          {firsts > 0 ? <em>{m.firsts(firsts)}</em> : null}
        </p>
      </header>
      {held.length > 0 ? (
        <>
          <ol className="af-tc-dyn-years">
            {[...bySeason].map(([season, picks]) => (
              <li key={season} className="af-tc-dyn-year">
                <span className="af-tc-dyn-season">{season}</span>
                <span className="af-tc-dyn-chips">
                  {picks.map((p) => {
                    const asset = rosterPickAsset(p, props.leagueId, props.book)
                    const added = props.inDeal.has(pickDealKey(asset))
                    const round = m.round(p.round!)
                    const name = `${season} ${round}`
                    return (
                      <button
                        key={p.pickId}
                        type="button"
                        className="af-tc-dyn-pick"
                        data-round={p.round === 1 ? '1' : undefined}
                        data-added={added || undefined}
                        disabled={added}
                        aria-label={added ? m.added(name) : m.add(p.fromTeam ? `${name} (${m.via(p.fromTeam)})` : name)}
                        onClick={() => props.onAdd(asset)}
                      >
                        <span className="af-tc-dyn-round">{round}</span>
                        {added ? <small>{m.inDeal}</small> : p.fromTeam ? <small>{m.via(p.fromTeam)}</small> : null}
                      </button>
                    )
                  })}
                </span>
              </li>
            ))}
          </ol>
          <p className="af-tc-dyn-hint">{analysisOnly ? m.hintAnalysis : m.hint}</p>
        </>
      ) : null}
      {props.coverage === 'traded_only' ? <p className="af-tc-dyn-hint">{m.tradedOnly}</p> : null}
    </section>
  )
}

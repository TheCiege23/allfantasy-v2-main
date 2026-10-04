'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ClubLogo } from '@/components/core-app/ClubLogo'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { slotText } from '@/lib/core-app/playerMovesCopy'
import { ageText } from '@/lib/core-app/shellCopy'
import type { TriageSlot } from '@/components/core-app/screens/Dash3ATriage'

/**
 * The words of Dash3ATriage, in the reader's language (2026-10-04).
 *
 * The strip is a SERVER component: it keeps the decision slice (starters who may not play), the cap,
 * every href, and each row's minutes to kickoff against the server's `now`. This says it. The injury
 * designation goes through `coreUiCopy`, the report age through shellCopy's `ageText`, the slot chip
 * through `slotText` — the same translators the rest of /core uses. The feed's own description is the
 * provider's sentence and stays as written, as it does on every surface that shows it.
 */
export type TriageViewLeague = {
  id: string
  name: string
  platform: string
  href: string
  slot: TriageSlot | null
  /** Same-position cover on your bench here — names only, only where he starts. */
  bench: string[]
}

export type TriageViewRow = {
  key: string
  name: string
  initials: string
  imageUrl: string | null
  playerHref: string
  position: string | null
  team: string | null
  sport: string | null
  status: string
  tone: 'bad' | 'warn'
  exposure: string
  exposureCount: number
  exposureTotal: number
  startingIn: number
  benchIn: number
  irIn: number
  taxiIn: number
  value: { overallRank: number | null; positionRank: number | null } | null
  reportedAgo: string | null
  /** Minutes from the server's `now` to his club's next kickoff; null when none is held. */
  kickoffMins: number | null
  description: string | null
  /** The first six leagues; `leagueCount` says how many there are. */
  leagues: TriageViewLeague[]
  leagueCount: number
  /** "Find free agents in …" — one per league where he STARTS. */
  freeAgentLinks: Array<{ id: string; name: string; href: string }>
}

const SLOT_LABEL: Record<TriageSlot, string> = { starter: 'STARTER', bench: 'bench', ir: 'IR', taxi: 'taxi' }

function slotLabel(slot: TriageSlot, es: boolean): string {
  if (!es) return SLOT_LABEL[slot]
  if (slot === 'starter') return slotText('STARTER', 'es')
  if (slot === 'bench') return slotText('BENCH', 'es').toLowerCase()
  return SLOT_LABEL[slot]
}

function kickoffLabel(mins: number | null, es: boolean): string | null {
  if (mins == null) return null
  if (mins <= 0) return es ? 'partido en curso' : 'kickoff underway'
  if (mins < 60) return es ? `inicio en ${mins} min` : `kickoff in ${mins}m`
  if (mins < 48 * 60) return es ? `inicio en ${Math.round(mins / 60)} h` : `kickoff in ${Math.round(mins / 60)}h`
  return es ? `inicio en ${Math.round(mins / (60 * 24))} d` : `kickoff in ${Math.round(mins / (60 * 24))}d`
}

/** "starting in 3, benched in 5, on IR in 1" — only the counts that are non-zero. */
function slotSummary(p: TriageViewRow, es: boolean): string {
  return [
    p.startingIn > 0 ? (es ? `titular en ${p.startingIn}` : `starting in ${p.startingIn}`) : null,
    p.benchIn > 0 ? (es ? `en la banca en ${p.benchIn}` : `benched in ${p.benchIn}`) : null,
    p.irIn > 0 ? (es ? `en IR en ${p.irIn}` : `on IR in ${p.irIn}`) : null,
    p.taxiIn > 0 ? (es ? `en el taxi en ${p.taxiIn}` : `on taxi in ${p.taxiIn}`) : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export function Dash3ATriageView({
  rows,
  overflow,
  valueBasis,
  freshness,
}: {
  rows: TriageViewRow[]
  overflow: number
  /** Present only when a row carries a price — see the band. */
  valueBasis: { format: string; qbFormat: string } | null
  freshness: ReactNode
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const title = es ? 'Titulares en duda' : 'Starters in doubt'

  return (
    <section className="af-core af-triage" aria-label={title}>
      <div className="af-triage-head">
        <h2 className="af-triage-title">{title}</h2>
        <TopicTip topic="startersInDoubt" />
        <span className="af-triage-sub">
          {es ? 'puede que no jueguen esta semana · los más valiosos primero' : 'may not play this week · most valuable first'}
        </span>
      </div>
      <ul className="af-triage-list">
        {rows.map((p) => {
          const kickoff = kickoffLabel(p.kickoffMins, es)
          const summary = slotSummary(p, es)
          return (
            <li key={p.key} className="af-triage-row" data-tone={p.tone}>
              {p.imageUrl ? (
                <FallbackImg
                  className="af-triage-avatar"
                  src={p.imageUrl}
                  alt=""
                  loading="lazy"
                  fallback={
                    <span className="af-triage-avatar af-triage-avatar--initials" aria-hidden>
                      {p.initials}
                    </span>
                  }
                />
              ) : (
                <span className="af-triage-avatar af-triage-avatar--initials" aria-hidden>
                  {p.initials}
                </span>
              )}
              <div className="af-triage-main">
                <div className="af-triage-line1">
                  <Link className="af-triage-name" href={p.playerHref}>
                    {p.name}
                  </Link>
                  <span className="af-triage-meta">
                    {[p.position, p.team].filter(Boolean).join(' · ')}
                    {String(p.sport ?? '').toUpperCase() === 'NFL' ? (
                      <ClubLogo club={p.team} size={14} style={{ marginLeft: 6 }} />
                    ) : null}
                  </span>
                  <span className="af-triage-status" data-tone={p.tone}>
                    {coreUiCopy(p.status, language)}
                  </span>
                </div>
                <div className="af-triage-line2">
                  <span className="af-triage-exposure">
                    {/*
                      One sentence, not two overlapping ones. It read
                      "7 of 61 leagues · starter in 3 · bench in 3 · IR in 1",
                      which states the total and then its own parts as though
                      they were separate facts, and leaves the reader adding up
                      to check.
                    */}
                    {es ? `En ${p.exposureCount} de ${p.exposureTotal} ligas` : `In ${p.exposure} leagues`}
                    {summary ? `: ${summary}` : ''}
                  </span>
                  {p.value ? (
                    /*
                     * Rank leads because it is cross-positional and needs no
                     * scale to read; the raw price follows it. Absent renders
                     * nothing at all — a player we hold no price for must not
                     * look like a player priced at nothing.
                     */
                    <span className="af-triage-value af-num">
                      {/*
                        "#14 overall · RB4" made the reader guess what the
                        number ranked. Naming the thing costs three words.
                      */}
                      {es ? 'Valor de intercambio:' : 'Trade value:'}{' '}
                      {p.value.positionRank != null && p.position ? `${p.position}${p.value.positionRank}` : null}
                      {p.value.positionRank != null && p.value.overallRank != null ? ', ' : ''}
                      {p.value.overallRank != null ? `#${p.value.overallRank} ${coreUiCopy('overall', language)}` : null}
                    </span>
                  ) : null}
                  {p.reportedAgo ? (
                    <span className="af-triage-ago">
                      {es ? `reportado ${ageText(p.reportedAgo, 'es')}` : `reported ${p.reportedAgo}`}
                    </span>
                  ) : null}
                  {kickoff ? <span className="af-triage-kickoff">{kickoff}</span> : null}
                </div>
                {p.description ? (
                  /* The feed's own sentence. Never paraphrased into a timeline —
                     no injury table here holds an expected return. */
                  <p className="af-triage-note">{p.description}</p>
                ) : null}
                {p.leagues.length > 0 ? (
                  <div className="af-triage-leagues">
                    {p.leagues.map((l) => (
                      <Link key={l.id} href={l.href} className="af-triage-league" data-slot={l.slot ?? undefined}>
                        <span className="af-triage-league-platform">{l.platform.toUpperCase()}</span>
                        {l.name}
                        {/* Where he sits in THIS league — the difference between
                            "act here" and "no action needed". Absent when the
                            roster could not be read; never defaulted to bench. */}
                        {l.slot ? (
                          <span className="af-triage-slot" data-slot={l.slot}>
                            {slotLabel(l.slot, es)}
                          </span>
                        ) : null}
                        {/*
                          Cover you already own, in this league. Free agents
                          need that league's whole player pool and a
                          rostered-elsewhere exclusion — a per-league scan that
                          must not run for 61 leagues on a render — so they
                          live behind the CTA below. An empty bench here is not
                          a gap in the data; it is the reason to go look.
                        */}
                        {l.slot === 'starter' && l.bench.length > 0 ? (
                          <span className="af-triage-bench">
                            {' '}
                            {es ? `pon a ${l.bench.join(' o ')}` : `swap in ${l.bench.join(' or ')}`}
                          </span>
                        ) : null}
                      </Link>
                    ))}
                    {p.leagueCount > p.leagues.length ? (
                      <span className="af-triage-league af-triage-league--more">
                        {es ? `+${p.leagueCount - p.leagues.length} más` : `+${p.leagueCount - p.leagues.length} more`}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="af-triage-actions">
                {p.freeAgentLinks.length > 0 ? (
                  p.freeAgentLinks.map((l) => (
                    <Link key={l.id} className="af-triage-cta" href={l.href}>
                      {es ? `Buscar agentes libres en ${l.name}` : `Find free agents in ${l.name}`}
                    </Link>
                  ))
                ) : (
                  <Link className="af-triage-cta" href="/core/players">
                    {es ? `Abrir ${coreUiCopy('Player Finder', 'es')}` : 'Open Player Finder'}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {overflow > 0 ? (
        <Link className="af-triage-overflow" href="/my-players">
          {es
            ? `+${overflow} titulares señalados más: auditoría completa de exposición`
            : `+${overflow} more starters flagged — full exposure audit`}
        </Link>
      ) : null}
      {valueBasis ? (
        /*
         * Said once for the panel. The price is captured at 12 teams and full
         * PPR and varies only dynasty/redraft and 1QB/superflex — it is NOT
         * tuned to this account's TE-premium or superflex settings, and
         * pretending otherwise would be the quiet kind of lie this screen
         * exists to avoid.
         */
        <p className="af-triage-basis">
          {es ? (
            <>
              Valores de FantasyCalc ({valueBasis.format.toLowerCase()}, {valueBasis.qbFormat === 'ONE_QB' ? '1QB' : 'superflex'}, PPR
              de 12 equipos). No están ajustados a la configuración de tu liga, y son solo de la NFL.
            </>
          ) : (
            <>
              Values from FantasyCalc ({valueBasis.format.toLowerCase()},{' '}
              {valueBasis.qbFormat === 'ONE_QB' ? '1QB' : 'superflex'}, 12-team PPR). Not tuned to
              your league&rsquo;s settings, and NFL only.
            </>
          )}
        </p>
      ) : null}
      {freshness}
    </section>
  )
}

export default Dash3ATriageView

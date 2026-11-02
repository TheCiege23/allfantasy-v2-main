import { defineMessages } from '@/lib/i18n/messages'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { ageText } from '@/lib/core-app/shellCopy'

/**
 * Starters in doubt (components/core-app/screens/Dash3ATriageView.tsx). Every string is the one the
 * strip printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. (The basis note was JSX with `&rsquo;` and line-wrapped text; it is the same rendered
 * characters, ’ and single spaces, here.)
 */
export const dashTriageMessages = defineMessages({
  en: {
    safePivot: (bench: string[]) => `safe pivot: ${bench.join(' or ')}`,
    swapIn: (bench: string[]) => `swap in ${bench.join(' or ')}`,
    chainFill: (move: string, to: string, fill: string, from: string) => `move ${move} to ${to}, start ${fill} at ${from}`,
    chainFreeAgent: (move: string, to: string, from: string) => `move ${move} to ${to}, then add a free agent at ${from}`,
    orChain: (chain: string) => `or ${chain}`,
    kickoffUnderway: 'kickoff underway',
    kickoffInMins: (mins: number) => `kickoff in ${mins}m`,
    kickoffInHours: (hours: number) => `kickoff in ${hours}h`,
    kickoffInDays: (days: number) => `kickoff in ${days}d`,
    lineupsToFix: (n: number) => `${n} ${n === 1 ? 'lineup' : 'lineups'} to fix`,
    withBenchCover: (n: number) => `${n} with bench cover`,
    needPickup: (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} a pickup`,
    startingIn: (n: number) => `starting in ${n}`,
    benchedIn: (n: number) => `benched in ${n}`,
    onIrIn: (n: number) => `on IR in ${n}`,
    onTaxiIn: (n: number) => `on taxi in ${n}`,
    bestBallIn: (n: number | undefined) => `best ball in ${n}`,
    healthyOf: (healthy: number, rostered: number) => `${healthy} healthy of ${rostered}`,
    out: (n: number) => `${n} out`,
    questionable: (n: number) => `${n} questionable`,
    depthTitle: 'Best ball depth check',
    depthSub: 'Best ball sets your lineup for you — these are the spots running out of healthy bodies.',
    findPosition: (position: string) => `Find a ${position}`,
    startersInDoubt: 'Starters in doubt',
    rosterCheck: 'Roster check',
    mayNotPlay: 'may not play this week · most valuable first',
    proUpsell: 'AF Pro: the best free agent for every hole, plus Questionable game-time calls',
    inLeagues: (exposure: string, _count: number, _total: number) => `In ${exposure} leagues`,
    tradeValue: 'Trade value:',
    reported: (ago: string) => `reported ${ago}`,
    gameTimeCall: "Game-time call: keep the pivot ready and swap before kickoff if he's ruled out.",
    benchedHandled: 'benched ✓',
    moreLeagues: (n: number) => `+${n} more`,
    setLineup: (platform: string, league: string) => `Set lineup in ${platform} · ${league}`,
    /*
     * The per-league fix row (2026-11-01 home redesign) already names the league and its platform, so
     * the button shows only the lead and keeps the rest for a screen reader. Lead + where === setLineup,
     * byte for byte, so the accessible name never changed.
     */
    setLineupLead: 'Set lineup',
    setLineupWhere: (platform: string, league: string) => ` in ${platform} · ${league}`,
    alsoIn: 'Also in',
    moreFlagged: (n: number) => `+${n} more starters flagged — full exposure audit`,
    valuesBasis: (format: string, qb: string) =>
      `Values from FantasyCalc (${format}, ${qb}, 12-team PPR). Not tuned to your league’s settings, and NFL only.`,
  },
  es: {
    safePivot: (bench) => `relevo seguro: ${bench.join(' o ')}`,
    swapIn: (bench) => `pon a ${bench.join(' o ')}`,
    chainFill: (move, to, fill, from) => `mueve a ${move} a ${to} y pon a ${fill} en ${from}`,
    chainFreeAgent: (move, to, from) => `mueve a ${move} a ${to} y añade un agente libre en ${from}`,
    orChain: (chain) => `o ${chain}`,
    kickoffUnderway: 'partido en curso',
    kickoffInMins: (mins) => `inicio en ${mins} min`,
    kickoffInHours: (hours) => `inicio en ${hours} h`,
    kickoffInDays: (days) => `inicio en ${days} d`,
    lineupsToFix: (n) => `${n} ${n === 1 ? 'alineación por corregir' : 'alineaciones por corregir'}`,
    withBenchCover: (n) => `${n} con relevo en tu banca`,
    needPickup: (n) => `${n} ${n === 1 ? 'necesita' : 'necesitan'} un agente libre`,
    startingIn: (n) => `titular en ${n}`,
    benchedIn: (n) => `en la banca en ${n}`,
    onIrIn: (n) => `en IR en ${n}`,
    onTaxiIn: (n) => `en el taxi en ${n}`,
    bestBallIn: (n) => `best ball en ${n}`,
    healthyOf: (healthy, rostered) => `${healthy} sano${healthy === 1 ? '' : 's'} de ${rostered}`,
    out: (n) => `${n} fuera`,
    questionable: (n) => `${n} en duda`,
    depthTitle: 'Profundidad en best ball',
    depthSub: 'Best ball arma tu alineación solo; esto marca posiciones donde casi no quedan sanos.',
    findPosition: (position) => `Buscar ${position}`,
    startersInDoubt: 'Titulares en duda',
    rosterCheck: 'Revisa tu plantilla',
    mayNotPlay: 'puede que no jueguen esta semana · los más valiosos primero',
    proUpsell: 'AF Pro: el mejor agente libre para cada hueco y alertas de jugadores en duda',
    inLeagues: (_exposure, count, total) => `En ${count} de ${total} ligas`,
    tradeValue: 'Valor de intercambio:',
    reported: (ago) => `reportado ${ageText(ago, 'es')}`,
    gameTimeCall: 'Decisión de último momento: ten el relevo listo y cámbialo antes del inicio si lo descartan.',
    benchedHandled: 'en la banca ✓',
    moreLeagues: (n) => `+${n} más`,
    setLineup: (platform, league) => `Corregir alineación en ${platform} · ${league}`,
    setLineupLead: 'Corregir alineación',
    setLineupWhere: (platform, league) => ` en ${platform} · ${league}`,
    alsoIn: 'También en',
    openPlayerFinder: `Abrir ${coreUiCopy('Player Finder', 'es')}`,
    moreFlagged: (n) => `+${n} titulares señalados más: auditoría completa de exposición`,
    valuesBasis: (format, qb) =>
      `Valores de FantasyCalc (${format}, ${qb}, PPR de 12 equipos). No están ajustados a la configuración de tu liga, y son solo de la NFL.`,
  },
})

export type DashTriageMessages = typeof dashTriageMessages.en

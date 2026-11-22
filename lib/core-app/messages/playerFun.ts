import type { ExposureTier, Form } from '../playerFun'
import type { PlayerFunCopy } from '../playerFunCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Words for the Finder's fun layer (lib/core-app/playerFunCopy.ts). Every string is the one the module
 * produced before the move, byte for byte, in both languages — a relocation, not a rewrite.
 *
 * `form` is the one value whose type allows "no chip" (`null`), which a catalog value cannot return;
 * here it returns '' for that case and `playerFunCopy` turns '' back into `null`.
 */

const TIER_EN: Record<ExposureTier, string> = { core: 'Core piece', big: 'Big bet', piece: 'Solid stake', sprinkle: 'Sprinkle' }
const TIER_ES: Record<ExposureTier, string> = { core: 'Pieza clave', big: 'Gran apuesta', piece: 'Buena parte', sprinkle: 'Pizca' }

const leaguesEn = (n: number) => (n === 1 ? 'league' : 'leagues')
const leaguesEs = (n: number) => (n === 1 ? 'liga' : 'ligas')

export type PlayerFunMessages = Omit<PlayerFunCopy, 'form'> & { form: (call: Form['call']) => string }

export const playerFunMessages = defineMessages<PlayerFunMessages>({
  en: {
    exposure: (pct, tier) => `${pct}% exposure · ${TIER_EN[tier]}`,
    exposureTitle: (n, of, pct) => `You roster him in ${n} of your ${of} ${leaguesEn(of)} — ${pct}% of your fantasy life rides on him.`,
    form: (c): string => (c === 'hot' ? '🔥 Hot' : c === 'cold' ? '🧊 Cold' : ''),
    formTitle: (r, s) => `Last 3 games: ${r} pts a game · season: ${s}`,
    flipsTitle: 'Coin flips',
    flipsSub: 'Close calls in your lineups — tap who you would start, then see our lean.',
    flipIn: (l) => `In ${l}`,
    flipStarting: 'starting',
    flipBench: 'bench',
    flipPickA: (n) => `Start ${n}`,
    flipAgree: 'Great minds ✅',
    flipDisagree: 'Bold call 👀',
    flipLean: (n, m) => `We lean ${n} by ${m} pts.`,
    flipEven: 'Dead even on our numbers.',
    flipSetLineup: (p) => `Set lineup in ${p}`,
    flipAgain: 'Change pick',
    mvpKicker: (w) => `Your Week ${w} MVP`,
    mvpPoints: (p, n) => `${p} pts for you across ${n} ${leaguesEn(n)}`,
    mvpBeat: (n, by) => `${by} pts clear of ${n}`,
    mvpShare: 'Share',
    mvpShared: 'Shared',
    mvpCopied: 'Copied — paste it anywhere',
    mvpShareText: (w, name, p, n) => `🏆 My Week ${w} fantasy MVP: ${name} — ${p} pts across ${n} ${leaguesEn(n)}. Tracked on AllFantasy.`,
    trendFree: (n) => `Free in ${n} of yours · add`,
    trendFreeLabel: (name, n) => `${name} is free in ${n} of your ${leaguesEn(n)} — see where to add him`,
  },
  es: {
    exposure: (pct, tier) => `${pct}% de exposición · ${TIER_ES[tier]}`,
    exposureTitle: (n, of, pct) => `Lo tienes en ${n} de tus ${of} ${leaguesEs(of)}: el ${pct}% de tu fantasy depende de él.`,
    form: (c): string => (c === 'hot' ? '🔥 En racha' : c === 'cold' ? '🧊 Frío' : ''),
    formTitle: (r, s) => `Últimos 3 partidos: ${r} pts por partido · temporada: ${s}`,
    flipsTitle: 'A cara o cruz',
    flipsSub: 'Decisiones ajustadas en tus alineaciones: toca a quién alinearías y mira nuestra opinión.',
    flipIn: (l) => `En ${l}`,
    flipStarting: 'titular',
    flipBench: 'banca',
    flipPickA: (n) => `Alinear a ${n}`,
    flipAgree: 'Pensamos igual ✅',
    flipDisagree: 'Apuesta valiente 👀',
    flipLean: (n, m) => `Nos inclinamos por ${n} por ${m} pts.`,
    flipEven: 'Empate total según nuestros números.',
    flipSetLineup: (p) => `Ajustar alineación en ${p}`,
    flipAgain: 'Cambiar elección',
    mvpKicker: (w) => `Tu MVP de la semana ${w}`,
    mvpPoints: (p, n) => `${p} pts para ti en ${n} ${leaguesEs(n)}`,
    mvpBeat: (n, by) => `${by} pts por delante de ${n}`,
    mvpShare: 'Compartir',
    mvpShared: 'Compartido',
    mvpCopied: 'Copiado: pégalo donde quieras',
    mvpShareText: (w, name, p, n) => `🏆 Mi MVP de fantasy de la semana ${w}: ${name}, ${p} pts en ${n} ${leaguesEs(n)}. Seguido en AllFantasy.`,
    trendFree: (n) => `Libre en ${n} de las tuyas · fichar`,
    trendFreeLabel: (name, n) => `${name} está libre en ${n} de tus ${leaguesEs(n)}: mira dónde ficharlo`,
  },
})

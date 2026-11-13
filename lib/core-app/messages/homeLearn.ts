import { defineMessages } from '@/lib/i18n/messages'
import type { FormatKey } from '@/lib/core-app/homeFormats'

/**
 * The /core home's teaching cards (2026-11-12): the format guide (lib/core-app/homeFormats.ts) and
 * the platform calendar (lib/core-app/platformCalendar.ts).
 *
 * ⚠ THE RULES ARE GENERAL, ON PURPOSE. Each format's two lines describe how it USUALLY works and say
 * so; the league's own settings are the authority, and the card points there. A guide that states a
 * default as fact teaches the one thing a commissioner may have changed.
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
type FormatText = { name: string; rule: string; watch: string }

const EN: Record<FormatKey, FormatText> = {
  redraft: {
    name: 'Redraft',
    rule: 'Everyone drafts a new team every season; nothing carries over.',
    watch: 'Only this season counts — trade future value for points now.',
  },
  dynasty: {
    name: 'Dynasty',
    rule: 'You keep your whole roster year after year, and rookie drafts add new players.',
    watch: 'Young players and draft picks hold value even when they don’t score this week.',
  },
  keeper: {
    name: 'Keeper',
    rule: 'You keep a few players into next season, usually at a draft-pick cost set by the league.',
    watch: 'Late-round breakouts are the best keepers — check your league’s keeper deadline.',
  },
  devy: {
    name: 'Devy',
    rule: 'A dynasty league where you can also roster college players before they turn pro.',
    watch: 'Watch draft stock: a college player’s value jumps the day they’re drafted.',
  },
  'best-ball': {
    name: 'Best ball',
    rule: 'No lineups to set — each week your highest scorers at each position count automatically.',
    watch: 'Depth matters: injuries and bye weeks can leave a position with nobody healthy to score.',
  },
  guillotine: {
    name: 'Guillotine',
    rule: 'The lowest-scoring team each week is eliminated and its players go back to free agency.',
    watch: 'Survive this week first — and have free-agent budget ready for the players who get freed.',
  },
  survivor: {
    name: 'Survivor',
    rule: 'Teams are voted or knocked out over the season until one is left.',
    watch: 'Standings matter less than staying out of the bottom group each round.',
  },
  zombie: {
    name: 'Zombie',
    rule: 'Eliminated teams come back as zombies that can still affect the teams left alive.',
    watch: 'Read your league’s zombie rules — who can infect whom changes every week.',
  },
  idp: {
    name: 'IDP',
    rule: 'Individual defensive players — linebackers, linemen, defensive backs — score instead of (or as well as) a team defense.',
    watch: 'Tackles drive most IDP scoring, so starting snaps matter more than big plays.',
  },
  superflex: {
    name: 'Superflex',
    rule: 'One flex spot can start a quarterback, so most teams start two QBs.',
    watch: 'Quarterbacks are worth far more here — a bye or injury at QB is a real hole.',
  },
  'te-premium': {
    name: 'TE premium',
    rule: 'Tight ends get extra points per catch.',
    watch: 'High-volume tight ends gain the most; check the bonus in your league’s scoring.',
  },
}

const ES: Record<FormatKey, FormatText> = {
  redraft: {
    name: 'Redraft',
    rule: 'Todos draftean un equipo nuevo cada temporada; nada se conserva.',
    watch: 'Solo cuenta esta temporada: cambia valor futuro por puntos ahora.',
  },
  dynasty: {
    name: 'Dynasty',
    rule: 'Conservas todo tu plantel año tras año, y los drafts de novatos suman jugadores nuevos.',
    watch: 'Los jugadores jóvenes y las selecciones del draft valen aunque no anoten esta semana.',
  },
  keeper: {
    name: 'Keeper',
    rule: 'Conservas algunos jugadores para la próxima temporada, normalmente a cambio de una selección que fija la liga.',
    watch: 'Los jugadores elegidos tarde que explotan son los mejores keepers: revisa la fecha límite de tu liga.',
  },
  devy: {
    name: 'Devy',
    rule: 'Una liga dynasty en la que también puedes tener jugadores universitarios antes de que lleguen a profesionales.',
    watch: 'Sigue su cotización en el draft: el valor de un universitario sube el día que lo eligen.',
  },
  'best-ball': {
    name: 'Best ball',
    rule: 'No hay alineaciones que preparar: cada semana cuentan automáticamente tus mejores anotadores en cada posición.',
    watch: 'La profundidad importa: lesiones y semanas de descanso pueden dejar una posición sin nadie sano que anote.',
  },
  guillotine: {
    name: 'Guillotina',
    rule: 'Cada semana se elimina al equipo con menos puntos y sus jugadores vuelven a los agentes libres.',
    watch: 'Primero sobrevive esta semana, y guarda presupuesto para los jugadores que queden libres.',
  },
  survivor: {
    name: 'Survivor',
    rule: 'Los equipos quedan fuera por votación o eliminación durante la temporada hasta que queda uno.',
    watch: 'La clasificación importa menos que no quedar en el grupo de abajo en cada ronda.',
  },
  zombie: {
    name: 'Zombie',
    rule: 'Los equipos eliminados vuelven como zombis que todavía pueden afectar a los que siguen vivos.',
    watch: 'Lee las reglas zombi de tu liga: quién puede infectar a quién cambia cada semana.',
  },
  idp: {
    name: 'IDP',
    rule: 'Los jugadores defensivos individuales (linebackers, linieros, backs defensivos) anotan en lugar de una defensa de equipo, o además de ella.',
    watch: 'Los tackleos generan la mayor parte de los puntos IDP, así que importan más los snaps de titular que las grandes jugadas.',
  },
  superflex: {
    name: 'Superflex',
    rule: 'Un puesto flex puede alinear a un quarterback, así que casi todos los equipos alinean dos QB.',
    watch: 'Los quarterbacks valen mucho más aquí: un descanso o una lesión de tu QB es un hueco real.',
  },
  'te-premium': {
    name: 'TE premium',
    rule: 'Los tight ends reciben puntos extra por recepción.',
    watch: 'Ganan más los tight ends con mucho volumen; revisa el bono en la puntuación de tu liga.',
  },
}

export const homeLearnMessages = defineMessages({
  en: {
    formatName: (k: FormatKey): string => EN[k].name,
    formatRule: (k: FormatKey): string => EN[k].rule,
    formatWatchLine: (k: FormatKey): string => EN[k].watch,
    formatsTitle: 'Your league formats',
    formatsSub: 'Tap a format to see how it works and what to watch.',
    formatLeagues: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`,
    formatHowItWorks: 'How it works',
    formatWatch: 'Watch this week',
    formatSettingsNote: 'These are the usual rules. Your league’s own settings decide the details.',

    calTitle: 'When things happen',
    calSub: 'Waiver runs on each platform you play, in your time.',
    calNextKickoff: 'Next kickoff',
    calLockNote: 'A player locks when their game kicks off, unless your league locks the whole lineup at once.',
    calLeagues: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`,
    calWaivers: 'Waivers',
    calDaily: 'Daily',
    calRuns: (when: string, n: number) => `${when} · ${n} ${n === 1 ? 'league' : 'leagues'}`,
    calUnread: (platform: string) => `Waiver time not readable from ${platform} yet — check the league’s settings.`,
    calSomeUnread: (n: number) => `${n} more ${n === 1 ? 'league' : 'leagues'} not readable yet.`,
    calTeach:
      'Claims made before a waiver run are processed together, by waiver priority or the highest free-agent bid. After the run, most free agents are first come, first served until the next one.',
    calNoLeagues: 'Connect a league to see its waiver times here.',
  },
  es: {
    formatName: (k) => ES[k as FormatKey].name,
    formatRule: (k) => ES[k as FormatKey].rule,
    formatWatchLine: (k) => ES[k as FormatKey].watch,
    formatsTitle: 'Los formatos de tus ligas',
    formatsSub: 'Toca un formato para ver cómo funciona y qué vigilar.',
    formatLeagues: (n) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    formatHowItWorks: 'Cómo funciona',
    formatWatch: 'Esta semana, vigila',
    formatSettingsNote: 'Estas son las reglas habituales. La configuración de tu liga decide los detalles.',

    calTitle: 'Cuándo pasa cada cosa',
    calSub: 'El proceso de reclamos de cada plataforma en la que juegas, en tu hora.',
    calNextKickoff: 'Próximo inicio',
    calLockNote: 'Un jugador se bloquea cuando empieza su partido, salvo que tu liga bloquee toda la alineación a la vez.',
    calLeagues: (n) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    calWaivers: 'Reclamos',
    calDaily: 'Diario',
    calRuns: (when, n) => `${when} · ${n} ${n === 1 ? 'liga' : 'ligas'}`,
    calUnread: (platform) => `Todavía no podemos leer la hora de los reclamos de ${platform}: revisa la configuración de la liga.`,
    calSomeUnread: (n) => `${n} ${n === 1 ? 'liga más no se puede' : 'ligas más no se pueden'} leer todavía.`,
    calTeach:
      'Los reclamos hechos antes del proceso se resuelven juntos, por prioridad o por la oferta más alta de presupuesto. Después del proceso, la mayoría de los agentes libres son para el primero que los tome hasta el siguiente.',
    calNoLeagues: 'Conecta una liga para ver aquí la hora de sus reclamos.',
  },
})

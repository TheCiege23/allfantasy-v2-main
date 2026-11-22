import { defineMessages } from '@/lib/i18n/messages'

/**
 * The inactive-manager ladder (lib/core-app/commissioner/inactiveLadder.ts): its labels, its teaching
 * line, and the three messages a commissioner can copy and send.
 *
 * ⚠ THE MESSAGES ARE THE COMMISSIONER'S WORDS, NOT OURS. They are written in the first person, to be
 * pasted into a league chat or DM by the commissioner, so they never mention AllFantasy and never
 * promise a deadline the league has not set ("this week", not a date we invented).
 */
type Ctx = { manager: string; league: string; days: number | null }

export const inactiveLadderMessages = defineMessages({
  en: {
    title: 'Inactive managers',
    summary: (replace: number, warn: number, nudge: number) =>
      [
        replace > 0 ? `${replace} to replace` : null,
        warn > 0 ? `${warn} to warn` : null,
        nudge > 0 ? `${nudge} to nudge` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    none: 'Every manager in the leagues checked has made a move in the last week.',
    noneOffSeason: 'None of the leagues checked is mid-season, so no one is on the ladder — a quiet manager before the draft or after the final is normal.',
    stepNudge: 'Nudge',
    stepWarn: 'Warn',
    stepReplace: 'Replace',
    quiet: (days: number | null) => (days == null ? 'no move on file' : `quiet ${days} ${days === 1 ? 'day' : 'days'}`),
    copy: 'Copy message',
    copied: 'Copied',
    copyFailed: 'Copy failed — select the text',
    openLeague: 'Open league',
    replaceManager: 'Find a replacement',
    showMessage: 'Show message',
    more: (n: number) => `+${n} more in the Commissioner Hub`,
    teach:
      'The ladder: one quiet week gets a friendly nudge, two gets a warning, three means line up a replacement before your trade deadline. “Quiet” means no trade, waiver claim or roster move — it can’t see a manager who only sets lineups.',
    messageNudge: ({ manager, league }: Ctx) =>
      `Hey ${manager}, quick check-in from ${league}: we haven’t seen a move from your team in a while. Make sure your starters are set before kickoff this week.`,
    messageWarn: ({ manager, league, days }: Ctx) =>
      `Hi ${manager}, it’s been ${days == null ? 'a couple of weeks' : `${days} days`} without a move on your team in ${league}. An inactive team hands free wins to whoever plays it, so please set your lineup this week — or tell me if you’d rather step away, no hard feelings.`,
    messageReplace: ({ manager, league, days }: Ctx) =>
      `Hi ${manager}, your team in ${league} has been inactive for ${days == null ? 'several weeks' : `${days} days`}. To keep the league fair I’m going to start looking for a replacement manager unless I hear from you this week.`,
  },
  es: {
    title: 'Mánagers inactivos',
    summary: (replace, warn, nudge) =>
      [
        replace > 0 ? `${replace} para reemplazar` : null,
        warn > 0 ? `${warn} para advertir` : null,
        nudge > 0 ? `${nudge} para recordar` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    none: 'Todos los mánagers de las ligas revisadas han hecho un movimiento en la última semana.',
    noneOffSeason: 'Ninguna de las ligas revisadas está en plena temporada, así que nadie entra en la escalera: es normal que un mánager esté quieto antes del draft o después de la final.',
    stepNudge: 'Recordar',
    stepWarn: 'Advertir',
    stepReplace: 'Reemplazar',
    quiet: (days) => (days == null ? 'sin movimientos registrados' : `${days} ${days === 1 ? 'día' : 'días'} sin movimientos`),
    copy: 'Copiar mensaje',
    copied: 'Copiado',
    copyFailed: 'No se pudo copiar: selecciona el texto',
    openLeague: 'Abrir la liga',
    replaceManager: 'Buscar un reemplazo',
    showMessage: 'Ver mensaje',
    more: (n) => `+${n} más en el Centro del Comisionado`,
    teach:
      'La escalera: una semana sin movimientos merece un recordatorio amable, dos una advertencia y tres significa buscar un reemplazo antes de la fecha límite de intercambios. “Sin movimientos” significa sin intercambios, reclamos ni cambios de plantel: no ve a un mánager que solo ajusta su alineación.',
    messageNudge: ({ manager, league }) =>
      `Hola ${manager}, un recordatorio de ${league}: hace tiempo que no vemos movimientos en tu equipo. Asegúrate de tener tu alineación lista antes del inicio de esta semana.`,
    messageWarn: ({ manager, league, days }) =>
      `Hola ${manager}, llevas ${days == null ? 'un par de semanas' : `${days} días`} sin movimientos en tu equipo de ${league}. Un equipo inactivo le regala victorias a quien juega contra él, así que por favor prepara tu alineación esta semana, o dime si prefieres dejarlo, sin problema.`,
    messageReplace: ({ manager, league, days }) =>
      `Hola ${manager}, tu equipo en ${league} lleva ${days == null ? 'varias semanas' : `${days} días`} inactivo. Para que la liga siga siendo justa voy a empezar a buscar un mánager de reemplazo, a menos que sepa de ti esta semana.`,
  },
})

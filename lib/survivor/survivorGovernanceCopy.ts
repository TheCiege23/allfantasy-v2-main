/**
 * Server-side copy for Survivor governance (swaps, strikes, alliances, trade rules) in English and
 * Spanish. Chimmy's Survivor copy follows `League.language` (see chimmyWeeklyReport.ts), so every
 * message here is picked by that value. Pure and client-safe.
 */
import { defineMessages, messagesFor } from '@/lib/i18n/messages'

export type GovernanceLang = 'en' | 'es'

export function governanceLang(language: string | null | undefined): GovernanceLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

const NUM_EN = ['zero', 'one', 'two', 'three', 'four', 'five']
const NUM_ES = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco']

export const survivorGovernanceCopy = defineMessages({
  en: {
    swapSealedResize: (count: number): string => `Drop your buffs. The cast is being redrawn into ${NUM_EN[count] ?? count} tribes, sealed until the next lineup lock.`,
    swapSealedReturn: 'Drop your buffs. Everyone still in the game is heading back to their original tribe, revealed at the next lineup lock.',
    swapSealedPattern: (count: number): string => `Drop your buffs. The commissioner's swap redraws the cast into ${NUM_EN[count] ?? count} tribes, sealed until the next lineup lock.`,
    swapRevealedResize: (count: number): string => `The new tribes are revealed: ${NUM_EN[count] ?? count} tribes now. Idols travel with their owners, and your tribe chat has switched over.`,
    swapRevealedReturn: 'The original tribes are back. Idols travel with their owners, and your tribe chat has switched over.',
    strikeIssued: (n: number, limit: number, reason: string): string => `@Chimmy: The commissioner issued you conduct strike ${n} of ${limit}. Reason: ${reason}`,
    strikeLimitWarning: (limit: number): string => `Reaching ${limit} ${limit === 1 ? 'strike' : 'strikes'} means removal from the season.`,
    strikeRemoved: 'You reached the strike limit and have been removed from the season.',
    strikeRevoked: (n: number): string => `@Chimmy: The commissioner withdrew a conduct strike. You now have ${n}.`,
    allianceCreated: (name: string, creator: string): string => `${creator} formed the alliance "${name}". Only its members can read this chat.`,
    tradeFrozen: 'Trades are frozen until after Tribal Council this week.',
    tradeCrossTribeBanned: 'Trades between tribes are not allowed in this league.',
    tradeCrossTribeClosed: (closes: string): string => `Trades between tribes are closed until after Tribal Council (the window closes ${closes} ET each week).`,
    tradePlayed: (player: string): string => `${player} has already played this week and cannot be traded until after Tribal Council.`,
    tradeTribeUnknown: 'Your tribe could not be confirmed, so this trade cannot be checked against the Survivor trade rules. Try again shortly.',
    tradeCrossTribeClosedWindows: (windows: string): string => `Trades between tribes are closed right now. They are open each week ${windows}.`,
    tradeHeldForCommissioner: 'The Survivor trade check could not run, so this trade is held for the commissioner to approve or veto.',
    tradeHeldChat: 'Accepted. Held for the commissioner: the Survivor trade check could not run.',
    crossWindowAfterTribal: (close: string): string => `after Tribal Council until ${close} ET`,
    crossWindowFromTo: (open: string, close: string): string => `from ${open} until ${close} ET`,
    crossWindowJoin: (parts: string[]): string => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`),
  },
  es: {
    swapSealedResize: (count: number): string => `Suelten sus bandanas. El elenco se reparte en ${NUM_ES[count] ?? count} tribus, en secreto hasta el próximo cierre de alineaciones.`,
    swapSealedReturn: 'Suelten sus bandanas. Todos los que siguen en el juego vuelven a su tribu original; se revela en el próximo cierre de alineaciones.',
    swapSealedPattern: (count: number): string => `Suelten sus bandanas. El cambio del comisionado reparte el elenco en ${NUM_ES[count] ?? count} tribus, en secreto hasta el próximo cierre de alineaciones.`,
    swapRevealedResize: (count: number): string => `Se revelan las nuevas tribus: ahora son ${NUM_ES[count] ?? count}. Los ídolos viajan con sus dueños y tu chat de tribu ya cambió.`,
    swapRevealedReturn: 'Vuelven las tribus originales. Los ídolos viajan con sus dueños y tu chat de tribu ya cambió.',
    strikeIssued: (n: number, limit: number, reason: string): string => `@Chimmy: El comisionado te dio la falta de conducta ${n} de ${limit}. Motivo: ${reason}`,
    strikeLimitWarning: (limit: number): string => `Llegar a ${limit} ${limit === 1 ? 'falta' : 'faltas'} significa quedar fuera de la temporada.`,
    strikeRemoved: 'Llegaste al límite de faltas y quedaste fuera de la temporada.',
    strikeRevoked: (n: number): string => `@Chimmy: El comisionado retiró una falta de conducta. Ahora tienes ${n}.`,
    allianceCreated: (name: string, creator: string): string => `${creator} formó la alianza "${name}". Solo sus miembros pueden leer este chat.`,
    tradeFrozen: 'Los cambios están congelados hasta después del Consejo Tribal de esta semana.',
    tradeCrossTribeBanned: 'En esta liga no se permiten cambios entre tribus.',
    tradeCrossTribeClosed: (closes: string): string => `Los cambios entre tribus están cerrados hasta después del Consejo Tribal (la ventana cierra ${closes} ET cada semana).`,
    tradePlayed: (player: string): string => `${player} ya jugó esta semana y no se puede cambiar hasta después del Consejo Tribal.`,
    tradeTribeUnknown: 'No se pudo confirmar tu tribu, así que este cambio no se puede revisar con las reglas de Survivor. Inténtalo de nuevo en un momento.',
    tradeCrossTribeClosedWindows: (windows: string): string => `Los cambios entre tribus están cerrados ahora. Abren cada semana ${windows}.`,
    tradeHeldForCommissioner: 'La revisión de reglas de Survivor no pudo hacerse, así que este cambio queda retenido hasta que el comisionado lo apruebe o lo vete.',
    tradeHeldChat: 'Aceptado. Retenido para el comisionado: la revisión de reglas de Survivor no pudo hacerse.',
    crossWindowAfterTribal: (close: string): string => `después del Consejo Tribal hasta el ${close} ET`,
    crossWindowFromTo: (open: string, close: string): string => `desde el ${open} hasta el ${close} ET`,
    crossWindowJoin: (parts: string[]): string => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`),
  },
})

export type SurvivorGovernanceCopy = typeof survivorGovernanceCopy.en

export function governanceCopy(language: string | null | undefined): SurvivorGovernanceCopy {
  return messagesFor(survivorGovernanceCopy, governanceLang(language))
}

export function swapAnnouncementCopy(language: string | null | undefined, stage: 'sealed' | 'revealed', mode: string, tribeCount: number): string {
  const m = governanceCopy(language)
  if (mode === 'return_to_original') return stage === 'sealed' ? m.swapSealedReturn : m.swapRevealedReturn
  if (stage === 'revealed') return m.swapRevealedResize(tribeCount)
  return mode === 'custom_pattern' ? m.swapSealedPattern(tribeCount) : m.swapSealedResize(tribeCount)
}

const DAY_ES: Record<string, string> = { Sunday: 'domingo', Monday: 'lunes', Tuesday: 'martes', Wednesday: 'miércoles', Thursday: 'jueves', Friday: 'viernes', Saturday: 'sábado' }

/** "Thursday 7:00 PM" / "jueves 19:00". */
export function dayTimeLabel(language: string | null | undefined, day: string, hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (governanceLang(language) === 'es') return `${DAY_ES[day] ?? day} ${match ? `${match[1]}:${match[2]}` : hhmm}`
  if (!match) return `${day} ${hhmm}`
  const hour = Number(match[1])
  return `${day} ${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`
}

/**
 * The week's cross-tribe windows in one phrase: "after Tribal Council until Thursday 8:15 PM ET and from
 * Friday 12:00 AM until Sunday 1:00 PM ET". Used by the refusal, Chimmy's rules answer and the cards.
 */
export function crossTribeWindowsLabel(
  language: string | null | undefined,
  windows: ReadonlyArray<{ opensOn: string; openDay?: string; openTime?: string; closeDay: string; closeTime: string }>,
): string {
  const m = governanceCopy(language)
  return m.crossWindowJoin(windows.map((w) => {
    const close = dayTimeLabel(language, w.closeDay, w.closeTime)
    return w.opensOn === 'time' && w.openDay && w.openTime ? m.crossWindowFromTo(dayTimeLabel(language, w.openDay, w.openTime), close) : m.crossWindowAfterTribal(close)
  }))
}

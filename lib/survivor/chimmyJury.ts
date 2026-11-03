/**
 * How Chimmy plays the finale for a castaway it runs — the pure decisions (no I/O). The turn that
 * applies them is chimmyJuryTurn.ts, called by the season runner during the finale week.
 *
 *  - As a JUROR it asks each finalist one question and votes for the finalist with the strongest
 *    season: the most season points — the same measure the jury tiebreak uses
 *    (finaleReveal.FINALE_TIEBREAK_RULE) — then immunity wins, then a stable id order.
 *  - As a FINALIST it answers every question put to it and posts a short closing speech built only
 *    from its public record (points, immunity wins). It never mentions a ballot or an idol holder.
 *
 * Copy follows League.language (English and Spanish), like chimmyCastawayChat.ts.
 */

export type ChimmyLang = 'en' | 'es'

export function chimmyLang(language: string | null | undefined): ChimmyLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export interface ChimmyFinalistRecord {
  rosterId: string
  name: string
  seasonPoints: number
  immunityWins: number
}

/** Pure: the finalist a Chimmy juror votes for. Deterministic for a given input. */
export function chimmyJurorVote(finalists: ReadonlyArray<ChimmyFinalistRecord>, selfRosterId?: string): string | null {
  const field = finalists.filter((f) => f.rosterId !== selfRosterId)
  if (!field.length) return null
  return [...field].sort((a, b) => b.seasonPoints - a.seasonPoints || b.immunityWins - a.immunityWins || a.rosterId.localeCompare(b.rosterId))[0]!.rosterId
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

const QUESTIONS: Record<ChimmyLang, Array<(finalist: string, rival: string) => string>> = {
  en: [
    (f, r) => `${f}, what was the one move this season that got you here, and why does it beat ${r}'s game?`,
    (f) => `${f}, who did you trust most out here, and did you ever plan to vote them out?`,
    (f, r) => `${f}, if ${r} had won the last immunity, how were you getting to the end?`,
    (f) => `${f}, which vote are you least proud of, and what would you do differently?`,
  ],
  es: [
    (f, r) => `${f}, ¿cuál fue la jugada de esta temporada que te trajo hasta aquí y por qué supera el juego de ${r}?`,
    (f) => `${f}, ¿en quién confiaste más aquí y alguna vez planeaste eliminarlo?`,
    (f, r) => `${f}, si ${r} hubiera ganado la última inmunidad, ¿cómo ibas a llegar al final?`,
    (f) => `${f}, ¿de qué voto estás menos orgulloso y qué harías diferente?`,
  ],
}

/** Pure: Chimmy's question for one finalist. Stable per juror/finalist pair. */
export function chimmyJuryQuestion(lang: ChimmyLang, jurorRosterId: string, finalist: ChimmyFinalistRecord, rivals: ReadonlyArray<ChimmyFinalistRecord>): string {
  const rival = rivals.find((r) => r.rosterId !== finalist.rosterId)?.name ?? (lang === 'es' ? 'los otros finalistas' : 'the other finalists')
  const pool = QUESTIONS[lang]
  return pool[hash(`${jurorRosterId}:${finalist.rosterId}`) % pool.length]!(finalist.name, rival)
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

/** Pure: Chimmy's answer as a finalist. Built from its public record only. */
export function chimmyFinalistAnswer(lang: ChimmyLang, self: ChimmyFinalistRecord): string {
  return lang === 'es'
    ? `Jugué a puntuar cada semana: ${fmt(self.seasonPoints)} puntos en la temporada y ${self.immunityWins} ${self.immunityWins === 1 ? 'inmunidad ganada' : 'inmunidades ganadas'}. Cada voto que di fue para mantener fuerte a mi tribu y luego para llegar aquí.`
    : `I played to score every week: ${fmt(self.seasonPoints)} season points and ${self.immunityWins} immunity ${self.immunityWins === 1 ? 'win' : 'wins'}. Every vote I cast was about keeping my tribe strong, then about getting here.`
}

/** Pure: Chimmy's closing speech as a finalist. One short post. */
export function chimmyClosingSpeech(lang: ChimmyLang, self: ChimmyFinalistRecord): string {
  return lang === 'es'
    ? `Jurado: llegué al final con ${fmt(self.seasonPoints)} puntos y ${self.immunityWins} ${self.immunityWins === 1 ? 'inmunidad' : 'inmunidades'}. No escondí mi juego: puntué, voté con mi tribu y sobreviví a cada Consejo. Les pido su voto por el juego más constante de la isla.`
    : `Jury: I made it to the end with ${fmt(self.seasonPoints)} season points and ${self.immunityWins} immunity ${self.immunityWins === 1 ? 'win' : 'wins'}. I did not hide my game: I scored, I voted with my tribe and I survived every Tribal Council. I am asking for your vote for the most consistent game on the island.`
}

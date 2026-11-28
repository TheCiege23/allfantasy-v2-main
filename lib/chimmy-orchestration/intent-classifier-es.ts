import type { ChimmyOrchestrationIntent } from './types'

/**
 * SPANISH VOCABULARY FOR THE CHIMMY INTENT ROUTER (owner decision, 2026-11-28).
 *
 * `classifyChimmyIntent` was English-only regex, so "¿acepto este intercambio?" was `general`: no
 * `pendingTrades` slice in the grounding packet (`intentToWant.ts`) and no second-model check
 * (`DECISION_CHECK_INTENTS`). The site's own language switch offers Spanish, so a Spanish speaker
 * got the thinner answer on every decision question.
 *
 * HOW IT IS WIRED, AND WHY THAT KEEPS ENGLISH UNCHANGED BY CONSTRUCTION. This runs only where the
 * English router would otherwise return its FINAL `general` — never ahead of an English branch, and
 * not on an English "how does X work" question, which returns `general` earlier on purpose. So an
 * English question that routed anywhere still routes there; the only rows this can change are ones
 * that used to be `general`. Two more fences keep it off those:
 *
 *   1. `looksSpanish` must hold — an inverted mark, an accented letter, or a Spanish function word.
 *      "Tell me about the draft" never reaches the vocabulary at all.
 *   2. No term below is also an English word the English router leaves `general`. That is why
 *      `bracket` is absent (English has no bracket branch, so "how is my bracket doing?" must stay
 *      general) and why `draft` appears only in Spanish frames (`draftear`, `el draft`).
 *
 * ACCENTS. Text is folded with NFD + combining-mark strip before matching, so `alineación` and
 * `alineacion`, `lesión` and `lesion`, `añado` and `anado` are one word. Every pattern is written
 * accent-free for that reason — do not add an accented literal, it can never match.
 *
 * ORDER mirrors the English router's (most specific first; trade after start/sit and waiver; the
 * inactive-manager commissioner form after trade; rookies last), so a Spanish question and its
 * English twin resolve to the same intent. `injury`, `weather` and `bracket` have no English branch
 * at all; they are routed here because the owner asked for every intent. They carry no packet want
 * (`deriveWantFromIntent`), so the only effect is the label the prompt is given.
 *
 * ⚠ THE SAME `\b` RULE AS THE ENGLISH FILE: a stem is unmatchable unless it carries its own
 * inflections. Spanish inflects more than English, so they are enumerated, not globbed, wherever a
 * stem can collide (`cambio` the trade vs `cambio` the change, `vale` the value vs `vale` = "OK").
 */

export type SpanishIntentMatch = { intent: ChimmyOrchestrationIntent; weight: number }

export function foldSpanish(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const SPANISH_SIGNAL =
  /\b(que|quien|quienes|cual|cuales|cuanto|cuantos|cuando|como|donde|debo|deberia|puedo|mi|mis|el|los|las|del|esta|este|esto|estos|para|por|con|una|unos|pongo|tengo|hago|semana|liga|equipo|jugador|jugadores|dame|muestrame|cuentame)\b/

export function looksSpanish(raw: string): boolean {
  if (/[¿¡áéíóúñü]/i.test(raw)) return true
  return SPANISH_SIGNAL.test(foldSpanish(raw))
}

/** The rules-question guard, Spanish half of `asksHowARuleWorks`. */
function asksHowARuleWorksEs(t: string): boolean {
  return /\b(como\s+funciona(?:n)?|que\s+significa|explica(?:me)?|cuantos\s+puntos)\b/.test(t)
}

/**
 * Returns the Spanish intent, or null when nothing Spanish names one. `raw` is the same text the
 * English router read (recent user turns joined in front of the message); `current` is the message
 * alone, which the deadline and rules guards read — as the English ones do — so a previous turn
 * cannot turn this one into a calendar or rules question.
 */
export function classifySpanishIntent(raw: string, current: string = raw): SpanishIntentMatch | null {
  if (!looksSpanish(raw)) return null
  const t = foldSpanish(raw)
  const cur = foldSpanish(current)

  if (/\b(resumen(?:es)?|cronicas?|narrativas?|historias?|salon\s+de\s+la\s+fama)\b/.test(t)) {
    return { intent: 'story_recap', weight: 3 }
  }
  if (
    /\b(psicologi(?:a|co|ca)|toxic[oa]s?|colusion|comportamientos?|tendencias?|malos?\s+managers?|perfil\s+del?\s+manager)\b/.test(t) ||
    /\bque\s+tipo\s+de\s+(?:manager|entrenador|drafter|negociador)\b/.test(t) ||
    /\bcomo\s+(?:draftea|negocia|intercambia)\s+\w+/.test(t)
  ) {
    return { intent: 'manager_psychology', weight: 3 }
  }
  if (
    /\bequipos?\s+mas\s+(?:fuertes?|debiles?)\b|\b(?:ranking|clasificacion)\s+de\s+poder\b|\bfuerza\s+de\s+la\s+liga\b|\bpanorama\s+de\s+(?:los\s+)?playoffs?\b|\ba\s+quien\s+temer\b/.test(t)
  ) {
    return { intent: 'league_strength', weight: 2.5 }
  }
  if (
    /\b(comisionad[oa]s?|vet(?:o|os|ar|ado|ada|aron|e|en))\b/.test(t) ||
    /\breglas?\s+de\s+(?:la|mi|nuestra)\s+liga\b|\bcambi(?:o|ar|amos|ar)\s+(?:las\s+|la\s+)?reglas?\b|\bcambios?\s+de\s+reglas?\b|\bformato\s+de\s+(?:los\s+)?playoffs?\b|\bcuotas?\b/.test(t) ||
    /\b(?:cuando|que\s+(?:semana|dia|fecha))\b[^?]*\bfecha\s+limite\b/.test(cur)
  ) {
    return { intent: 'commissioner', weight: 3 }
  }
  if (asksHowARuleWorksEs(cur)) return null
  if (/\b(enfrentamientos?|oponentes?|contra\s+quien\s+(?:juego|juegas|jugamos))\b/.test(t)) {
    return { intent: 'matchup', weight: 2.5 }
  }
  if (
    /\b(draftear|drafteo|draftea|drafteas|draftee|mock\s*drafts?)\b|\b(?:el|del|mi|nuestro|un|este)\s+draft\b/.test(t) ||
    /\bmis?\s+(?:mejor(?:es)?\s+)?selecci(?:on|ones)\b|\bselecci(?:on|ones)\s+(?:del?\s+draft|numero|global|en\s+(?:la\s+)?(?:primera|segunda|tercera|\d+))/.test(t) ||
    /\b(?:debo|deberia|puedo)\s+(?:seleccionar|escoger|elegir)\b/.test(t) ||
    /\b(?:en\s+)?que\s+ronda\b/.test(t)
  ) {
    return { intent: 'draft', weight: 3 }
  }
  if (
    /\b(titular(?:es)?|alineaci(?:on|ones)|aline(?:ar|o|as|a)|banca|banquear|banqueo|sentar|siento)\b/.test(t) ||
    /\b(?:a\s+)?quien\s+(?:pongo|alineo|arranco)\b/.test(t)
  ) {
    return { intent: 'start_sit', weight: 3 }
  }
  if (
    /\b(agentes?\s+libres?|recog(?:er|o|emos)|fich(?:ar|o|aje|ajes)|solt(?:ar|amos)|suelto|dar\s+de\s+baja|doy\s+de\s+baja|puj(?:a|as|ar|o)|levant(?:ar|o)\s+a|agreg(?:ar|o)\s+a|anad(?:ir|o)\s+a)\b/.test(t)
  ) {
    return { intent: 'waiver', weight: 3 }
  }
  if (
    /\b(intercambi(?:o|os|ar|amos|aria|as)|canjes?|ofertas?|contraofertas?|acept(?:o|ar|as|a|amos|aria)|rechaz(?:o|ar|as|a|aria)|tradear|tradeo)\b/.test(t) ||
    /\b(?:el|este|ese|un|del|los|estos|esos|unos)\s+cambios?\b|\bcambios?\s+por\b|\bcambi(?:o|ar|as|amos|aria)\s+a\s+\w+(?:\s+\w+){0,3}\s+por\b/.test(t) ||
    /\bque\s+dar(?:ias|ia|as)\s+por\b/.test(t)
  ) {
    return { intent: 'trade', weight: 3 }
  }
  if (
    /\b(?:managers?|manageres|entrenadores|duenos|propietarios|usuarios|equipos)\s+inactiv[oa]s?\b|\b(?:managers?|manageres|duenos)\b[^?.!]{0,30}\binactiv[oa]s?\b|\binactiv[oa]s?\b[^?.!]{0,30}\b(?:mi|nuestra|la|esta)\s+liga\b/.test(t) ||
    /\bequipos?\s+abandonad[oa]s?\b|\bsalud\s+de\s+(?:la|mi|nuestra)\s+liga\b/.test(t)
  ) {
    return { intent: 'commissioner', weight: 2.5 }
  }
  if (/\b(lesion(?:es)?|lesionad[oa]s?|en\s+duda)\b/.test(t)) {
    return { intent: 'injury', weight: 2.5 }
  }
  if (/\b(clima|lluvia|lluvioso|nieve|nevando|vientos?|tormentas?)\b/.test(t)) {
    return { intent: 'weather', weight: 2.5 }
  }
  if (/\b(quinielas?|cuadro\s+del?\s+torneo|llaves?\s+del\s+torneo)\b/.test(t)) {
    return { intent: 'bracket', weight: 2.5 }
  }
  if (
    /\b(valor(?:es)?|cuanto\s+valen?|vender\s+alto|comprar\s+bajo|resto\s+de\s+(?:la\s+)?temporada|proyecci(?:on|ones)|perspectivas?)\b/.test(t)
  ) {
    return { intent: 'player_value', weight: 2.5 }
  }
  if (/\b(novatos?|devy)\b/.test(t)) {
    return { intent: 'draft', weight: 2.5 }
  }
  return null
}

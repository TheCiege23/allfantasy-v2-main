/**
 * Spanish for the dynasty direction engine's explanation sentences, at display time.
 *
 * `dynastyTeamDirectionEngine` writes its facts as English sentences, and they are read verbatim by
 * more than the War Room: the older dynasty league tab and Chimmy's dynasty grounding
 * (`dynastyChimmyGrounding.ts`) quote them. Changing what the engine emits would change all of those,
 * so the translation happens here, where the War Room draws them — the same approach Season Outlook
 * takes for its own sentences (`seasonOutlookSentence` in outlookSpanish.ts).
 *
 * ⚠ EACH RULE IS ONE OF THE ENGINE'S TEMPLATES, MATCHED WHOLE. A sentence no rule recognises is
 * returned in English unchanged — a correct English line beats a guessed Spanish one. The guard test
 * (`__tests__/war-room/dynasty-facts-spanish.test.ts`) runs the REAL engine and fails if it emits a
 * sentence this file does not know, so a wording change in the engine cannot silently fall back to
 * English for Spanish readers.
 *
 * Pure and client-safe.
 */

type Rule = [RegExp, (m: RegExpMatchArray) => string]

const plural = (n: string, one: string, many: string) => (n === '1' ? one : many)

const RULES: Rule[] = [
  [/^Roster not found in this league\.$/, () => 'No se encontró tu plantel en esta liga.'],
  [
    /^Record (\d+)-(\d+)(?:-(\d+))? \(win% ([\d.]+)\)\.$/,
    (m) => `Récord ${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''} (porcentaje de victorias ${m[4]}).`,
  ],
  [
    /^Young-asset value share (\d+)% \(sustainability signal\)\.$/,
    (m) => `El ${m[1]}% del valor está en activos jóvenes (señal de sostenibilidad).`,
  ],
  [/^Average starter age ([\d.]+)\.$/, (m) => `Edad promedio de los titulares: ${m[1]}.`],
  [
    /^Pick capital: (\d+) future pick\(s\), (\d+) early(?:, tier total ([\d.]+))?\.$/,
    (m) =>
      `Capital de selecciones: ${m[1]} ${plural(m[1]!, 'selección futura', 'selecciones futuras')}, ${m[2]} ${plural(m[2]!, 'temprana', 'tempranas')}${m[3] ? `, valor total por niveles ${m[3]}` : ''}.`,
  ],
]

/** True when a rule recognises this engine sentence. */
export function isKnownDynastyFact(english: string): boolean {
  return RULES.some(([re]) => re.test(english))
}

/** The sentence in the viewer's language: Spanish when a rule knows it, otherwise unchanged. */
export function dynastyFactSentence(english: string, language: string | null | undefined): string {
  if (language !== 'es') return english
  for (const [re, to] of RULES) {
    const m = english.match(re)
    if (m) return to(m)
  }
  return english
}

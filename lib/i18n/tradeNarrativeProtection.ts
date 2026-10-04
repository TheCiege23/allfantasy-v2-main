/** Display translation only: names, identifiers, grades and numeric claims are opaque tokens. */
export function tradeIdentityTerms(context: unknown): string[] {
  const terms = new Set<string>()
  const seen = new Set<object>()
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return
    seen.add(value)
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /^(name|playerName|managerName|ownerName|displayName|teamName|leagueName|username|id|playerId|rosterId)$/i.test(key) && child.trim()) terms.add(child.trim())
      else visit(child, depth + 1)
    }
  }
  visit(context, 0)
  return [...terms].filter(value => value.length <= 160).slice(0, 400)
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function protectTradeNarrative(text: string, identities: readonly string[]) {
  const originals: string[] = []
  const names = [...new Set(identities)].filter(Boolean).sort((a, b) => b.length - a.length).map(escape)
  // Proper names are also protected when prose mentions a player absent from the selected assets.
  const pattern = new RegExp([
    ...(names.length ? [`(?<![\\p{L}\\p{N}])(?:${names.join('|')})(?![\\p{L}\\p{N}])`] : []),
    'https?://[^\\s]+|[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}',
    "\\b[A-ZÁÉÍÓÚÑ][\\p{L}'’.-]+(?:\\s+[A-ZÁÉÍÓÚÑ][\\p{L}'’.-]+)+\\b",
    '\\b(?:NFL|NBA|MLB|NHL|NCAAF|NCAAB|FAAB|ADP|PPR|QB|RB|WR|TE|IDP|SF|AF)\\b',
    '\\b[A-F][+-]?(?![\\p{L}])',
    '[-+±]?(?:[$€£])?\\d+(?:[.,:/–-]\\d+)*(?:%|st|nd|rd|th)?',
  ].join('|'), 'gu')
  const masked = text.replace(pattern, value => {
    const token = `AFKEEP${String(originals.length).padStart(6, '0')}`
    originals.push(value)
    return token
  })
  return {
    masked,
    restore(translated: string): string | null {
      const tokens: string[] = translated.match(/AFKEEP\d{6}/g) ?? []
      if (tokens.length !== originals.length || new Set(tokens).size !== originals.length) return null
      for (let i = 0; i < originals.length; i++) if (!tokens.includes(`AFKEEP${String(i).padStart(6, '0')}`)) return null
      // Reject altered tokens or additional numeric claims instead of showing a changed evaluation.
      if (/\d|AFKEEP/.test(translated.replace(/AFKEEP\d{6}/g, ''))) return null
      return translated.replace(/AFKEEP(\d{6})/g, (_, index) => originals[Number(index)]!)
    },
  }
}

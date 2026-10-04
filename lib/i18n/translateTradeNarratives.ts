import 'server-only'
import { protectTradeNarrative } from './tradeNarrativeProtection'

/** No shared cache, persistence or text logging: explanations may be private to an account. */
export async function translateTradeNarratives(texts: string[], target: 'en' | 'es', identities: string[]) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY?.trim()
  if (!key) return texts.map(() => null)
  const protectedTexts = texts.map(text => protectTradeNarrative(text, identities))
  try {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ q: protectedTexts.map(text => text.masked), target, format: 'text' }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return texts.map(() => null)
    const body = await response.json() as { data?: { translations?: { translatedText?: string }[] } }
    if (body.data?.translations?.length !== texts.length) return texts.map(() => null)
    return protectedTexts.map((text, index) => {
      const translated = body.data!.translations![index]?.translatedText
      if (!translated?.trim() || translated.length > 8_000) return null
      const decoded = translated.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'"}[entity]!))
      return text.restore(decoded)
    })
  } catch {
    return texts.map(() => null)
  }
}

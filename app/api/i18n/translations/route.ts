import { NextResponse } from "next/server"
import { DEFAULT_LANG, resolveLanguage, SUPPORTED_LANGUAGES } from "@/lib/i18n/constants"
import { translations } from "@/lib/i18n/translations"
import { translateMissingEnglishKeysWithGoogle } from "@/lib/i18n/google-translate-server"
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { consumeRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { translateTradeNarratives } from '@/lib/i18n/translateTradeNarratives'

export const runtime = "nodejs"

const narrativeRequest = z.object({
  kind: z.literal('trade-narrative'),
  language: z.enum(['en', 'es']),
  texts: z.array(z.string().trim().min(1).max(2_000).refine(value => !value.includes('AFKEEP'))).min(1).max(24),
  identities: z.array(z.string().trim().min(1).max(160)).max(400).default([]),
}).strict().refine(value => value.texts.reduce((sum, text) => sum + text.length, 0) <= 8_000)

/** Authenticated display prose only. Never reprices a trade or writes its preserved evaluation. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions) as {user?: {id?: string}} | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = consumeRateLimit({ scope: 'i18n', action: 'trade_narrative', sleeperUsername: userId, maxRequests: 12, windowMs: 60_000 })
  if (!limited.success) return NextResponse.json({ error: 'Translation limit reached' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, limited.retryAfterSec)) } })
  // Bound the body before parsing; an oversized streaming request is cancelled immediately.
  const reader = req.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Invalid translation request' }, { status: 400 })
  const decoder = new TextDecoder()
  let raw = '', bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 96_000) { await reader.cancel(); return NextResponse.json({ error: 'Request too large' }, { status: 413 }) }
      raw += decoder.decode(part.value, { stream: true })
    }
    raw += decoder.decode()
    const parsed = narrativeRequest.safeParse(JSON.parse(raw))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid translation request' }, { status: 400 })
    const translated = await translateTradeNarratives(parsed.data.texts, parsed.data.language, parsed.data.identities)
    return NextResponse.json({ translations: translated, complete: translated.every(text => text !== null) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Invalid translation request' }, { status: 400 })
  } finally { reader.releaseLock() }
}

// Map language codes to Google Translate language codes (if different)
const LANG_TO_GOOGLE_CODE: Record<string, string> = {
  en: "en",
  es: "es",
  zh: "zh-CN", // Simplified Chinese
  fil: "tl", // Filipino (Tagalog)
  vi: "vi",
  fr: "fr",
  ar: "ar",
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lang = resolveLanguage(searchParams?.get("lang") ?? DEFAULT_LANG)

  const fallback = translations.en || {}
  const selected = translations[lang] || fallback
  const merged = {
    ...fallback,
    ...selected,
  }

  // Use Google Translate for all non-English languages with missing entries
  let googleMessages: Record<string, string> = {}
  if (lang !== "en") {
    const missingEntries: Record<string, string> = {}
    for (const [key, value] of Object.entries(fallback)) {
      if (selected[key] !== undefined) continue
      missingEntries[key] = value
    }
    
    if (Object.keys(missingEntries).length > 0) {
      const googleLang = LANG_TO_GOOGLE_CODE[lang] || lang
      googleMessages = await translateMissingEnglishKeysWithGoogle(missingEntries, googleLang)
    }
  }

  return NextResponse.json({
    ok: true,
    language: lang,
    messages: {
      ...merged,
      ...googleMessages,
    },
  })
}


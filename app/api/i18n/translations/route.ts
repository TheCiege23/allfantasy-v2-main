import { NextResponse } from "next/server"
import { DEFAULT_LANG, getLanguageSupportStatus, resolveLanguage } from "@/lib/i18n/constants"
import { translations } from "@/lib/i18n/translations"
import { translateMissingEnglishKeysWithGoogle } from "@/lib/i18n/google-translate-server"

export const runtime = "nodejs"

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
    fallbackLanguage: DEFAULT_LANG,
    supportStatus: getLanguageSupportStatus(lang),
    machineTranslatedMissingKeys: Object.keys(googleMessages).length,
    messages: {
      ...merged,
      ...googleMessages,
    },
  })
}


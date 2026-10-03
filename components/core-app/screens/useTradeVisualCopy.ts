'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { getIntlLocale } from '@/lib/i18n/constants'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
export function useTradeVisualCopy() {
  const {language}=useOptionalLanguage()
  function copy(value:string):string
  function copy<T>(value:T):T
  function copy(value:unknown):unknown {return typeof value==='string'?tradeVisualCopy(value,language):value}
  return {copy,language,locale:getIntlLocale(language)}
}

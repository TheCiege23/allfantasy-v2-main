'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { getIntlLocale } from '@/lib/i18n/constants'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import { useEffect, useRef, useState } from 'react'
import { tradeIdentityTerms } from '@/lib/i18n/tradeNarrativeProtection'

export type TradeTranslationState = 'idle' | 'loading' | 'translated' | 'partial'
/** Optional context enables translation of unbundled explanatory prose, never saved results. */
export function useTradeVisualCopy(context?: unknown) {
  const {language}=useOptionalLanguage()
  const identities = tradeIdentityTerms(context)
  const cache = useRef(new Map<string, string>())
  const queued = useRef(new Map<string, string>())
  const attempted = useRef(new Set<string>())
  const active = useRef<AbortController | null>(null)
  const [translationState, setTranslationState] = useState<TradeTranslationState>('idle')
  const [, rerender] = useState(0)
  useEffect(() => {
    setTranslationState('idle')
    return () => {
      active.current?.abort(); active.current = null
      for(const key of attempted.current) if(key.startsWith(`${language}:`)&&!cache.current.has(key)) attempted.current.delete(key)
    }
  }, [language])
  useEffect(() => {
    if (active.current || !['en','es'].includes(language)) return
    const entries = [...queued.current].filter(([key]) => key.startsWith(`${language}:`) && !attempted.current.has(key)).slice(0,24)
    const batch: typeof entries = []
    let length = 0
    for (const entry of entries) { if (length + entry[1].length > 8_000) break; length += entry[1].length; batch.push(entry) }
    if (!batch.length) return
    batch.forEach(([key]) => attempted.current.add(key))
    const controller = new AbortController()
    active.current = controller
    let timedOut=false
    const timer=setTimeout(()=>{if(active.current===controller){timedOut=true;controller.abort()}},20_000)
    setTranslationState('loading')
    void fetch('/api/i18n/translations', {
      method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store', signal:controller.signal,
      body:JSON.stringify({kind:'trade-narrative',language,texts:batch.map(([,text])=>text),identities}),
    }).then(async response => {
      if (!response.ok) throw new Error('Translation unavailable')
      const body = await response.json() as {translations?: unknown[]}
      if (!Array.isArray(body.translations) || body.translations.length !== batch.length) throw new Error('Incomplete translation')
      if (controller.signal.aborted) return
      let complete = true
      body.translations.forEach((value,index) => {
        if (typeof value==='string' && value.trim()) cache.current.set(batch[index]![0],value)
        else complete=false
      })
      while(cache.current.size>128) cache.current.delete(cache.current.keys().next().value!)
      const failed=[...attempted.current].some(key=>key.startsWith(`${language}:`)&&!cache.current.has(key))
      setTranslationState(complete&&!failed?'translated':'partial')
    }).catch(() => { if(!controller.signal.aborted||timedOut) setTranslationState('partial') })
      .finally(() => { clearTimeout(timer); if(active.current===controller) {active.current=null; if(!controller.signal.aborted||timedOut) rerender(value=>value+1)} })
  })
  function copy(value:string):string
  function copy<T>(value:T):T
  function copy(value:unknown):unknown {
    if(typeof value!=='string') return value
    const bundled=tradeVisualCopy(value,language)
    if(bundled!==value || context===undefined || identities.includes(value.trim())) return bundled
    const key=`${language}:${value}`
    const translated=cache.current.get(key)
    if(translated) return translated
    const prose=value.trim().length>=24 && value.length<=2_000 && value.trim().split(/\s+/).length>=4
    // The trade engines store English prose. Spanish source notes can also be displayed in English.
    const spanishSource=/\b(?:el|los|las|este|esta|para|pero|equipo|intercambio|jugador|plantilla)\b|[¿¡]/i.test(value)
    if(prose && (language==='es'||(language==='en'&&spanishSource)) && queued.current.size<128 && !value.includes('AFKEEP')) queued.current.set(key,value)
    return value
  }
  const retryTranslation=()=>{for(const key of queued.current.keys()) if(key.startsWith(`${language}:`)&&!cache.current.has(key)) attempted.current.delete(key); rerender(value=>value+1)}
  return {copy,language,locale:getIntlLocale(language),translationState,retryTranslation}
}

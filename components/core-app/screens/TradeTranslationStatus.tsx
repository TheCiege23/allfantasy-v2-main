'use client'
import type { TradeTranslationState } from './useTradeVisualCopy'
export function TradeTranslationStatus({state,language,retry}:{state:TradeTranslationState;language:string;retry:()=>void}) {
  if(state==='idle') return null
  const es=language==='es'
  return <div className="af-tc-row-sub" role="status" aria-live="polite" style={{overflowWrap:'anywhere'}}>
    {state==='loading'?(es?'Traduciendo explicaciones… El original sigue visible.':'Translating explanations… The original remains visible.'):
      state==='partial'?(es?'Algunas explicaciones siguen en su idioma original.':'Some explanations remain in their original language.'):
        (es?'Traducción automática de las explicaciones. Las notas y los valores no cambian.':'Explanations are machine translated. Grades and values are unchanged.')}
    {state==='partial'?<> <button type="button" className="af-btn af-btn--ghost" onClick={retry}>{es?'Reintentar traducción':'Retry translation'}</button></>:null}
  </div>
}

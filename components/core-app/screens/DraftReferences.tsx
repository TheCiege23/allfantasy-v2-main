'use client';
import { InfoTip } from '../InfoTip';
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient';
import type { DraftReference } from '@/lib/draft-archive/referenceModel';
import { useState } from 'react';
import '@/components/core-app/af-draft-analysis.css';
function ReferenceRows({ r, es }: { r: DraftReference; es: boolean }) {
  const [query,setQuery] = useState(''), [page,setPage] = useState(0);
  const t = (en: string, sp: string) => es ? sp : en;
  const entries = [...r.entries].sort((a,b) => r.kind === 'adp' ? a.value - b.value : b.value - a.value).filter(e => (e.name + ' ' + e.position).toLowerCase().includes(query.toLowerCase()));
  return <><label>{t('Find a covered player', 'Buscar jugador cubierto')}<input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label>
    <div className="af-archive-table" role="region" tabIndex={0} aria-label={t('Reference rankings', 'Clasificación de referencia')}><table><thead><tr><th>{t('Player', 'Jugador')}</th><th>{t('Value', 'Valor')}</th><th>{t('Sample', 'Muestra')}</th><th>{t('Overall / ADP difference', 'Selección / diferencia de ADP')}</th></tr></thead><tbody>{entries.slice(page*20,page*20+20).map(e => <tr key={e.playerId}><td>{e.name} · {e.position}</td><td>{e.value.toFixed(1)}</td><td>{e.sample ?? '—'}</td><td>{e.draftedOverall ?? '—'} / {e.difference == null ? '—' : (e.difference >= 0 ? '+' : '') + e.difference.toFixed(1)}</td></tr>)}</tbody></table></div>
    <nav aria-label={t('Reference pages', 'Páginas de referencias')}><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t('Previous','Anterior')}</button><span>{entries.length} {t('players', 'jugadores')} · {page+1}</span><button disabled={(page+1)*20>=entries.length} onClick={()=>setPage(p=>p+1)}>{t('Next','Siguiente')}</button></nav></>;
}
export function DraftReferences({ references, error }: { references?: DraftReference[]; error?: boolean }) {
  const es = useOptionalLanguage().language === 'es';
  const t = (en: string, sp: string) => es ? sp : en;
  if (!references?.length && !error) return null;
  return <section className="af-draft-reference" aria-label={t('Market references', 'Referencias de mercado')}>
    <h3>{t('Market references', 'Referencias de mercado')} <InfoTip label={t('About market references', 'Acerca de referencias')} title={t('Reference coverage', 'Cobertura de referencias')}><p>{t('These are separate reference rankings. ADP measures selection order; market value measures a provider’s valuation; auction prices measure recorded bids. They do not prove decision quality. Provider formats may omit team count, custom scoring and tight-end premium. Historical references must precede draft start.', 'Son clasificaciones de referencia separadas. ADP mide el orden; el valor de mercado mide la valoración del proveedor; las subastas miden pujas registradas. No demuestran la calidad de una decisión. Los formatos pueden omitir cantidad de equipos, puntuación personalizada y prima de TE. Las referencias históricas deben preceder al inicio.')}</p></InfoTip></h3>
    {error && <p role="status">{t('Reference data could not be loaded. Retry this page.', 'No se pudieron cargar las referencias. Vuelve a intentar.')}</p>}
    {references?.map(r => <details key={r.kind + r.format}><summary>{r.kind === 'adp' ? 'ADP' : r.kind === 'auction_price' ? t('Observed auction prices', 'Precios observados de subasta') : t('Market value ranking', 'Clasificación de valor de mercado')} · {r.format} · {r.entries.length} {t('covered players', 'jugadores cubiertos')}</summary>
      <p>{r.attributionUrl ? <a href={r.attributionUrl} target="_blank" rel="noopener noreferrer">{r.provider}</a> : r.provider} · {t('Effective', 'Vigente')}: {r.effectiveAt} · {t('Retrieved', 'Consultado')}: {r.observedAt}</p>
      <p>{t('Format reference; exact custom-scoring compatibility is not implied. ADP sample size is unavailable unless shown. Cached ADP observation time does not establish provider freshness.', 'Referencia de formato; no implica compatibilidad exacta con reglas personalizadas. La muestra de ADP no está disponible salvo que se indique. La hora de observación del caché no demuestra la actualización del proveedor.')}</p>
      <ReferenceRows key={r.effectiveAt + r.observedAt} r={r} es={es}/>
      {r.displayScope && <p>{r.displayScope === 'preparation_top100' ? t('Preparation subset: top 100 players from this reference board.', 'Subconjunto de preparación: 100 jugadores principales de la referencia.') : t('This view covers selections from the chosen draft.', 'Esta vista cubre selecciones del draft elegido.')}</p>}
      {r.formatBasis === 'observed_historical_season' && <p>{t('Format comes from an observed historical-season settings snapshot; original draft-time settings are unverified.', 'El formato procede de reglas observadas de la temporada histórica; las reglas originales del draft no están verificadas.')}</p>}
      {r.identityBasis === 'current_verified_mapping' && <p>{t('Player binding uses the current verified ID crosswalk. This is a historical market reference and is excluded from frozen draft-day grading.', 'La identidad usa correspondencias de IDs verificadas actuales. Es una referencia histórica de mercado y se excluye de la calificación congelada del draft.')}</p>}
      <p>{t('Sorted by reference value. Positive ADP difference means selected later; negative means earlier. Values are reference data, not projected fantasy points.', 'Ordenado por valor de referencia. Diferencia de ADP positiva significa seleccionado después; negativa, antes. Los valores son referencias, no puntos proyectados.')}</p>
    </details>)}
  </section>;
}

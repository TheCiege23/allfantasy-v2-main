'use client';
import { InfoTip } from '../InfoTip';
import { useMessages } from '@/components/i18n/useMessages';
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens';
import type { DraftReference } from '@/lib/draft-archive/referenceModel';
import { useState } from 'react';
import '@/components/core-app/af-draft-analysis.css';
function ReferenceRows({ r }: { r: DraftReference }) {
  const [query,setQuery] = useState(''), [page,setPage] = useState(0);
  const m = useMessages(draftScreensMessages);
  const entries = [...r.entries].sort((a,b) => r.kind === 'adp' ? a.value - b.value : b.value - a.value).filter(e => (e.name + ' ' + e.position).toLowerCase().includes(query.toLowerCase()));
  return <><label>{m.referencesFindPlayer}<input value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label>
    <div className="af-archive-table" role="region" tabIndex={0} aria-label={m.referencesReferenceRankings}><table><thead><tr><th>{m.referencesPlayer}</th><th>{m.referencesValue}</th><th>{m.referencesSample}</th><th>{m.referencesOverallAdpDifference}</th></tr></thead><tbody>{entries.slice(page*20,page*20+20).map(e => <tr key={e.playerId}><td>{e.name} · {e.position}</td><td>{e.value.toFixed(1)}</td><td>{e.sample ?? '—'}</td><td>{e.draftedOverall ?? '—'} / {e.difference == null ? '—' : (e.difference >= 0 ? '+' : '') + e.difference.toFixed(1)}</td></tr>)}</tbody></table></div>
    <nav aria-label={m.referencesReferencePages}><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{m.referencesPrevious}</button><span>{entries.length} {m.referencesPlayers} · {page+1}</span><button disabled={(page+1)*20>=entries.length} onClick={()=>setPage(p=>p+1)}>{m.referencesNext}</button></nav></>;
}
export function DraftReferences({ references, error }: { references?: DraftReference[]; error?: boolean }) {
  const m = useMessages(draftScreensMessages);
  if (!references?.length && !error) return null;
  return <section className="af-draft-reference" aria-label={m.referencesMarketReferences}>
    <h3>{m.referencesMarketReferences} <InfoTip label={m.referencesAboutMarketReferences} title={m.referencesReferenceCoverage}><p>{m.referencesHelp}</p></InfoTip></h3>
    {error && <p role="status">{m.referencesLoadError}</p>}
    {references?.map(r => <details key={r.kind + r.format}><summary>{r.kind === 'adp' ? 'ADP' : r.kind === 'auction_price' ? m.referencesObservedAuctionPrices : m.referencesMarketValueRanking} · {r.format} · {r.entries.length} {m.referencesCoveredPlayers}</summary>
      <p>{r.attributionUrl ? <a href={r.attributionUrl} target="_blank" rel="noopener noreferrer">{r.provider}</a> : r.provider} · {m.referencesEffective}: {r.effectiveAt} · {m.referencesRetrieved}: {r.observedAt}</p>
      <p>{m.referencesFormatNote}</p>
      <ReferenceRows key={r.effectiveAt + r.observedAt} r={r}/>
      {r.displayScope && <p>{r.displayScope === 'preparation_top100' ? m.referencesPreparationSubset : m.referencesDraftScope}</p>}
      {r.formatBasis === 'observed_historical_season' && <p>{m.referencesObservedFormat}</p>}
      {r.identityBasis === 'current_verified_mapping' && <p>{m.referencesCurrentMapping}</p>}
      <p>{m.referencesSortNote}</p>
    </details>)}
  </section>;
}

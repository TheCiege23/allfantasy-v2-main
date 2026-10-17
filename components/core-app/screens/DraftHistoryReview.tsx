'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InfoTip } from '../InfoTip';
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient';
import { listHistorySources, previewHistorySource, confirmHistorySource } from '@/lib/draft-archive/historyActions';
export function DraftHistoryReview({ leagueId, archiveKey }: { leagueId: string; archiveKey: string }) {
  const es = useOptionalLanguage().language === 'es', router = useRouter();
  const t = (en: string, sp: string) => es ? sp : en;
  const [drafts, setDrafts] = useState<Array<{ id: string; type: string; status: string; start: number | null }>>([]), [source, setSource] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ digest: string; count: number; total: number; picks: Array<{ overall: number; round: number; playerId: string | null }> } | null>(null);
  async function run(action: 'list' | 'preview' | 'apply') {
    setBusy(true); setMessage('');
    try {
      if (action === 'list') { const result = await listHistorySources(leagueId, archiveKey); if (!result.ok) throw new Error(); setDrafts(result.drafts); setPreview(null); }
      if (action === 'preview') { const result = await previewHistorySource(leagueId, archiveKey, source); if (!result.ok) throw new Error(); setPreview(result); }
      if (action === 'apply' && preview) { const result = await confirmHistorySource(leagueId, archiveKey, source, preview.digest, reason); if (!result.ok) throw new Error(); setPreview(null); setMessage(t(`${result.count} historical picks verified. Review again for remaining records.`, `${result.count} selecciones verificadas. Revisa los registros restantes.`)); router.push('/core/draft-hq?league=' + encodeURIComponent(leagueId) + '&draft=' + encodeURIComponent('imported:' + source)); }
    } catch { setPreview(null); setMessage(t('Review unavailable or records changed. Retry; no source is guessed. Commissioners only.', 'Revisión no disponible o registros cambiados. Vuelve a intentar; no se adivina el origen. Solo comisionados.')); }
    finally { setBusy(false); }
  }
  return <details><summary>{t('Commissioner: verify historical source', 'Comisionado: verificar origen histórico')} <InfoTip label={t('About source verification', 'Acerca de la verificación')} title={t('Historical verification', 'Verificación histórica')}><p>{t('Choose a source you can independently confirm. Only exact season, round, overall pick and player-ID matches are attached, at most 50 per review. Raw selections are preserved. The actor, reason and before/after metadata are audited privately. Unmatched facts remain unresolved.', 'Elige un origen que puedas confirmar. Solo se vinculan coincidencias exactas de temporada, ronda, selección e ID, hasta 50 por revisión. Las selecciones se conservan. Actor, motivo y metadatos se auditan en privado. Las discrepancias siguen sin resolver.')}</p></InfoTip></summary>
    <p>{t('Different drafts can contain identical selections. Confirm the original draft before applying a source.', 'Distintos drafts pueden contener selecciones idénticas. Confirma el draft original antes de vincularlo.')}</p>
    <button disabled={busy} onClick={() => run('list')}>{t('Load verified league sources / retry provider', 'Cargar orígenes / reintentar proveedor')}</button>
    {!!drafts.length && <><label>{t('Source draft', 'Draft de origen')}<select value={source} disabled={busy} onChange={e => { setSource(e.target.value); setPreview(null); }}><option value="">{t('Choose a source', 'Elige un origen')}</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.id} · {d.type} · {d.status} · {d.start ? new Date(d.start).toISOString().slice(0,10) : '—'}</option>)}</select></label><button disabled={busy || !source} onClick={() => run('preview')}>{t('Preview exact matches', 'Vista previa de coincidencias')}</button></>}
    {preview && <><p>{preview.count}/{preview.total} {t('unresolved picks in this batch. Preview IDs:', 'selecciones sin resolver en este lote. IDs:')}</p><ul>{preview.picks.map(p => <li key={p.overall}>{p.round}.{p.overall} · {p.playerId}</li>)}</ul><label>{t('Evidence / reason (10–500 characters)', 'Evidencia / motivo (10–500 caracteres)')}<textarea minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={busy || !preview.count || reason.trim().length < 10} onClick={() => run('apply')}>{t('Confirm this source and preserve audit', 'Confirmar origen y conservar auditoría')}</button></>}
    <p role="status">{busy ? t('Reading historical source…', 'Consultando origen histórico…') : message}</p>
  </details>;
}

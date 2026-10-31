'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InfoTip } from '../InfoTip';
import { useMessages } from '@/components/i18n/useMessages';
import { coreTriageMessages } from '@/lib/core-app/messages/coreTriage';
import { listHistorySources, previewHistorySource, confirmHistorySource } from '@/lib/draft-archive/historyActions';
export function DraftHistoryReview({ leagueId, archiveKey }: { leagueId: string; archiveKey: string }) {
  const m = useMessages(coreTriageMessages), router = useRouter();
  const [drafts, setDrafts] = useState<Array<{ id: string; type: string; status: string; start: number | null }>>([]), [source, setSource] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ digest: string; count: number; total: number; picks: Array<{ overall: number; round: number; playerId: string | null }> } | null>(null);
  async function run(action: 'list' | 'preview' | 'apply') {
    setBusy(true); setMessage('');
    try {
      if (action === 'list') { const result = await listHistorySources(leagueId, archiveKey); if (!result.ok) throw new Error(); setDrafts(result.drafts); setPreview(null); }
      if (action === 'preview') { const result = await previewHistorySource(leagueId, archiveKey, source); if (!result.ok) throw new Error(); setPreview(result); }
      if (action === 'apply' && preview) { const result = await confirmHistorySource(leagueId, archiveKey, source, preview.digest, reason); if (!result.ok) throw new Error(); setPreview(null); setMessage(m.draftReviewVerified(result.count)); router.push('/core/draft-hq?league=' + encodeURIComponent(leagueId) + '&draft=' + encodeURIComponent('imported:' + source)); }
    } catch { setPreview(null); setMessage(m.draftReviewUnavailable); }
    finally { setBusy(false); }
  }
  return <details><summary>{m.draftReviewSummary} <InfoTip label={m.draftReviewTipLabel} title={m.draftReviewTipTitle}><p>{m.draftReviewTipBody}</p></InfoTip></summary>
    <p>{m.draftReviewWarning}</p>
    <button disabled={busy} onClick={() => run('list')}>{m.draftReviewLoad}</button>
    {!!drafts.length && <><label>{m.draftReviewSourceDraft}<select value={source} disabled={busy} onChange={e => { setSource(e.target.value); setPreview(null); }}><option value="">{m.draftReviewChooseSource}</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.id} · {d.type} · {d.status} · {d.start ? new Date(d.start).toISOString().slice(0,10) : '—'}</option>)}</select></label><button disabled={busy || !source} onClick={() => run('preview')}>{m.draftReviewPreview}</button></>}
    {preview && <><p>{preview.count}/{preview.total} {m.draftReviewUnresolved}</p><ul>{preview.picks.map(p => <li key={p.overall}>{p.round}.{p.overall} · {p.playerId}</li>)}</ul><label>{m.draftReviewEvidence}<textarea minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={busy || !preview.count || reason.trim().length < 10} onClick={() => run('apply')}>{m.draftReviewConfirm}</button></>}
    <p role="status">{busy ? m.draftReviewReading : message}</p>
  </details>;
}

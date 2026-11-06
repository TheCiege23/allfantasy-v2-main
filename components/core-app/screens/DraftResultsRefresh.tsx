'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient';
import { useMessages } from '@/components/i18n/useMessages';
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens';
import { InfoTip } from '../InfoTip';
import { refreshHistoricalResults } from '@/lib/draft-archive/historyActions';

const DATE_LOCALE: Record<string, string> = { en: 'en-US', es: 'es' };

/** "Nov 1, 2026, 8:01 AM" in the reader's language and zone — never the raw ISO instant. */
export function readableWhen(iso: string, language: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : new Intl.DateTimeFormat(DATE_LOCALE[language] ?? 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

export function DraftResultsRefresh({ leagueId, archiveKey, observedAt }: { leagueId: string; archiveKey: string; observedAt?: string | null }) {
  const language = useOptionalLanguage().language, m = useMessages(draftScreensMessages), router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const refresh = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await refreshHistoricalResults(leagueId, archiveKey);
      setMessage(result.ok ? m.resultsRefreshed(result.weeks, result.state) : m.resultsRefreshUnavailable);
      if (result.ok) router.refresh();
    } catch { setMessage(m.resultsRefreshRetry); } finally { setBusy(false); }
  };
  return <div className="af-results-refresh">
    <p>{m.resultsLastRead}: {observedAt ? readableWhen(observedAt, language) : m.resultsNotReadYet} <InfoTip label={m.resultsAboutRefresh} title={m.resultsRecordedWeekly}><span className="af-info-para">{m.resultsRefreshHelp}</span></InfoTip></p>
    <button type="button" disabled={busy} onClick={refresh}>{busy ? m.resultsRefreshing : m.resultsRefresh}</button>
    <p role="status">{message}</p>
  </div>;
}

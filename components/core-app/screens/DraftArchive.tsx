'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InfoTip } from '@/components/core-app/InfoTip';
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient';
import { useMessages } from '@/components/i18n/useMessages';
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens';
import { coreLang } from '@/lib/core-app/messages/coreLocale';
import type { ArchiveChoice } from '@/lib/draft-archive/catalog';
import type { ArchiveDetail } from '@/lib/draft-archive/detail';
import { DraftHistoryReview } from './DraftHistoryReview';
import { DraftReferences } from './DraftReferences';
import { DraftAnalysis } from './DraftAnalysis';
import { DraftPhase4 } from './DraftPhase4';
import { DraftResultsRefresh } from './DraftResultsRefresh';
import { DraftRecordView } from './DraftRecordView';
import '@/components/core-app/af-draft-archive.css';
type Choice = Omit<ArchiveChoice, 'createdAt' | 'total'>;
export function DraftArchive({ choices, detail, leagueId, page, more, total, error, query = '', season = '', timelinePage = 1 }: {
    choices: Choice[];
    detail: ArchiveDetail | null;
    leagueId?: string | null;
    page: number;
    more: boolean;
    total: number;
    error?: string | null;
    query?: string;
    season?: string;
    timelinePage?: number;
}) {
    const language = useOptionalLanguage().language, router = useRouter();
    const m = useMessages(draftScreensMessages);
    const [pickPage, setPickPage] = useState(0), [team, setTeam] = useState(''), [player, setPlayer] = useState('');
    useEffect(() => { setPickPage(0); setTeam(''); setPlayer(''); }, [detail?.choice.key, detail?.choice.leagueId]);
    const href = (key?: string, league = leagueId, nextPage = 1) => { const p = new URLSearchParams(); if (league)
        p.set('league', league); if (key)
        p.set('draft', key); if (nextPage > 1)
        p.set('archivePage', String(nextPage)); if (query)
        p.set('archiveQuery', query); if (season)
        p.set('archiveSeason', season); return '/core/draft-hq?' + p.toString(); };
    const help = (title: string, text: string) => <InfoTip label={m.archiveAboutPrefix + title} title={title}><span className="af-info-para">{text}</span></InfoTip>;
    const picks = detail?.picks.filter(p => (!team || p.rosterId === team) && (!player || p.playerName.toLowerCase().includes(player.toLowerCase()))) ?? [];
    const teams = [...new Map((detail?.picks ?? []).filter(p => p.rosterId).map(p => [p.rosterId!, p.teamName ?? p.rosterId!])).entries()];
    const time = (v: string | null) => v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    const duration = (v: number | null) => v == null ? '—' : Math.floor(v / 3600000) + 'h ' + Math.floor(v % 3600000 / 60000) + 'm ' + Math.floor(v % 60000 / 1000) + 's';
    const timelineHref = (next: number) => href(detail?.choice.key, leagueId, page) + '&timelinePage=' + next;
    const sectionHelp = [m.archiveHelpSnapshot, m.archiveHelpClockTimeline, m.archiveHelpCorrections, m.archiveHelpTradePackages, m.archiveHelpExecutedTrades];
    return <section className="af-frame af-archive" aria-label={m.archiveDraftArchive}>
  <header><h2>{m.archiveDraftArchive} {help(m.archiveDraftIdentity, m.archiveHelpDraftIdentity)}</h2><p>{total} {m.archiveDraftRecords}</p></header>
  <details className="af-archive-search"><summary>{m.archiveSearchAndFilter}</summary><form action="/core/draft-hq" method="get"><input type="hidden" name="league" value={leagueId ?? ''}/><label>{m.archiveSearchLabel}<input name="archiveQuery" defaultValue={query} maxLength={120}/></label><label>{m.archiveSeason}<input name="archiveSeason" type="number" min={1900} max={2100} defaultValue={season}/></label><button>{m.archiveSearch}</button><Link href={leagueId ? '/core/draft-hq?league=' + encodeURIComponent(leagueId) : '/core/draft-hq'}>{m.archiveResetFilters}</Link></form></details>
  {leagueId && <label>{m.archiveIndividualDraft}<select aria-label={m.archiveSelectDraft} value={detail?.choice.key ?? ''} onChange={e => router.push(href(e.target.value))}><option value="">{m.archiveChooseADraft}</option>{detail && !choices.some(c => c.key === detail.choice.key) && <option value={detail.choice.key}>{detail.choice.season ?? '?'} · {detail.choice.format} · {detail.choice.sourceId}</option>}{choices.map(c => <option key={c.key} value={c.key}>{c.season ?? '?'} · {c.format} · {c.status} · {c.sourceId}</option>)}</select></label>}
  {!leagueId && <ul>{choices.map(c => <li key={c.leagueId + ':' + c.key}><Link href={href(c.key, c.leagueId)}>{c.leagueName} · {c.season ?? '?'} · {c.sport} · {c.format} · {c.status}</Link></li>)}</ul>}
  <nav aria-label={m.archiveArchivePages}>{page > 1 && <Link href={href(detail?.choice.key, leagueId, page - 1)}>{m.archivePrevious}</Link>}<span>{m.archivePage} {page}</span>{more && <Link href={href(detail?.choice.key, leagueId, page + 1)}>{m.archiveNext}</Link>}</nav>
  {error && <p role="alert">{m.archiveError(error)} <Link href={leagueId ? '/core/draft-hq?league=' + encodeURIComponent(leagueId) : '/core/draft-hq'}>{m.archiveReturnToCurrent}</Link></p>}
  {detail && <>
   <h3>{detail.choice.season ?? m.archiveUnknownSeason} · {detail.choice.sport} · {detail.choice.format} · {detail.choice.status}</h3>
   <p>{m.archiveSourceDraft}: {detail.choice.sourceId}</p>
   {detail.canReconcile && <DraftHistoryReview key={'review:' + detail.choice.key} leagueId={detail.choice.leagueId} archiveKey={detail.choice.key}/>}
   <div className="af-archive-summary"><p>{m.archiveStarted}: {time(detail.startedAt)}</p><p>{m.archiveEndMeaning(detail.endMeaning)}: {time(detail.endedAt)}</p><p>{m.archiveElapsedDuration}: {duration(detail.elapsedMs)} {help(m.archiveDuration, m.archiveHelpDuration)}</p><p>{m.archiveActiveDuration}: {duration(detail.activeMs)}</p></div>
   {detail.coverage.map((c, i) => <p key={i} className="af-archive-coverage">{m.archiveCoverage(c)}</p>)}
   {!detail.picks.length&&<p>{m.archiveNoSelections}</p>}
   <div className="af-archive-filters"><label>{m.archiveTeam}<select value={team} onChange={e => { setTeam(e.target.value); setPickPage(0); }}><option value="">{m.archiveAllTeams}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>{m.archivePlayer}<input value={player} onChange={e => { setPlayer(e.target.value); setPickPage(0); }}/></label></div>
   <p>{m.archiveAdpComparison} {help(m.archiveAdpDifference, m.archiveHelpAdpDifference)}</p>
   <h3>{m.archiveSelectionsAndOwnership} {help(m.archiveSelectionDetails, m.archiveHelpSelectionDetails)}</h3>
   <div className="af-archive-table" tabIndex={0} role="region" aria-label={m.archiveArchivedPicks}><table><thead><tr>{[m.archivePick, m.archivePlayer, m.archiveReceivingTeam, m.archiveOriginalSlotOwner, m.archiveSelectedBy, m.archiveSelectedAt, m.archiveOtcColumns, m.archivePriceSource, m.archiveDraftTimeAdpDifference].map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{picks.slice(pickPage * 25, pickPage * 25 + 25).map(p => <tr key={p.id}><td>#{p.overall} <small>{m.archiveRound} {p.round} · {m.archiveOverall} #{p.overall}</small></td><td>{p.playerName}<small>{p.position} · {p.club ?? '—'}</small><small>{p.keeper ? m.archiveKeeper : ''}</small><details><summary>{m.archiveIdentityAndOwnerTime}</summary><p>{p.playerId ?? '—'} · {p.identityBasis}</p><p>{m.archiveOtcStarted}: {time(p.onClockAt ?? null)}</p><p>{m.archivePausedOtc}: {duration(p.pausedMs ?? null)}</p>{p.ownerTime && Object.entries(p.ownerTime).map(([owner, ms]) => <p key={owner}>{owner}: {duration(ms)}</p>)}</details></td><td>{p.teamName ?? p.rosterId ?? '—'}</td><td>{p.slot ?? '—'} / {p.originalTeamName ?? p.originalRosterId ?? '—'}</td><td>{p.actorName ?? p.actor ?? '—'}</td><td>{time(p.selectedAt)}</td><td>{duration(p.elapsedMs ?? null)} / {duration(p.activeMs)} / {p.allowanceSeconds == null ? '—' : p.allowanceSeconds + 's'}</td><td>{p.amount ?? '—'} / {p.source ?? '—'}</td><td>{p.adp == null ? '—' : p.adp.toFixed(1)} / {p.adpDifference == null ? '—' : (p.adpDifference > 0 ? '+' : '') + p.adpDifference.toFixed(1)}<small>{p.adpSample == null ? '' : m.archiveSample + ': ' + p.adpSample}</small><small>{p.adpObservedAt ? time(p.adpObservedAt) : ''}</small></td></tr>)}</tbody></table></div>
   <nav><button disabled={pickPage === 0} onClick={() => setPickPage(v => v - 1)}>{m.archivePreviousPicks}</button><span>{picks.length} {m.archivePicks}</span><button disabled={(pickPage + 1) * 25 >= picks.length} onClick={() => setPickPage(v => v + 1)}>{m.archiveNextPicks}</button></nav>
   <DraftReferences references={detail.references}/>
   <DraftAnalysis report={detail.analysisReport} results={detail.resultsReport}/>
   {/* 🛑 Each sibling keys on the draft with its OWN prefix. All three used to share `detail.choice.key`;
       duplicate sibling keys made React append a fresh DraftPhase4 on every server refresh instead of
       reconciling — one language switch left five on Draft HQ, only the last one live (2026-10-06). */}
   <DraftPhase4 key={'phase4:' + detail.choice.key} detail={detail}/>
   {detail.canRefreshResults && <DraftResultsRefresh key={'results:' + detail.choice.key} leagueId={detail.choice.leagueId} archiveKey={detail.choice.key} observedAt={detail.resultsObservedAt}/>}
   {!detail.analysisReport && detail.analysis && <section aria-label={m.archiveDraftAnalysisCoverage}>
    <h3>{m.archiveDraftAnalysis} {help(m.archiveAnalysisBasis, m.archiveHelpAnalysisBasis)}</h3>
    <div className="af-archive-summary">
     <p>{m.archiveDraftDayGrade}<small>{detail.analysis.draftDay.capturedBaselines} {m.archivePreservedBaselines}</small></p>
     <p>{m.archiveResultsToDateGrade}<small>{detail.analysis.resultsToDate.coveredPicks}/{detail.analysis.totalPicks} {m.archiveVerifiedSelections}</small></p>
    </div>
   </section>}
   {[[m.archiveDraftTimeSnapshot, detail.snapshot], [m.archiveClockTimeline, detail.events], [m.archiveCommissionerCorrections, detail.corrections], [m.archiveTradePackages, detail.trades], [m.archiveExecutedTradesDuring, detail.playerTrades ?? []]].map(([title, data], index) => <details key={String(title)}><summary>{String(title)} {help(String(title), sectionHelp[index])}</summary><DraftRecordView value={data} language={coreLang(language)}/></details>)}
   <nav aria-label={m.archiveTimelinePages}>
    {timelinePage > 1 && <Link href={timelineHref(timelinePage - 1)}>{m.archiveNewerRecords}</Link>}
    <span>{m.archiveTimelinePage} {timelinePage}</span>
    {(detail.eventsMore || detail.correctionsMore || detail.tradesMore || detail.playerTradesMore) && <Link href={timelineHref(timelinePage + 1)}>{m.archiveOlderRecords}</Link>}
   </nav>
   <p>{m.archiveTimelineNote}</p>
  </>}
 </section>;
}

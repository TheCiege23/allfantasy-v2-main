'use client';
import { useEffect, useState, type CSSProperties } from 'react';
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
export function DraftArchive({ choices, detail, leagueId, page, more, total, error, query = '', season = '', timelinePage = 1, asDraftHq = false }: {
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
    /** The league has no Draft HQ data of its own (its draft ran on the platform), so this archive IS the screen: it carries the title. */
    asDraftHq?: boolean;
}) {
    const language = useOptionalLanguage().language, router = useRouter();
    const m = useMessages(draftScreensMessages);
    // The picker read "2026 · snake · complete · 1391441779609317376" (live /core, 2026-11-06). The provider's
    // draft id is only worth showing to tell apart two drafts that would otherwise read the same, and then
    // its last four digits do it; the full id stays in Timing and source details.
    const baseLabel = (c: { season: number | null; format: string; status: string }) => `${c.season ?? '?'} · ${c.format} · ${c.status}`;
    const draftLabel = (c: { key: string; season: number | null; format: string; status: string; sourceId: string }) =>
        choices.some(o => o.key !== c.key && baseLabel(o) === baseLabel(c)) ? `${baseLabel(c)} · …${c.sourceId.slice(-4)}` : baseLabel(c);
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
    // An imported Sleeper draft has no owner of the original slot, no selection time, no clock and no price,
    // so four columns read "—" on all 168 rows (live /core, 2026-11-06). A column shows only when some pick
    // in the draft has a value for it; the coverage notes in Timing and source details say what is missing.
    const all = detail?.picks ?? [];
    const has = { owner: all.some(p => p.originalTeamName || p.originalRosterId), slot: all.some(p => p.slot != null), actor: all.some(p => p.actorName), at: all.some(p => p.selectedAt), otc: all.some(p => p.elapsedMs != null || p.activeMs != null || p.allowanceSeconds != null), price: all.some(p => p.amount != null), adp: all.some(p => p.adp != null) };
    const heads: [string, boolean][] = [[m.archivePick, true], [m.archivePlayer, true], [m.archiveReceivingTeam, true], [has.owner ? m.archiveOriginalSlotOwner : m.archiveOriginalSlot, has.owner || has.slot], [m.archiveSelectedBy, has.actor], [m.archiveSelectedAt, has.at], [m.archiveOtcColumns, has.otc], [m.archivePriceSource, has.price], [m.archiveDraftTimeAdpDifference, has.adp]];
    const hidden = heads.some(([, shown]) => !shown);
    const teams = [...new Map((detail?.picks ?? []).filter(p => p.rosterId).map(p => [p.rosterId!, p.teamName ?? p.rosterId!])).entries()];
    const time = (v: string | null) => v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    const duration = (v: number | null) => v == null ? '—' : Math.floor(v / 3600000) + 'h ' + Math.floor(v % 3600000 / 60000) + 'm ' + Math.floor(v % 60000 / 1000) + 's';
    const timelineHref = (next: number) => href(detail?.choice.key, leagueId, page) + '&timelinePage=' + next;
    const sectionHelp = [m.archiveHelpSnapshot, m.archiveHelpClockTimeline, m.archiveHelpCorrections, m.archiveHelpTradePackages, m.archiveHelpExecutedTrades];
    return <section className="af-frame af-archive" aria-label={m.archiveDraftArchive}>
  {asDraftHq && <header className="af-archive-hq"><h1 className="af-archive-hq-title">{m.archiveHqTitle}</h1>{detail && <p className="af-archive-hq-sub">{detail.choice.season ?? m.archiveUnknownSeason} · {detail.choice.sport} · {detail.choice.format} · <span className="af-archive-row-status" data-status={detail.choice.status}>{detail.choice.status}</span> · {detail.picks.length} {m.archivePicks}</p>}</header>}
  <header><h2>{m.archiveDraftArchive} {help(m.archiveDraftIdentity, m.archiveHelpDraftIdentity)}</h2><p>{m.archiveDraftRecords(total)}</p></header>
  <details className="af-archive-search"><summary>{m.archiveSearchAndFilter}</summary><form action="/core/draft-hq" method="get"><input type="hidden" name="league" value={leagueId ?? ''}/><label>{m.archiveSearchLabel}<input name="archiveQuery" defaultValue={query} maxLength={120}/></label><label>{m.archiveSeason}<input name="archiveSeason" type="number" min={1900} max={2100} defaultValue={season}/></label><button>{m.archiveSearch}</button><Link href={leagueId ? '/core/draft-hq?league=' + encodeURIComponent(leagueId) : '/core/draft-hq'}>{m.archiveResetFilters}</Link></form></details>
  {leagueId && <label>{m.archiveIndividualDraft}<select aria-label={m.archiveSelectDraft} value={detail?.choice.key ?? ''} onChange={e => router.push(href(e.target.value))}><option value="">{m.archiveChooseADraft}</option>{detail && !choices.some(c => c.key === detail.choice.key) && <option value={detail.choice.key}>{draftLabel(detail.choice)}</option>}{choices.map(c => <option key={c.key} value={c.key}>{draftLabel(c)}</option>)}</select></label>}
  {!leagueId && <ul className="af-archive-list">{choices.map(c => <li key={c.leagueId + ':' + c.key}><Link className="af-archive-row" href={href(c.key, c.leagueId)}><b>{c.leagueName}</b><span className="af-archive-row-meta">{c.season ?? '?'} · {c.sport} · {c.format}</span><span className="af-archive-row-status" data-status={c.status}>{c.status}</span></Link></li>)}</ul>}
  {/* One page of drafts has nowhere to go, so "Page 1" alone is noise. */}
  {(page > 1 || more) && <nav aria-label={m.archiveArchivePages}>{page > 1 && <Link href={href(detail?.choice.key, leagueId, page - 1)}>{m.archivePrevious}</Link>}<span>{m.archivePage} {page}</span>{more && <Link href={href(detail?.choice.key, leagueId, page + 1)}>{m.archiveNext}</Link>}</nav>}
  {error && <p role="alert">{m.archiveError(error)} <Link href={leagueId ? '/core/draft-hq?league=' + encodeURIComponent(leagueId) : '/core/draft-hq'}>{m.archiveReturnToCurrent}</Link></p>}
  {detail && <>
   {/* As Draft HQ, the header line already says this. */}
   {!asDraftHq && <h3>{detail.choice.season ?? m.archiveUnknownSeason} · {detail.choice.sport} · {detail.choice.format} · {detail.choice.status}</h3>}
   {detail.canReconcile && <DraftHistoryReview key={'review:' + detail.choice.key} leagueId={detail.choice.leagueId} archiveKey={detail.choice.key}/>}
   {/* Provenance, not the draft: the source id, UTC clock and coverage notes fold away so the selections lead (live /core, 2026-11-05). */}
   <details className="af-archive-tech"><summary>{m.archiveRecordDetails}</summary>
   <p>{m.archiveSourceDraft}: {detail.choice.sourceId}</p>
   <div className="af-archive-summary"><p>{m.archiveStarted}: {time(detail.startedAt)}</p><p>{m.archiveEndMeaning(detail.endMeaning)}: {time(detail.endedAt)}</p><p>{m.archiveElapsedDuration}: {duration(detail.elapsedMs)} {help(m.archiveDuration, m.archiveHelpDuration)}</p><p>{m.archiveActiveDuration}: {duration(detail.activeMs)}</p></div>
   {detail.coverage.map((c, i) => <p key={i} className="af-archive-coverage">{m.archiveCoverage(c)}</p>)}
   </details>
   {!detail.picks.length&&<p>{m.archiveNoSelections}</p>}
   <div className="af-archive-filters"><label>{m.archiveTeam}<select value={team} onChange={e => { setTeam(e.target.value); setPickPage(0); }}><option value="">{m.archiveAllTeams}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>{m.archivePlayer}<input value={player} onChange={e => { setPlayer(e.target.value); setPickPage(0); }}/></label></div>
   <p>{m.archiveAdpComparison} {help(m.archiveAdpDifference, m.archiveHelpAdpDifference)}</p>
   <h3>{m.archiveSelectionsAndOwnership} {help(m.archiveSelectionDetails, m.archiveHelpSelectionDetails)}</h3>
   <div className="af-archive-table" tabIndex={0} role="region" aria-label={m.archiveArchivedPicks}><table style={{ '--af-cols': heads.filter(([, shown]) => shown).length } as CSSProperties}><thead><tr>{heads.filter(([, shown]) => shown).map(([c]) => <th key={c}>{c}</th>)}</tr></thead><tbody>{picks.slice(pickPage * 25, pickPage * 25 + 25).map(p => <tr key={p.id}><td>#{p.overall} <small>{m.archiveRound} {p.round} · {m.archiveOverall} #{p.overall}</small></td><td>{p.playerName}<small>{p.position} · {p.club ?? '—'}</small><small>{p.keeper ? m.archiveKeeper : ''}</small><details><summary>{m.archiveIdentityAndOwnerTime}</summary><p>{p.playerId ?? '—'} · {p.identityBasis}</p><p>{m.archiveOtcStarted}: {time(p.onClockAt ?? null)}</p><p>{m.archivePausedOtc}: {duration(p.pausedMs ?? null)}</p>{p.ownerTime && Object.entries(p.ownerTime).map(([owner, ms]) => <p key={owner}>{owner}: {duration(ms)}</p>)}</details></td><td>{p.teamName ?? p.rosterId ?? '—'}</td>{has.owner ? <td>{p.slot ?? '—'} / {p.originalTeamName ?? p.originalRosterId ?? '—'}</td> : has.slot && <td>{p.slot ?? '—'}</td>}{has.actor && <td>{p.actorName ?? '—'}</td>}{has.at && <td>{time(p.selectedAt)}</td>}{has.otc && <td>{duration(p.elapsedMs ?? null)} / {duration(p.activeMs)} / {p.allowanceSeconds == null ? '—' : p.allowanceSeconds + 's'}</td>}{has.price && <td>{p.amount ?? '—'} / {p.source ?? '—'}</td>}{has.adp && <td>{p.adp == null ? '—' : p.adp.toFixed(1)} / {p.adpDifference == null ? '—' : (p.adpDifference > 0 ? '+' : '') + p.adpDifference.toFixed(1)}<small>{p.adpSample == null ? '' : m.archiveSample + ': ' + p.adpSample}</small><small>{p.adpObservedAt ? time(p.adpObservedAt) : ''}</small></td>}</tr>)}</tbody></table></div>{hidden && <p className="af-archive-cols-note">{m.archiveColumnsHidden}</p>}
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

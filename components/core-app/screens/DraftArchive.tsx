'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InfoTip } from '@/components/core-app/InfoTip';
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient';
import type { ArchiveChoice } from '@/lib/draft-archive/catalog';
import type { ArchiveDetail } from '@/lib/draft-archive/detail';
import '@/components/core-app/af-draft-archive.css';
type Choice = Omit<ArchiveChoice, 'createdAt' | 'total'>;
const coverageSpanish: Record<string, string> = {
    'Original draft-time settings were not archived for this older native draft.': 'Las reglas originales de este draft nativo antiguo no se archivaron.',
    'Draft-time settings and clock coverage will be captured when this draft starts.': 'Las reglas y el reloj se conservarán cuando este draft comience.',
    'Exact per-pick selection timestamps and active OTC were not supplied by this provider.': 'El proveedor no suministró horas exactas por selección ni OTC activo.',
    'Legacy records have no individual source draft ID. Separate drafts may remain unresolved until verified backfill.': 'Los registros antiguos no tienen ID individual de draft. Los drafts separados pueden seguir sin resolver hasta una verificación.',
    'Transaction packages are season-level records; exact linkage to this individual draft is not inferred.': 'Los intercambios son registros de temporada; no se supone una relación exacta con este draft.',
    'Commissioner correction details are restricted to commissioners.': 'Los detalles de correcciones están restringidos a los comisionados.',
    'Complete native clock-event coverage is unavailable for this draft.': 'No hay cobertura completa del reloj para este draft.',
    'Auction prices require a compatible observed bid-value benchmark; pick-order ADP is not used.': 'Los precios de subasta requieren una referencia compatible de pujas; no se usa ADP de selecciones.',
    'No verified compatible ADP observation from before this draft is available.': 'No hay una observación de ADP compatible y verificada anterior a este draft.',
};
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
    const es = useOptionalLanguage().language === 'es', router = useRouter();
    const t = (en: string, sp: string) => es ? sp : en;
    const [pickPage, setPickPage] = useState(0), [team, setTeam] = useState(''), [player, setPlayer] = useState('');
    useEffect(() => { setPickPage(0); setTeam(''); setPlayer(''); }, [detail?.choice.key]);
    const href = (key?: string, league = leagueId, nextPage = 1) => { const p = new URLSearchParams(); if (league)
        p.set('league', league); if (key)
        p.set('draft', key); if (nextPage > 1)
        p.set('archivePage', String(nextPage)); if (query)
        p.set('archiveQuery', query); if (season)
        p.set('archiveSeason', season); return '/core/draft-hq?' + p.toString(); };
    const help = (title: string, en: string, sp: string) => <InfoTip label={t('About ', 'Acerca de ') + title} title={title}><span className="af-info-para">{t(en, sp)}</span></InfoTip>;
    const picks = detail?.picks.filter(p => (!team || p.rosterId === team) && (!player || p.playerName.toLowerCase().includes(player.toLowerCase()))) ?? [];
    const teams = [...new Map((detail?.picks ?? []).filter(p => p.rosterId).map(p => [p.rosterId!, p.teamName ?? p.rosterId!])).entries()];
    const time = (v: string | null) => v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    const duration = (v: number | null) => v == null ? '—' : Math.floor(v / 3600000) + 'h ' + Math.floor(v % 3600000 / 60000) + 'm ' + Math.floor(v % 60000 / 1000) + 's';
    const timelineHref = (next: number) => href(detail?.choice.key, leagueId, page) + '&timelinePage=' + next;
    return <section className="af-frame af-archive" aria-label={t('Draft archive', 'Archivo de drafts')}>
  <header><h2>{t('Draft archive', 'Archivo de drafts')} {help(t('Draft identity', 'Identidad del draft'), 'Choose an individual draft. Startup, rookie and supplemental drafts remain separate, even in the same season. Legacy records without source IDs remain explicitly unresolved.', 'Elige un draft individual. Startup, rookie y suplementarios permanecen separados. Los registros antiguos sin ID siguen sin resolver.')}</h2><p>{total} {t('draft records', 'registros de draft')}</p></header>
  <details className="af-archive-search"><summary>{t("Search and filter drafts", "Buscar y filtrar drafts")}</summary><form action="/core/draft-hq" method="get"><input type="hidden" name="league" value={leagueId ?? ''}/><label>{t('Search league, sport or format', 'Buscar liga, deporte o formato')}<input name="archiveQuery" defaultValue={query} maxLength={120}/></label><label>{t('Season', 'Temporada')}<input name="archiveSeason" type="number" min={1900} max={2100} defaultValue={season}/></label><button>{t('Search', 'Buscar')}</button><Link href={leagueId ? '/core/draft-hq?league=' + encodeURIComponent(leagueId) : '/core/draft-hq'}>{t('Reset filters', 'Restablecer filtros')}</Link></form></details>
  {leagueId && <label>{t('Individual draft', 'Draft individual')}<select aria-label={t('Select draft', 'Elegir draft')} value={detail?.choice.key ?? ''} onChange={e => router.push(href(e.target.value))}><option value="">{t('Choose a draft', 'Elige un draft')}</option>{detail && !choices.some(c => c.key === detail.choice.key) && <option value={detail.choice.key}>{detail.choice.season ?? '?'} · {detail.choice.format} · {detail.choice.sourceId}</option>}{choices.map(c => <option key={c.key} value={c.key}>{c.season ?? '?'} · {c.format} · {c.status} · {c.sourceId}</option>)}</select></label>}
  {!leagueId && <ul>{choices.map(c => <li key={c.leagueId + ':' + c.key}><Link href={href(c.key, c.leagueId)}>{c.leagueName} · {c.season ?? '?'} · {c.sport} · {c.format} · {c.status}</Link></li>)}</ul>}
  <nav aria-label={t('Archive pages', 'Páginas del archivo')}>{page > 1 && <Link href={href(detail?.choice.key, leagueId, page - 1)}>{t('Previous', 'Anterior')}</Link>}<span>{t('Page', 'Página')} {page}</span>{more && <Link href={href(detail?.choice.key, leagueId, page + 1)}>{t('Next', 'Siguiente')}</Link>}</nav>
  {error && <p role="alert">{t(error, 'Este draft no está disponible en esta liga.')} <Link href={href()}>{t('Return to current draft', 'Volver al draft actual')}</Link></p>}
  {detail && <>
   <h3>{detail.choice.season ?? t('Unknown season', 'Temporada desconocida')} · {detail.choice.sport} · {detail.choice.format} · {detail.choice.status}</h3>
   <p>{t('Source draft', 'Draft de origen')}: {detail.choice.sourceId}</p>
   <div className="af-archive-summary"><p>{t('Started', 'Inicio')}: {time(detail.startedAt)}</p><p>{t(detail.endMeaning, detail.endMeaning === 'Completed at' ? 'Completado' : 'Última selección del proveedor')}: {time(detail.endedAt)}</p><p>{t('Elapsed duration', 'Duración total')}: {duration(detail.elapsedMs)} {help(t('Duration', 'Duración'), 'Elapsed time includes pauses. Active time counts recorded running-clock segments. Provider last-picked time is not a verified completion timestamp.', 'El tiempo total incluye pausas. El tiempo activo cuenta segmentos registrados del reloj. La última selección del proveedor no es una finalización verificada.')}</p><p>{t('Active duration', 'Duración activa')}: {duration(detail.activeMs)}</p></div>
   {detail.coverage.map((c, i) => <p key={i} className="af-archive-coverage">{t(c, coverageSpanish[c] ?? c)}</p>)}
   {!detail.picks.length&&<p>{t('No selections are recorded for this draft yet.','Aún no hay selecciones registradas para este draft.')}</p>}
   <div className="af-archive-filters"><label>{t('Team', 'Equipo')}<select value={team} onChange={e => { setTeam(e.target.value); setPickPage(0); }}><option value="">{t('All teams', 'Todos los equipos')}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>{t('Player', 'Jugador')}<input value={player} onChange={e => { setPlayer(e.target.value); setPickPage(0); }}/></label></div>
   <p>{t('ADP comparison', 'Comparación de ADP')} {help(t('ADP difference', 'Diferencia de ADP'), 'Overall pick minus compatible ADP recorded before draft start. Positive means selected later; negative means selected earlier. A market discount does not prove a better decision. Auctions require price benchmarks.', 'Selección global menos ADP compatible registrado antes del inicio. Positivo significa seleccionado después; negativo, antes. Un descuento de mercado no demuestra una mejor decisión. Las subastas requieren precios de referencia.')}</p>
   <h3>{t('Selections and ownership', 'Selecciones y propietarios')} {help(t('Selection details', 'Detalles de la selección'), 'Original slot, receiving team and selecting actor are separate facts. OTC is active time recorded for this pick, split by clock owner when ownership changes. Missing provider fields stay unavailable.', 'Puesto original, equipo receptor y actor son datos distintos. OTC es tiempo activo registrado, dividido por propietario cuando cambia. Los datos ausentes siguen no disponibles.')}</h3>
   <div className="af-archive-table" tabIndex={0} role="region" aria-label={t('Archived picks', 'Selecciones archivadas')}><table><thead><tr>{[t('Pick', 'Selección'), t('Player', 'Jugador'), t('Receiving team', 'Equipo receptor'), t('Original slot / owner', 'Puesto / dueño original'), t('Selected by', 'Seleccionado por'), t('Selected at', 'Hora'), t('Active OTC / allowance', 'OTC activo / límite'), t('Price / source', 'Precio / origen'), t('Draft-time ADP / difference', 'ADP del draft / diferencia')].map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{picks.slice(pickPage * 25, pickPage * 25 + 25).map(p => <tr key={p.id}><td>#{p.overall} <small>{t("Round", "Ronda")} {p.round} · {t('Overall', 'Global')} #{p.overall}</small></td><td>{p.playerName}<small>{p.position} · {p.club ?? '—'}</small><small>{p.keeper ? t('Keeper', 'Retenido') : ''}</small><details><summary>{t('Identity and owner time', 'Identidad y tiempo por dueño')}</summary><p>{p.playerId ?? '—'} · {p.identityBasis}</p>{p.ownerTime && Object.entries(p.ownerTime).map(([owner, ms]) => <p key={owner}>{owner}: {duration(ms)}</p>)}</details></td><td>{p.teamName ?? p.rosterId ?? '—'}</td><td>{p.slot ?? '—'} / {p.originalRosterId ?? '—'}</td><td>{p.actor ?? '—'}</td><td>{time(p.selectedAt)}</td><td>{duration(p.activeMs)} / {p.allowanceSeconds == null ? '—' : p.allowanceSeconds + 's'}</td><td>{p.amount ?? '—'} / {p.source ?? '—'}</td><td>{p.adp == null ? '—' : p.adp.toFixed(1)} / {p.adpDifference == null ? '—' : (p.adpDifference > 0 ? '+' : '') + p.adpDifference.toFixed(1)}<small>{p.adpSample == null ? '' : t('Sample', 'Muestra') + ': ' + p.adpSample}</small><small>{p.adpObservedAt ? time(p.adpObservedAt) : ''}</small></td></tr>)}</tbody></table></div>
   <nav><button disabled={pickPage === 0} onClick={() => setPickPage(v => v - 1)}>{t('Previous picks', 'Selecciones anteriores')}</button><span>{picks.length} {t('picks', 'selecciones')}</span><button disabled={(pickPage + 1) * 25 >= picks.length} onClick={() => setPickPage(v => v + 1)}>{t('Next picks', 'Siguientes selecciones')}</button></nav>
   {detail.analysis && <section aria-label={t('Draft analysis coverage', 'Cobertura del análisis')}>
    <h3>{t('Draft analysis', 'Análisis del draft')} {help(t('Analysis basis', 'Base del análisis'), 'Draft-day analysis requires projections preserved before the draft, matching scoring, verified player identities and replacement levels. Results analysis requires separate weekly production and contribution data. Missing inputs do not receive an average letter grade.', 'El análisis del día del draft requiere proyecciones previas, puntuación compatible, identidades verificadas y niveles de reemplazo. Los resultados requieren datos semanales de producción y contribución. La falta de datos no recibe una calificación promedio.')}</h3>
    <div className="af-archive-summary">
     <p>{t('Draft-day grade: Insufficient data', 'Calificación del draft: Datos insuficientes')}<small>{detail.analysis.draftDay.capturedBaselines} {t('preserved generic PPR baselines', 'proyecciones PPR genéricas conservadas')}</small></p>
     <p>{t('Results-to-date grade: Insufficient data', 'Calificación de resultados: Datos insuficientes')}<small>{detail.analysis.resultsToDate.coveredPicks}/{detail.analysis.totalPicks} {t('selections with verified contribution coverage', 'selecciones con contribución verificada')}</small></p>
    </div>
   </section>}
   {[[t('Draft-time snapshot', 'Instantánea del draft'), detail.snapshot], [t('Clock timeline', 'Cronología del reloj'), detail.events], [t('Commissioner corrections', 'Correcciones del comisionado'), detail.corrections], [t('Trade packages', 'Paquetes de intercambios'), detail.trades]].map(([title, data]) => <details key={String(title)}><summary>{String(title)}</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>)}
   <nav aria-label={t('Timeline pages', 'Páginas de cronología')}>
    {timelinePage > 1 && <Link href={timelineHref(timelinePage - 1)}>{t('Newer records', 'Registros más recientes')}</Link>}
    <span>{t('Timeline page', 'Página de cronología')} {timelinePage}</span>
    {(detail.eventsMore || detail.correctionsMore || detail.tradesMore) && <Link href={timelineHref(timelinePage + 1)}>{t('Older records', 'Registros anteriores')}</Link>}
   </nav>
   <p>{t('Each timeline page shows up to 100 records per section. Pick filters cover every archived selection.', 'Cada página muestra hasta 100 registros por sección. Los filtros cubren todas las selecciones archivadas.')}</p>
  </>}
 </section>;
}

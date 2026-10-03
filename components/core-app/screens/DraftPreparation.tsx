"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { InfoTip } from "../InfoTip";
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient";
import type { DraftPreparationData } from "@/lib/core-app/draftPreparation";
import "@/components/core-app/af-draft-preparation.css";

const spanish: Record<string, string> = {
  "Draft preparation": "Preparación del draft",
  "Draft-time ADP": "ADP al inicio del draft",
  "Observed ADP rankings": "Clasificación por ADP observado",
  "Pre-draft outlook": "Perspectiva previa al draft",
  "Preparation checklist": "Lista de preparación",
  "Search players": "Buscar jugadores",
  "All positions": "Todas las posiciones",
  Player: "Jugador",
  Rank: "Puesto",
  ADP: "ADP",
  Sample: "Muestra",
  Range: "Rango",
  Tier: "Nivel",
  "Roster fit": "Encaje en plantilla",
  Position: "Posición",
  "Next round": "Próxima ronda",
  "Market spread": "Dispersión del mercado",
  "ADP order": "Orden por ADP",
  "Prefer tighter range": "Preferir menor dispersión",
  "Prefer broader range": "Preferir mayor dispersión",
  "Personal order": "Orden personal",
  "Reset planning preferences": "Restablecer preferencias",
  "Move up": "Subir",
  "Move down": "Bajar",
  Previous: "Anterior",
  Next: "Siguiente",
  Unavailable: "No disponible",
  Team: "Equipo",
  Score: "Puntuación",
  "Roster / keepers": "Plantilla / conservados",
  "Draft capital": "Capital del draft",
  Flexibility: "Flexibilidad",
  "Keeper costs": "Costes de conservados",
  Round: "Ronda",
  Pick: "Selección",
  Difference: "Diferencia",
  "Matching rules recorded": "Reglas compatibles registradas",
  "Remaining queue targets": "Objetivos restantes en cola",
  "Open a what-if mock": "Abrir simulación hipotética",
  "Direct slot open": "Puesto directo vacante",
  "Covered / flexible": "Cubierto / flexible",
  "No players match these filters.":
    "Ningún jugador coincide con estos filtros.",
  "Platform ADP: unavailable": "ADP de plataforma: no disponible",
  "Consensus ADP: unavailable": "ADP de consenso: no disponible",
  "No grade is assigned when ADP is missing.":
    "Sin ADP, no se asigna calificación.",
  "Planning preferences are saved in this browser for this draft. They do not change your live queue or autopick.":
    "Las preferencias se guardan en este navegador para este draft. No cambian tu cola ni la selección automática.",
  "Observed market order, not a projected-points ranking.":
    "Orden del mercado observado; no es una clasificación de puntos proyectados.",
  "Relative planning heuristic v1; not a win forecast. Equivalent fresh redraft teams tie.":
    "Heurística relativa de planificación v1; no predice victorias. Los equipos equivalentes en redraft empatan.",
  "Provider coverage must include matching season, rules, team count and player pool before comparison.":
    "La cobertura debe incluir temporada, reglas, número de equipos y grupo de jugadores compatibles.",
  "Market spread describes draft-position variability, not player performance risk.":
    "La dispersión describe variación en la posición del draft, no el riesgo de rendimiento.",
  "New snapshots build coverage going forward; earlier draft-day benchmarks cannot be reconstructed from current ADP.":
    "Las nuevas instantáneas crean cobertura futura; el ADP actual no permite reconstruir referencias anteriores.",
  "AllFantasy native observed drafts": "Drafts observados en AllFantasy",
  Yes: "Sí",
  No: "No",
};
function signed(v: number | null) {
  return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1);
}
function numeric(v: number | null) {
  return v == null ? "—" : v.toFixed(1);
}
export function DraftPreparation({
  data,
  leagueId,
}: {
  data: DraftPreparationData;
  leagueId: string;
}) {
  const language = useOptionalLanguage().language,
    es = language === "es",
    t = (s: string) => (es ? (spanish[s] ?? s) : s);
  const [search, setSearch] = useState(""),
    [position, setPosition] = useState(""),
    [spread, setSpread] = useState("adp"),
    [personal, setPersonal] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [comparisonPage, setComparisonPage] = useState(0);
  const storageKey =
    "af-draft-preparation-v1:" + (data.preferenceScope ?? "unavailable");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      setPersonal(
        Array.isArray(saved.order)
          ? saved.order
              .filter((x: unknown) => typeof x === "string")
              .slice(0, 3000)
          : [],
      );
      setSpread(
        ["adp", "tight", "broad"].includes(saved.spread) ? saved.spread : "adp",
      );
    } catch {
      setPersonal([]);
      setSpread("adp");
    }
  }, [storageKey]);
  const save = (order: string[], mode: string) => {
    setPersonal(order);
    setSpread(mode);
    try {
      if (data.preferenceScope)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ order, spread: mode }),
        );
    } catch {
      /* Browser storage may be disabled; planning still works for this view. */
    }
  };
  const ordered = useMemo(() => {
    const ranks = new Map(personal.map((key, i) => [key, i]));
    return [...data.players].sort((a, b) => {
      if (data.customRankingsEnabled && personal.length)
        return (
          (ranks.get(a.playerKey) ?? 10000 + a.rank) -
          (ranks.get(b.playerKey) ?? 10000 + b.rank)
        );
      if (spread !== "adp") {
        if (a.standardDeviation == null || b.standardDeviation == null)
          return a.standardDeviation == null
            ? b.standardDeviation == null
              ? a.adp - b.adp
              : 1
            : -1;
        const diff = a.standardDeviation - b.standardDeviation;
        if (diff) return spread === "tight" ? diff : -diff;
      }
      return a.adp - b.adp;
    });
  }, [data.players, data.customRankingsEnabled, personal, spread]);
  const filtered = ordered.filter(
    (p) =>
      (!position || p.position === position) &&
      p.playerName.toLowerCase().includes(search.toLowerCase()),
  );
  const visible = filtered.slice(page * 25, page * 25 + 25);
  const move = (key: string, direction: number) => {
    const keys = ordered.map((p) => p.playerKey),
      i = keys.indexOf(key),
      j = i + direction;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    save(keys, spread);
  };
  const help = (title: string, en: string, sp: string) => (
    <InfoTip label={`${es ? "Acerca de" : "About"} ${t(title)}`} title={t(title)}>
      <span className="af-info-para">{es ? sp : en}</span>
    </InfoTip>
  );
  const reasonTranslations: Record<string, string> = {
    "No compatible observed ADP snapshot is available.":
      "No hay una instantánea de ADP observado compatible.",
    "Draft preparation could not be loaded. Retry this page.":
      "No se pudo cargar la preparación. Vuelve a intentar.",
    "Auction preparation needs observed bid prices and budgets. Pick-order ADP is not a price benchmark.":
      "La preparación de subastas necesita precios y presupuestos observados. El ADP por selección no sirve como referencia de precio.",
    "Scoring and roster slots must be recorded before this draft can use a matching ADP board.":
      "Se deben registrar reglas y puestos antes de usar un ADP compatible.",
    "This draft has no verified start time, so a draft-time ADP comparison cannot be made.":
      "No hay hora de inicio verificada para comparar el ADP de este draft.",
    "Historical imported ADP needs a preserved draft-time context. No upcoming draft is scheduled here.":
      "El ADP histórico importado necesita contexto conservado. No hay un draft próximo programado aquí.",
  };
  const reason = data.reason
    ? es
      ? (reasonTranslations[data.reason] ??
        "Esta función necesita datos compatibles adicionales.")
      : data.reason
    : null;
  return (
    <section
      className="af-frame af-dh-section af-prep"
      id="preparation"
      data-testid="draft-preparation"
      aria-label={t("Draft preparation")}
    >
      <header className="af-dh-section-head">
        <h2 className="af-label">
          {t("Draft preparation")}{" "}
          {help(
            "Draft preparation",
            "Preparation uses this native draft only. Imported historical sections below may describe another draft. Missing or incompatible benchmarks stay unavailable.",
            "La preparación usa solo este draft nativo. Las secciones históricas importadas pueden corresponder a otro draft. Las referencias ausentes o incompatibles permanecen no disponibles.",
          )}
        </h2>
        <Link
          href={
            "/mock-draft?leagueId=" +
            encodeURIComponent(leagueId) +
            "&sport=" +
            encodeURIComponent(data.context?.sport ?? "")
          }
        >
          {t("Open a what-if mock")} →
        </Link>
      </header>
      {data.context && (
        <p className="af-prep-context">
          {data.context.sport} · {data.context.season} ·{" "}
          {data.context.leagueType} · {data.context.purpose} ·{" "}
          {data.context.playerPool} · {data.context.scoring} ·{" "}
          {data.context.teamCount} {es ? "equipos" : "teams"} ·{" "}
          {data.context.draftType}
        </p>
      )}
      {data.context && (
        <details className="af-prep-rules">
          <summary>
            {t("Benchmark settings")}{" "}
            {help(
              "Benchmark settings",
              "ADP is matched to these recorded scoring rules and roster slots. A benchmark for another context is never substituted.",
              "El ADP coincide con estas reglas y puestos registrados. Nunca se sustituye con otra configuración.",
            )}
          </summary>
          <p>
            {t("Roster slots")}:{" "}
            {Object.entries(
              data.context.rosterSlots.reduce<Record<string, number>>(
                (counts, slot) => ({
                  ...counts,
                  [slot]: (counts[slot] ?? 0) + 1,
                }),
                {},
              ),
            )
              .map(([slot, count]) => slot + " × " + count)
              .join(" · ")}
          </p>
          <p>{t("Scoring rules")}</p>
          <pre>{JSON.stringify(data.context.scoringRules, null, 2)}</pre>
        </details>
      )}
      <div className="af-prep-summary">
        <div>
          <h3>
            {t("Preparation checklist")}{" "}
            {help(
              "Preparation checklist",
              "Checklist progress measures preparation activity, not roster strength. Queues are read without changing draft state.",
              "La lista mide actividad de preparación, no fuerza de plantilla. Las colas se leen sin cambiar el estado del draft.",
            )}
          </h3>
          <p>
            {t("Matching rules recorded")}: {t(data.context ? "Yes" : "No")}
          </p>
          <p>
            {t("Remaining queue targets")}:{" "}
            {data.queue.count ?? t("Unavailable")}
          </p>
          <p>
            {es
              ? ((
                  {
                    "The provider controls its own queue and autopick.":
                      "El proveedor controla su propia cola y selección automática.",
                    "Queue settings are unavailable.":
                      "Las preferencias de cola no están disponibles.",
                    "Queue or autopick settings could not be loaded. Retry this page.":
                      "No se pudieron cargar la cola o las preferencias. Vuelve a intentar.",
                    "Your personal autopick is disabled.":
                      "Tu selección automática personal está desactivada.",
                    "Chimmy queue autopick is enabled.":
                      "La selección automática de la cola con Chimmy está activada.",
                    "Standard autopick is enabled; it tries your live queue before fallback rules.":
                      "La selección automática estándar está activada; usa tu cola antes de las reglas alternativas.",
                  } as Record<string, string>
                )[data.queue.autopick] ??
                "Las preferencias de cola no están disponibles.")
              : data.queue.autopick}
          </p>
        </div>
        <div>
          <h3>
            {t(data.historical ? "Draft-time ADP" : "Observed ADP rankings")}{" "}
            {help(
              "ADP",
              "Average draft position in matching observed drafts. Historical comparisons use the newest preserved snapshot at or before draft start. No current-ADP fallback.",
              "Posición media en drafts observados compatibles. Las comparaciones históricas usan la última instantánea anterior al inicio. No se sustituye con ADP actual.",
            )}
          </h3>
          <p>
            {t("AllFantasy native observed drafts")}
            {data.observedAt
              ? " · " +
                new Date(data.observedAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 16) +
                " UTC"
              : ""}
          </p>
          <p>
            {t("Platform ADP: unavailable")} · {t("Consensus ADP: unavailable")}
          </p>
          <p>
            {t(
              "Provider coverage must include matching season, rules, team count and player pool before comparison.",
            )}
          </p>
        </div>
      </div>
      {reason && (
        <p
          className="af-dh-unavailable"
          role={data.state === "error" ? "alert" : undefined}
        >
          {reason}
        </p>
      )}
      {!data.observedAt && (
        <p>
          {t(
            "New snapshots build coverage going forward; earlier draft-day benchmarks cannot be reconstructed from current ADP.",
          )}
        </p>
      )}
      {!!data.players.length && (
        <>
          <p>{t("Observed market order, not a projected-points ranking.")}</p>
          <div className="af-prep-controls">
            <label>
              {t("Search players")}
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              {t("Position")}
              <select
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">{t("All positions")}</option>
                {[...new Set(data.players.map((p) => p.position))]
                  .sort()
                  .map((p) => (
                    <option key={p}>{p}</option>
                  ))}
              </select>
            </label>
            <label>
              {t("Market spread")}
              <select
                value={spread}
                onChange={(e) => {
                  save([], e.target.value);
                  setPage(0);
                }}
              >
                <option value="adp">{t("ADP order")}</option>
                <option value="tight">{t("Prefer tighter range")}</option>
                <option value="broad">{t("Prefer broader range")}</option>
              </select>
            </label>
            <button
              onClick={() => {
                save([], "adp");
                setPage(0);
              }}
            >
              {t("Reset planning preferences")}
            </button>
          </div>
          <p>
            {t(
              "Market spread describes draft-position variability, not player performance risk.",
            )}{" "}
            {help(
              "Market spread",
              "Standard deviation measures variation in observed pick position. Low samples (fewer than 10 observations) are labeled; one observation has no measured spread.",
              "La desviación estándar mide variación en posición. Se indican muestras menores de 10; una observación no permite medir dispersión.",
            )}
          </p>
          <p>
            {t(
              "Planning preferences are saved in this browser for this draft. They do not change your live queue or autopick.",
            )}
          </p>
          <div
            className="af-prep-table"
            tabIndex={0}
            role="region"
            aria-label={t("Observed ADP rankings")}
          >
            <table>
              <thead>
                <tr>
                  <th>{t("Rank")}</th>
                  <th>{t("Player")}</th>
                  <th>{t("ADP")}</th>
                  <th>{t("Sample")}</th>
                  <th>{t("Range")}</th>
                  <th>
                    {t("Tier")}{" "}
                    {help(
                      "Tier",
                      "Market bands group each team-count block of ADP. They are not projection tiers.",
                      "Las bandas agrupan bloques de ADP según número de equipos. No son niveles de proyecciones.",
                    )}
                  </th>
                  <th>
                    {t("Roster fit")}{" "}
                    {help(
                      "Roster fit",
                      "An uncovered exact starting-position slot. Flexible eligibility and lineup optimization are not inferred.",
                      "Puesto titular directo sin cubrir. No se infieren elegibilidad flexible ni optimización.",
                    )}
                  </th>
                  <th>
                    {t("Next round")}{" "}
                    {help(
                      "Next round",
                      "Remaining same-position players within one team-count span after this player’s ADP. A market-density hint, not an availability probability.",
                      "Jugadores restantes del mismo puesto dentro de un bloque de ADP. Indica densidad, no probabilidad de disponibilidad.",
                    )}
                  </th>
                  {data.customRankingsEnabled && <th>{t("Personal order")}</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <tr key={p.playerKey}>
                    <td>{page * 25 + i + 1}</td>
                    <td>
                      {p.playerName}
                      <small>
                        {p.position}
                        {p.observedTeams?.length
                          ? " · " + p.observedTeams.join(" / ")
                          : ""}
                      </small>
                    </td>
                    <td>{p.adp.toFixed(1)}</td>
                    <td>
                      {p.sampleSize}
                      {p.sampleSize < 10 && (
                        <small>{es ? "Muestra pequeña" : "Low sample"}</small>
                      )}
                    </td>
                    <td>
                      {p.minPick}–{p.maxPick}
                      <small>σ {numeric(p.standardDeviation)}</small>
                    </td>
                    <td>{p.tier}</td>
                    <td>
                      {t(
                        p.rosterFit ? "Direct slot open" : "Covered / flexible",
                      )}
                    </td>
                    <td>{p.withinNextRound}</td>
                    {data.customRankingsEnabled && (
                      <td>
                        <button
                          aria-label={t("Move up") + " " + p.playerName}
                          disabled={ordered[0]?.playerKey === p.playerKey}
                          onClick={() => move(p.playerKey, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={t("Move down") + " " + p.playerName}
                          disabled={
                            ordered[ordered.length - 1]?.playerKey ===
                            p.playerKey
                          }
                          onClick={() => move(p.playerKey, 1)}
                        >
                          ↓
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <p>{t("No players match these filters.")}</p>}
          <div className="af-prep-pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t("Previous")}
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              disabled={(page + 1) * 25 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              {t("Next")}
            </button>
          </div>
        </>
      )}
      <h3>
        {t("Pre-draft outlook")}{" "}
        {help(
          "Pre-draft outlook",
          "Relative heuristic: keeper market strength 45%, unspent draft capital 35%, remaining-pick flexibility 20%. Components are min-max scaled 0–100 within this league; equal components are 50. Capital sums 1/sqrt(overall pick). No standings prediction. Dynasty needs existing-roster snapshots before ranking.",
          "Heurística relativa: fuerza de conservados 45%, capital disponible 35%, flexibilidad 20%. Componentes escalados 0–100 en la liga; valores iguales son 50. Capital suma 1/raíz de selección. No predice resultados; dynasty necesita instantáneas de plantilla.",
        )}
      </h3>
      <p>
        {t(
          "Relative planning heuristic v1; not a win forecast. Equivalent fresh redraft teams tie.",
        )}
      </p>
      {data.outlook.length ? (
        <div
          className="af-prep-table"
          tabIndex={0}
          role="region"
          aria-label={t("Pre-draft outlook")}
        >
          <table>
            <thead>
              <tr>
                {[
                  "Rank",
                  "Team",
                  "Score",
                  "Roster / keepers",
                  "Draft capital",
                  "Flexibility",
                ].map((k) => (
                  <th key={k}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.outlook.map((r) => (
                <tr key={r.id}>
                  <td>{r.rank}</td>
                  <td>{r.name}</td>
                  <td>{numeric(r.score)}</td>
                  <td>{numeric(r.roster)}</td>
                  <td>{numeric(r.capital)}</td>
                  <td>{numeric(r.flexibility)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          {es
            ? "Datos insuficientes para comparar equipos."
            : (data.outlookReason ?? "Insufficient data to compare teams.")}
        </p>
      )}
      {!!data.keeperCosts.length && (
        <>
          <h3>
            {t("Keeper costs")}{" "}
            {help(
              "Keeper costs",
              "Round costs consume picks. Positive cost-minus-ADP means a later pick is spent. This is a market comparison, not a keeper recommendation.",
              "El coste por ronda consume selecciones. Diferencia positiva indica gasto de una selección posterior al ADP. No es recomendación de conservar.",
            )}
          </h3>
          <div
            className="af-prep-table"
            tabIndex={0}
            role="region"
            aria-label={t("Keeper costs")}
          >
            <table>
              <thead>
                <tr>
                  {["Player", "Team", "Round", "Pick", "ADP", "Difference"].map(
                    (k) => (
                      <th key={k}>{t(k)}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.keeperCosts.map((k, i) => (
                  <tr key={i}>
                    <td>{k.playerName}</td>
                    <td>{k.teamName}</td>
                    <td>{k.round}</td>
                    <td>{k.costOverall ?? "—"}</td>
                    <td>{numeric(k.adp)}</td>
                    <td>{signed(k.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!!data.comparisons.length && (
        <>
          <h3>
            {t("Draft-time ADP")}{" "}
            {help(
              "Difference",
              "Overall pick minus draft-time ADP: positive = later, negative = earlier. Market discount does not prove pick quality. Missing ADP never receives a grade.",
              "Selección global menos ADP al inicio: positivo = posterior, negativo = anterior. El descuento no demuestra calidad. Sin ADP no se asigna calificación.",
            )}
          </h3>
          <p>{t("No grade is assigned when ADP is missing.")}</p>
          <div
            className="af-prep-table"
            tabIndex={0}
            role="region"
            aria-label={t("Draft-time ADP")}
          >
            <table>
              <thead>
                <tr>
                  {[
                    "Pick",
                    "Player",
                    "Team",
                    "ADP",
                    "Difference",
                    "Sample",
                  ].map((k) => (
                    <th key={k}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.comparisons
                  .slice(comparisonPage * 50, comparisonPage * 50 + 50)
                  .map((p) => (
                    <tr key={p.overall}>
                      <td>{p.overall}</td>
                      <td>{p.playerName}</td>
                      <td>{p.teamName ?? "—"}</td>
                      <td>{numeric(p.adp)}</td>
                      <td>{signed(p.difference)}</td>
                      <td>{p.sampleSize ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="af-prep-pagination">
            <button
              disabled={!comparisonPage}
              onClick={() => setComparisonPage(comparisonPage - 1)}
            >
              {t("Previous")}
            </button>
            <span>{comparisonPage + 1}</span>
            <button
              disabled={(comparisonPage + 1) * 50 >= data.comparisons.length}
              onClick={() => setComparisonPage(comparisonPage + 1)}
            >
              {t("Next")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

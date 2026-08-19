import 'server-only'
import type { ExecImportRun, ExecLeagueRow, ExecManagerRow, ExecSnapshot, ExecSnapshotResult } from './types'

/**
 * Fantasy OS Phase 4 — read-only, env-gated data-access boundary for the executive workspace.
 *
 * Reads the certified NON-PRODUCTION `fos_phase4` portfolio (schema-isolated in the verify project).
 * Hard rules enforced here:
 *   - Enabled ONLY when both FANTASY_OS_EXEC_ENABLED === 'true' AND FANTASY_OS_EXEC_DATABASE_URL is set.
 *   - Fails CLOSED: when disabled or on any error it returns `{ available: false }` — it NEVER falls back
 *     to the application/production database and NEVER fabricates rows to populate the UI.
 *   - Connection is forced read-only at the session level + a statement timeout is applied.
 *   - `server-only` prevents this module (and the connection string) from ever reaching the client bundle.
 */

const QUERY_TIMEOUT_MS = 8000

type PgPool = {
  query: (text: string) => Promise<{ rows: Record<string, unknown>[] }>
}

let poolPromise: Promise<PgPool | null> | null = null

function isEnabled(): { ok: true; url: string } | { ok: false; detail: string } {
  if (process.env.FANTASY_OS_EXEC_ENABLED !== 'true') {
    return { ok: false, detail: 'FANTASY_OS_EXEC_ENABLED is not "true"' }
  }
  const url = process.env.FANTASY_OS_EXEC_DATABASE_URL
  if (!url || url.trim().length === 0) {
    return { ok: false, detail: 'FANTASY_OS_EXEC_DATABASE_URL is not set' }
  }
  return { ok: true, url }
}

async function getPool(url: string): Promise<PgPool | null> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const mod = (await import('pg')) as unknown as { default?: { Pool: new (cfg: unknown) => PgPool }; Pool?: new (cfg: unknown) => PgPool }
      const Pool = mod.Pool ?? mod.default?.Pool
      if (!Pool) return null
      // Session forced read-only + bounded statement timeout. Never a write path.
      return new Pool({
        connectionString: url,
        max: 3,
        idleTimeoutMillis: 10_000,
        statement_timeout: QUERY_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
        options: '-c default_transaction_read_only=on -c statement_timeout=8000',
      })
    })().catch(() => null)
  }
  return poolPromise
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function str(v: unknown): string | null {
  return v == null ? null : String(v)
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  return []
}

function mapLeague(r: Record<string, unknown>): ExecLeagueRow {
  const fmt = str(r.format_type)
  return {
    leagueId: String(r.league_id),
    season: String(r.season),
    name: str(r.name),
    status: str(r.status),
    totalRosters: r.total_rosters == null ? null : num(r.total_rosters),
    previousLeagueId: str(r.previous_league_id),
    isMembership: r.is_membership === true,
    formatType: fmt === 'dynasty' || fmt === 'keeper' || fmt === 'redraft' ? fmt : 'unknown',
    seedRole: r.seed_role === 'commissioner' || r.seed_role === 'ancestor' ? r.seed_role : 'member',
    scoringKeys: num(r.scoring_keys),
    rosterPositions: arr(r.roster_positions),
    users: num(r.users),
    rosters: num(r.rosters),
    commissioners: num(r.commissioners),
    drafts: num(r.drafts),
    draftPicks: num(r.draft_picks),
    tradedFuturePicks: num(r.traded_future_picks),
    matchupRecords: num(r.matchup_records),
    weeksWithMatchups: num(r.weeks_with_matchups),
    transactions: num(r.transactions),
    trades: num(r.trades),
    waivers: num(r.waivers),
    freeAgents: num(r.free_agents),
    faab: num(r.faab),
    hasWinnersBracket: r.has_winners_bracket === true,
    hasLosersBracket: r.has_losers_bracket === true,
  }
}

function mapManager(r: Record<string, unknown>): ExecManagerRow {
  return {
    userId: String(r.user_id),
    displayName: str(r.display_name),
    isCommissioner: r.is_commissioner === true,
    leagueCount: num(r.league_count),
    seasonCount: num(r.season_count),
    teamNames: arr(r.team_names),
  }
}

/**
 * Fetch the full neutral portfolio snapshot (read-only). Returns a fail-closed unavailable result when
 * the data source is disabled or errors — the caller must render an explicit unavailable state, never fake data.
 */
export async function fetchExecSnapshot(): Promise<ExecSnapshotResult> {
  const gate = isEnabled()
  if (!gate.ok) return { available: false, reason: 'disabled', detail: gate.detail }

  try {
    const pool = await getPool(gate.url)
    if (!pool) return { available: false, reason: 'unavailable', detail: 'data source pool unavailable' }

    const [runRes, leagueRes, managerRes, chainRes] = await Promise.all([
      pool.query(
        `SELECT run_id, manifest_hash, seed_user_id, seed_username, generated_at, schema_version, calc_version, imported_at, config, totals, api, warnings
         FROM fos_phase4.import_run ORDER BY imported_at DESC LIMIT 1`,
      ),
      pool.query(`SELECT * FROM fos_phase4.league ORDER BY season DESC, league_id ASC`),
      pool.query(`SELECT * FROM fos_phase4.manager ORDER BY league_count DESC, user_id ASC`),
      pool.query(`SELECT count(*)::int AS n FROM fos_phase4.continuity_chain`),
    ])

    const runRow = runRes.rows[0]
    if (!runRow) return { available: false, reason: 'unavailable', detail: 'no import_run present' }

    const totals = (runRow.totals ?? {}) as Record<string, number | string | string[]>
    const config = (runRow.config ?? {}) as { seasons?: string[] }
    const uniqueSeasons = (totals.uniqueSeasons as string[] | undefined) ?? config.seasons ?? []

    const run: ExecImportRun = {
      runId: String(runRow.run_id),
      manifestHash: String(runRow.manifest_hash),
      seedUserId: String(runRow.seed_user_id),
      seedUsername: str(runRow.seed_username),
      generatedAt: String(runRow.generated_at),
      schemaVersion: String(runRow.schema_version),
      calcVersion: String(runRow.calc_version),
      importedAt: String(runRow.imported_at),
      seasons: uniqueSeasons,
      totals,
      api: (runRow.api ?? {}) as Record<string, number>,
      warnings: (runRow.warnings as string[] | undefined) ?? [],
    }

    const snapshot: ExecSnapshot = {
      run,
      leagues: leagueRes.rows.map(mapLeague),
      managers: managerRes.rows.map(mapManager),
      continuityChainCount: num(chainRes.rows[0]?.n),
    }
    return { available: true, snapshot }
  } catch (err) {
    return {
      available: false,
      reason: 'unavailable',
      detail: err instanceof Error ? err.message : 'unknown data-source error',
    }
  }
}

/** Read-only: the finished_at of the most recent COMPLETED sync run for a run key (for the scheduler due-check). */
export async function fetchLastCompletedSyncAt(runKey: string): Promise<{ available: boolean; finishedAt: string | null; detail?: string }> {
  const gate = isEnabled()
  if (!gate.ok) return { available: false, finishedAt: null, detail: gate.detail }
  try {
    const pool = await getPool(gate.url)
    if (!pool) return { available: false, finishedAt: null, detail: 'pool unavailable' }
    const res = await pool.query(
      `SELECT finished_at FROM fos_phase4.sync_run WHERE run_key = ${quoteLiteral(runKey)} AND status = 'completed' ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    )
    const row = res.rows[0]
    return { available: true, finishedAt: row?.finished_at ? String(row.finished_at) : null }
  } catch (err) {
    return { available: false, finishedAt: null, detail: err instanceof Error ? err.message : 'error' }
  }
}

/** Minimal single-quote escaping for the read-only run-key lookup (values are internal, not user input). */
function quoteLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

export type { ExecImportRun, ExecLeagueRow, ExecManagerRow, ExecSnapshot, ExecSnapshotResult }

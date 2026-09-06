/**
 * "How old is the newest row in this table" — computed by Postgres, never by the client clock.
 *
 * ⚠ THE BUG THIS EXISTS TO MAKE UNREPEATABLE
 * Most freshness columns in this database are `timestamp without time zone` holding UTC. `pg`
 * hands those back as JS `Date`s interpreted in the CLIENT's timezone, so:
 *
 *     Date.now() - row.newest.getTime()
 *
 * is exactly right on a UTC runner and wrong by the local offset everywhere else. On a UTC-4
 * machine a row written 2 minutes ago reads as 238 minutes in the FUTURE.
 *
 * It is not a cosmetic error. A negative age makes data look NEWER than it is, so a probe with a
 * 20-minute allowance reports healthy no matter how long its job has been dead — a false negative
 * in tooling whose entire purpose is catching false negatives.
 *
 * AND CI CANNOT CATCH IT: GitHub runners are UTC, where the broken arithmetic gives the right
 * answer every single time. It only ever shows up on someone's laptop.
 *
 * WHY A SHARED MODULE RATHER THAN A COMMENT. This was fixed once in
 * `scripts/cron-freshness-check.mjs`, and then reintroduced the same day in a throwaway
 * verification script that printed `-239m` for heartbeats the monitor correctly showed as `1m`.
 * A rule that lives in one file's comments does not survive the next script. This makes the
 * correct path the easy one and gives the wrong one nowhere to hide.
 *
 * USAGE
 *     const client = new pg.Client({ connectionString })
 *     await client.connect()
 *     await pinSessionToUtc(client)
 *     const { ageMs, newest, rowCount, timestampCount } = await maxAge(client, {
 *       table: 'SportsInjury', column: 'fetchedAt',
 *     })
 */

/**
 * Pin the session to UTC.
 *
 * Postgres coerces a naive `timestamp` to `timestamptz` using the SESSION zone, so pinning it to
 * the zone the data is actually stored in makes the naive-vs-timestamptz distinction stop
 * mattering — `now() - max(col)` is then correct for either column type.
 *
 * Call once per connection, before any freshness query.
 */
export async function pinSessionToUtc(client) {
  await client.query("SET TIME ZONE 'UTC'")
}

/**
 * Newest value of `column` on `table`, with its age measured against the DATABASE's clock.
 *
 * `count(*)` and `count(column)` are both returned deliberately: a bare `max()` reports "no rows"
 * and "rows whose column is entirely NULL" identically as `null`, and those need opposite
 * responses. `player_game_stats` is the real case — 252,768 rows with `fetched_at` NULL on every
 * one, which means the COLUMN is wrong, not that the job is dead.
 *
 * @param {{query: Function}} client any pg-shaped client — a real one, or a fake in tests
 * @param {{table: string, column: string, where?: string|null, params?: unknown[]}} opts
 *   `table` and `column` are interpolated as quoted identifiers and must come from trusted,
 *   literal configuration — they cannot be parameterised. `where` is likewise trusted text; put
 *   user-supplied values in `params` and reference them positionally.
 * @returns {Promise<{newest: Date|null, newestIso: string|null, ageMs: number|null, rowCount: number, timestampCount: number}>}
 */
export async function maxAge(client, { table, column, where = null, params = [] }) {
  const sql =
    `SELECT max("${column}") AS newest,\n` +
    `       count(*)::bigint AS n,\n` +
    `       count("${column}")::bigint AS n_ts,\n` +
    // 🛑 THE TIMESTAMP IS RENDERED BY POSTGRES TOO, FOR THE SAME REASON THE AGE IS.
    //
    // `max(col)` came back through node-postgres as a Date, and node-postgres parses
    // `timestamp without time zone` (oid 1114) in the CLIENT's local zone. On this machine that is
    // EDT, so a row written at 13:07Z was handed to the checker as 17:07Z and published in --json
    // as `newest: "...T17:07:02.777Z"` — four hours in the future, while `ageMs` beside it read a
    // correct 13 minutes.
    //
    // ⚠ MEASURED 2026-09-06, AND IT COST A DISAGREEMENT BEFORE IT COST A BUG: two sessions read
    // the SAME sync_job_runs row and reported timestamps four hours apart, each from its own tool,
    // each correct by its own lights. The verdicts were never wrong — staleness is judged on
    // `age_seconds` below — but "when did this last run" is the field a human reads while
    // debugging, and it was the one that lied.
    //
    // `to_char` is safe for either column type because pinSessionToUtc has already pinned the
    // session: a naive timestamp renders its own digits, and a timestamptz renders in UTC.
    `       to_char(max("${column}"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS newest_iso,\n` +
    // 🛑 AND THE `Z` ABOVE IS ASSERTED, NOT ASSUMED — read the check below before removing this.
    `       current_setting('TimeZone') AS session_tz,\n` +
    // The whole point: Postgres subtracts against its own now(), so the client's timezone and
    // clock are never involved.
    `       EXTRACT(EPOCH FROM (now() - max("${column}"))) AS age_seconds\n` +
    `  FROM "${table}"` +
    (where ? `\n WHERE ${where}` : '')

  const result = await client.query(sql, params)
  const row = result?.rows?.[0] ?? {}

  /*
   * 🛑 THE `"Z"` IN THE FORMAT STRING IS A CLAIM ABOUT THE SESSION, AND THIS IS WHERE IT IS PAID FOR.
   *
   * `to_char` appends that literal Z whatever the session zone actually is. For a naive
   * `timestamp` column the digits are UTC either way, so the label is true. For a `timestamptz`
   * column Postgres renders in the SESSION zone, so the label is true only if the session is
   * pinned to UTC — and this function does not pin it. `pinSessionToUtc` is a separate export the
   * CALLER has to remember.
   *
   * ⚠ THAT IS THE SAME DEFECT THIS FUNCTION WAS JUST FIXED FOR, ONE LAYER OUT. The client-zone bug
   * published a confidently-wrong timestamp because nothing checked an assumption; a caller who
   * forgets to pin would publish a confidently-wrong timestamp LABELLED UTC for exactly the same
   * reason. A contract that lives only in a doc comment is not a contract, so it is executable
   * here: forgetting now throws instead of lying.
   *
   * Costs nothing — `current_setting` rides along in the query that was already being sent.
   */
  const tz = row.session_tz
  if (tz && tz !== 'UTC') {
    throw new Error(
      `maxAge("${table}"."${column}"): session TimeZone is "${tz}", not UTC — the "Z" this function ` +
        'appends to newest_iso would be a lie for a timestamptz column. Call pinSessionToUtc(client) ' +
        'before maxAge, as scripts/cron-freshness-check.mjs does.',
    )
  }

  return {
    // Built from the Postgres-rendered ISO string, never from `row.newest` — see above. The `Z` is
    // what makes this parse as an instant rather than as local wall-clock time.
    newest: row.newest_iso ? new Date(row.newest_iso) : null,
    newestIso: row.newest_iso ?? null,
    ageMs: row.age_seconds == null ? null : Number(row.age_seconds) * 1000,
    rowCount: Number(row.n ?? 0),
    timestampCount: Number(row.n_ts ?? 0),
  }
}

/**
 * Human-readable age. Separate from the measurement so a formatting tweak can never change what
 * "stale" means.
 */
export function formatAge(ms) {
  if (ms == null) return 'never'
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.round(ms / 60_000)}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

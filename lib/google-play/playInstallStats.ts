/**
 * Google Play install counts for the admin Command Center.
 *
 * Google does not expose download counts through the Play Developer API. The
 * only programmatic source is the Play Console's monthly statistics export,
 * which Google writes as CSV files into a Cloud Storage bucket owned by the
 * developer account:
 *
 *   gs://pubsite_prod_<id>/stats/installs/installs_<package>_<YYYYMM>_overview.csv
 *
 * Reading it needs a service account that has been invited in Play Console
 * (Users and permissions) with "View app information and download bulk
 * reports". That account signs a JWT here with node:crypto, so no Google SDK is
 * pulled in for one read-only call.
 *
 * ⚠ THE FILES ARE UTF-16LE WITH A BOM. Decoding them as UTF-8 yields a header
 * full of NUL bytes that matches no column name, which reads as "0 installs"
 * rather than as a failure. The decoder below checks the BOM, and a report with
 * no recognisable install column is reported as unreadable, never as zero.
 *
 * ⚠ GOOGLE PUBLISHES WITH A LAG OF A FEW DAYS. The newest row is usually 2-3
 * days old, so `latestDate` is returned for the card note. A quiet "today" is
 * not missing data.
 *
 * The admin page must render if any of this fails, so the exported helper never
 * throws. Results are cached in-process: the export changes at most daily.
 */

import { createSign } from "node:crypto"

const DEFAULT_PACKAGE_NAME = "ai.allfantasy.app"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const STORAGE_API = "https://storage.googleapis.com/storage/v1"
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only"
const REQUEST_TIMEOUT_MS = 10_000
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000
const FAILURE_TTL_MS = 15 * 60 * 1000

export type PlayInstallStats = {
  /** Sum of daily installs across every report month Google has published. */
  installsAllTime: number
  installs28Days: number
  installs7Days: number
  /** Devices with the app installed on the newest report day, when Google provides it. */
  activeDevices: number | null
  /** Newest day present in the export (YYYY-MM-DD). */
  latestDate: string | null
  /** Which CSV column the install counts were read from. */
  installColumn: string
  reportMonths: number
}

export type PlayInstallStatsResult =
  | { status: "ok"; stats: PlayInstallStats; fetchedAt: string }
  | { status: "not_configured"; missing: string[] }
  | { status: "error"; reason: string }

type ServiceAccount = { client_email: string; private_key: string }

type PlayConfig = {
  serviceAccount: ServiceAccount
  bucket: string
  packageName: string
}

/**
 * Preferred first: "Daily User Installs" counts unique users, which is the
 * figure closest to what the Play Store listing calls downloads. Older and
 * newer exports carry different column sets, so fall back in order.
 */
const INSTALL_COLUMNS = ["Daily User Installs", "Daily Device Installs", "Install events"]
const ACTIVE_DEVICE_COLUMNS = ["Active Device Installs"]

let cache: { result: PlayInstallStatsResult; expiresAt: number } | null = null

export function resetPlayInstallStatsCache(): void {
  cache = null
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  const candidates = [raw.trim()]
  // Railway and similar dashboards mangle multi-line JSON, so base64 is accepted too.
  if (!raw.trim().startsWith("{")) {
    try {
      candidates.push(Buffer.from(raw.trim(), "base64").toString("utf8"))
    } catch {
      // not base64
    }
  }
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as Partial<ServiceAccount>
      if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        }
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

export function readPlayConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: PlayConfig } | { ok: false; missing: string[]; invalid?: string } {
  const rawAccount = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()
  const bucket = env.GOOGLE_PLAY_REPORTS_BUCKET?.trim().replace(/^gs:\/\//, "").replace(/\/+$/, "")
  const missing: string[] = []
  if (!rawAccount) missing.push("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")
  if (!bucket) missing.push("GOOGLE_PLAY_REPORTS_BUCKET")
  if (missing.length) return { ok: false, missing }

  const serviceAccount = parseServiceAccount(rawAccount!)
  if (!serviceAccount) {
    return { ok: false, missing: [], invalid: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not a service-account key" }
  }
  return {
    ok: true,
    config: {
      serviceAccount,
      bucket: bucket!,
      packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || DEFAULT_PACKAGE_NAME,
    },
  }
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64Url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  )
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claims}`)
  const assertion = `${header}.${claims}.${base64Url(signer.sign(account.private_key))}`

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (HTTP ${res.status})`)
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error("Google token exchange returned no access token")
  return body.access_token
}

async function listOverviewReports(token: string, config: PlayConfig): Promise<string[]> {
  const prefix = `stats/installs/installs_${config.packageName}_`
  const names: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ prefix, fields: "items(name),nextPageToken" })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await fetchWithTimeout(
      `${STORAGE_API}/b/${encodeURIComponent(config.bucket)}/o?${params.toString()}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    if (res.status === 403 || res.status === 401) {
      throw new Error("The service account cannot read the reports bucket. Check its Play Console permissions.")
    }
    if (res.status === 404) throw new Error(`Reports bucket "${config.bucket}" was not found`)
    if (!res.ok) throw new Error(`Listing Play reports failed (HTTP ${res.status})`)
    const body = (await res.json()) as { items?: { name: string }[]; nextPageToken?: string }
    for (const item of body.items ?? []) {
      if (item.name.endsWith("_overview.csv")) names.push(item.name)
    }
    pageToken = body.nextPageToken
  } while (pageToken)
  return names.sort()
}

async function downloadReport(token: string, config: PlayConfig, name: string): Promise<string> {
  const res = await fetchWithTimeout(
    `${STORAGE_API}/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(name)}?alt=media`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Downloading ${name} failed (HTTP ${res.status})`)
  return decodeReport(Buffer.from(await res.arrayBuffer()))
}

export function decodeReport(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le")
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8")
  }
  return bytes.toString("utf8")
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      out.push(field)
      field = ""
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((v) => v.trim())
}

export type ParsedReportRow = { date: string; installs: number; activeDevices: number | null }

/** Returns null when the report has no recognisable install column, so a bad parse never reads as zero. */
export function parseOverviewReport(csv: string): { column: string; rows: ParsedReportRow[] } | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const dateIdx = header.indexOf("date")
  const installColumn = INSTALL_COLUMNS.find((c) => header.includes(c.toLowerCase()))
  if (dateIdx < 0 || !installColumn) return null
  const installIdx = header.indexOf(installColumn.toLowerCase())
  const activeIdx = ACTIVE_DEVICE_COLUMNS.map((c) => header.indexOf(c.toLowerCase())).find((i) => i >= 0) ?? -1

  const rows: ParsedReportRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const date = cells[dateIdx]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue
    const installs = Number((cells[installIdx] ?? "").replace(/,/g, ""))
    const active = activeIdx >= 0 ? Number((cells[activeIdx] ?? "").replace(/,/g, "")) : NaN
    rows.push({
      date,
      installs: Number.isFinite(installs) ? installs : 0,
      activeDevices: Number.isFinite(active) ? active : null,
    })
  }
  return { column: installColumn, rows }
}

export function summarizeReports(reports: { column: string; rows: ParsedReportRow[] }[]): PlayInstallStats | null {
  if (reports.length === 0) return null
  // A day can appear in two monthly files when Google republishes; keep one row per day.
  const byDate = new Map<string, ParsedReportRow>()
  for (const report of reports) for (const row of report.rows) byDate.set(row.date, row)
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const latest = days[days.length - 1] ?? null

  const sumSince = (windowDays: number) => {
    if (!latest) return 0
    const cutoff = new Date(`${latest.date}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1))
    const cutoffKey = cutoff.toISOString().slice(0, 10)
    return days.filter((d) => d.date >= cutoffKey).reduce((sum, d) => sum + d.installs, 0)
  }

  return {
    installsAllTime: days.reduce((sum, d) => sum + d.installs, 0),
    installs28Days: sumSince(28),
    installs7Days: sumSince(7),
    activeDevices: latest?.activeDevices ?? null,
    latestDate: latest?.date ?? null,
    installColumn: reports[reports.length - 1].column,
    reportMonths: reports.length,
  }
}

async function loadPlayInstallStats(): Promise<PlayInstallStatsResult> {
  const cfg = readPlayConfig()
  if (!cfg.ok) {
    if (cfg.invalid) return { status: "error", reason: cfg.invalid }
    return { status: "not_configured", missing: cfg.missing }
  }
  const { config } = cfg
  const token = await getAccessToken(config.serviceAccount)
  const names = await listOverviewReports(token, config)
  if (names.length === 0) {
    return {
      status: "error",
      reason: `No install reports for ${config.packageName} in the bucket yet. Google adds them a few days after launch.`,
    }
  }
  const reports = []
  for (const name of names) {
    const parsed = parseOverviewReport(await downloadReport(token, config, name))
    if (!parsed) return { status: "error", reason: `Could not read the install columns in ${name}` }
    reports.push(parsed)
  }
  const stats = summarizeReports(reports)
  if (!stats) return { status: "error", reason: "The install reports contained no rows" }
  return { status: "ok", stats, fetchedAt: new Date().toISOString() }
}

/** Never throws. Safe to call on every admin page load. */
export async function getPlayInstallStats(): Promise<PlayInstallStatsResult> {
  if (cache && cache.expiresAt > Date.now()) return cache.result
  let result: PlayInstallStatsResult
  try {
    result = await loadPlayInstallStats()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Never echo a key: messages above are built from status codes and names only.
    result = { status: "error", reason: message.includes("abort") ? "Google did not respond in time" : message }
  }
  const ttl = result.status === "ok" ? SUCCESS_TTL_MS : result.status === "not_configured" ? 60_000 : FAILURE_TTL_MS
  cache = { result, expiresAt: Date.now() + ttl }
  return result
}

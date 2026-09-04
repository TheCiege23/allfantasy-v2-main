import "server-only"

import { prisma } from "@/lib/prisma"
import { normalizeTeamAbbrev } from "@/lib/team-abbrev"

// ─── Public types ─────────────────────────────────────────────────────────────

export type TeamMappingStatus =
  | "mapped"          // high-confidence single canonical match
  | "probable_match"  // medium-confidence single match — review recommended
  | "ambiguous"       // multiple canonical candidates found
  | "unmapped"        // no candidate found
  | "duplicate"       // two+ provider rows from same sport+source resolve to same canonical

export type ProviderTeamMappingResult = {
  /** SportsTeam.source (e.g. "api_sports", "espn") */
  provider: string
  sport: string
  /** SportsTeam.externalId */
  providerTeamId: string
  providerName: string
  providerShortName: string | null
  providerCity: string | null
  /** Number of canonical candidates found during matching */
  candidateCount: number
  status: TeamMappingStatus
  /** 0–1; 0 = unmapped, 1.0 = exact abbrev/code match */
  confidence: number
  /** Which matching tier produced the best match */
  matchedBy:
    | "exact_abbrev"
    | "alias_abbrev"
    | "exact_full_name"
    | "normalized_name"
    | "city_substring"
    | "partial_word"
    | "wc_fifa_code"
    | "wc_country_name"
    | null
  /** TeamAsset.teamCode or WorldCupTeam.fifaCode */
  canonicalTeamCode: string | null
  /** TeamAsset.teamName or WorldCupTeam.name */
  canonicalTeamName: string | null
  /** Which canonical table the match points to */
  canonicalTableRef: "teamAsset" | "worldCupTeam" | null
}

export type ProviderTeamReconciliationSummary = {
  sport: string
  provider: string
  totalProviderTeams: number
  mapped: number
  probableMatch: number
  ambiguous: number
  unmapped: number
  duplicate: number
  /** mapped / total  (0–100) */
  mappedPct: number
  /** (mapped + probableMatch) / total  (0–100) */
  coveredPct: number
}

export type ProviderTeamReconciliationReport = {
  generatedAt: string
  /** One row per (sport × provider) */
  summaries: ProviderTeamReconciliationSummary[]
  /** Sum of ambiguous + unmapped + duplicate across all sports/providers */
  totalProblems: number
  /** Up to 50 unmapped rows sorted by sport then provider — for quick triage */
  topUnmapped: ProviderTeamMappingResult[]
  /** Up to 20 ambiguous rows sorted by candidateCount desc */
  topAmbiguous: ProviderTeamMappingResult[]
  /** Full result set — may be large, use summaries for display */
  allResults: ProviderTeamMappingResult[]
}

// ─── Internal types ───────────────────────────────────────────────────────────

type CanonicalTeam = {
  /** Normalised uppercase code / abbreviation */
  code: string
  /** Display name */
  name: string
  /** Additional search keys (country, city, alternate abbreviations) */
  alternateNames: string[]
  tableRef: "teamAsset" | "worldCupTeam"
}

type ProviderTeam = {
  provider: string
  sport: string
  externalId: string
  name: string
  shortName: string | null
  city: string | null
}

type CandidateMatch = {
  canonical: CanonicalTeam
  confidence: number
  matchedBy: ProviderTeamMappingResult["matchedBy"]
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const STOP_WORDS = new Set([
  "fc", "sc", "afc", "cf", "ac", "rsc", "rc", "bsc",
  "sporting", "club", "united", "city", "town",
  "de", "du", "la", "le", "les", "the", "of",
])

function significantWords(s: string): Set<string> {
  const result = new Set<string>()
  for (const word of norm(s).split(" ")) {
    if (word.length > 2 && !STOP_WORDS.has(word)) result.add(word)
  }
  return result
}

// ─── Multi-tier matcher ───────────────────────────────────────────────────────

function findCandidates(row: ProviderTeam, canonicals: CanonicalTeam[]): CandidateMatch[] {
  const candidates = new Map<string, CandidateMatch>()

  const normShort = norm(row.shortName)
  const normName = norm(row.name)
  const normCity = norm(row.city)

  function add(canonical: CanonicalTeam, confidence: number, matchedBy: ProviderTeamMappingResult["matchedBy"]) {
    const existing = candidates.get(canonical.code)
    if (!existing || existing.confidence < confidence) {
      candidates.set(canonical.code, { canonical, confidence, matchedBy })
    }
  }

  for (const canonical of canonicals) {
    const normCode = norm(canonical.code)
    const normCanonName = norm(canonical.name)

    // ── Tier 1: exact shortName / externalId === canonical code ──────────────
    if (normShort && normShort === normCode) {
      add(canonical, 1.0, "exact_abbrev"); continue
    }
    if (norm(row.externalId) === normCode) {
      add(canonical, 1.0, "exact_abbrev"); continue
    }

    // ── Tier 2: alias resolution via normalizeTeamAbbrev ─────────────────────
    if (row.shortName) {
      const resolved = normalizeTeamAbbrev(row.shortName)
      if (resolved && norm(resolved) === normCode) {
        add(canonical, 0.98, "alias_abbrev"); continue
      }
    }

    // ── World Cup Tier A: FIFA code match ─────────────────────────────────────
    if (canonical.tableRef === "worldCupTeam") {
      if (normShort && normShort === normCode) {
        add(canonical, 1.0, "wc_fifa_code"); continue
      }
      // country name match
      for (const alt of canonical.alternateNames) {
        if (norm(alt) && norm(alt) === normName) {
          add(canonical, 0.93, "wc_country_name"); continue
        }
      }
      // provider city === country/name for international teams
      if (normCity && (norm(canonical.name) === normCity || canonical.alternateNames.some((a) => norm(a) === normCity))) {
        add(canonical, 0.90, "wc_country_name")
      }
    }

    if (candidates.has(canonical.code)) continue

    // ── Tier 3: exact full name ───────────────────────────────────────────────
    if (normName && normName === normCanonName) {
      add(canonical, 0.95, "exact_full_name"); continue
    }

    // ── Tier 4: normalized name (stop-words removed) ──────────────────────────
    const sigRow = [...significantWords(row.name)].sort().join(" ")
    const sigCan = [...significantWords(canonical.name)].sort().join(" ")
    if (sigRow.length > 0 && sigCan.length > 0 && sigRow === sigCan) {
      add(canonical, 0.88, "normalized_name"); continue
    }

    // ── Tier 5: city substring ────────────────────────────────────────────────
    if (normCity && normCity.length > 3) {
      if (normCanonName.includes(normCity) || normCode.includes(normCity.slice(0, 3))) {
        add(canonical, 0.68, "city_substring"); continue
      }
    }

    // ── Tier 6: significant word overlap (≥50% of smaller set) ───────────────
    const rowWords = significantWords(row.name)
    const canWords = significantWords(canonical.name)
    if (rowWords.size > 0 && canWords.size > 0) {
      const shared = [...rowWords].filter((w) => canWords.has(w))
      const overlap = shared.length / Math.min(rowWords.size, canWords.size)
      if (overlap >= 0.5) {
        add(canonical, 0.45 + overlap * 0.1, "partial_word")
      }
    }
  }

  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence)
}

// ─── Status classification ────────────────────────────────────────────────────

function classifyResult(row: ProviderTeam, candidates: CandidateMatch[]): ProviderTeamMappingResult {
  const base: Omit<ProviderTeamMappingResult, "status" | "confidence" | "matchedBy" | "canonicalTeamCode" | "canonicalTeamName" | "canonicalTableRef"> = {
    provider: row.provider,
    sport: row.sport,
    providerTeamId: row.externalId,
    providerName: row.name,
    providerShortName: row.shortName,
    providerCity: row.city,
    candidateCount: candidates.length,
  }

  if (candidates.length === 0) {
    return { ...base, status: "unmapped", confidence: 0, matchedBy: null, canonicalTeamCode: null, canonicalTeamName: null, canonicalTableRef: null }
  }

  const best = candidates[0]

  if (candidates.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      confidence: best.confidence,
      matchedBy: best.matchedBy,
      canonicalTeamCode: best.canonical.code,
      canonicalTeamName: best.canonical.name,
      canonicalTableRef: best.canonical.tableRef,
    }
  }

  return {
    ...base,
    status: best.confidence >= 0.85 ? "mapped" : "probable_match",
    confidence: best.confidence,
    matchedBy: best.matchedBy,
    canonicalTeamCode: best.canonical.code,
    canonicalTeamName: best.canonical.name,
    canonicalTableRef: best.canonical.tableRef,
  }
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

/**
 * If two+ provider rows from the same sport+provider resolve to the same
 * canonical team, flag ALL of them as "duplicate" (they all have redundant mappings).
 */
function markDuplicates(results: ProviderTeamMappingResult[]): ProviderTeamMappingResult[] {
  const canonicalHitCount = new Map<string, number>()
  for (const r of results) {
    if (!r.canonicalTeamCode || r.status === "unmapped" || r.status === "ambiguous") continue
    const key = `${r.sport}|${r.provider}|${r.canonicalTeamCode}`
    canonicalHitCount.set(key, (canonicalHitCount.get(key) ?? 0) + 1)
  }
  return results.map((r) => {
    if (!r.canonicalTeamCode || r.status === "unmapped" || r.status === "ambiguous") return r
    const key = `${r.sport}|${r.provider}|${r.canonicalTeamCode}`
    if ((canonicalHitCount.get(key) ?? 0) > 1) return { ...r, status: "duplicate" as TeamMappingStatus }
    return r
  })
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildSummaries(results: ProviderTeamMappingResult[]): ProviderTeamReconciliationSummary[] {
  const grouped = new Map<string, ProviderTeamMappingResult[]>()
  for (const r of results) {
    const key = `${r.sport}|${r.provider}`
    const group = grouped.get(key) ?? []
    group.push(r)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map(([key, group]) => {
      const [sport, provider] = key.split("|")
      const total = group.length
      const mapped = group.filter((r) => r.status === "mapped").length
      const probableMatch = group.filter((r) => r.status === "probable_match").length
      const ambiguous = group.filter((r) => r.status === "ambiguous").length
      const unmapped = group.filter((r) => r.status === "unmapped").length
      const duplicate = group.filter((r) => r.status === "duplicate").length
      return {
        sport,
        provider,
        totalProviderTeams: total,
        mapped,
        probableMatch,
        ambiguous,
        unmapped,
        duplicate,
        mappedPct: total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0,
        coveredPct: total > 0 ? Math.round(((mapped + probableMatch) / total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => `${a.sport}|${a.provider}`.localeCompare(`${b.sport}|${b.provider}`))
}

// ─── DB loaders ───────────────────────────────────────────────────────────────

async function loadProviderTeams(sports?: string[]): Promise<ProviderTeam[]> {
  try {
    const rows = await prisma.sportsTeam.findMany({
      where: sports?.length ? { sport: { in: sports } } : {},
      select: { sport: true, externalId: true, name: true, shortName: true, city: true, source: true },
      orderBy: [{ sport: "asc" }, { source: "asc" }],
    })
    return rows.map((r) => ({
      provider: r.source,
      sport: r.sport,
      externalId: r.externalId,
      name: r.name,
      shortName: r.shortName ?? null,
      city: r.city ?? null,
    }))
  } catch {
    return []
  }
}

async function loadCanonicalTeamsBySport(sports?: string[]): Promise<Map<string, CanonicalTeam[]>> {
  const result = new Map<string, CanonicalTeam[]>()
  try {
    const rows = await prisma.teamAsset.findMany({
      where: sports?.length ? { sport: { in: sports } } : {},
      select: { sport: true, teamCode: true, teamName: true },
    })
    for (const r of rows) {
      const group = result.get(r.sport) ?? []
      group.push({ code: r.teamCode.trim().toUpperCase(), name: r.teamName, alternateNames: [], tableRef: "teamAsset" })
      result.set(r.sport, group)
    }
  } catch {
    // no-op — empty map returned
  }
  return result
}

async function loadWorldCupCanonicalTeams(): Promise<CanonicalTeam[]> {
  try {
    const model = (prisma as unknown as Record<string, unknown>)["worldCupTeam"] as
      | { findMany: (args?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>> }
      | undefined
    if (!model?.findMany) return []
    const rows = await model.findMany({ select: { fifaCode: true, name: true, country: true } } as Record<string, unknown>)
    return rows.map((r) => {
      const fifaCode = String(r["fifaCode"] ?? "").trim().toUpperCase()
      const name = String(r["name"] ?? "")
      const country = String(r["country"] ?? "")
      return {
        code: fifaCode || name.slice(0, 3).toUpperCase(),
        name,
        alternateNames: country && country !== name ? [country] : [],
        tableRef: "worldCupTeam" as const,
      }
    })
  } catch {
    return []
  }
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Run provider → canonical team reconciliation for all (or specific) sports.
 *
 * Matching tiers (high to low confidence):
 *   1.0  exact shortName/externalId === canonical code
 *   0.98 alias resolution via normalizeTeamAbbrev (NFL aliases)
 *   0.95 exact full-name match
 *   0.93 WC country-name match
 *   0.88 normalised name (stop-words removed, sorted)
 *   0.68 city substring in canonical name
 *   0.45–0.55 significant word overlap (≥50% of smaller set)
 *
 * Status thresholds:
 *   confidence ≥ 0.85, 1 candidate  → mapped
 *   confidence < 0.85, 1 candidate  → probable_match
 *   2+ candidates                   → ambiguous
 *   0 candidates                    → unmapped
 *   2+ provider rows → same canonical (same sport+provider) → duplicate
 *
 * @param sports Optional list of sport strings to limit scope (e.g. ["NFL","WC_SOCCER"])
 */
export async function getProviderTeamReconciliationReport(
  sports?: string[]
): Promise<ProviderTeamReconciliationReport> {
  const [providerTeams, canonicalBySport, wcTeams] = await Promise.all([
    loadProviderTeams(sports),
    loadCanonicalTeamsBySport(sports),
    loadWorldCupCanonicalTeams(),
  ])

  // Merge WC canonical teams under WC_SOCCER key
  if (!sports || sports.includes("WC_SOCCER")) {
    canonicalBySport.set("WC_SOCCER", wcTeams)
  }

  // Reconcile each provider team
  let allResults: ProviderTeamMappingResult[] = providerTeams.map((row) => {
    const canonicals = canonicalBySport.get(row.sport) ?? []
    const candidates = findCandidates(row, canonicals)
    return classifyResult(row, candidates)
  })

  allResults = markDuplicates(allResults)

  const summaries = buildSummaries(allResults)

  const totalProblems = allResults.filter(
    (r) => r.status === "ambiguous" || r.status === "unmapped" || r.status === "duplicate"
  ).length

  const topUnmapped = allResults
    .filter((r) => r.status === "unmapped")
    .sort((a, b) => `${a.sport}|${a.provider}`.localeCompare(`${b.sport}|${b.provider}`))
    .slice(0, 50)

  const topAmbiguous = allResults
    .filter((r) => r.status === "ambiguous")
    .sort(
      (a, b) =>
        b.candidateCount - a.candidateCount ||
        `${a.sport}|${a.provider}`.localeCompare(`${b.sport}|${b.provider}`)
    )
    .slice(0, 20)

  return {
    generatedAt: new Date().toISOString(),
    summaries,
    totalProblems,
    topUnmapped,
    topAmbiguous,
    allResults,
  }
}

/**
 * Lightweight variant — returns only summaries + total problem count.
 * Suitable for admin-panel overview cards without fetching full result sets.
 */
export async function getProviderTeamReconciliationSummaries(sports?: string[]): Promise<{
  summaries: ProviderTeamReconciliationSummary[]
  totalProblems: number
  generatedAt: string
}> {
  const { summaries, totalProblems, generatedAt } = await getProviderTeamReconciliationReport(sports)
  return { summaries, totalProblems, generatedAt }
}

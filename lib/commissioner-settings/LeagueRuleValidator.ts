/**
 * Validates commissioner settings before save.
 * Sport-aware (NFL, NHL, NBA, MLB, NCAAF, NCAAB, SOCCER).
 */

import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import type { LeagueSport } from "@prisma/client"
import type { LeagueSettingsPatch } from "./types"

export type ValidationResult = { valid: true } | { valid: false; error: string }

export function validateGeneralSettings(patch: LeagueSettingsPatch): ValidationResult {
  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim() : ""
    if (name.length > 200) return { valid: false, error: "League name must be 200 characters or less" }
  }
  if (patch.description !== undefined && patch.description != null) {
    if (typeof patch.description !== "string") return { valid: false, error: "Description must be a string" }
    if (patch.description.length > 2000) return { valid: false, error: "Description must be 2000 characters or less" }
  }
  if (patch.sport !== undefined && patch.sport != null) {
    const s = String(patch.sport).toUpperCase()
    if (!(SUPPORTED_SPORTS as readonly string[]).includes(s)) {
      return { valid: false, error: `Sport must be one of: ${SUPPORTED_SPORTS.join(", ")}` }
    }
  }
  if (patch.season !== undefined && patch.season != null) {
    const y = Number(patch.season)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      return { valid: false, error: "Season must be a year between 2000 and 2100" }
    }
  }
  return { valid: true }
}

export function validateRosterSettings(patch: LeagueSettingsPatch): ValidationResult {
  if (patch.rosterSize !== undefined && patch.rosterSize != null) {
    const n = Number(patch.rosterSize)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return { valid: false, error: "Roster size must be between 1 and 100" }
    }
  }
  if (patch.leagueSize !== undefined && patch.leagueSize != null) {
    const n = Number(patch.leagueSize)
    if (!Number.isInteger(n) || n < 2 || n > 32) {
      return { valid: false, error: "League size must be between 2 and 32" }
    }
  }
  if (patch.benchSize !== undefined && patch.benchSize != null) {
    const n = Number(patch.benchSize)
    if (!Number.isInteger(n) || n < 0 || n > 60) {
      return { valid: false, error: "Bench size must be between 0 and 60" }
    }
  }
  if (patch.rosterPositions !== undefined && patch.rosterPositions != null) {
    if (!Array.isArray(patch.rosterPositions)) {
      return { valid: false, error: "Roster positions must be an array" }
    }
    if (patch.rosterPositions.length > 30) {
      return { valid: false, error: "Roster positions can include up to 30 entries" }
    }
    const hasInvalid = patch.rosterPositions.some((p) => typeof p !== "string" || p.trim().length === 0 || p.trim().length > 24)
    if (hasInvalid) {
      return { valid: false, error: "Each roster position must be a non-empty string up to 24 characters" }
    }
  }
  return { valid: true }
}

export function validateTradeSettings(patch: LeagueSettingsPatch): ValidationResult {
  if (patch.tradeReviewType !== undefined && patch.tradeReviewType != null) {
    const normalized = String(patch.tradeReviewType).trim().toLowerCase()
    const allowed = new Set(["none", "commissioner", "league_vote", "instant"])
    if (!allowed.has(normalized)) {
      return { valid: false, error: "Trade review type must be one of: none, commissioner, league_vote, instant" }
    }
  }
  if (patch.vetoThresholdMode !== undefined && patch.vetoThresholdMode != null) {
    if (patch.vetoThresholdMode !== "count" && patch.vetoThresholdMode !== "percent") {
      return { valid: false, error: "Veto threshold must be counted as votes (count) or a percent of teams (percent)" }
    }
  }
  if (patch.vetoThreshold !== undefined && patch.vetoThreshold != null) {
    const n = Number(patch.vetoThreshold)
    // A number of votes (the default) is 1–30; a percent of the league's teams is 1–100. 0 still clears it.
    const max = patch.vetoThresholdMode === "count" ? 30 : 100
    if (!Number.isInteger(n) || n < 0 || n > max) {
      return {
        valid: false,
        error: patch.vetoThresholdMode === "count" ? "Veto votes must be 0–30" : "Veto threshold must be 0–100",
      }
    }
  }
  return { valid: true }
}

export function validateCommissionerPatch(patch: LeagueSettingsPatch): ValidationResult {
  const g = validateGeneralSettings(patch)
  if (!g.valid) return g
  const r = validateRosterSettings(patch)
  if (!r.valid) return r
  return validateTradeSettings(patch)
}

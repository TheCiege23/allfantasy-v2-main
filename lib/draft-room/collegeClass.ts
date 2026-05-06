/**
 * Normalize Rolling Insights / college roster `class` labels for NCAA filters.
 * Does not infer NFL rookie status.
 */

export type NormalizedCollegeClass =
  | 'freshman'
  | 'sophomore'
  | 'junior'
  | 'senior'
  | 'graduate'
  | 'unknown'

const WS = /\s+/g

export function normalizeCollegeClass(value: unknown): NormalizedCollegeClass {
  if (value == null) return 'unknown'
  const raw = String(value).trim()
  if (!raw) return 'unknown'
  const s = raw.replace(WS, ' ').toLowerCase()

  if (
    s === 'fr' ||
    s === 'freshman' ||
    s === 'r-fr' ||
    s === 'r fr' ||
    s === 'rs-fr' ||
    s === 'rs fr' ||
    s.startsWith('rs-fr') ||
    s.startsWith('redshirt fr')
  ) {
    return 'freshman'
  }
  if (
    s === 'so' ||
    s === 'sophomore' ||
    s === 'r-so' ||
    s === 'rs-so' ||
    s.startsWith('rs-so') ||
    s.startsWith('redshirt so')
  ) {
    return 'sophomore'
  }
  if (
    s === 'jr' ||
    s === 'junior' ||
    s === 'r-jr' ||
    s === 'rs-jr' ||
    s.startsWith('rs-jr') ||
    s.startsWith('redshirt jr')
  ) {
    return 'junior'
  }
  if (
    s === 'sr' ||
    s === 'senior' ||
    s === 'r-sr' ||
    s === 'rs-sr' ||
    s.startsWith('rs-sr') ||
    s.startsWith('redshirt sr')
  ) {
    return 'senior'
  }
  if (s === 'gr' || s === 'grad' || s === 'graduate' || s.includes('grad student')) {
    return 'graduate'
  }

  return 'unknown'
}

export function isFreshmanClass(value: unknown): boolean {
  return normalizeCollegeClass(value) === 'freshman'
}

export function isSophomoreClass(value: unknown): boolean {
  return normalizeCollegeClass(value) === 'sophomore'
}

export function isJuniorClass(value: unknown): boolean {
  return normalizeCollegeClass(value) === 'junior'
}

export function isSeniorClass(value: unknown): boolean {
  return normalizeCollegeClass(value) === 'senior'
}

export function isGraduateClass(value: unknown): boolean {
  return normalizeCollegeClass(value) === 'graduate'
}

export function isUnderclassmanClass(value: unknown): boolean {
  const n = normalizeCollegeClass(value)
  return n === 'freshman' || n === 'sophomore'
}

/** Default: Junior+ and graduate — typical draft-eligible band (product-tunable later). */
export function isDraftEligibleCollegeClass(value: unknown): boolean {
  const n = normalizeCollegeClass(value)
  return n === 'junior' || n === 'senior' || n === 'graduate'
}

/** Alias for normalized bucket — useful for filters and analytics keys. */
export function getCollegeClassBucket(value: unknown): NormalizedCollegeClass {
  return normalizeCollegeClass(value)
}

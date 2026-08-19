/**
 * Fantasy OS Suite — Phase V8.1: file-backed historical evidence store.
 *
 * The fixture/smoke-verified implementation of `HistoricalEvidenceStore`. Persists provider-neutral,
 * anonymized JSON under a store directory:
 *   <root>/portfolios/<acct>.json · <root>/leagues/<ref>.json · <root>/import-state.json
 *
 * Idempotent (upsert by reference), restartable (state persisted), and crash-safer (write to a temp file
 * then rename). No provider identifiers are ever written — inputs are already anonymized.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  type HistoricalEvidenceStore,
  type PersistedLeagueEvidence,
  type PersistedPortfolio,
  type ImportState,
  emptyImportState,
} from './evidenceStore'

export class FileEvidenceStore implements HistoricalEvidenceStore {
  private readonly leaguesDir: string
  private readonly portfoliosDir: string
  private readonly statePath: string

  constructor(private readonly root: string) {
    this.leaguesDir = path.join(root, 'leagues')
    this.portfoliosDir = path.join(root, 'portfolios')
    this.statePath = path.join(root, 'import-state.json')
    fs.mkdirSync(this.leaguesDir, { recursive: true })
    fs.mkdirSync(this.portfoliosDir, { recursive: true })
  }

  /** Atomic-ish write: temp file + rename, so a crash never leaves a half-written record. */
  private writeJson(file: string, value: unknown): void {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, file)
  }

  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T
    } catch {
      return null
    }
  }

  private leaguePath(ref: string): string {
    // ref is an anonymized `lg_<hex>` token — safe as a filename.
    return path.join(this.leaguesDir, `${ref}.json`)
  }

  async upsertPortfolio(portfolio: PersistedPortfolio): Promise<void> {
    this.writeJson(path.join(this.portfoliosDir, `${portfolio.accountReference}.json`), portfolio)
  }

  async upsertLeagueEvidence(evidence: PersistedLeagueEvidence): Promise<void> {
    const file = this.leaguePath(evidence.leagueReference)
    // Immutable completed seasons are written once — never overwritten on a later run.
    const existing = this.readJson<PersistedLeagueEvidence>(file)
    if (existing && existing.seasonImmutable) return
    this.writeJson(file, evidence)
  }

  async hasLeague(leagueReference: string): Promise<boolean> {
    return fs.existsSync(this.leaguePath(leagueReference))
  }

  async getLeague(leagueReference: string): Promise<PersistedLeagueEvidence | null> {
    return this.readJson<PersistedLeagueEvidence>(this.leaguePath(leagueReference))
  }

  async listLeagues(): Promise<PersistedLeagueEvidence[]> {
    if (!fs.existsSync(this.leaguesDir)) return []
    return fs
      .readdirSync(this.leaguesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readJson<PersistedLeagueEvidence>(path.join(this.leaguesDir, f)))
      .filter((x): x is PersistedLeagueEvidence => x !== null)
      .sort((a, b) => a.leagueReference.localeCompare(b.leagueReference))
  }

  async listPortfolios(): Promise<PersistedPortfolio[]> {
    if (!fs.existsSync(this.portfoliosDir)) return []
    return fs
      .readdirSync(this.portfoliosDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readJson<PersistedPortfolio>(path.join(this.portfoliosDir, f)))
      .filter((x): x is PersistedPortfolio => x !== null)
      .sort((a, b) => a.accountReference.localeCompare(b.accountReference))
  }

  async readImportState(): Promise<ImportState> {
    return this.readJson<ImportState>(this.statePath) ?? emptyImportState()
  }

  async writeImportState(state: ImportState): Promise<void> {
    this.writeJson(this.statePath, state)
  }
}

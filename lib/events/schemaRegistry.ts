/**
 * G15.1 — Event Foundation: Event Schema Registry.
 *
 * Per-(type, version) payload validators. Validators are plain functions so the
 * registry is decoupled from Zod (you can register a Zod-backed validator via
 * `zodValidator`, or any other). Versioning is additive: register a new version
 * rather than mutating an old one.
 */
import type { z } from 'zod'
import type { IEventSchemaRegistry, PayloadValidator, ValidationResult } from './types'

/** Adapt a Zod schema into a PayloadValidator. */
export function zodValidator(schema: z.ZodTypeAny): PayloadValidator {
  return (payload: unknown): ValidationResult => {
    const res = schema.safeParse(payload)
    if (res.success) return { ok: true }
    const error = res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    return { ok: false, error }
  }
}

export class InMemoryEventSchemaRegistry implements IEventSchemaRegistry {
  /** type → version → validator */
  private readonly byType = new Map<string, Map<number, PayloadValidator>>()

  register(type: string, version: number, validate: PayloadValidator): void {
    if (!type) throw new Error('schema registry: type is required')
    if (!Number.isInteger(version) || version < 1) throw new Error(`schema registry: invalid version ${version} for ${type}`)
    const versions = this.byType.get(type) ?? new Map<number, PayloadValidator>()
    if (versions.has(version)) {
      throw new Error(`schema registry: ${type} v${version} already registered (versions are immutable; add a new version)`)
    }
    versions.set(version, validate)
    this.byType.set(type, versions)
  }

  has(type: string, version?: number): boolean {
    const versions = this.byType.get(type)
    if (!versions) return false
    return version === undefined ? versions.size > 0 : versions.has(version)
  }

  latestVersion(type: string): number | undefined {
    const versions = this.byType.get(type)
    if (!versions || versions.size === 0) return undefined
    return Math.max(...versions.keys())
  }

  validate(type: string, version: number, payload: unknown): ValidationResult {
    const validate = this.byType.get(type)?.get(version)
    if (!validate) return { ok: false, error: `no schema registered for ${type} v${version}` }
    return validate(payload)
  }
}

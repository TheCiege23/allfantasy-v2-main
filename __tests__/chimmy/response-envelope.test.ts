/**
 * The shared Chimmy response envelope: server-side stamping + client-side version gate. Proves both
 * pipelines can produce one versioned envelope and that the client fails SAFE on an unsupported/malformed
 * version (rather than trusting or crashing on it).
 */
import { describe, it, expect } from 'vitest'
import {
  CHIMMY_SCHEMA_VERSION,
  stampChimmyMeta,
  isSupportedChimmySchemaVersion,
  isRenderableChimmyEnvelope,
  normalizeMissingInformation,
} from '@/lib/chimmy-chat/responseEnvelope'

describe('stampChimmyMeta (server)', () => {
  it('stamps the current schema version onto a meta object without adding evidence', () => {
    const out = stampChimmyMeta({ confidencePct: 60, dataSources: ['Sleeper'] })
    expect(out.schemaVersion).toBe(CHIMMY_SCHEMA_VERSION)
    expect(out.confidencePct).toBe(60)
    expect(out.dataSources).toEqual(['Sleeper'])
    expect(Object.keys(out).sort()).toEqual(['confidencePct', 'dataSources', 'schemaVersion'])
  })

  it('is idempotent and preserves an existing version', () => {
    const out = stampChimmyMeta({ schemaVersion: '1', foo: 'bar' })
    expect(out.schemaVersion).toBe('1')
    expect(out.foo).toBe('bar')
  })

  it('handles null/undefined/non-object safely', () => {
    expect(stampChimmyMeta(null).schemaVersion).toBe(CHIMMY_SCHEMA_VERSION)
    expect(stampChimmyMeta(undefined).schemaVersion).toBe(CHIMMY_SCHEMA_VERSION)
  })
})

describe('isSupportedChimmySchemaVersion', () => {
  it('accepts the current version only', () => {
    expect(isSupportedChimmySchemaVersion(CHIMMY_SCHEMA_VERSION)).toBe(true)
    expect(isSupportedChimmySchemaVersion('999')).toBe(false)
    expect(isSupportedChimmySchemaVersion(1 as unknown)).toBe(false)
    expect(isSupportedChimmySchemaVersion(undefined)).toBe(false)
  })
})

describe('isRenderableChimmyEnvelope (client gate)', () => {
  it('null/absent meta is fine (text-only)', () => {
    expect(isRenderableChimmyEnvelope(null)).toBe(true)
    expect(isRenderableChimmyEnvelope(undefined)).toBe(true)
  })
  it('meta without a version renders best-effort (legacy)', () => {
    expect(isRenderableChimmyEnvelope({ confidencePct: 50 })).toBe(true)
  })
  it('supported version renders; unsupported version fails safe', () => {
    expect(isRenderableChimmyEnvelope({ schemaVersion: CHIMMY_SCHEMA_VERSION })).toBe(true)
    expect(isRenderableChimmyEnvelope({ schemaVersion: '999' })).toBe(false)
  })
  it('malformed (non-object) meta fails safe', () => {
    expect(isRenderableChimmyEnvelope('nope')).toBe(false)
    expect(isRenderableChimmyEnvelope(['x'])).toBe(false)
    expect(isRenderableChimmyEnvelope(42)).toBe(false)
  })
})

describe('normalizeMissingInformation', () => {
  it('keeps non-empty strings, trims, drops junk, distinguishes empty from omitted', () => {
    expect(normalizeMissingInformation(['  Final injury report ', '', 3, null, 'Weather'])).toEqual([
      'Final injury report',
      'Weather',
    ])
    expect(normalizeMissingInformation([])).toBeUndefined()
    expect(normalizeMissingInformation(undefined)).toBeUndefined()
    expect(normalizeMissingInformation('x')).toBeUndefined()
  })
})

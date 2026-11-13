/**
 * Deterministic context envelope and evidence presentation layer.
 * All AI tools that require factual grounding use this schema and contracts.
 * AI cannot compute facts the deterministic layer should compute; AI cannot invent missing metrics.
 */

export * from './schema'
export * from './contracts'
export * from './adapters/waiver-to-envelope'

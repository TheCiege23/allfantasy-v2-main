export class RedraftControlsError extends Error { constructor(message: string, public status = 400) { super(message) } }
export function jsonRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

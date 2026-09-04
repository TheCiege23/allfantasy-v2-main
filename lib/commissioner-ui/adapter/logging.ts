import type { CommissionerDataMode } from '../demo-mode/constants'
import type { CommissionerErrorAttributableId, CommissionerErrorContract } from '../contracts'

export type CommissionerAdapterLogEvent =
  | { type: 'success'; moduleId: CommissionerErrorAttributableId; method: string; mode: CommissionerDataMode; source: CommissionerDataMode; durationMs: number }
  | { type: 'error'; moduleId: CommissionerErrorAttributableId; method: string; mode: CommissionerDataMode; durationMs: number; error: CommissionerErrorContract }

export interface CommissionerAdapterLogger {
  log(event: CommissionerAdapterLogEvent): void
}

const noopLogger: CommissionerAdapterLogger = {
  log() {
    /* production default — silent */
  },
}

/** Mirrors DataModeIndicator's existing dev-only gate — no new visibility convention introduced. */
const devConsoleLogger: CommissionerAdapterLogger = {
  log(event) {
    if (event.type === 'error') {
      console.error('[commissioner-os][adapter]', event)
    } else {
      console.debug('[commissioner-os][adapter]', event)
    }
  },
}

let activeLogger: CommissionerAdapterLogger = process.env.NODE_ENV === 'production' ? noopLogger : devConsoleLogger

/** Pluggable so a real logging/observability service can replace the console default later with zero call-site changes. */
export function setCommissionerAdapterLogger(logger: CommissionerAdapterLogger): void {
  activeLogger = logger
}

export function resetCommissionerAdapterLogger(): void {
  activeLogger = process.env.NODE_ENV === 'production' ? noopLogger : devConsoleLogger
}

export function logAdapterEvent(event: CommissionerAdapterLogEvent): void {
  activeLogger.log(event)
}

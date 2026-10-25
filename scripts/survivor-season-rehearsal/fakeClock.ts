/**
 * A process-wide movable clock for the season rehearsal. Imported FIRST, before anything that reads
 * the time, so every `new Date()` / `Date.now()` in the engine sees the rehearsal's instant. Real
 * timers (setTimeout, sockets) are untouched: only the wall clock is moved.
 */
const RealDate = Date
let offsetMs = 0

class RehearsalDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs)
    else super(...(args as [number]))
  }
  static now(): number {
    return RealDate.now() + offsetMs
  }
}

globalThis.Date = RehearsalDate as DateConstructor

export function setRehearsalNow(instant: Date | number): void {
  offsetMs = (typeof instant === 'number' ? instant : instant.getTime()) - RealDate.now()
}

export function advanceRehearsalClock(ms: number): void {
  offsetMs += ms
}

export function rehearsalNow(): Date {
  return new RehearsalDate()
}

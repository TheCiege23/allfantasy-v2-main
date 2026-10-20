/** Client mock clocks use deadlines so suspended browser timers cannot extend a turn. */
export function mockTurnDurationMs(speed: number, isUser: boolean): number {
  return isUser ? speed * 1000 : speed === 0 ? 300 : speed * 200
}

export function remainingMockSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

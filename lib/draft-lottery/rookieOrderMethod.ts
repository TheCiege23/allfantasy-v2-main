/** Older league creation saved 'lottery' for the weighted rookie lottery. */
export function isWeightedRookieLottery(method: string | null | undefined): boolean {
  return method === 'weighted_lottery' || method === 'lottery'
}

export function normalizeRookieOrderMethod(method: string): string {
  return isWeightedRookieLottery(method) ? 'weighted_lottery' : method
}

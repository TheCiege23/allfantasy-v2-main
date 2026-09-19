export type ImportProgressStage = 'queued' | 'discovering' | 'importing' | 'finalizing' | 'complete' | 'failed'

export function buildImportProgressView(input: {
  status: string
  progress: number | null
  currentSeason: number | null
  totalSeasons: number | null
  seasonsCompleted: number | null
  seasonStatuses: string[]
}): {
  stage: ImportProgressStage
  message: string
  retryable: boolean
  pollAfterMs: number | null
} {
  const status = input.status.toLowerCase()
  const progress = input.progress ?? 0
  const processing = input.seasonStatuses.includes('processing')

  if (status === 'error' || status === 'failed' || input.seasonStatuses.includes('error')) {
    return {
      stage: 'failed',
      message: 'The provider interrupted this import. Completed seasons were kept, and you can retry safely.',
      retryable: true,
      pollAfterMs: null,
    }
  }
  if (status === 'complete' || status === 'completed') {
    return {
      stage: 'complete',
      message: 'Import complete. Rankings and career totals are ready.',
      retryable: false,
      pollAfterMs: null,
    }
  }
  if (progress >= 90 && !processing) {
    return {
      stage: 'finalizing',
      message: 'Finalizing rankings, career totals, and notifications…',
      retryable: false,
      pollAfterMs: 2_500,
    }
  }
  if (processing || input.currentSeason != null) {
    return {
      stage: 'importing',
      message: input.currentSeason != null
        ? `Importing the ${input.currentSeason} season…`
        : 'Importing league seasons…',
      retryable: false,
      pollAfterMs: 2_500,
    }
  }
  if (status === 'running') {
    return {
      stage: 'discovering',
      message: 'Finding new and recently changed seasons…',
      retryable: false,
      pollAfterMs: 2_500,
    }
  }
  return {
    stage: 'queued',
    message: 'Import queued. It will start shortly.',
    retryable: false,
    pollAfterMs: 4_000,
  }
}

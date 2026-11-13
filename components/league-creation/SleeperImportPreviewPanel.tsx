'use client';

import type { ImportPreviewResponse } from '@/lib/league-import/ImportedLeaguePreviewBuilder';

export interface SleeperImportPreviewPanelProps {
  preview: ImportPreviewResponse | null;
  loading: boolean;
  onCreateFromImport: () => void;
  createLoading: boolean;
}


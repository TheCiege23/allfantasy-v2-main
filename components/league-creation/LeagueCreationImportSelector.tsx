'use client';

export type CreationMode = 'create' | 'import';

export interface LeagueCreationImportSelectorProps {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
  disabled?: boolean;
}


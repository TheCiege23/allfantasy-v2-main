'use client';

type CreationMode = 'create' | 'import';

export interface LeagueCreationImportSelectorProps {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
  disabled?: boolean;
}


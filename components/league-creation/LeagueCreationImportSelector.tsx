'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type CreationMode = 'create' | 'import';

export interface LeagueCreationImportSelectorProps {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
  disabled?: boolean;
}

export function LeagueCreationImportSelector({
  value,
  onChange,
  disabled,
}: LeagueCreationImportSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>How do you want to set up your league?</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as CreationMode)}
        disabled={disabled}
      >
        <SelectTrigger
          className="bg-gray-900 border-purple-600/40"
          aria-label="League creation mode"
          data-testid="league-creation-mode-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="create">Create New AF League — set sport, scoring, and size manually</SelectItem>
          <SelectItem value="import">Import Existing League — choose a supported provider</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

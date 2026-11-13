/**
 * LeagueSettingsEngineTypes.ts
 * Canonical types for the unified AllFantasy League Settings Platform
 * One league = one settings profile across all sports
 */

// ============================================================
// SUPPORTED SPORTS & LEAGUE TYPES
// ============================================================

export type SupportedLeagueSport =
  | 'NFL'
  | 'NCAAF'
  | 'NBA'
  | 'NCAAB'
  | 'MLB'
  | 'NHL'
  | 'Soccer';

export type LeagueType =
  | 'redraft'
  | 'keeper'
  | 'dynasty'
  | 'best-ball'
  | 'tournament'
  | 'seasonal'
  | 'devy';

type SourceType = 'created' | 'imported';

export type SourcePlatform =
  | 'espn'
  | 'yahoo'
  | 'sleeper'
  | 'fleaflicker'
  | 'cbs'
  | 'mfl'
  | 'fantrax'
  | 'other'
  | null;

export type UserRole = 'commissioner' | 'co-owner' | 'member' | 'viewer';

export type LeagueSettingsPage =
  | 'league'
  | 'team'
  | 'roster'
  | 'scoring'
  | 'draft'
  | 'divisions'
  | 'members'
  | 'co-owners'
  | 'commissioner-control'
  | 'previous-leagues'
  | 'delete-league';

// ============================================================
// AUDIT & VERSIONING
// ============================================================

export interface LeagueSettingsAuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  action: 'created' | 'updated' | 'reset' | 'imported' | 'deleted';
  page: LeagueSettingsPage;
  changedKeys: string[];
  premiumUsed: boolean;
  regenerationTriggered?: boolean;
  previousSnapshot?: Partial<UnifiedLeagueSettings>;
}

interface LeagueSettingsAudit {
  version: number;
  lastUpdatedAt: Date;
  lastUpdatedBy: string;
  changes: LeagueSettingsAuditEntry[];
  createdAt: Date;
  templateMatches: boolean;
}

// ============================================================
// LEAGUE SETTINGS SECTIONS
// ============================================================

interface LeagueSettingsMeta {
  sport: SupportedLeagueSport;
  leagueType: LeagueType;
  sourceType: SourceType;
  sourcePlatform: SourcePlatform;
  timezone: string;
  language: string;
  slug?: string;
}

interface LeagueSettingsBasic {
  name: string;
  description?: string;
  visibility: 'public' | 'private' | 'invited';
  season: number;
  scoringFormat?: 'ppr' | 'half-ppr' | 'standard' | 'custom';
}

interface PlayoffStructure {
  enabled: boolean;
  numberOfPlayoffTeams?: number;
  playoffStartWeek?: number;
  seasonLength?: number;
  format?: 'bracket' | 'round-robin' | 'custom';
  qualificationMethod?: 'points' | 'division-winners' | 'seeding' | 'mixed';
  secondaryPlayoffEnabled?: boolean;
  consolationBracketEnabled?: boolean;
  customPlayoffWeeks?: number[];
  premiumPlayoffFormatEnabled?: boolean;
}

interface LeagueSettingsLeague extends LeagueSettingsBasic {
  playoffSettings: PlayoffStructure;
  schedule?: {
    type: 'balanced' | 'custom' | 'generated';
    matchupsPerTeam?: number;
  };
}

interface TeamSettings {
  numberOfTeams: number;
  teamNamingRules?: 'free' | 'enforced-name-only' | 'avatar-required';
  avatarSettings?: {
    required: boolean;
    maxSizeKb?: number;
  };
  franchiseContinuity?: {
    enabled: boolean;
    franchiseType?: 'none' | 'name-based' | 'id-based';
  };
  orphanTeamHandling?: 'auto-disband' | 'commissioner-assigns' | 'keep';
  maxTransactionsPerTeam?: number;
}

interface RosterConfigReference {
  templateKey: string;
  isCustom: boolean;
  matchesTemplate: boolean;
  version: number;
}

interface ScoringConfigReference {
  presetKey: string;
  isCustom: boolean;
  version: number;
}

interface DraftSettings {
  draftType: 'snake' | 'linear' | 'auction' | 'best-ball' | 'tournament-bracket';
  draftOrder: 'randomized' | 'manual' | 'serpentine' | 'custom';
  snakeDirection?: 'snake' | 'linear';
  timerEnabled: boolean;
  timerSeconds?: number;
  pauseResumeAllowed?: boolean;
  keeperDraftEnabled?: boolean;
  dynastyDraftOptions?: {
    rookieDraft: boolean;
    minorsExpansion: boolean;
  };
  importedDraftState?: {
    draftPositions: Record<string, number>;
    draftedSlots: Array<{ pick: number; team: string; slot: string }>;
  };
}

interface DivisionSettings {
  enabled: boolean;
  numberOfDivisions?: number;
  divisionNames?: string[];
  divisionMemberships?: Record<string, string[]>;
  playoffQualificationByDivision?: boolean;
  minimumTeamsPerDivision?: number;
}

interface MemberSettings {
  inviteSettings: {
    requiresCommissionerApproval: boolean;
    invitationExpiry?: number; // days
  };
  joinApprovals: {
    enabled: boolean;
    requiresCommissionerApproval?: boolean;
  };
  coManagerPermissions?: {
    allowed: boolean;
    maxCoOwners?: number;
    canEdit?: string[]; // page names they can edit
  };
  memberVisibility: 'public' | 'league-members-only' | 'commissioner-only';
  inactiveManagerHandling?: {
    enabled: boolean;
    daysBeforeInactive?: number;
    autoRemove?: boolean;
  };
  bootRulesEnabled?: boolean;
}

interface CoOwnerSettings {
  coOwnerEnabled: boolean;
  coOwnerPermissionScope?: 'read-only' | 'limited-edit' | 'roster-edit' | 'full-edit';
  maxCoOwnersPerTeam?: number;
  coOwnerInviteRules?: {
    requiresTeamOwnerApproval: boolean;
    requiresCommissionerApproval: boolean;
  };
}

interface CommissionerControlSettings {
  forceLineupEnabled?: boolean;
  forceLineupLockTime?: string; // ISO time string
  lockUnlockWaiversEnabled?: boolean;
  scoreOverrideEnabled?: boolean;
  teamAssignmentEnabled?: boolean;
  auditLogVisible?: boolean;
  emergencyToolsEnabled?: boolean;
  automationTriggersEnabled?: boolean;
  premiumCommissionerToolsEnabled?: boolean;
  commissionerNotificationSettings?: {
    emailNotifications: boolean;
    inappNotifications: boolean;
  };
}

interface ScheduleSettings {
  type: 'balanced' | 'custom' | 'generated';
  matchupsPerTeam?: number;
  customSchedule?: Array<{
    week: number;
    matchups: Array<{ team1: string; team2: string }>;
  }>;
}

// ============================================================
// UNIFIED LEAGUE SETTINGS PROFILE
// ============================================================

export interface UnifiedLeagueSettings {
  // Immutable metadata
  meta: LeagueSettingsMeta;
  audit: LeagueSettingsAudit;

  // Mutable settings by category
  league: LeagueSettingsLeague;
  team: TeamSettings;
  roster: RosterConfigReference; // references league.rosterConfig, managed by roster-engine
  scoring: ScoringConfigReference; // references league.scoringConfig, managed by scoring-engine
  draft: DraftSettings;
  divisions: DivisionSettings;
  members: MemberSettings;
  coOwners: CoOwnerSettings;
  commissionerControls: CommissionerControlSettings;
  schedule: ScheduleSettings;

  // Import metadata if applicable
  importMetadata?: {
    originalSourcePlatform: SourcePlatform;
    importMappingNotes: string[];
    normalizationWarnings: string[];
    preservedFields: string[];
    oversizedFields: string[];
  };
}

// ============================================================
// VALIDATION RESULT
// ============================================================

export interface LeagueSettingsValidationError {
  field: string;
  page: LeagueSettingsPage;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LeagueSettingsValidationResult {
  isValid: boolean;
  errors: LeagueSettingsValidationError[];
  warnings: LeagueSettingsValidationError[];
  impactedSystems: string[]; // e.g., ['roster', 'schedule', 'playoffs']
  regenerationRequired: string[]; // systems that need regeneration
  canSave: boolean; // true if only warnings, false if errors
}

// ============================================================
// ROLE & PERMISSION TYPES
// ============================================================

export interface UserPermissions {
  role: UserRole;
  isCommissioner: boolean;
  isCoOwner: boolean;
  isMember: boolean;
  readOnly: boolean;
  editablePages: LeagueSettingsPage[];
  canAccessPremium: boolean;
  canManageCoOwners: boolean;
  canDeleteLeague: boolean;
  reason?: string;
}

export interface RolePermissionConfig {
  commissioner: {
    editablePages: LeagueSettingsPage[];
    canAccessPremium: boolean;
    canDeleteLeague: boolean;
  };
  'co-owner': {
    editablePages: LeagueSettingsPage[];
    canAccessPremium: boolean;
    canDeleteLeague: boolean;
  };
  member: {
    editablePages: LeagueSettingsPage[];
    canAccessPremium: boolean;
    canDeleteLeague: boolean;
  };
  viewer: {
    editablePages: LeagueSettingsPage[];
    canAccessPremium: boolean;
    canDeleteLeague: boolean;
  };
}

// ============================================================
// SERVICE INTERFACES
// ============================================================

export interface ISportLeagueSettingsService {
  /**
   * Get default settings profile for a new league of this sport
   */
  getDefaultSettings(leagueType: LeagueType): UnifiedLeagueSettings;

  /**
   * Validate settings specific to this sport
   */
  validateSettings(settings: UnifiedLeagueSettings): LeagueSettingsValidationResult;

  /**
   * Apply default values for league creation
   */
  applyDefaultOnCreate(sport: SupportedLeagueSport, leagueType: LeagueType): UnifiedLeagueSettings;

  /**
   * Normalize imported league settings
   */
  normalizeImportedSettings(
    importedData: any,
    sourcePlatform: SourcePlatform,
  ): UnifiedLeagueSettings;
}

// ============================================================
// API REQUEST/RESPONSE TYPES
// ============================================================

export interface GetLeagueSettingsResponse {
  leagueId: string;
  settings: UnifiedLeagueSettings;
  canEdit: boolean;
  userRole: UserRole;
  userPermissions: UserPermissions;
  validationWarnings: LeagueSettingsValidationError[];
  subscriptionStatus: {
    isPremium: boolean;
    expiresAt?: Date;
  };
}

export interface ValidateLeagueSettingsRequest {
  settings: Partial<UnifiedLeagueSettings>;
  page: LeagueSettingsPage;
}

export interface ValidateLeagueSettingsResponse {
  validation: LeagueSettingsValidationResult;
  canSave: boolean;
}

export interface ResetLeagueSettingsRequest {
  resetTo: 'default' | 'created-state';
  confirmationToken?: string;
}

export interface ResetLeagueSettingsResponse {
  success: boolean;
  settings: UnifiedLeagueSettings;
  audit: LeagueSettingsAudit;
}

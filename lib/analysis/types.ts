export type AnalysisRecordKind = 'message' | 'test' | 'match';
export type AnalysisRole = 'user' | 'assistant' | 'system';

export type AnalysisFilters = {
  from?: string;
  to?: string;
  sourceIds?: string[];
  kinds?: AnalysisRecordKind[];
  roles?: AnalysisRole[];
  contactId?: string;
  includeLinkedContacts?: boolean;
  province?: string;
  gender?: string;
  ageFrom?: number;
  ageTo?: number;
  testKey?: string;
  includeExcluded?: boolean;
  scoreKey?: string;
  scoreFrom?: number;
  scoreTo?: number;
};

export type AnalysisSource = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  platform: string;
  status: string;
};

export type AnalysisConfiguration = {
  serviceConfigured?: boolean;
  modelConfigured: boolean;
  embeddingConfigured: boolean;
  model?: string;
  embeddingModel?: string;
};

export type AnalysisCoverage = {
  eligible: number;
  processed: number;
  pending: number;
  failed: number;
};

export type AnalysisCatalog = {
  sources: AnalysisSource[];
  configuration: AnalysisConfiguration;
  access: { canManage: boolean; canOwner: boolean };
  sync: {
    lastSyncedAt?: string;
    snapshotId?: string;
    changeSequence?: number;
    pendingChanges?: number;
  };
  notice?: string;
};

export type AnalysisOverview = {
  dataset: { snapshotId: string; generation: string; syncedAt: string } | null;
  configuration: AnalysisConfiguration;
  totals: {
    records: number;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    conversations: number;
    contacts: number;
    verifiedIdentities?: number;
    linkedContacts?: number;
    tests: number;
    matches: number;
  };
  sources: AnalysisSource[];
  coverage: AnalysisCoverage;
  notice?: string;
};

export type AnalysisWord = {
  term: string;
  occurrences: number;
  messages: number;
  conversations: number;
  evidenceIds?: string[];
};

export type AnalysisWords = {
  items: AnalysisWord[];
  totalRecords: number;
  metric: string;
  lexiconVersion?: string;
  range: { from: string | null; to: string | null };
};

export type AnalysisEvidence = {
  id: string;
  quote: string;
  sourceId: string;
  recordId: string;
  kind: AnalysisRecordKind;
  occurredAt: string | number | null;
  href?: string;
};

export type AnalysisLabel = {
  label: string;
  count: number;
  share: number;
  evidenceIds: string[];
};

export type AnalysisExperience = {
  id: string;
  title: string;
  summary: string;
  attribution: string;
  reason: string;
  evidenceIds: string[];
};

export type AnalysisRunKind =
  | 'challenges'
  | 'emotions'
  | 'experiences'
  | 'research'
  | 'content';
export type AnalysisRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AnalysisGuideReference = {
  testKey: string;
  version: string;
  source: string | { title?: string; reference?: string; url?: string };
  sha256: string;
};

export type AnalysisRunResult = {
  guideReferences?: AnalysisGuideReference[];
  answer: string;
  labels: AnalysisLabel[];
  items: AnalysisExperience[];
  evidence: AnalysisEvidence[];
  coverage: AnalysisCoverage;
  notice?: string;
  unit?: 'conversation' | 'record';
  totalAnalyzedUnits?: number;
  totalFound?: number;
  calculations?: unknown[];
  trends?: { day: string; label: string; count: number; share: number }[];
};

export type AnalysisRun = {
  guideReferences?: AnalysisGuideReference[];
  id: string;
  kind: AnalysisRunKind;
  status: AnalysisRunStatus;
  progress: number;
  processed: number;
  eligible: number;
  error: { code: string; message: string } | null;
  result: AnalysisRunResult | null;
  resultSetId?: string;
  stale: boolean;
  createdAt?: string;
  sessionId?: string;
  filters?: AnalysisFilters;
};

export type AnalysisResultPage = {
  items: AnalysisExperience[];
  nextCursor: string | null;
  total: number;
};

export type AnalysisSession = {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
};
export type AnalysisMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  createdAt?: string;
};
export type AnalysisSessionDetail = AnalysisSession & {
  messages: AnalysisMessage[];
};

export type AnalysisSyncResponse = {
  snapshotId: string;
  cursor: number;
  nextCursor: number | null;
  complete: boolean;
  processed: number;
  total: number;
  syncedAt?: string;
};

export type AnalysisContentFormat =
  | 'article'
  | 'story'
  | 'instagram'
  | 'podcast'
  | 'ideas';

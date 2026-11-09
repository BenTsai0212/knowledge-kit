// 每個物件型別的鍵清單，供 schema-sync.test.ts 與 JSON Schema 比對。
// satisfies KeyManifest<T>：型別多一個或少一個鍵、必填與否標錯時，npm run typecheck 會失敗。
import type {
  AliasRules,
  AccessFile,
  ClientFile,
  ConflictsFile,
  EntityTypeFile,
  EvalThresholdsFile,
  EvalsFile,
  KnowledgeModelFile,
  PathRef,
  Project,
  Question,
  RelationType,
  RetrievalFile,
  UploadFile,
  Role,
  Scenario,
  ScenariosFile,
  ThemeColors,
  ThemeFile,
  ThemeFonts,
  ThemeRadius,
  UiStrings,
  VisibilityLevel,
} from "./types";

export type KeyManifest<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? "optional" : "required";
};

export interface ManifestEntry {
  schema: string;
  // Schema 中該物件的 JSON Pointer
  pointer: string;
  keys: Record<string, "required" | "optional">;
}

const pathRef = { path: "required" } satisfies KeyManifest<PathRef>;
const localizedLabel = { id: "required", label: "required" } satisfies KeyManifest<Project>;

export const manifests: ManifestEntry[] = [
  {
    schema: "client.schema.json",
    pointer: "",
    keys: {
      displayName: "required",
      defaultLanguage: "required",
      languages: "required",
      model: "required",
      dataset: "required",
      evals: "required",
      retrieval: "optional",
      upload: "optional",
      conflicts: "optional",
    } satisfies KeyManifest<ClientFile>,
  },
  { schema: "client.schema.json", pointer: "/properties/dataset", keys: pathRef },
  { schema: "client.schema.json", pointer: "/properties/evals", keys: { path: "required", thresholds: "optional" } satisfies KeyManifest<EvalsFile> },
  {
    schema: "client.schema.json",
    pointer: "/properties/evals/properties/thresholds",
    keys: { citation: "optional", answer: "optional", refusal: "optional" } satisfies KeyManifest<EvalThresholdsFile>,
  },
  {
    schema: "client.schema.json",
    pointer: "/properties/retrieval",
    keys: { provider: "optional", topK: "optional", minScore: "optional" } satisfies KeyManifest<RetrievalFile>,
  },
  {
    schema: "client.schema.json",
    pointer: "/properties/upload",
    keys: { passageMaxChars: "optional", extractMaxBatches: "optional" } satisfies KeyManifest<UploadFile>,
  },
  {
    schema: "client.schema.json",
    pointer: "/properties/conflicts",
    keys: { enabled: "optional", candidatesPerPassage: "optional", minScore: "optional" } satisfies KeyManifest<ConflictsFile>,
  },
  {
    schema: "theme.schema.json",
    pointer: "",
    keys: { colors: "required", darkColors: "required", radius: "required", fonts: "required" } satisfies KeyManifest<ThemeFile>,
  },
  {
    schema: "theme.schema.json",
    pointer: "/properties/colors",
    keys: {
      primary: "required",
      onPrimary: "required",
      background: "required",
      surface: "required",
      text: "required",
      textMuted: "required",
      border: "required",
      danger: "required",
      warning: "required",
      success: "required",
      info: "required",
      onStatus: "required",
      mark: "required",
      overlay: "required",
      graphFallback: "required",
    } satisfies KeyManifest<ThemeColors>,
  },
  {
    schema: "theme.schema.json",
    pointer: "/properties/radius",
    keys: { small: "required", medium: "required", large: "required", pill: "required" } satisfies KeyManifest<ThemeRadius>,
  },
  {
    schema: "theme.schema.json",
    pointer: "/properties/fonts",
    keys: { body: "required", heading: "required" } satisfies KeyManifest<ThemeFonts>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "",
    keys: { entityTypes: "required", relationTypes: "required" } satisfies KeyManifest<KnowledgeModelFile>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/entityTypes/items",
    keys: {
      id: "required",
      label: "required",
      color: "required",
      aliasRules: "required",
      mergeStrategy: "optional",
    } satisfies KeyManifest<EntityTypeFile>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/entityTypes/items/properties/aliasRules",
    keys: {
      ignoreCase: "required",
      normalizeWidth: "required",
      ignoreWhitespace: "required",
    } satisfies KeyManifest<AliasRules>,
  },
  {
    schema: "knowledge-model.schema.json",
    pointer: "/properties/relationTypes/items",
    keys: { id: "required", label: "required", from: "required", to: "required" } satisfies KeyManifest<RelationType>,
  },
  {
    schema: "access.schema.json",
    pointer: "",
    keys: { visibilityLevels: "required", projects: "required", roles: "required" } satisfies KeyManifest<AccessFile>,
  },
  {
    schema: "access.schema.json",
    pointer: "/properties/visibilityLevels/items",
    keys: { id: "required", label: "required", rank: "required", color: "required" } satisfies KeyManifest<VisibilityLevel>,
  },
  { schema: "access.schema.json", pointer: "/properties/projects/items", keys: localizedLabel },
  {
    schema: "access.schema.json",
    pointer: "/properties/roles/items",
    keys: { id: "required", label: "required", visibility: "required", projects: "required", canUpload: "required", canReview: "required" } satisfies KeyManifest<Role>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "",
    keys: { scenarios: "required" } satisfies KeyManifest<ScenariosFile>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "/properties/scenarios/items",
    keys: {
      id: "required",
      title: "required",
      description: "optional",
      role: "required",
      questions: "required",
    } satisfies KeyManifest<Scenario>,
  },
  {
    schema: "scenarios.schema.json",
    pointer: "/properties/scenarios/items/properties/questions/items",
    keys: { id: "required", text: "required", answerPassages: "required" } satisfies KeyManifest<Question>,
  },
];

// client/i18n/<語言>.json：鍵很多，每行列多個
const uiStrings = {
  loading: "required", loadFailed: "required",
  modelLoadingTitle: "required", modelDownloadingTitle: "required", modelDownloadProgress: "required", modelPreparing: "required",
  retrievalFallbackTitle: "required", retrievalFallback: "required",
  fictionalData: "required", demoPermissions: "required",
  identity: "required", language: "required", accessCodeTitle: "required", accessCodeLabel: "required",
  accessCodeHint: "required", demoAccessCodeHint: "required", demoQaNotice: "required",
  demoUploadNotice: "required", accessCodeSubmit: "required", changeAccessCode: "required",
  presetQuestions: "required", scenarioRole: "required", questionLabel: "required",
  questionPlaceholder: "required", askButton: "required", answering: "required", emptyAnswer: "required",
  openSource: "required", sourceTitle: "required", closeSource: "required", views: "required", tabQa: "required",
  tabGraph: "required", legend: "required", graphEmpty: "required", selectEntity: "required",
  relatedEntities: "required", entitySources: "required", tabTimeline: "required", pathTitle: "required",
  pathFrom: "required", pathTo: "required", pathChoose: "required", pathNotFound: "required",
  timelineFilter: "required", timelineAll: "required", timelineEmpty: "required", undated: "required",
  tabUpload: "required", uploadNotAllowed: "required", uploadEphemeral: "required", uploadFile: "required",
  uploadPaste: "required", uploadPastePlaceholder: "required", uploadDocTitle: "required",
  uploadLanguage: "required", uploadVisibility: "required", uploadProject: "required",
  uploadNoProject: "required", uploadDate: "required", uploadPreview: "required", uploadParsing: "required",
  uploadPassageCount: "required", uploadSubmit: "required", uploadDone: "required", uploadGotoQa: "required",
  uploadGotoTimeline: "required", uploadErrors: "required", uploadDrop: "required", uploadClearFile: "required",
  uploadAudience: "required", listSeparator: "required", uploadConfirmTitle: "required", uploadBack: "required",
  uploadShowAll: "required", uploadWriting: "required", uploadAnother: "required", timelineUploaded: "required",
  extractTitle: "required", extractRunning: "required", extractDone: "required", extractEntities: "required",
  extractRelations: "required", extractDropped: "required", extractSkipped: "required",
  extractFailed: "required", extractNotRun: "required", extractRetry: "required", extractErrors: "required",
  tabReview: "required", reviewPendingTab: "required", reviewRejectedTab: "required", reviewEmpty: "required",
  reviewRejectedEmpty: "required", reviewExtracting: "required", reviewRefresh: "required",
  reviewEntities: "required", reviewRelations: "required", reviewSelectAll: "required",
  reviewApproveSelected: "required", reviewApproveDocument: "required", reviewApprove: "required",
  reviewReject: "required", reviewWorking: "required", reviewNeedsChoice: "required", reviewChoose: "required",
  reviewCreateNew: "required", reviewMergeInto: "required", reviewMergeHint: "required",
  reviewApprovedCount: "required", reviewRejectedWithEntity: "required", reviewRelationBlocked: "required",
  reviewNamesRequired: "required", reviewSkippedNames: "required", noticeParseTitle: "required",
  noticeWriteTitle: "required", noticeReviewTitle: "required", uploadChooseAgain: "required",
  dialogClose: "required", reviewStatusTabs: "required", reviewEditNames: "required", reviewEditDone: "required",
  reviewExpand: "required", reviewCollapse: "required", reviewToastApprovedOne: "required",
  reviewToastApproved: "required", reviewToastRejectedOne: "required", reviewToastRejected: "required",
  reviewGotoGraph: "required", reviewErrors: "required", reviewDecidedTab: "required",
  reviewDecidedEmpty: "required", conflictSection: "required", conflictNew: "required", conflictOld: "required",
  conflictDecisions: "required", conflictToast: "required", conflictMarks: "required", conflictTitle: "required",
  conflictWaiting: "required", conflictRunning: "required", conflictFound: "required",
  conflictDropped: "required", conflictUnchecked: "required", conflictUnrelated: "required",
  conflictFailed: "required", conflictRetry: "required",
  tabEvals: "required", evalSettings: "required", evalSetName: "required", evalTopK: "required",
  evalMinScore: "required", evalUseSetB: "required", evalModelGrading: "required", evalInvalidSettings: "required",
  evalUploaded: "required", evalStart: "required", evalPreparing: "required", evalStop: "required",
  evalRunning: "required", evalProgress: "required", evalDone: "required", evalStopped: "required",
  evalAborted: "required", evalConfirmTitle: "required", evalConfirmCalls: "required", evalConfirmLimit: "required",
  evalConfirmStart: "required", evalCancel: "required", evalDownload: "required", evalSummary: "required",
  evalMetric: "required", evalThreshold: "required", evalSettingsValue: "required", evalAtLeast: "required",
  evalAtMost: "required", evalRate: "required", evalLeakCount: "required", evalUngradable: "required",
  evalPass: "required", evalFail: "required", evalIncomplete: "required", evalNotApplicable: "required",
  evalResults: "required", evalOnlyDiff: "required", evalDiffers: "required", evalQuestion: "required",
  evalNotRun: "required", evalRequiresSemantic: "required", evalPassageLanguage: "required", evalAnswerText: "required", evalCitations: "required", evalNoCitations: "required",
  evalDropped: "required", evalKeyPoints: "required", evalGrade: "required", evalMetrics: "required",
  evalCategories: "required", evalExpect: "required", evalVerdicts: "required", evalLeaks: "required",
  colon: "required", progress: "required",
  parenthetical: "required", refusal: "required", uncited: "required", incomplete: "required",
  errors: "required", unknownError: "required",
} satisfies KeyManifest<UiStrings>;

export const i18nManifests: ManifestEntry[] = [
  { schema: "i18n.schema.json", pointer: "", keys: uiStrings },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/uploadErrors",
    keys: {
      unsupported: "required", too_large: "required", too_long: "required", empty: "required", no_text: "required",
      failed: "required", denied: "required", invalid: "required", no_input: "required",
    } satisfies KeyManifest<UiStrings["uploadErrors"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/retrievalFallback",
    keys: { download: "required", integrity: "required", init: "required" } satisfies KeyManifest<UiStrings["retrievalFallback"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/extractErrors",
    keys: {
      format: "required", truncated: "required", write: "required", no_access_code: "required",
    } satisfies KeyManifest<UiStrings["extractErrors"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/reviewErrors",
    keys: {
      denied: "required", conflict: "required",
    } satisfies KeyManifest<UiStrings["reviewErrors"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/conflictDecisions",
    keys: {
      coexist: "required", supersede: "required", not_conflict: "required",
    } satisfies KeyManifest<UiStrings["conflictDecisions"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/conflictMarks",
    keys: {
      conflict: "required", superseded_by: "required", supersedes: "required",
    } satisfies KeyManifest<UiStrings["conflictMarks"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/evalMetrics",
    keys: {
      citation: "required", answer: "required", leakage: "required", refusal: "required",
    } satisfies KeyManifest<UiStrings["evalMetrics"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/evalCategories",
    keys: {
      scenario: "required", permission: "required", "out-of-scope": "required", conflict: "required", "extraction-attempt": "required",
      "cross-language": "required", synonym: "required", unrelated: "required",
    } satisfies KeyManifest<UiStrings["evalCategories"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/evalExpect",
    keys: {
      answer: "required", refusal: "required",
    } satisfies KeyManifest<UiStrings["evalExpect"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/evalVerdicts",
    keys: {
      correct: "required", incorrect: "required", ungradable: "required",
    } satisfies KeyManifest<UiStrings["evalVerdicts"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/evalLeaks",
    keys: {
      retrieved: "required", sentPassage: "required", sentDocument: "required", cited: "required", forbidden: "required",
    } satisfies KeyManifest<UiStrings["evalLeaks"]>,
  },
  {
    schema: "i18n.schema.json",
    pointer: "/properties/errors",
    keys: {
      forbidden_origin: "required", invalid_access_code: "required", daily_limit: "required",
      global_daily_limit: "required", invalid_request: "required", unknown_model: "required", prompt_too_long: "required",
      limit_unavailable: "required", misconfigured: "required", method_not_allowed: "required",
      upstream_quota: "required", upstream_overloaded: "required", upstream_timeout: "required",
      upstream_error: "required", upstream_refusal: "required", upstream_interrupted: "required",
      network: "required", unexpected_response: "required", empty_question: "required",
      question_too_long: "required",
    } satisfies KeyManifest<UiStrings["errors"]>,
  },
];

// client/*.json 的型別。JSON Schema（client/schema/）是唯一正本；改 Schema 時同步修改本檔與 keys.ts。

import type { ErrorType } from "../../../worker/src/errors";
import type { PassageMarkKind } from "../conflicts/marks";
import type { ConflictDecision } from "../conflicts/store";
import type { Leak, ModelGrade } from "../evals/score";
import type { EvalCategory, EvalExpect } from "../evals/types";
import type { FallbackReason } from "../retrieval/providers";
import type { ParseFailure } from "../upload/parse";

export type LanguageCode = string;
export type LocalizedText = Record<LanguageCode, string>;
export type Id = string;
export type ModelCode = string;
export type RelativePath = string;

// 檔案中的原始形狀

export interface PathRef {
  path: RelativePath;
}

// app/src/retrieval/providers.ts 的 PROVIDERS 鍵
export type ProviderId = "keyword-hash" | "multilingual-e5-small";

export interface RetrievalFile {
  provider?: ProviderId;
  topK?: number;
  minScore?: number;
}

export interface UploadFile {
  passageMaxChars?: number;
  extractMaxBatches?: number;
}

export interface ConflictsFile {
  enabled?: boolean;
  candidatesPerPassage?: number;
  minScore?: number;
}

// 評測台的門檻（docs/evals.md「指標」）：比例的下限；權限滲漏固定是 0 題（score.ts 的 LEAKAGE_LIMIT），不能設定
export interface EvalThresholdsFile {
  citation?: number;
  answer?: number;
  refusal?: number;
}

export interface EvalsFile extends PathRef {
  thresholds?: EvalThresholdsFile;
}

export interface ClientFile {
  displayName: LocalizedText;
  defaultLanguage: LanguageCode;
  languages: LanguageCode[];
  model: ModelCode;
  dataset: PathRef;
  evals: EvalsFile;
  retrieval?: RetrievalFile;
  upload?: UploadFile;
  conflicts?: ConflictsFile;
}

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  // 狀態的文字、邊框與圖示底色
  danger: string;
  warning: string;
  success: string;
  info: string;
  // 放在實心狀態色上的文字
  onStatus: string;
  // <mark> 的底色
  mark: string;
  // 確認視窗的遮罩與陰影（#RRGGBBAA）
  overlay: string;
  // 圖譜與標籤找不到類型或等級時的顏色
  graphFallback: string;
}

export interface ThemeRadius {
  small: string;
  medium: string;
  large: string;
  pill: string;
}

export interface ThemeFonts {
  body: string;
  heading: string;
}

export interface ThemeFile {
  colors: ThemeColors;
  // 深色模式（prefers-color-scheme: dark）的色票
  darkColors: ThemeColors;
  radius: ThemeRadius;
  fonts: ThemeFonts;
}

export interface AliasRules {
  ignoreCase: boolean;
  normalizeWidth: boolean;
  ignoreWhitespace: boolean;
}

export type MergeStrategy = "review" | "auto";

export interface EntityTypeFile {
  id: Id;
  label: LocalizedText;
  // 圖譜中節點的顏色（#RRGGBB）
  color: string;
  aliasRules: AliasRules;
  mergeStrategy?: MergeStrategy;
}

export interface RelationType {
  id: Id;
  label: LocalizedText;
  from: Id[];
  to: Id[];
}

export interface KnowledgeModelFile {
  entityTypes: EntityTypeFile[];
  relationTypes: RelationType[];
}

export interface VisibilityLevel {
  id: Id;
  label: LocalizedText;
  rank: number;
  // 畫面上可見等級標籤的顏色（#RRGGBB）
  color: string;
}

export interface Project {
  id: Id;
  label: LocalizedText;
}

export interface Role {
  id: Id;
  label: LocalizedText;
  visibility: Id;
  projects: Id[];
  // 能否上傳文件；可上傳的等級與專案同樣限於看得到的範圍
  canUpload: boolean;
  // 能否核准或退回萃取結果；只能審核看得到的文件
  canReview: boolean;
}

export interface AccessFile {
  visibilityLevels: VisibilityLevel[];
  projects: Project[];
  roles: Role[];
}

export interface Question {
  id: Id;
  text: LocalizedText;
  answerPassages: Id[];
}

export interface Scenario {
  id: Id;
  title: LocalizedText;
  description?: LocalizedText;
  role: Id;
  questions: Question[];
}

export interface ScenariosFile {
  scenarios: Scenario[];
}

export interface ClientFiles {
  client: ClientFile;
  theme: ThemeFile;
  knowledgeModel: KnowledgeModelFile;
  access: AccessFile;
  scenarios: ScenariosFile;
}

// app 讀取端拿到的形狀：省略的欄位已補上預設值

export interface EntityType extends Omit<EntityTypeFile, "mergeStrategy"> {
  mergeStrategy: MergeStrategy;
}

export type RetrievalConfig = Required<RetrievalFile>;
export type UploadConfig = Required<UploadFile>;
export type ConflictsConfig = Required<ConflictsFile>;
export type EvalThresholds = Required<EvalThresholdsFile>;

export interface ClientConfig extends Omit<ClientFiles, "client" | "knowledgeModel"> {
  client: Omit<ClientFile, "evals" | "retrieval" | "upload" | "conflicts"> & {
    evals: PathRef & { thresholds: EvalThresholds };
    retrieval: RetrievalConfig;
    upload: UploadConfig;
    conflicts: ConflictsConfig;
  };
  knowledgeModel: {
    entityTypes: EntityType[];
    relationTypes: RelationType[];
  };
}

// 介面文字的鍵：錯誤與失敗原因的類型（翻譯檔中錯誤訊息的鍵）

// /api/ask 的錯誤類型（worker/README.md），加上前端自己的錯誤。少了任何一種，型別檢查就會失敗
export type AskErrorType =
  | ErrorType
  // fetch 失敗（離線、連不到伺服器）
  | "network"
  // 不是 SSE，也不是 Worker 的 JSON 錯誤
  | "unexpected_response"
  // ask() 在送出前的檢查
  | "empty_question"
  | "question_too_long";

// 上傳失敗的原因：解析（ParseFailure）、寫入（denied：被 RLS 拒絕；invalid：格式不符）、沒有選檔也沒有貼上文字
export type UploadFailure = ParseFailure | "denied" | "invalid" | "no_input";

// 萃取的失敗原因（run.ts 之外，以及畫面自己的 no_access_code）；/api/ask 的錯誤類型用 errors
export type ExtractFailure = "format" | "truncated" | "write" | "no_access_code";

// client/i18n/<語言>.json（i18n.schema.json）。帶參數的文字以 {camelCase} 標示，由 i18n.ts 的 fill() 代入
export interface UiStrings {
  loading: string;
  loadFailed: string;
  // 語意向量 provider 準備中的提示（問答頁與評測台）：從快取載入或初始化時、下載時與進度（{loaded}、{total} 是 MB），以及兩者共用的說明
  modelLoadingTitle: string;
  modelDownloadingTitle: string;
  modelDownloadProgress: string;
  modelPreparing: string;
  // 語意向量 provider 準備失敗、改用 keyword-hash 時的提示（問答頁與評測台）
  retrievalFallbackTitle: string;
  retrievalFallback: Record<FallbackReason, string>;
  // 標示：資料是虛構的、身分切換只是展示權限
  fictionalData: string;
  demoPermissions: string;
  identity: string;
  language: string;
  accessCodeTitle: string;
  accessCodeLabel: string;
  accessCodeHint: string;
  // 線上 demo（#100）：公開試用碼的說明、問答頁與上傳頁的提醒
  demoAccessCodeHint: string;
  demoQaNotice: string;
  demoUploadNotice: string;
  accessCodeSubmit: string;
  changeAccessCode: string;
  presetQuestions: string;
  // 預設問題旁標示情境的角色；提問一律以目前選的身分（#26 決定 1）
  scenarioRole: string;
  questionLabel: string;
  questionPlaceholder: string;
  askButton: string;
  answering: string;
  emptyAnswer: string;
  // 三欄的問答頁（#195）：輸入框下方的說明（每題獨立回答）、左側導覽「這次的問題」
  qaIndependent: string;
  sessionQuestions: string;
  openSource: string;
  sourceTitle: string;
  closeSource: string;
  views: string;
  tabQa: string;
  tabGraph: string;
  legend: string;
  graphEmpty: string;
  selectEntity: string;
  relatedEntities: string;
  entitySources: string;
  tabTimeline: string;
  pathTitle: string;
  pathFrom: string;
  pathTo: string;
  pathChoose: string;
  // 找不到路徑時的固定文字：不區分沒有連通或看不到（不透露是否因權限而找不到）
  pathNotFound: string;
  timelineFilter: string;
  timelineAll: string;
  timelineEmpty: string;
  undated: string;
  tabUpload: string;
  uploadNotAllowed: string;
  // 上傳內容只存在瀏覽器記憶體
  uploadEphemeral: string;
  uploadFile: string;
  uploadPaste: string;
  uploadPastePlaceholder: string;
  uploadDocTitle: string;
  uploadLanguage: string;
  uploadVisibility: string;
  uploadProject: string;
  uploadNoProject: string;
  uploadDate: string;
  uploadPreview: string;
  uploadParsing: string;
  uploadPassageCount: string;
  uploadSubmit: string;
  uploadDone: string;
  uploadGotoQa: string;
  uploadGotoTimeline: string;
  uploadErrors: Record<UploadFailure, string>;
  uploadDrop: string;
  uploadClearFile: string;
  // 依可見等級與專案算出看得到的角色（#42）
  uploadAudience: string;
  listSeparator: string;
  uploadConfirmTitle: string;
  uploadBack: string;
  uploadShowAll: string;
  uploadWriting: string;
  uploadAnother: string;
  // 時間軸中本次工作階段上傳的文件
  timelineUploaded: string;
  extractTitle: string;
  extractRunning: string;
  extractDone: string;
  extractEntities: string;
  extractRelations: string;
  extractDropped: string;
  extractSkipped: string;
  extractFailed: string;
  // 萃取停止後還沒執行的批次（例如邀請碼被拒），重試時一併送出
  extractNotRun: string;
  extractRetry: string;
  extractErrors: Record<ExtractFailure, string>;
  tabReview: string;
  reviewPendingTab: string;
  reviewRejectedTab: string;
  reviewEmpty: string;
  reviewRejectedEmpty: string;
  reviewExtracting: string;
  reviewRefresh: string;
  reviewEntities: string;
  reviewRelations: string;
  reviewApproveDocument: string;
  reviewApprove: string;
  reviewReject: string;
  reviewWorking: string;
  reviewNeedsChoice: string;
  reviewChoose: string;
  reviewCreateNew: string;
  reviewMergeInto: string;
  reviewMergeHint: string;
  reviewApprovedCount: string;
  reviewRejectedWithEntity: string;
  reviewRelationBlocked: string;
  // 核准前修改的名稱，每種語言都必須有值（#47 審查）
  reviewNamesRequired: string;
  reviewSkippedNames: string;
  // 待審頁的分組（#189）：每份文件的摘要與進度、系統已準備、圖譜已有、新增、確認一組、出處的開關
  reviewSummary: string;
  reviewProgress: string;
  reviewProgressDone: string;
  reviewDecideLeft: string;
  reviewPrepared: string;
  reviewPreparedMergeHint: string;
  reviewSuggested: string;
  reviewExisting: string;
  reviewNew: string;
  reviewConfirm: string;
  // 「確認」一組時一起核准的關係數：{count}（#189 修正要求）
  reviewConfirmWithRelations: string;
  reviewSources: string;
  // 提示框的標題與動作（#48）
  noticeParseTitle: string;
  noticeWriteTitle: string;
  noticeReviewTitle: string;
  uploadChooseAgain: string;
  // 確認視窗右上角 ✕ 的 aria-label
  dialogClose: string;
  // 待審頁第二層（待審／已退回）的 aria-label
  reviewStatusTabs: string;
  // 待審卡片（#48）：編輯名稱、出處段落的展開與收合
  reviewEditNames: string;
  reviewEditDone: string;
  reviewExpand: string;
  reviewCollapse: string;
  // 核准或退回後的短提示：一筆時 {name} 換成項目名稱，多筆時 {count} 換成筆數
  reviewToastApprovedOne: string;
  reviewToastApproved: string;
  reviewToastRejectedOne: string;
  reviewToastRejected: string;
  reviewGotoGraph: string;
  reviewErrors: Record<"denied" | "conflict", string>;
  // 說法不同（#51）：待審頁的並列與處理、已處理分頁、處理後的短提示（{name} 換成處理方式）
  reviewDecidedTab: string;
  reviewDecidedEmpty: string;
  conflictSection: string;
  conflictNew: string;
  conflictOld: string;
  conflictDecisions: Record<ConflictDecision, string>;
  conflictToast: string;
  // 時間軸與原文面板的標示：{title} 換成另一段所屬文件的標題
  conflictMarks: Record<PassageMarkKind, string>;
  // 上傳頁的比對狀態
  conflictTitle: string;
  conflictWaiting: string;
  conflictRunning: string;
  conflictFound: string;
  conflictDropped: string;
  conflictUnchecked: string;
  conflictUnrelated: string;
  conflictFailed: string;
  conflictRetry: string;
  tabEvals: string;
  evalSettings: string;
  evalSetName: string;
  evalTopK: string;
  evalMinScore: string;
  evalUseSetB: string;
  evalModelGrading: string;
  evalInvalidSettings: string;
  evalUploaded: string;
  evalStart: string;
  evalPreparing: string;
  evalStop: string;
  evalRunning: string;
  evalProgress: string;
  evalDone: string;
  evalStopped: string;
  evalAborted: string;
  evalConfirmTitle: string;
  evalConfirmCalls: string;
  evalConfirmLimit: string;
  evalConfirmStart: string;
  evalCancel: string;
  evalDownload: string;
  evalSummary: string;
  evalMetric: string;
  evalThreshold: string;
  evalSettingsValue: string;
  evalAtLeast: string;
  evalAtMost: string;
  evalRate: string;
  evalLeakCount: string;
  evalUngradable: string;
  evalPass: string;
  evalFail: string;
  evalIncomplete: string;
  evalNotApplicable: string;
  evalResults: string;
  evalOnlyDiff: string;
  evalDiffers: string;
  evalQuestion: string;
  evalNotRun: string;
  // requires: "semantic" 的題目在 keyword-hash 時的結果欄
  evalRequiresSemantic: string;
  // 題目的 passageLanguage：{language} 是語言代碼
  evalPassageLanguage: string;
  evalAnswerText: string;
  evalCitations: string;
  evalNoCitations: string;
  evalDropped: string;
  evalKeyPoints: string;
  evalGrade: string;
  evalMetrics: Record<"citation" | "answer" | "leakage" | "refusal", string>;
  evalCategories: Record<EvalCategory, string>;
  evalExpect: Record<EvalExpect, string>;
  evalVerdicts: Record<ModelGrade["verdict"], string>;
  // 滲漏的原因：{id} 是段落或文件 id，{term} 是命中的禁止說法
  evalLeaks: Record<Leak["kind"], string>;
  // 標籤與內容之間的分隔（繁中用全形冒號）
  colon: string;
  // 進度（{done}、{total}）與括號附註（{text}、{note}）：符號依語言而定，不寫死在元件中
  progress: string;
  parenthetical: string;
  // 拒答：「沒有資料」與「沒有權限」相同，不透露是否有看不到的文件
  refusal: string;
  // 拒答下方的「可以試試」（#192）：所有拒答共用，只依能不能上傳決定是否顯示上傳那一項；不提權限
  refusalNextTitle: string;
  refusalNextRephrase: string;
  refusalNextAskPerson: string;
  refusalNextUpload: string;
  refusalGotoUpload: string;
  // 不是拒答、但沒有任何有效引用的回答
  uncited: string;
  // 串流中斷或被截斷，保留已收到的內容
  incomplete: string;
  errors: Record<AskErrorType, string>;
  // 不認得的錯誤類型
  unknownError: string;
}

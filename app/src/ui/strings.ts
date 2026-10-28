// 介面文字：集中在本檔，元件與問答模組不寫死文字（#26 決定 4）。正式的翻譯檔格式在 Epic 第 11 項，屆時移到 client/。
import type { ErrorType } from "../../../worker/src/errors";
import type { LanguageCode } from "../client/types";
import type { ParseFailure } from "../upload/parse";

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

export interface UiStrings {
  loading: string;
  loadFailed: string;
  // 標示：資料是虛構的、身分切換只是展示權限
  fictionalData: string;
  demoPermissions: string;
  identity: string;
  language: string;
  accessCodeTitle: string;
  accessCodeLabel: string;
  accessCodeHint: string;
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
  reviewSelectAll: string;
  reviewApproveSelected: string;
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
  reviewErrors: Record<"denied" | "conflict", string>;
  // 標籤與內容之間的分隔（繁中用全形冒號）
  colon: string;
  // 拒答：「沒有資料」與「沒有權限」相同，不透露是否有看不到的文件
  refusal: string;
  // 不是拒答、但沒有任何有效引用的回答
  uncited: string;
  // 串流中斷或被截斷，保留已收到的內容
  incomplete: string;
  errors: Record<AskErrorType, string>;
  // 不認得的錯誤類型
  unknownError: string;
}

export const STRINGS: Record<LanguageCode, UiStrings> = {
  "zh-TW": {
    loading: "正在載入資料…",
    loadFailed: "資料載入失敗，請重新整理頁面。",
    fictionalData: "虛構資料",
    demoPermissions: "展示用權限",
    identity: "身分",
    language: "語言",
    accessCodeTitle: "輸入邀請碼",
    accessCodeLabel: "邀請碼",
    accessCodeHint: "邀請碼只保存在這個分頁，關閉分頁後就會清除。",
    accessCodeSubmit: "開始使用",
    changeAccessCode: "更換邀請碼",
    presetQuestions: "預設問題",
    scenarioRole: "情境角色",
    questionLabel: "自由提問",
    questionPlaceholder: "輸入問題（500 字以內）",
    askButton: "提問",
    answering: "回答中…",
    emptyAnswer: "選擇預設問題，或輸入問題後提問。",
    openSource: "打開原文",
    sourceTitle: "原文",
    closeSource: "關閉",
    views: "頁面",
    tabQa: "問答",
    tabGraph: "圖譜",
    legend: "圖例",
    graphEmpty: "目前的身分看不到任何實體。",
    selectEntity: "點選節點查看詳細資訊。",
    relatedEntities: "相關實體",
    entitySources: "出處",
    tabTimeline: "時間軸",
    pathTitle: "多跳路徑",
    pathFrom: "起點",
    pathTo: "終點",
    pathChoose: "選擇起點與終點，找出兩個實體之間的最短路徑。",
    pathNotFound: "找不到這兩個實體之間的路徑。",
    timelineFilter: "依實體篩選",
    timelineAll: "全部",
    timelineEmpty: "沒有可顯示的文件。",
    undated: "未註明日期",
    tabUpload: "上傳",
    uploadNotAllowed: "目前的身分沒有上傳文件的權限。",
    uploadEphemeral: "上傳內容只保留到重新整理頁面為止。",
    uploadFile: "選擇檔案（.txt、.md、.pdf、.docx）",
    uploadPaste: "或直接貼上文字",
    uploadPastePlaceholder: "貼上要上傳的文字",
    uploadDocTitle: "標題",
    uploadLanguage: "語言",
    uploadVisibility: "可見等級",
    uploadProject: "專案",
    uploadNoProject: "無",
    uploadDate: "日期（選填）",
    uploadPreview: "預覽",
    uploadParsing: "正在讀取文件…",
    uploadPassageCount: "段落數",
    uploadSubmit: "上傳",
    uploadDone: "上傳完成，現在可以在問答與時間軸中查到這份文件。",
    uploadGotoQa: "到問答",
    uploadGotoTimeline: "到時間軸",
    uploadErrors: {
      unsupported: "不支援這種檔案格式，請上傳 .txt、.md、.pdf 或 .docx。",
      too_large: "檔案超過 10 MB，請縮小後再上傳。",
      too_long: "文件太長（超過 50,000 字或 500 段），請拆成多份上傳。",
      empty: "文件中沒有文字。",
      no_text: "這份 PDF 沒有可擷取的文字（可能是掃描檔），目前不支援文字辨識。",
      failed: "無法讀取這份檔案，檔案可能已損毀。",
      denied: "目前的身分不能上傳這個可見等級或專案的文件。",
      invalid: "請填寫標題，並確認日期格式正確。",
      no_input: "請選擇檔案或貼上文字。",
    },
    uploadDrop: "或把檔案拖放到這裡",
    uploadClearFile: "清除檔案",
    uploadAudience: "誰看得到",
    listSeparator: "、",
    uploadConfirmTitle: "確認上傳",
    uploadBack: "返回修改",
    uploadShowAll: "顯示全部段落",
    uploadWriting: "上傳中…",
    uploadAnother: "再上傳一份",
    timelineUploaded: "上傳",
    extractTitle: "萃取實體與關係",
    extractRunning: "萃取中",
    extractDone: "已送審",
    extractEntities: "實體",
    extractRelations: "關係",
    extractDropped: "捨棄",
    extractSkipped: "超過批數上限，未萃取的段落數",
    extractFailed: "部分批次失敗",
    extractNotRun: "未執行，可重試的批次",
    extractRetry: "重試萃取",
    extractErrors: {
      format: "模型輸出的格式不符。",
      truncated: "模型的回應太長而被截斷。",
      write: "寫入待審時被拒絕。",
      no_access_code: "需要邀請碼才能萃取。請到問答頁輸入邀請碼後重試。",
    },
    tabReview: "待審",
    reviewPendingTab: "待審",
    reviewRejectedTab: "已退回",
    reviewEmpty: "沒有待審的項目。",
    reviewRejectedEmpty: "沒有已退回的項目。",
    reviewExtracting: "還有文件在萃取中，完成後請重新整理清單。",
    reviewRefresh: "重新整理",
    reviewEntities: "實體",
    reviewRelations: "關係",
    reviewSelectAll: "全選",
    reviewApproveSelected: "核准選取的項目",
    reviewApproveDocument: "核准這份文件的全部",
    reviewApprove: "核准",
    reviewReject: "退回",
    reviewWorking: "處理中…",
    reviewNeedsChoice: "需逐筆決定：請選擇合併對象或建立新實體",
    reviewChoose: "請選擇",
    reviewCreateNew: "建立新實體",
    reviewMergeInto: "合併到",
    reviewMergeHint: "合併後，看得到這份文件的人也會看到此實體。",
    reviewApprovedCount: "已核准",
    reviewRejectedWithEntity: "因實體退回",
    reviewRelationBlocked: "兩端的實體核准後才能核准",
    reviewNamesRequired: "請填寫所有語言的名稱",
    reviewSkippedNames: "名稱未填寫完整而略過的項目",
    reviewErrors: {
      denied: "沒有權限處理這個項目。",
      conflict: "這個項目已經被處理過，請重新整理。",
    },
    colon: "：",
    refusal: "找不到可以回答這個問題的資料。",
    uncited: "未附出處",
    incomplete: "回答不完整",
    errors: {
      forbidden_origin: "這個網址無法使用問答功能。",
      invalid_access_code: "邀請碼不正確，請重新輸入。",
      daily_limit: "今天的提問次數已用完，請明天再試。",
      invalid_request: "送出的內容格式有誤，請重新整理頁面後再試。",
      unknown_model: "模型設定有誤，請聯絡管理者。",
      prompt_too_long: "問題與參考資料太長，請縮短問題後再試。",
      limit_unavailable: "暫時無法確認提問次數，請稍後再試。",
      misconfigured: "服務設定有誤，請聯絡管理者。",
      method_not_allowed: "送出的方式有誤，請重新整理頁面後再試。",
      upstream_quota: "模型服務的額度已用完，請聯絡管理者。",
      upstream_overloaded: "模型服務目前忙碌中，請稍後再試。",
      upstream_timeout: "模型服務回應逾時，請稍後再試。",
      upstream_error: "模型服務發生錯誤，請稍後再試。",
      upstream_refusal: "模型無法回答這個問題。",
      upstream_interrupted: "回答在傳送途中中斷，請再試一次。",
      network: "無法連線到伺服器，請確認網路後再試。",
      unexpected_response: "伺服器的回應無法辨識，請稍後再試。",
      empty_question: "請輸入問題。",
      question_too_long: "問題太長，請縮短後再試。",
    },
    unknownError: "發生未預期的錯誤，請稍後再試。",
  },
  en: {
    loading: "Loading data…",
    loadFailed: "The data couldn't be loaded. Please reload the page.",
    fictionalData: "Fictional data",
    demoPermissions: "Demo permissions",
    identity: "Identity",
    language: "Language",
    accessCodeTitle: "Enter your access code",
    accessCodeLabel: "Access code",
    accessCodeHint: "The access code is kept only in this tab and is cleared when you close it.",
    accessCodeSubmit: "Start",
    changeAccessCode: "Change access code",
    presetQuestions: "Sample questions",
    scenarioRole: "Scenario role",
    questionLabel: "Your question",
    questionPlaceholder: "Type a question (up to 500 characters)",
    askButton: "Ask",
    answering: "Answering…",
    emptyAnswer: "Choose a sample question, or type your own and ask.",
    openSource: "Open source",
    sourceTitle: "Source",
    closeSource: "Close",
    views: "Views",
    tabQa: "Q&A",
    tabGraph: "Graph",
    legend: "Legend",
    graphEmpty: "No entities are visible to the current identity.",
    selectEntity: "Select a node to see its details.",
    relatedEntities: "Related entities",
    entitySources: "Sources",
    tabTimeline: "Timeline",
    pathTitle: "Multi-hop path",
    pathFrom: "From",
    pathTo: "To",
    pathChoose: "Choose two entities to find the shortest path between them.",
    pathNotFound: "No path was found between these two entities.",
    timelineFilter: "Filter by entity",
    timelineAll: "All",
    timelineEmpty: "No documents to show.",
    undated: "Undated",
    tabUpload: "Upload",
    uploadNotAllowed: "The current identity can't upload documents.",
    uploadEphemeral: "Uploaded content is kept only until you reload the page.",
    uploadFile: "Choose a file (.txt, .md, .pdf, .docx)",
    uploadPaste: "Or paste text",
    uploadPastePlaceholder: "Paste the text to upload",
    uploadDocTitle: "Title",
    uploadLanguage: "Language",
    uploadVisibility: "Visibility",
    uploadProject: "Project",
    uploadNoProject: "None",
    uploadDate: "Date (optional)",
    uploadPreview: "Preview",
    uploadParsing: "Reading the document…",
    uploadPassageCount: "Passages",
    uploadSubmit: "Upload",
    uploadDone: "Uploaded. You can now find this document in Q&A and the timeline.",
    uploadGotoQa: "Go to Q&A",
    uploadGotoTimeline: "Go to timeline",
    uploadErrors: {
      unsupported: "This file type isn't supported. Please upload a .txt, .md, .pdf, or .docx file.",
      too_large: "The file is larger than 10 MB. Please make it smaller and try again.",
      too_long: "The document is too long (over 50,000 characters or 500 passages). Please split it into several uploads.",
      empty: "The document has no text.",
      no_text: "This PDF has no extractable text (it may be a scan). Text recognition isn't supported.",
      failed: "The file couldn't be read. It may be damaged.",
      denied: "The current identity can't upload documents with this visibility or project.",
      invalid: "Please enter a title and check that the date is valid.",
      no_input: "Please choose a file or paste some text.",
    },
    uploadDrop: "Or drop a file here",
    uploadClearFile: "Clear file",
    uploadAudience: "Visible to",
    listSeparator: ", ",
    uploadConfirmTitle: "Confirm upload",
    uploadBack: "Back to edit",
    uploadShowAll: "Show all passages",
    uploadWriting: "Uploading…",
    uploadAnother: "Upload another",
    timelineUploaded: "Uploaded",
    extractTitle: "Entity and relation extraction",
    extractRunning: "Extracting",
    extractDone: "Sent for review",
    extractEntities: "Entities",
    extractRelations: "Relations",
    extractDropped: "Discarded",
    extractSkipped: "Passages not extracted (over the batch limit)",
    extractFailed: "Some batches failed",
    extractNotRun: "Batches not run yet (retry to run them)",
    extractRetry: "Retry extraction",
    extractErrors: {
      format: "The model's output wasn't in the expected format.",
      truncated: "The model's response was too long and was cut off.",
      write: "Saving the results for review was refused.",
      no_access_code: "An access code is needed to extract. Enter it on the Q&A page, then retry.",
    },
    tabReview: "Review",
    reviewPendingTab: "Pending",
    reviewRejectedTab: "Rejected",
    reviewEmpty: "Nothing is waiting for review.",
    reviewRejectedEmpty: "Nothing has been rejected.",
    reviewExtracting: "Some documents are still being extracted. Refresh the list when they finish.",
    reviewRefresh: "Refresh",
    reviewEntities: "Entities",
    reviewRelations: "Relations",
    reviewSelectAll: "Select all",
    reviewApproveSelected: "Approve selected",
    reviewApproveDocument: "Approve everything in this document",
    reviewApprove: "Approve",
    reviewReject: "Reject",
    reviewWorking: "Working…",
    reviewNeedsChoice: "Decide one by one: choose an entity to merge into, or create a new one",
    reviewChoose: "Choose",
    reviewCreateNew: "Create a new entity",
    reviewMergeInto: "Merge into",
    reviewMergeHint: "After merging, anyone who can see this document can also see this entity.",
    reviewApprovedCount: "Approved",
    reviewRejectedWithEntity: "Rejected with its entity",
    reviewRelationBlocked: "Approve both entities first",
    reviewNamesRequired: "Please fill in the name in every language",
    reviewSkippedNames: "Items skipped because a name is missing",
    reviewErrors: {
      denied: "You don't have permission to handle this item.",
      conflict: "This item has already been handled. Please refresh.",
    },
    colon: ": ",
    refusal: "I couldn't find information to answer this question.",
    uncited: "No sources cited",
    incomplete: "Incomplete answer",
    errors: {
      forbidden_origin: "Questions can't be asked from this address.",
      invalid_access_code: "The access code is incorrect. Please enter it again.",
      daily_limit: "You've reached today's question limit. Please try again tomorrow.",
      invalid_request: "The request was invalid. Please reload the page and try again.",
      unknown_model: "The model setting is invalid. Please contact the administrator.",
      prompt_too_long: "The question and sources are too long. Please shorten the question and try again.",
      limit_unavailable: "The question limit can't be checked right now. Please try again later.",
      misconfigured: "The service is misconfigured. Please contact the administrator.",
      method_not_allowed: "The request method was invalid. Please reload the page and try again.",
      upstream_quota: "The model service has run out of quota. Please contact the administrator.",
      upstream_overloaded: "The model service is busy. Please try again later.",
      upstream_timeout: "The model service timed out. Please try again later.",
      upstream_error: "The model service returned an error. Please try again later.",
      upstream_refusal: "The model declined to answer this question.",
      upstream_interrupted: "The answer was interrupted. Please try again.",
      network: "Couldn't reach the server. Please check your connection and try again.",
      unexpected_response: "The server's response couldn't be read. Please try again later.",
      empty_question: "Please enter a question.",
      question_too_long: "The question is too long. Please shorten it and try again.",
    },
    unknownError: "Something went wrong. Please try again later.",
  },
};

export function strings(language: LanguageCode): UiStrings {
  if (!Object.hasOwn(STRINGS, language)) throw new Error(`沒有介面文字的語言：${language}`);
  return STRINGS[language];
}

// 錯誤類型 → 使用者看得懂的訊息；不認得的類型用通用訊息
export function errorMessage(language: LanguageCode, error: string): string {
  const s = strings(language);
  return Object.hasOwn(s.errors, error) ? s.errors[error as AskErrorType] : s.unknownError;
}

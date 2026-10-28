// 介面文字：集中在本檔，元件與問答模組不寫死文字（#26 決定 4）。正式的翻譯檔格式在 Epic 第 11 項，屆時移到 client/。
import type { ErrorType } from "../../../worker/src/errors";
import type { LanguageCode } from "../client/types";

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

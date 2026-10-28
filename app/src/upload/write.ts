// 上傳的寫入：一份文件與它的段落在同一個交易中寫入，一律經 withIdentity()。
// 能否寫入完全交給 RLS（docs/data-model.md「寫入規則」）；本模組只檢查格式，不另外判斷權限。
import type { LanguageCode } from "../client/types";
import type { Database } from "../db/database";

export interface UploadInput {
  title: string;
  language: LanguageCode;
  visibility: string;
  // null 表示沒有專案
  project: string | null;
  // YYYY-MM-DD，選填
  date: string | null;
  passages: string[];
}

export interface UploadResult {
  documentId: string;
  passageIds: string[];
}

// 格式錯誤（程式端的檢查）與被 RLS 拒絕，畫面各顯示固定訊息
export class UploadError extends Error {
  constructor(readonly reason: "invalid" | "denied") {
    super(reason === "invalid" ? "上傳的內容格式不符" : "沒有寫入這份文件的權限");
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 文件 id 為 upload- 加上 UUID（43 字元，符合 client 設定的 Id 格式）；段落 id 為「文件 id-序號」
export const newDocumentId = () => `upload-${crypto.randomUUID()}`;

export async function uploadDocument(
  db: Database,
  identityId: string | null,
  input: UploadInput,
  options: { languages: LanguageCode[] },
): Promise<UploadResult> {
  const passages = input.passages.map((p) => p.trim()).filter((p) => p !== "");
  if (
    input.title.trim() === "" ||
    passages.length === 0 ||
    !options.languages.includes(input.language) ||
    (input.date !== null && !DATE.test(input.date))
  ) {
    throw new UploadError("invalid");
  }

  const documentId = newDocumentId();
  const passageIds = passages.map((_, i) => `${documentId}-${i + 1}`);
  try {
    await db.withIdentity(identityId, async (tx) => {
      // uploaded_by 由資料庫取目前身分；RLS 的 WITH CHECK 要求兩者相同
      await tx.query(
        `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, document_date, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, kk.current_identity_id())`,
        [documentId, input.title.trim(), input.language, input.visibility, input.project, input.date],
      );
      for (const [i, content] of passages.entries()) {
        await tx.query(
          `INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [passageIds[i], documentId, i, input.language, content, input.visibility, input.project],
        );
      }
    });
  } catch (e) {
    // 42501：違反 RLS 的 WITH CHECK 或沒有權限；其他錯誤（例如不存在的等級）照樣拋出
    if ((e as { code?: string }).code === "42501") throw new UploadError("denied");
    throw e;
  }
  return { documentId, passageIds };
}

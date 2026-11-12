// 端對端測試共用的操作（#66）。畫面文字一律從選定客戶的 i18n 讀取，測試中不寫死；只用預設語言（client.json 的 defaultLanguage）。
import { expect, type Locator, type Page } from "@playwright/test";
import { access, language, s, scenarios } from "./client";
import { FAKE_ENTITY_NAME, routeFakeAsk } from "./fake-ask";
import { demoAccount } from "../../app/src/ui/sign-in";

export { language, s };

// 邀請碼：假的 /api/ask 不檢查，任意虛構字串即可（只存在 sessionStorage）
export const ACCESS_CODE = "e2e-access-code";

export type RoleId = string;

// 預設問題（scenarios.json）；資料庫載入完成前停用
export const presetQuestions = scenarios.scenarios.flatMap((x) => x.questions.map((q) => ({ role: x.role as RoleId, text: q.text[language] })));

// 擋下語意模型的下載（模型檔的網址見 app/src/retrieval/semantic/model-files.ts）：CI 不下載模型，
// 選用語意向量的客戶降級到 keyword-hash（#175，docs/testing.md「客戶」）；keyword-hash 的客戶不會發出這類請求。須在 page.goto 之前呼叫
export async function blockModelDownload(page: Page): Promise<void> {
  await page.route("https://huggingface.co/**", (route) => route.abort());
}

// 開啟評測台的網址（#192，docs/evals.md「開啟評測台」）：沒有這個參數時，canReview 的身分也看不到評測台
export const EVALS_PATH = "/?tools=evals";

// 展示模式（?mode=presentation）的登入頁只有邀請碼（#287 決定 2）
export const isPresentation = (path: string) => new URL(path, "http://localhost").searchParams.get("mode") === "presentation";

// 打開首頁（path 可帶網址參數，例如展示模式的 /?mode=presentation）、以「使用邀請碼體驗」輸入邀請碼（可以切換身分，#287），
// 等資料庫載入完成（預設問題的按鈕可以按）。帳號登入見 sign-in.spec.ts
export async function openApp(page: Page, path = "/"): Promise<void> {
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.goto(path);
  if (!isPresentation(path)) await page.getByRole("button", { name: s.signInWithCode }).click();
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
}

// 帳號登入（#287）：登入頁的面板與帳號欄的選項（app/src/ui/sign-in.ts 的展示帳號＋角色名稱）
export const signInPanel = (page: Page) => page.locator("section.sign-in");
export function accountOption(id: RoleId): string {
  const role = access.roles.find((r) => r.id === id)!;
  return s.signInAccountOption.replace("{account}", demoAccount(id)).replace("{role}", role.label[language]);
}

// 以左側導覽的身分選單切換身分
export async function switchIdentity(page: Page, id: RoleId): Promise<void> {
  const role = access.roles.find((r) => r.id === id)!;
  await page.getByRole("banner").getByLabel(s.identity).selectOption({ label: role.label[language] });
}

// 以 label 開頭比對的正規表示式
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

// 頁籤的按鈕；待審頁籤的名稱後面接著筆數，所以比對開頭
export function tab(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: s.views }).getByRole("button", { name: startsWith(label) });
}

// 包在 <label> 裡的欄位：無障礙名稱含有欄位目前的值（例如下拉選單選中的項目），所以以 label 文字的開頭找
const field = (page: Page, label: string, tag: "input" | "select") => page.locator("label").filter({ hasText: startsWith(label) }).locator(tag);

// 切換頁籤
export async function openTab(page: Page, label: string): Promise<void> {
  await tab(page, label).click();
}

export const sourcePanel = (page: Page) => page.getByRole("complementary", { name: s.sourceTitle });

// 以目前的身分上傳 fixtures 的檔案（預設 upload-note.md），等萃取的實體出現在待審（目前的身分要能上傳也能審查）。
// title：文件標題（沒有時用檔名）；visibility：可見等級的 id（沒有時用上傳頁的預設）；expected：待審頁中要出現的實體名稱
export async function uploadAndReview(
  page: Page,
  options: { file?: string; title?: string; visibility?: string; expected?: string } = {},
): Promise<void> {
  const { file = "upload-note.md", title, visibility, expected = FAKE_ENTITY_NAME } = options;
  await openTab(page, s.tabUpload);
  await page.getByLabel(s.uploadFile).setInputFiles(`e2e/fixtures/${file}`);
  if (title !== undefined) await field(page, s.uploadDocTitle, "input").fill(title);
  if (visibility !== undefined) {
    const level = access.visibilityLevels.find((l) => l.id === visibility)!;
    await field(page, s.uploadVisibility, "select").selectOption({ label: level.label[language] });
  }
  await page.getByRole("button", { name: s.uploadPreview }).click();

  const dialog = page.getByRole("dialog", { name: s.uploadConfirmTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadSubmit, exact: true }).click();
  await expect(dialog.getByText(s.uploadDone)).toBeVisible();
  await dialog.getByRole("button", { name: s.uploadAnother }).click();
  await expect(dialog).toBeHidden();

  // 萃取在背景執行；結束前打開待審頁時看不到，按重新整理再讀一次
  await openTab(page, s.tabReview);
  const item = page.locator(".review-page").getByText(expected, { exact: true }).first();
  await expect(async () => {
    await page.getByRole("button", { name: s.reviewRefresh }).first().click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

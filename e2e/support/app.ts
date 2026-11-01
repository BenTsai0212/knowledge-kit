// 端對端測試共用的操作（#66）。畫面文字一律從 client/i18n 讀取，測試中不寫死；只用預設語言（client.json 的 defaultLanguage）。
import { expect, type Page } from "@playwright/test";
import access from "../../client/access.json" with { type: "json" };
import client from "../../client/client.json" with { type: "json" };
import en from "../../client/i18n/en.json" with { type: "json" };
import zhTW from "../../client/i18n/zh-TW.json" with { type: "json" };
import scenarios from "../../client/scenarios.json" with { type: "json" };
import { routeFakeAsk } from "./fake-ask";

const TRANSLATIONS = { "zh-TW": zhTW, en };
export const language = client.defaultLanguage as keyof typeof TRANSLATIONS;
export const s = TRANSLATIONS[language];

// 邀請碼：假的 /api/ask 不檢查，任意虛構字串即可（只存在 sessionStorage）
const ACCESS_CODE = "e2e-access-code";

export type RoleId = (typeof access.roles)[number]["id"];

// 預設問題（scenarios.json）；資料庫載入完成前停用
export const presetQuestions = scenarios.scenarios.flatMap((x) => x.questions.map((q) => ({ role: x.role as RoleId, text: q.text[language] })));

// 打開首頁、輸入邀請碼，等資料庫載入完成（預設問題的按鈕可以按）
export async function openApp(page: Page): Promise<void> {
  await routeFakeAsk(page);
  await page.goto("/");
  await page.getByLabel(s.accessCodeLabel).fill(ACCESS_CODE);
  await page.getByRole("button", { name: s.accessCodeSubmit }).click();
  await expect(page.getByRole("button", { name: presetQuestions[0].text, exact: true })).toBeEnabled();
}

// 以 Toolbar 的身分選單切換身分
export async function switchIdentity(page: Page, id: RoleId): Promise<void> {
  const role = access.roles.find((r) => r.id === id)!;
  await page.getByRole("banner").getByLabel(s.identity).selectOption({ label: role.label[language] });
}

// 切換頁籤；待審頁籤的名稱後面接著筆數，所以比對開頭
export async function openTab(page: Page, label: string): Promise<void> {
  const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  await page.getByRole("navigation", { name: s.views }).getByRole("button", { name }).click();
}

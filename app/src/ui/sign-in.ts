// 登入頁（#287，docs/design.md「日常工具」的「登入」）：帳號登入是展示，不做會員系統；fork 時換成客戶的身分驗證（docs/client-config.md「登入（展示）」）。
// 帳號與密碼不送出、不保存；/api/ask 仍以邀請碼把關。

// 展示帳號：由角色 id 推算，不寫進 access.json（#287 決定 1）。example.test 是保留給測試的網域，不會是真實的信箱
export const DEMO_ACCOUNT_DOMAIN = "example.test";

export const demoAccount = (roleId: string) => `${roleId}@${DEMO_ACCOUNT_DOMAIN}`;

// 登入的方式：帳號登入時身分固定、不能切換；以邀請碼體驗時可以切換（現行）。null 是還沒登入（登入頁）
export type SignIn = { kind: "account"; role: string } | { kind: "code" };

// 身分是否能在介面上切換（docs/design.md「身分是登入的人，不是設定」）
export const canSwitchIdentity = (signIn: SignIn | null) => signIn?.kind !== "account";

// 帳號登入要不要另外輸入邀請碼：線上 demo 有內建的公開碼時不用；沒有公開碼的部署要輸入
export const needsAccessCode = (publicCode: string) => publicCode.trim() === "";

// 帳號登入時送給 /api/ask 的邀請碼：有公開碼時用公開碼，否則用輸入的碼；都沒有時為 null（不能登入）
export function accountAccessCode(publicCode: string, typed: string): string | null {
  const code = needsAccessCode(publicCode) ? typed.trim() : publicCode.trim();
  return code === "" ? null : code;
}

// 登入頁有沒有帳號登入：展示模式（?mode=presentation）只顯示邀請碼，一定可以切換身分（#287 決定 2）
export const offersAccountSignIn = (presentation: boolean) => !presentation;

import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { accountAccessCode, canSwitchIdentity, demoAccount, needsAccessCode, offersAccountSignIn } from "./sign-in";

describe("demoAccount", () => {
  it("由角色 id 推算 <id>@example.test", () => {
    expect(demoAccount("staff")).toBe("staff@example.test");
  });

  it("參考情境的每個角色都有不重複的展示帳號，都在保留給測試的網域", () => {
    const accounts = clientConfig.access.roles.map((r) => demoAccount(r.id));
    expect(new Set(accounts).size).toBe(accounts.length);
    for (const a of accounts) expect(a).toMatch(/^[^@\s]+@example\.test$/);
  });
});

describe("canSwitchIdentity", () => {
  it("帳號登入時不能切換；以邀請碼體驗與還沒登入時可以", () => {
    expect(canSwitchIdentity({ kind: "account", role: "staff" })).toBe(false);
    expect(canSwitchIdentity({ kind: "code" })).toBe(true);
    expect(canSwitchIdentity(null)).toBe(true);
  });
});

describe("帳號登入的邀請碼", () => {
  it("有公開碼時不必輸入，以公開碼送出（忽略輸入的內容）", () => {
    expect(needsAccessCode("demo-code")).toBe(false);
    expect(accountAccessCode("demo-code", "")).toBe("demo-code");
    expect(accountAccessCode(" demo-code ", "other")).toBe("demo-code");
  });

  it("沒有公開碼時要輸入，沒輸入就不能登入", () => {
    expect(needsAccessCode("")).toBe(true);
    expect(needsAccessCode("  ")).toBe(true);
    expect(accountAccessCode("", " typed ")).toBe("typed");
    expect(accountAccessCode("", "  ")).toBeNull();
  });
});

describe("offersAccountSignIn", () => {
  it("展示模式只顯示邀請碼，一般模式才有帳號登入", () => {
    expect(offersAccountSignIn(true)).toBe(false);
    expect(offersAccountSignIn(false)).toBe(true);
  });
});

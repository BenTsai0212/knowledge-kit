// 桌機的左側欄（#330，畫板 docs/design/v1/boards/K-Home.dc.html）：頂部、頁面項目、底部的標示與使用者卡
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { IDENTITY_SELECT_ID } from "./empty-state";
import { SIMPLIFIED_MAX_SIZE } from "./ProductIcon";
import { avatarInitial, Sidebar, SIDEBAR_ICON_SIZE, type NavProps } from "./Sidebar";
import { demoAccount } from "./sign-in";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 中的那一條）
function rule(selector: string): Record<string, string> {
  const block = cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const { roles } = clientConfig.access;
const language = clientConfig.client.defaultLanguage;
const s = strings(language);

const render = (props: Partial<NavProps> = {}) =>
  renderToStaticMarkup(
    createElement(Sidebar, {
      language,
      identity: roles[0].id,
      identityControl: "menu",
      onIdentity: () => {},
      onLanguage: () => {},
      onChangeAccessCode: () => {},
      views: ["home", "qa", "review"],
      view: "qa",
      onView: () => {},
      ...props,
    }),
  );

const userCard = (html: string) => html.match(/<div class="user-card">([\s\S]*?)<\/div>/)?.[1];

describe("頂部與頁面項目", () => {
  it("28px 的 icon＋客戶名稱；產品名稱只給報讀器", () => {
    expect(SIDEBAR_ICON_SIZE).toBe(28);
    expect(SIDEBAR_ICON_SIZE).toBeLessThanOrEqual(SIMPLIFIED_MAX_SIZE);
    for (const lang of clientConfig.client.languages) {
      const h1 = render({ language: lang }).match(/<h1 class="sidebar__brand">([\s\S]*?)<\/h1>/)?.[1] ?? "";
      expect(h1).toContain('width="28"');
      expect(h1).toContain(`<span class="visually-hidden">${strings(lang).productName} </span>`);
      expect(h1).toContain(`<span class="sidebar__client">${clientConfig.client.displayName[lang]}</span>`);
    }
  });

  it("目前頁面以 aria-current=\"page\" 標示，筆數接在名稱後面", () => {
    const html = render({ view: "qa", tabExtra: { review: createElement("span", { className: "tab-count" }, 3) } });
    expect(html).toMatch(/<button type="button" data-view="qa" aria-current="page">/);
    expect(html).not.toMatch(/data-view="home" aria-current/);
    expect(html).toContain(`${s.tabReview}</span><span class="tab-count">3</span>`);
  });

  it("「這次的問題」不在左側欄（#330 決定 3）", () => {
    expect(render()).not.toContain(s.sessionQuestions);
  });
});

describe("底部", () => {
  it("邀請碼體驗：標示是「虛構資料 · 展示用權限」，使用者卡是角色的縮寫頭像、角色名與「看得到：…」，沒有「登出」", () => {
    for (const role of roles) {
      const html = render({ identity: role.id });
      expect(html).toMatch(new RegExp(`<p class="sidebar__labels"><span>${s.fictionalData}</span><span aria-hidden="true"> · </span><span>${s.demoPermissions}</span></p>`));
      const card = userCard(html);
      expect(card, role.id).toBeDefined();
      expect(card).toContain(`id="${IDENTITY_SELECT_ID}"`);
      expect(card).toContain('aria-haspopup="dialog"');
      expect(card).toContain(`<span class="user-card__avatar" aria-hidden="true">${avatarInitial(role.label[language])}</span>`);
      expect(card).toContain(`<b class="user-card__name">${role.label[language]}</b>`);
      expect(card).not.toContain("user-card__role");
      expect(card).toContain(fill(s.userCardScope, { scope: role.scope[language] }));
      expect(card).not.toContain(s.signOut);
      // 登入後語言在使用者卡的選單裡，左側欄沒有語言的下拉選單
      expect(html).not.toContain("sidebar__language");
    }
  });

  it("帳號登入：使用者卡是帳號的縮寫頭像、帳號、角色、「看得到：…」與「登出」", () => {
    const role = roles.at(-1)!;
    const account = demoAccount(role.id);
    const card = userCard(render({ identity: role.id, identityControl: "account", account }));
    expect(card).toContain(`<span class="user-card__avatar" aria-hidden="true">${avatarInitial(account)}</span>`);
    expect(card).toContain(`<b class="user-card__name">${account}</b><span class="user-card__role">${role.label[language]}</span>`);
    expect(card).toContain(fill(s.userCardScope, { scope: role.scope[language] }));
    expect(card).toContain(`>${s.signOut}</button>`);
  });

  it("登入頁：沒有使用者卡，標示只有「虛構資料」，語言是下拉選單", () => {
    const html = render({ identityControl: "none", onChangeAccessCode: undefined });
    expect(userCard(html)).toBeUndefined();
    expect(html).toContain(`<p class="sidebar__labels"><span>${s.fictionalData}</span></p>`);
    expect(html).toMatch(/<label class="sidebar__language">[^<]*<select/);
  });

  it("縮寫頭像是第一個字，英文字母大寫", () => {
    expect(avatarInitial("staff@example.test")).toBe("S");
    expect(avatarInitial("主管")).toBe("主");
    expect(avatarInitial("")).toBe("");
  });
});

describe("樣式（畫板 K-Home）", () => {
  it("寬 220px、surface 底、右邊 1px border", () => {
    expect(rule(".app")["grid-template-columns"]).toBe("220px minmax(0, 1fr)");
    expect(rule(".sidebar")).toMatchObject({ background: "var(--color-surface)", "border-right": "1px solid var(--color-border)" });
  });

  it("頂部是 16px／900 的客戶名稱", () => {
    expect(rule(".sidebar__brand")).toMatchObject({ "font-size": "16px", "font-weight": "900" });
  });

  it("頁面項目 44px、圓角 10px、15px；選中是 text 底、surface 字、700", () => {
    expect(rule(".sidebar .primary-tabs button")).toMatchObject({ "min-height": "44px", "border-radius": "var(--radius-medium)", "font-size": "15px" });
    expect(clientConfig.theme.radius.medium).toBe("10px");
    expect(rule('.sidebar .primary-tabs button[aria-current="page"]')).toMatchObject({
      background: "var(--color-text)",
      color: "var(--color-surface)",
      "font-weight": "700",
    });
  });

  it("筆數是右側的 primary 圓形徽章（22px）", () => {
    expect(rule(".sidebar .tab-count")).toMatchObject({
      "min-width": "22px",
      height: "22px",
      "margin-left": "auto",
      "border-radius": "var(--radius-pill)",
      background: "var(--color-primary)",
      color: "var(--color-onPrimary)",
    });
  });

  it("標示是虛線框；使用者卡是 surfaceRaised 底、圓角 12px，頭像 32px", () => {
    expect(rule(".sidebar__labels").border).toBe("1px dashed var(--color-textMuted)");
    expect(rule(".user-card")).toMatchObject({ background: "var(--color-surfaceRaised)", "border-radius": "12px" });
    expect(rule(".user-card__avatar")).toMatchObject({ width: "32px", height: "32px", "border-radius": "var(--radius-pill)" });
  });

  it("使用者卡的選單從左側欄旁出現（popover）", () => {
    expect(rule(".bottom-sheet.popover-sheet").inset).toBe("auto auto 16px 228px");
  });
});

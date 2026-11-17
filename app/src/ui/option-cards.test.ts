// 單選卡與選項的排版（#415）：全域的 label 是 inline-flex＋flex-wrap: wrap，圓點＋說明較長的 <label> 會整塊換到下一行。
// 以 flex 排列「圓點在左、文字在右」的 <label> 一律覆寫成 flex-wrap: nowrap，文字在自己的欄內換行。
// 實際排版（圓點與文字在同一列）以 E2E（e2e/role-cards.spec.ts）在桌機、平板與手機確認
import { describe, expect, it } from "vitest";
import css from "./app.css?raw";
import identitySheet from "./IdentitySheet.tsx?raw";
import reviewPage from "./ReviewPage.tsx?raw";
import signInPanel from "./SignInPanel.tsx?raw";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同、不在 @media 內的第一條）
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.[\]()"=]/g, "\\$&");
  const block = cssText.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// 圓點＋文字、以 flex 排列的 <label>：class 與使用它的元件
const OPTION_LABELS: { className: string; source: string }[] = [
  { className: "role-card", source: identitySheet },
  { className: "review-choice__option", source: reviewPage },
  { className: "account-card", source: signInPanel },
];

describe("圓點＋文字的 <label> 不換行（#415）", () => {
  it("全域的 label 會換行（這些卡片因此需要覆寫）", () => {
    expect(rule("label")["flex-wrap"]).toBe("wrap");
  });

  for (const { className, source } of OPTION_LABELS) {
    it(`.${className} 是 <label>，flex 排列且 flex-wrap: nowrap`, () => {
      expect(source).toMatch(new RegExp(`<label[^>]*className="${className}"`));
      const decls = rule(`.${className}`);
      expect(decls.display).toMatch(/^(inline-)?flex$/);
      expect(decls["flex-wrap"]).toBe("nowrap");
    });
  }

  it("身分卡片的圓點不縮小，文字區塊可以縮放、在自己的欄內換行", () => {
    expect(rule(".role-card input").flex).toBe("none");
    expect(rule(".role-card__text")).toMatchObject({ "min-width": "0", "overflow-wrap": "anywhere" });
  });
});

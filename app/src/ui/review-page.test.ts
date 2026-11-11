// 待審頁的結構測試（#243）：第二層是底線式分頁（role="tablist"），不再用舊的分段切換；樣式來自設計系統 v1 的 token
import { describe, expect, it } from "vitest";
import css from "./app.css?raw";
import reviewPage from "./ReviewPage.tsx?raw";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS 規則的宣告（選擇器完全相同的那一條）
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.[\]()"=]/g, "\\$&");
  const block = cssText.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  expect(block, selector).toBeDefined();
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("待審頁的分頁", () => {
  it("是 tablist 與 tab，以 aria-selected 標示選中；沒有舊的分段切換", () => {
    expect(reviewPage).toContain('role="tablist"');
    expect(reviewPage).toContain('role="tab"');
    expect(reviewPage).toContain('role="tabpanel"');
    expect(reviewPage).toContain("aria-selected=");
    expect(reviewPage).not.toContain("aria-pressed");
    expect(reviewPage).not.toContain("segmented");
    expect(cssText).not.toContain(".segmented");
  });

  it("選中的分頁是 2px text 底線、粗體", () => {
    expect(rule('.review-tabs [role="tab"][aria-selected="true"]')).toMatchObject({
      "border-bottom-color": "var(--color-text)",
      "font-weight": "700",
    });
    expect(rule('.review-tabs [role="tab"]')["border-bottom"]).toBe("2px solid transparent");
  });
});

describe("文件卡片", () => {
  it("「還有 N 組需要你確認」是 conflictSoft 底；組名是 textMuted 小標題", () => {
    expect(rule(".review-to-confirm")).toMatchObject({ background: "var(--color-conflictSoft)", color: "var(--color-conflictText)" });
    expect(rule(".review-group-title").color).toBe("var(--color-textMuted)");
  });

  it("組名與標示的文字來自 i18n", () => {
    for (const key of ["reviewEntities", "reviewRelations", "conflictSection", "reviewNew", "reviewAutoMerged", "reviewSuggested", "reviewExisting"]) {
      expect(reviewPage, key).toContain(`s.${key}`);
    }
  });
});

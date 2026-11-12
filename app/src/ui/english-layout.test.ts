// 英文版面（#288，docs/design.md「英文版面」）：英文寬度平均是中文的 1.5 倍、最多約 3 倍，介面不切字、不重疊。
// 版面的實際寬度以 E2E（e2e/english-layout.spec.ts）在 375px 與 1440px 確認；這裡檢查規則與截斷的邏輯
import { describe, expect, it } from "vitest";
import en from "@client/i18n/en.json";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { clampLabel } from "./graph-labels";
import { graphStyle, NODE_LABEL_MAX_LINES, NODE_LABEL_MAX_WIDTH } from "./graph-style";
import graphView from "./GraphView.tsx?raw";
import reportList from "./ReportList.tsx?raw";
import { overflowsEnd } from "./review-helpers";
import reviewPage from "./ReviewPage.tsx?raw";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

// 所有規則（含 @media 內的）：選擇器、宣告與所在的 @media 條件
function rules(): { selector: string; decls: Record<string, string>; media: string | null }[] {
  const out: { selector: string; decls: Record<string, string>; media: string | null }[] = [];
  const parse = (text: string, media: string | null) => {
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = Object.fromEntries([...`${m[2]};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((d) => [d[1], d[2].trim()]));
      out.push({ selector: m[1].trim().replace(/\s+/g, " "), decls, media });
    }
  };
  const mediaBlocks = [...cssText.matchAll(/@media\s*([^{]+)\{((?:[^{}]*\{[^{}]*\})*\s*)\}/g)];
  for (const m of mediaBlocks) parse(m[2], m[1].trim());
  parse(mediaBlocks.reduce((t, m) => t.replace(m[0], ""), cssText), null);
  return out;
}

// 每個字 8px、空白 4px 的量法
const measure = (text: string) => [...text].reduce((w, c) => w + (c === " " ? 4 : 8), 0);

describe("圖譜節點的名稱（最寬 112px、最多兩行）", () => {
  it("放得下時不變；英文在空白處換行", () => {
    expect(clampLabel("Sales", measure, 112)).toBe("Sales");
    expect(clampLabel("Product Development", measure, 112)).toBe("Product\nDevelopment");
  });

  it("超過兩行時第二行以「…」結尾，每行都不超過最寬", () => {
    const label = clampLabel("Regional Customer Success Operations Team", measure, 112);
    const lines = label.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(112);
  });

  it("沒有空白的中文與太長的單字逐字換行", () => {
    const zh = clampLabel("北區客戶成功營運與服務品質管理部門", measure, 112);
    expect(zh.split("\n")).toEqual(["北區客戶成功營運與服務品質管", "理部門"]);
    const long = clampLabel("Supercalifragilisticexpialidocious", measure, 112);
    expect(long.split("\n")).toHaveLength(2);
    expect(long.split("\n").every((l) => measure(l) <= 112)).toBe(true);
    expect(clampLabel("A".repeat(60), measure, 112).endsWith("…")).toBe(true);
  });

  it("畫在圖上的是截斷的 shortLabel，選取與滑過時是完整名稱（label）", () => {
    expect(NODE_LABEL_MAX_WIDTH).toBe(112);
    expect(NODE_LABEL_MAX_LINES).toBe(2);
    const style = graphStyle(() => "", clientConfig.knowledgeModel.entityTypes) as { selector: string; style: Record<string, unknown> }[];
    expect(style.find((r) => r.selector === "node")?.style).toMatchObject({ label: "data(shortLabel)", "text-max-width": "112px" });
    expect(style.find((r) => r.selector === "node.selected, node.hover")?.style.label).toBe("data(label)");
    // 元素的 label 是完整名稱（E2E 與搜尋以它比對），shortLabel 由 clampLabel() 產生
    expect(graphView).toContain("clampLabel(label, measure, NODE_LABEL_MAX_WIDTH, NODE_LABEL_MAX_LINES)");
    expect(graphView).toMatch(/data: \{ id: e\.id, type: e\.type, label, shortLabel/);
  });
});

describe("手機待審頁的分段", () => {
  it("英文 “Resolved differences” 改為 “Resolved”", () => {
    expect(en.reviewDecidedTab).toBe("Resolved");
  });

  it("右側還有內容時才有 36px 漸層提示", () => {
    expect(overflowsEnd({ scrollLeft: 0, clientWidth: 358, scrollWidth: 436 })).toBe(true);
    expect(overflowsEnd({ scrollLeft: 78, clientWidth: 358, scrollWidth: 436 })).toBe(false);
    expect(overflowsEnd({ scrollLeft: 77.5, clientWidth: 358, scrollWidth: 436 })).toBe(false);
    expect(overflowsEnd({ scrollLeft: 0, clientWidth: 600, scrollWidth: 600 })).toBe(false);
    const fade = rules().find((r) => r.selector === ".review-tabs.has-more");
    expect(fade?.decls["mask-image"]).toContain("36px");
    expect(fade?.decls["-webkit-mask-image"]).toBe(fade?.decls["mask-image"]);
    expect(reviewPage).toContain('"review-tabs has-more"');
    expect(reviewPage).toContain("onScroll={checkTabs}");
  });
});

describe("窄螢幕的按鈕", () => {
  it("說法不同的三個決定：窄於 480px 時整列排列、文字可換行", () => {
    const media = rules().filter((r) => r.media === "(max-width: 480px)");
    expect(media.find((r) => r.selector === ".conflict-actions")?.decls).toMatchObject({ "flex-direction": "column", "align-items": "stretch" });
    expect(media.find((r) => r.selector === ".conflict-actions button")?.decls["white-space"]).toBe("normal");
  });

  it("回報處理的兩個按鈕：窄於 360px 時上下排列", () => {
    const media = rules().filter((r) => r.media === "(max-width: 360px)");
    expect(media.find((r) => r.selector === ".report-actions")?.decls).toMatchObject({ "flex-direction": "column", "align-items": "stretch" });
    expect(reportList).toContain('className="dialog-actions report-actions"');
  });
});

describe("首頁", () => {
  it("欄寬是 minmax(0, 1fr)：截斷的長標題不會把卡片撐出畫面", () => {
    expect(rules().find((r) => r.selector === ".home" && r.media === null)?.decls["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });
});

describe("排版規則", () => {
  // 按鈕、分段（分頁）、晶片的選擇器
  const control = /button|chip|\[role="tab"\]|review-tabs/;

  it("按鈕、分段、晶片不設固定寬度（只有沒有文字的圖示按鈕）", () => {
    const fixed = rules()
      .filter((r) => control.test(r.selector))
      .flatMap((r) =>
        Object.entries(r.decls)
          .filter(([p, v]) => /^(?:width|max-width|inline-size|max-inline-size)$/.test(p) && /\d(?:px|rem|em|ch)\b/.test(v))
          .map(([p, v]) => `${r.selector} { ${p}: ${v} }`),
      );
    expect(fixed).toEqual([".icon-button { width: 2rem }"]);
  });

  it("只有名稱類可以截斷：按鈕、分段、晶片沒有 text-overflow", () => {
    const truncated = rules().filter((r) => "text-overflow" in r.decls);
    expect(truncated.length).toBeGreaterThan(0);
    expect(truncated.filter((r) => control.test(r.selector)).map((r) => r.selector)).toEqual([]);
  });
});

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
  it("每個頁籤至少 44×44px（文字短的頁籤也一樣），分段切換仍是一行、橫向捲動", () => {
    const tab = rules().find((r) => r.media === null && r.selector === '.review-page--phone .review-tabs [role="tab"]');
    expect(tab?.decls).toMatchObject({ "min-height": "44px", "min-width": "44px" });
    const tabs = rules().find((r) => r.media === null && r.selector === ".review-tabs");
    expect(tabs?.decls).toMatchObject({ "flex-wrap": "nowrap", "overflow-x": "auto" });
  });

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

  it.each([".home__list", ".home__cards"])("%s 的欄寬是 minmax(0, 1fr)：不換行的長標題以省略號截斷", (selector) => {
    expect(rules().find((r) => r.selector === selector && r.media === null)?.decls["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });
});

describe("頁面外層與清單的欄寬", () => {
  // 不換行、截斷或橫向捲動的元素 → 它在畫面上的祖先中所有 display: grid 的容器（到 .app 為止）。
  // 隱含的 auto 欄與 1fr（minmax(auto, 1fr)）至少是內容的最小寬度，這些元素會把欄撐寬、整頁出現橫向捲動
  // （#288 審查：首頁的清單、待審頁的分頁列）。新增這類元素時，把它與祖先的 grid 加進這張表
  const page = ["main"];
  const ancestors: Record<string, string[]> = {
    // 桌機的左側欄（#330）：flex 容器，在 .app 的第一欄（220px）
    ".sidebar__client": [".app"],
    // 桌機登入頁的頂端列（#334）：flex 容器，在 .app 的第一列
    ".entry-bar__wordmark": [".app"],
    // 手機的頂端列與分頁列（#255）：flex 容器，.app--phone 是 display: block
    ".mobile-brand__client": [".app"],
    ".identity-badge": [".app"],
    ".mobile-tabbar__label": [".app"],
    // 平板的導覽列（#255）：flex 容器，在 .app 的第一欄
    ".nav-rail__label": [".app"],
    ".presets": [".app", "main.qa", ".home", ...page],
    ".scenario": [".app", "main.qa", ".home", ...page],
    ".review-tabs": [".review-page", ".upload", ...page],
    '.review-tabs [role="tab"]': [".review-page", ".upload", ...page],
    ".table-scroll": [".eval-overview", ".eval-page", ...page],
    ".eval-chip": [".eval-page", ...page],
    ".eval-outcome": [".eval-overview", ".eval-page", ...page],
    // 手機評測台的指標卡（#282 審查）：判定膠囊與「通過／總數」不換行；.eval-metric__set 是 flex
    ".eval-metric .eval-verdict": [".eval-metric__body", ".eval-metric", ".eval-metrics", ".eval-page", ...page],
    ".eval-metric__fraction": [".eval-metric__body", ".eval-metric", ".eval-metrics", ".eval-page", ...page],
    // 桌機圖譜的層級路徑（#336）：一行、在列內橫向捲動；.graph-page--desktop 與 main.page 是 flex（min-width: 0）
    ".graph-page--desktop .graph-trail": [".app", ...page],
    // 首頁的列與「最近看過」（#331）：桌機的卡片是 auto-fit（minmax(min(100%, 340px), 1fr)）
    ".home__name, .home__question, .home__sub, .home__entity-name": [".home__list", ".home__cards", ".home--wide .home__cards", ".home", ...page],
    // 手機首頁的常見問題（#356）：一行、橫向滑動；提問框在 .home 的單欄
    ".home--phone .composer--compact .presets": [".app", ".home", ...page],
    ".home--phone .composer--compact .scenario": [".app", ".home", ...page],
    ".my-upload__title": [".my-uploads__list", ".my-uploads", ".upload", ...page],
    // 手機待審頁需要決定的一行摘要（#282）：名稱或差異說明以省略號截斷；.review-item 的內容是 min-width: 0
    ".review-sheet-row__text": [".review-list", ".review-page", ...page],
    // 手機的時間軸（#282）：篩選晶片一行、橫向滑動；.timeline-page 不是 grid
    ".app--phone .timeline-filter": [...page],
    ".app--phone .timeline-filter button.chip": [...page],
    // 桌機的時間軸（#346）：篩選一列，放不下時在列內橫向捲動；.timeline-page--desktop 是 flex
    ".timeline-page--desktop .timeline-filter": [...page],
    ".timeline-page--desktop .timeline-filter button.chip": [...page],
    // 手機的「回答提到」（#256）：一行、橫向滑動；.answer 不是 grid，.qa-center 與手機的 main.qa 是 flex
    ".app--phone .mentions": [".conversation", ...page],
    ".app--phone .mentions > p, .app--phone .mention-group": [".conversation", ...page],
  };

  // 不在畫面上占寬度的（絕對定位、只給報讀器）不算
  const unwrapped = () =>
    rules()
      .filter((r) => /nowrap/.test(r.decls["white-space"] ?? "") || "text-overflow" in r.decls || /auto|scroll/.test(r.decls["overflow-x"] ?? ""))
      .filter((r) => r.decls.position !== "absolute")
      .map((r) => r.selector);

  // 每個欄的最小寬度都不看內容：minmax(0, …)、minmax(min(100%, …), …) 或固定長度
  const tracks = (template: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let current = "";
    for (const c of `${template} `) {
      if (c === " " && depth === 0) {
        if (current !== "") out.push(current);
        current = "";
        continue;
      }
      depth += c === "(" ? 1 : c === ")" ? -1 : 0;
      current += c;
    }
    return out.flatMap((t) => (t.startsWith("repeat(") ? tracks(t.slice(t.indexOf(",") + 1, -1).trim()) : [t]));
  };
  const contentFree = (track: string) => /^minmax\((?:0|min\(100%, [^)]+\)),/.test(track) || /^\d+(?:\.\d+)?(?:px|rem)$/.test(track);

  it("表列出所有不換行、截斷或橫向捲動的元素", () => {
    expect(unwrapped().sort()).toEqual(Object.keys(ancestors).sort());
  });

  it.each(Object.entries(ancestors))("%s 的祖先 grid 都指定不看內容的欄寬", (_, containers) => {
    for (const container of containers) {
      const rule = rules().find((r) => r.media === null && r.selector.split(", ").includes(container) && "grid-template-columns" in r.decls);
      expect(rule, container).toBeDefined();
      const template = rule?.decls["grid-template-columns"] ?? "";
      expect(tracks(template).every(contentFree), `${container} { grid-template-columns: ${template} }`).toBe(true);
    }
  });

  it("頁面外層與清單的 grid 是 minmax(0, 1fr)", () => {
    for (const selector of ["main", ".review-page", ".review-list", ".review-rows", ".timeline", ".upload", ".upload-recent", ".graph-side", ".eval-page", ".my-uploads", ".my-uploads__list"]) {
      const rule = rules().find((r) => r.media === null && r.selector.split(", ").includes(selector) && r.decls.display === "grid");
      expect(rule?.decls["grid-template-columns"], selector).toBe("minmax(0, 1fr)");
    }
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
    // 桌機圖譜的放大／縮小（#336）、手機圖譜的篩選（#357）、手機待審頁的重新整理（#282，觸控目標 44px）也是沒有文字的圖示按鈕
    expect(fixed).toEqual([
      ".icon-button { width: 2rem }",
      ".graph-zoom-buttons button { width: 44px }",
      ".graph-page--phone button.graph-filters-button { width: 44px }",
      ".review-page--phone .review-toolbar .icon-button { width: 44px }",
    ]);
  });

  it("只有名稱類可以截斷：按鈕、分段、晶片沒有 text-overflow", () => {
    const truncated = rules().filter((r) => "text-overflow" in r.decls);
    expect(truncated.length).toBeGreaterThan(0);
    expect(truncated.filter((r) => control.test(r.selector)).map((r) => r.selector)).toEqual([]);
  });
});

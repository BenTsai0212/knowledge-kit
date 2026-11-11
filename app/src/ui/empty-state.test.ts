// 空狀態（#245，docs/design.md「狀態的共同語言」）：最多兩個下一步、線條圖示、虛線框，文字不用驚嘆號、不暗示有看不到的內容
import { describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { EMPTY_ICONS, emptyActions, MAX_EMPTY_ACTIONS } from "./empty-state";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => cssText.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

const action = (label: string) => ({ label, onClick: () => {} });

// 空狀態新增的原因與按鈕文字
const NEW_KEYS = [
  "emptyAnswerReason", "emptyAnswerAction", "graphEmptyReason", "switchIdentity", "pathNotFoundReason", "pathChangeEnd",
  "timelineEmptyReason", "timelineFilterEmptyReason", "timelineShowAll", "uploadNotAllowedReason", "reviewEmptyReason",
  "reviewUploadAnother", "reportsEmptyReason", "evalEmptyTitle", "evalEmptyReason", "evalEmptyAction",
] as const;

// 與身分的可見範圍有關的標題與原因：不得暗示「有內容但你看不到」（#245 決定、docs/qa.md「不透露是否有看不到的文件」）
const VISIBILITY_TEXTS = [
  "graphEmpty", "graphEmptyReason", "timelineEmptyReason", "timelineFilterEmptyReason", "reportsEmpty", "reportsEmptyReason", "reviewEmptyReason",
] as const;
const HIDDEN_HINT = /權限|看不到|看得到|沒有權|隱藏|permission|can't see|cannot see|can see|visible|hidden|not allowed|権限|閲覧でき|表示できる/i;

describe("空狀態", () => {
  it(`下一步最多 ${MAX_EMPTY_ACTIONS} 個，依傳入的順序（第一個是主要按鈕）`, () => {
    expect(emptyActions([action("a"), action("b"), action("c")]).map((a) => a.label)).toEqual(["a", "b"]);
    expect(emptyActions([action("a")]).map((a) => a.label)).toEqual(["a"]);
    expect(emptyActions([])).toEqual([]);
  });

  it("圖示只有線條：path 只用移動、直線、弧線指令", () => {
    for (const d of Object.values(EMPTY_ICONS)) expect(d).toMatch(/^[MmLlHhVvAaZz\d\s.,-]+$/);
  });

  it("虛線框與圖示用 textMuted 系，圖示不填色", () => {
    expect(rule(".empty-state")).toMatch(/border:\s*1px dashed var\(--color-textMuted\)/);
    expect(rule(".empty-state")).toMatch(/color:\s*var\(--color-textMuted\)/);
    expect(rule(".empty-state__icon")).toMatch(/fill:\s*none/);
    expect(rule(".empty-state__icon")).toMatch(/stroke:\s*currentColor/);
    expect(rule(".empty-state__title")).toMatch(/font-weight:\s*700/);
  });

  for (const language of clientConfig.client.languages) {
    const s = strings(language);
    it(`${language}：新增的文字都有內容、不用驚嘆號`, () => {
      for (const key of NEW_KEYS) {
        expect(s[key].trim(), key).not.toBe("");
        expect(s[key], key).not.toMatch(/[!！]/);
      }
    });

    it(`${language}：與可見範圍有關的標題與原因不暗示有看不到的內容`, () => {
      for (const key of VISIBILITY_TEXTS) expect(s[key], key).not.toMatch(HIDDEN_HINT);
    });

    it(`${language}：空狀態的按鈕與預設問題、開始評測不同名（同名的按鈕會讓操作與 E2E 選不到）`, () => {
      expect(s.evalEmptyAction.toLowerCase()).not.toContain(s.evalStart.toLowerCase());
      const presets = clientConfig.scenarios.scenarios.flatMap((x) => x.questions.map((q) => q.text[language]));
      expect(presets).not.toContain(s.emptyAnswerAction);
    });
  }
});

describe("示範客戶（clients/）的空狀態文字", () => {
  const files = Object.entries(import.meta.glob<Record<string, string>>("../../../clients/*/i18n/*.json", { eager: true, import: "default" }));

  it("有示範客戶的翻譯檔", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const [path, texts] of files) {
    it(`${path.replace("../../../", "")}：與可見範圍有關的標題與原因不暗示有看不到的內容`, () => {
      for (const key of VISIBILITY_TEXTS) expect(texts[key], key).not.toMatch(HIDDEN_HINT);
    });
  }
});

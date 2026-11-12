import { describe, expect, it } from "vitest";
import accessCodeForm from "./AccessCodeForm.tsx?raw";
import css from "./app.css?raw";
import evalPage from "./EvalPage.tsx?raw";
import fallbackNotice from "./RetrievalFallbackNotice.tsx?raw";
import reviewPage from "./ReviewPage.tsx?raw";
import timelinePage from "./TimelinePage.tsx?raw";
import app from "../App.tsx?raw";
import main from "../main.tsx?raw";

// 全域與進入的動態（#246，docs/design.md「全互動對照表」的「全域」「進入」列）：toast、對話框、邀請碼錯誤、改用關鍵字檢索的提示、
// 切換身分（看不到的內容消失）、切換語言與 Light／Dark（交叉淡換）。
// 時間一律是 --motion-* 變數（減少動態效果時為 0ms，motion.test.ts 檢查），keyframes 照抄參考檔（motion-reference.test.ts 檢查）

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
// 選擇器完全相同的規則內容（多個同名規則時接在一起）
const rule = (selector: string) =>
  [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].split(",").some((x) => x.trim() === selector))
    .map((m) => m[2])
    .join("\n");

describe("toast（#246 決定補充 3）", () => {
  it("在視窗底部置中；上升 12px＋淡入（kToast，base），拿掉舊的 toast-in", () => {
    expect(rule(".toast-region")).toMatch(/bottom:/);
    expect(rule(".toast-region")).not.toMatch(/\btop:/);
    expect(rule(".toast")).toMatch(/animation: kToast var\(--motion-base\) var\(--ease-enter\) backwards;/);
    expect(cssText).not.toContain("toast-in");
  });

  it("底部細線以 linear 倒數 TOAST_MS（經過 motionDuration()），暫停時 animation-play-state: paused", () => {
    expect(rule(".toast__timer")).toMatch(/animation: kTimer var\(--toast-duration\) var\(--ease-linear\) forwards;/);
    expect(rule(".toast__timer.is-paused")).toMatch(/animation-play-state: paused;/);
    expect(reviewPage).toContain("motionDuration(prefersReducedMotion(), TOAST_MS)");
    // 暫停與重新計時跟著 toast-timer.ts
    expect(reviewPage).toMatch(/createToastTimer\(\s*TOAST_MS,[\s\S]*?\(running\) => setToastRun/);
  });
});

describe("對話框（#246）", () => {
  it("遮罩淡入（base）；本體 98%→100%＋淡入、延後 60ms", () => {
    expect(rule(".dialog::backdrop")).toMatch(/animation: kFade var\(--motion-base\) var\(--ease-enter\) backwards;/);
    expect(rule(".upload-dialog::backdrop")).toMatch(/animation: kFade var\(--motion-base\)/);
    expect(rule(".dialog[open]")).toMatch(/animation: kScale var\(--motion-base\) var\(--ease-enter\) var\(--motion-stagger-list\) backwards;/);
  });

  it("關閉時反向（fast、退場曲線），由 dialog-motion.ts 的 closeDialog() 加上 is-closing", () => {
    expect(rule(".dialog.is-closing")).toMatch(/animation: kScale var\(--motion-fast\) var\(--ease-exit\) reverse forwards;/);
    expect(rule(".dialog.is-closing::backdrop")).toMatch(/animation: kFadeOut var\(--motion-fast\) var\(--ease-exit\) forwards;/);
    expect(evalPage).toContain('className="dialog"');
    expect(evalPage).toContain("closeDialog(d, prefersReducedMotion())");
    expect(evalPage).not.toMatch(/\bd\.close\(\)/);
  });
});

describe("邀請碼錯誤（#246）", () => {
  it("輸入框邊線換成 danger；說明往下展開（kDrop，base，延後 80ms）", () => {
    expect(rule('.access-code input[aria-invalid="true"]')).toMatch(/border-color: var\(--color-danger\);/);
    expect(rule(".access-code__error")).toMatch(/animation: kDrop var\(--motion-base\) var\(--ease-enter\) var\(--motion-stagger-sentence\) backwards;/);
    expect(rule(".access-code__error > *")).toMatch(/min-height: 0;/);
  });

  it("保留已輸入的內容（被拒的碼），不搖晃", () => {
    expect(accessCodeForm).toContain("useState(rejected ?? onlineDemo.publicAccessCode)");
    expect(cssText).not.toMatch(/@keyframes \w*(shake|Shake)/);
  });
});

it("改用關鍵字檢索的提示：從頂端往下推開內容（kExpand，expand）", () => {
  expect(fallbackNotice).toContain('className="retrieval-fallback"');
  expect(rule(".retrieval-fallback")).toMatch(/animation: kExpand var\(--motion-expand\) var\(--ease-enter\) backwards;/);
  expect(rule(".retrieval-fallback > .notice")).toMatch(/min-height: 0;/);
});

describe("切換身分（#246 決定補充 2）", () => {
  it("時間軸中新身分看不到的文件模糊淡出並收合（kGone，expand＋fast、退場曲線，依序延後 40ms）", () => {
    expect(rule(".timeline-entry.is-gone")).toMatch(
      /animation: kGone calc\(var\(--motion-expand\) \+ var\(--motion-fast\)\) var\(--ease-exit\) calc\(var\(--i, 0\) \* var\(--motion-stagger-sentence\) \/ 2\) forwards;/,
    );
    expect(rule(".timeline-entry.is-gone > *")).toMatch(/min-height: 0;/);
  });

  it("不放上鎖框或佔位：消失的只是切換前已在畫面上的文件，播完（goneDelay，減少動態效果時為 0）就移除", () => {
    expect(timelinePage).toContain("goneDelay(prefersReducedMotion(), removed)");
    expect(timelinePage).toContain("setTimeout(() => setGone(null), gone.ms)");
    expect(timelinePage).toMatch(/inert=\{order !== undefined\}/);
    expect(cssText).not.toMatch(/\.is-gone[^{]*\{[^}]*(?:content|border|background)/);
  });
});

describe("切換語言、Light／Dark（#246）", () => {
  it("原地交叉淡換：舊畫面 kFadeOut（fast），新畫面 kFade（base，延後 60ms）；不滑動、不縮放", () => {
    expect(rule("::view-transition-old(root)")).toMatch(/^\s*animation: kFadeOut var\(--motion-fast\) var\(--ease-exit\) forwards;\s*$/);
    expect(rule("::view-transition-new(root)")).toMatch(/^\s*animation: kFade var\(--motion-base\) var\(--ease-enter\) var\(--motion-stagger-list\) backwards;\s*$/);
  });

  it("切換語言與系統切換淺色／深色都經過 crossFade()", () => {
    expect(app).toContain("onLanguage={(code) => crossFade(() => flushSync(() => (discard(), setLanguage(code))))}");
    expect(main).toContain("followColorScheme((query) => window.matchMedia(query), document.documentElement, crossFade)");
  });
});

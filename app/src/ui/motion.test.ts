import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import css from "./app.css?raw";
import { graphStyle } from "./graph-style";
import {
  EASING,
  EXPAND_MS,
  MOTION,
  motionDuration,
  motionStyleSheet,
  motionVariables,
  PAN_MS,
  REDUCED_MOTION,
  STAGGER,
  STAGGER_LIMIT,
  staggerDelay,
  watchReducedMotion,
} from "./motion";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("圖譜的動態（#199）", () => {
  it("動態約 0.2–0.5 秒；減少動態效果時為 0", () => {
    for (const ms of [EXPAND_MS, PAN_MS]) {
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThanOrEqual(500);
      expect(motionDuration(false, ms)).toBe(ms);
      expect(motionDuration(true, ms)).toBe(0);
    }
  });

  it("減少動態效果時，cytoscape 的 transition 時間為 0", () => {
    const durations = (reduced: boolean) =>
      (graphStyle(() => "", clientConfig.knowledgeModel.entityTypes, motionDuration(reduced, EXPAND_MS)) as unknown as { style: Record<string, unknown> }[])
        .map((r) => r.style["transition-duration"])
        .filter((d) => d !== undefined);
    expect(durations(false)).not.toEqual([]);
    expect(new Set(durations(false))).toEqual(new Set([EXPAND_MS]));
    expect(new Set(durations(true))).toEqual(new Set([0]));
  });

  it("讀出目前的設定，系統設定改變時通知，取消後不再通知", () => {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    };
    const queries: string[] = [];
    const seen: boolean[] = [];
    const stop = watchReducedMotion((q) => (queries.push(q), query as unknown as MediaQueryList), (reduced) => seen.push(reduced));
    expect(queries).toEqual([REDUCED_MOTION]);
    query.matches = true;
    for (const fn of listeners) fn();
    expect(seen).toEqual([false, true]);
    stop();
    expect(listeners.size).toBe(0);
  });
});

describe("動態的刻度（#227，docs/design.md「刻度」）", () => {
  it("時間與曲線與 design.md 相同；expand、sweep 沿用圖譜的 EXPAND_MS、PAN_MS", () => {
    expect(MOTION).toEqual({ fast: 120, base: 220, expand: EXPAND_MS, sweep: PAN_MS, settle: 520 });
    expect([EXPAND_MS, PAN_MS]).toEqual([300, 400]);
    expect(STAGGER).toEqual({ list: 60, sentence: 80 });
    expect(EASING).toEqual({ enter: "cubic-bezier(.2,0,0,1)", exit: "cubic-bezier(.4,0,1,1)", spring: "cubic-bezier(.3,1.5,.5,1)" });
  });

  it("依序出現的延遲：超過 6 項不再延遲；減少動態效果時為 0", () => {
    expect(STAGGER_LIMIT).toBe(6);
    expect([0, 1, 5, 6, 10].map((i) => staggerDelay(false, i, STAGGER.sentence))).toEqual([0, 80, 400, 400, 400]);
    expect([0, 1, 5, 6, 10].map((i) => staggerDelay(true, i, STAGGER.list))).toEqual([0, 0, 0, 0, 0]);
  });

  it("CSS 變數經過 motionDuration()：平常是刻度的時間，減少動態效果時全部 0ms；曲線兩者相同", () => {
    expect(motionVariables(false)).toEqual({
      "--motion-fast": "120ms",
      "--motion-base": "220ms",
      "--motion-expand": "300ms",
      "--motion-sweep": "400ms",
      "--motion-settle": "520ms",
      "--motion-stagger-list": "60ms",
      "--motion-stagger-sentence": "80ms",
      "--ease-enter": EASING.enter,
      "--ease-exit": EASING.exit,
      "--ease-spring": EASING.spring,
    });
    const reduced = motionVariables(true);
    for (const [name, value] of Object.entries(reduced)) expect(value).toBe(name.startsWith("--motion-") ? "0ms" : motionVariables(false)[name]);
  });

  it("樣式表：:root 放平常的時間，prefers-reduced-motion: reduce 內換成 0ms", () => {
    const [normal, reduced] = motionStyleSheet().split(`@media ${REDUCED_MOTION}`);
    expect(normal).toContain("--motion-base: 220ms;");
    expect(reduced).toContain("--motion-base: 0ms;");
    expect(reduced.match(/--motion-[\w-]+: (\d+)ms/g)?.every((d) => d.endsWith(" 0ms"))).toBe(true);
  });

  it("app.css 用到的 --motion-*、--ease-* 都由 motion.ts 提供", () => {
    const used = new Set([...cssText.matchAll(/var\((--(?:motion|ease)-[\w-]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((name) => !(name in motionVariables(false)))).toEqual([]);
  });

  it("問答的動畫只用刻度的變數，不寫死時間與曲線", () => {
    // 時間軸的標示（#42）與 toast 不在本次範圍，另以自己的 reduced-motion 規則處理
    const legacy = ["timeline-flash", "timeline-flash-static", "toast-in"];
    const animations = [...cssText.matchAll(/(?:^|[;{\s])(animation(?:-delay)?|transition(?:-duration|-timing-function)?)\s*:\s*([^;{}]+);/g)]
      .map((m) => [m[1], m[2].trim()] as const)
      .filter(([, value]) => value !== "none" && !legacy.some((name) => value.startsWith(name)));
    expect(animations.length).toBeGreaterThan(8);
    const hardCoded = (value: string) => /\d(?:m?s)\b|cubic-bezier|\bease\b|ease-(?:in|out)|linear/.test(value.replace(/var\(--[\w-]+(?:,\s*\d+)?\)/g, ""));
    // 檢查本身：寫死的時間與曲線會被抓到
    expect(["kFade 0.3s ease-out", "kRise var(--motion-base) cubic-bezier(.2,0,0,1)", "kRise 220ms"].map(hardCoded)).toEqual([true, true, true]);
    expect(animations.filter(([, value]) => hardCoded(value))).toEqual([]);
  });

  it("問答用到的 keyframes 都有定義", () => {
    const used = new Set([...cssText.matchAll(/animation:\s*(k[A-Z]\w*)/g)].map((m) => m[1]));
    expect(used).toEqual(new Set(["kSend", "kRise", "kPopS", "kFade", "kSlideIn", "kSweep"]));
    for (const name of used) expect(cssText).toContain(`@keyframes ${name} {`);
  });

  // 結束狀態留在 keyframes 的 to 會蓋掉元素自己的樣式（#227：螢光在刷過後變透明）
  it("fill-mode 是 both／forwards 的問答 keyframes 只寫 from，結束時回到元素自己的樣式", () => {
    const keyframes = (name: string) => cssText.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    const filled = (css: string) =>
      [...css.matchAll(/animation:\s*(k[A-Z]\w*)[^;]*\b(both|forwards)\s*;/g)].map((m) => m[1]).filter((name) => /\bto\s*\{|100%\s*\{/.test(keyframes(name)));
    // 檢查本身：以 both 結束在 to 的寫法會被抓到
    expect(filled(`${cssText}\n.x { animation: kSweep 1s both; }`)).toEqual(["kSweep"]);
    expect(filled(cssText)).toEqual([]);
    expect(cssText).toMatch(/animation: kSweep [^;]* backwards;/);
  });
});

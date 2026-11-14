// 功能介紹影片（#370，docs/testing.md「功能介紹影片」）：桌機 1440×900 依分鏡走過每一頁，最後一段是 390×844 的手機，
// 介面語言與字幕一致，英文與繁中各錄一支，轉成 test-results/video-tour/video-tour-<語言>.mp4（scripts/video-tour.mjs，需要 ffmpeg）。
// 不是測試，預設不執行：KK_VIDEO_TOUR=1 時 playwright.config.ts 只執行這個檔案。
// /api/ask 一律是假的回應（routeFakeAsk，問答的回答取自檢索到的段落），不需要 API 金鑰、不呼叫模型；只用參考情境（client/）的虛構資料。
// 字幕與點擊位置的圓圈由這個腳本注入頁面（不改產品程式），文字在 video-tour.captions.json；資料庫載入、萃取與評測的等待時間在轉檔時剪掉。
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { REFUSAL_MARKER } from "../app/src/qa/prompt";
import { demoAccount } from "../app/src/ui/sign-in";
import { encode, MAX_BYTES, MAX_SECONDS, MIN_SECONDS, type Cut } from "../scripts/video-tour.mjs";
import { ACCESS_CODE, blockModelDownload, EVALS_PATH, field, gotoView, switchIdentity, switchLanguage } from "./support/app";
import { access, client, nonReviewingUploader, readClientJson, reviewingUploader, s as defaultStrings, scenarios } from "./support/client";
import { normalizeText, onlyOneSees } from "./support/dataset";
import { routeFakeAsk, sseBody, WALKTHROUGH_TITLE } from "./support/fake-ask";
import { waitForGraphIdle, type Cy } from "./support/graph";

type Strings = typeof defaultStrings;
type Caption = { title: string; text: string };
type Captions = Record<string, Caption>;

const LANGUAGES = ["en", "zh-TW"] as const;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const OUT_DIR = "test-results/video-tour";
const CANVAS = ".graph-page .graph-canvas";
const captions = JSON.parse(readFileSync("e2e/video-tour.captions.json", "utf8")) as Record<string, Captions>;
const notice = readFileSync("e2e/fixtures/walkthrough-notice.md", "utf8");

// 節奏（毫秒）：字幕出現後先停一下再操作；點擊前先顯示圓圈；每次操作與每一段結束後停頓，操作不會一閃而過
const CAPTION_MS = 2_000;
const POINT_MS = 700;
const SETTLE_MS = 900;
const SCENE_END_MS = 1_200;
const TYPE_DELAY_MS = 45;

const stringsOf = (lang: string): Strings => (lang === client.defaultLanguage ? defaultStrings : readClientJson<Strings>(`i18n/${lang}.json`));
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// 一般員工與主管（參考情境是 staff、manager）；主管的題目中只有主管看得到答案段落的一題（2026 年平均調薪幅度）
const staff = nonReviewingUploader;
const manager = reviewingUploader;
const managerQuestions = scenarios.scenarios.find((x) => x.role === manager?.id)?.questions ?? [];
const restrictedQuestion = managerQuestions.find((q) => onlyOneSees(q.answerPassages, client.defaultLanguage)?.role === manager?.id) ?? managerQuestions[0];

// ---- 注入頁面的字幕與點擊圓圈（只在錄影時存在） ----

async function showCaption(page: Page, caption: Caption, position: "top" | "bottom"): Promise<void> {
  await page.evaluate(
    ({ caption, position }) => {
      let box = document.getElementById("video-tour-caption");
      if (box === null) {
        box = document.createElement("div");
        box.id = "video-tour-caption";
        document.documentElement.append(box);
      }
      Object.assign(box.style, {
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        top: position === "top" ? "20px" : "auto",
        bottom: position === "bottom" ? "28px" : "auto",
        zIndex: "2147483647",
        pointerEvents: "none",
        maxWidth: "min(760px, 92vw)",
        padding: "12px 20px",
        borderRadius: "12px",
        background: "rgba(17, 24, 39, 0.88)",
        color: "#fff",
        font: '500 17px/1.45 system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "Noto Sans CJK TC", sans-serif',
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        textAlign: "center",
      });
      box.replaceChildren();
      const title = document.createElement("div");
      title.textContent = caption.title;
      Object.assign(title.style, { fontWeight: "700", fontSize: "19px", marginBottom: "2px" });
      const text = document.createElement("div");
      text.textContent = caption.text;
      box.append(title, text);
    },
    { caption, position },
  );
}

async function showPointer(page: Page, x: number, y: number, visible: boolean): Promise<void> {
  await page.evaluate(
    ({ x, y, visible }) => {
      let ring = document.getElementById("video-tour-pointer");
      if (ring === null) {
        ring = document.createElement("div");
        ring.id = "video-tour-pointer";
        document.documentElement.append(ring);
      }
      Object.assign(ring.style, {
        position: "fixed",
        left: `${x - 20}px`,
        top: `${y - 20}px`,
        width: "40px",
        height: "40px",
        borderRadius: "50%",
        border: "3px solid #f59e0b",
        background: "rgba(245, 158, 11, 0.25)",
        zIndex: "2147483646",
        pointerEvents: "none",
        display: visible ? "block" : "none",
      });
    },
    { x, y, visible },
  );
}

// ---- 錄影的一支：記錄要剪掉的區間與失敗的段落 ----

class Tour {
  readonly cuts: Cut[] = [];
  readonly failures: string[] = [];
  private readonly started = Date.now();
  private position: "top" | "bottom" = "bottom";
  private caption: Caption | null = null;

  constructor(
    readonly page: Page,
    readonly captions: Captions,
  ) {}

  private seconds(): number {
    return (Date.now() - this.started) / 1000;
  }

  // 等待的時間（載入、萃取、評測）：轉檔時剪掉
  async cut<T>(work: () => Promise<T>): Promise<T> {
    const start = this.seconds();
    try {
      return await work();
    } finally {
      this.cuts.push([start, this.seconds()]);
    }
  }

  // 一段：先顯示字幕，再操作；失敗時記下來繼續錄下一段，最後一併回報
  async scene(key: string, act: () => Promise<void>, position: "top" | "bottom" = "bottom"): Promise<void> {
    try {
      this.position = position;
      this.caption = this.captions[key];
      await this.recaption();
      await pause(this.page, CAPTION_MS);
      await act();
      await pause(this.page, SCENE_END_MS);
    } catch (error) {
      this.failures.push(`${key}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }

  // 換頁（goto、setContent）後字幕會消失，重新放上
  async recaption(): Promise<void> {
    if (this.caption !== null) await showCaption(this.page, this.caption, this.position);
  }

  // 在目標上顯示圓圈、停一下再操作（預設是點擊）
  async tap(target: Locator, act: () => Promise<unknown> = () => target.click()): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box !== null) await showPointer(this.page, box.x + box.width / 2, box.y + box.height / 2, true);
    await pause(this.page, POINT_MS);
    await act();
    await pause(this.page, SETTLE_MS);
    await showPointer(this.page, 0, 0, false);
  }

  // 點欄位後逐字輸入
  async type(target: Locator, text: string): Promise<void> {
    await this.tap(target);
    await target.pressSequentially(text, { delay: TYPE_DELAY_MS });
    await pause(this.page, SETTLE_MS / 2);
  }

  // 指著某處（不點擊）
  async point(target: Locator, ms = 1_200): Promise<void> {
    if ((await target.count()) === 0) return;
    await this.tap(target.first(), () => pause(this.page, ms));
  }
}

// ---- 假的 /api/ask ----

const passagesIn = (text: string) =>
  [...text.matchAll(/<passage number="(\d+)"([^>]*)>\n([\s\S]*?)\n<\/passage>/g)].map(([, number, attrs, body]) => ({
    number: Number(number),
    language: /language="([^"]+)"/.exec(attrs)?.[1] ?? "",
    text: unescape(body),
  }));
const sse = (text: string) => ({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(text) });

// 只有一個身分看得到答案段落的題目：送出的段落含答案段落時回答，否則拒答（與 compare.spec.ts 相同）
function restrictedMarkers(lang: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const q of scenarios.scenarios.flatMap((x) => x.questions)) {
    const only = onlyOneSees(q.answerPassages, lang);
    if (only !== null) map.set(q.text[lang], only.markers);
  }
  return map;
}

// 說法不同的比對：走查用的通知中陳柏翰負責長堤專案的段落，與既有段落中張雅婷負責長堤專案的段落列為一組
function conflictReply(system: string, content: string): string {
  const fresh = passagesIn(/<new_document[^>]*>([\s\S]*?)<\/new_document>/.exec(content)?.[1] ?? "").find((p) => p.text.includes("陳柏翰"));
  const old = passagesIn(/<existing_passages>([\s\S]*?)<\/existing_passages>/.exec(content)?.[1] ?? "").find(
    (p) => /張雅婷|Yating Chang/.test(p.text) && /長堤|Longpier/.test(p.text),
  );
  if (fresh === undefined || old === undefined) return JSON.stringify({ conflicts: [] });
  const summary = /summary in English/.test(system) ? "Longpier lead: Yating Chang → Bohan Chen" : "長堤專案負責人：張雅婷 → 陳柏翰";
  return JSON.stringify({ conflicts: [{ new: fresh.number, existing: old.number, summary }] });
}

// 問答的回答引用與介面同語言的前兩段原文（README 的截圖相同）；其他請求交給 routeFakeAsk
async function routeTour(page: Page, lang: string): Promise<void> {
  const restricted = restrictedMarkers(lang);
  await blockModelDownload(page);
  await routeFakeAsk(page);
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    const system = body.system ?? "";
    const content = body.messages?.at(-1)?.content ?? "";
    if (system.startsWith("You compare a newly uploaded document")) return route.fulfill(sse(conflictReply(system, content)));
    if (!system.startsWith("You answer questions")) return route.fallback();
    const question = unescape(/<question>\n([\s\S]*?)\n<\/question>/.exec(content)?.[1] ?? "").trim();
    const markers = restricted.get(question);
    const sent = normalizeText(unescape(content));
    if (markers !== undefined && !markers.some((m) => sent.includes(m))) return route.fulfill(sse(REFUSAL_MARKER));
    const passages = passagesIn(content);
    const same = passages.filter((p) => p.language === lang);
    const quoted = (same.length > 0 ? same : passages).slice(0, 2);
    return route.fulfill(sse(quoted.map((p) => `${p.text} [${p.number}]`).join(" ")));
  });
}

// ---- 共用的操作 ----

async function newRecording(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    acceptDownloads: true,
    recordVideo: { dir: `${OUT_DIR}/raw`, size: viewport },
  });
  return { context, page: await context.newPage() };
}

// 打開網站後的介面一律是預設語言（client.json 的 defaultLanguage）：switchLanguage 以預設語言的文字找選單
async function useLanguage(page: Page, lang: string): Promise<void> {
  if ((await page.locator("html").getAttribute("lang")) === lang) return;
  await switchLanguage(page, lang);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

// 資料庫載入完成：首頁的常見問題可以按
const homeReady = (page: Page, t: Strings) => expect(page.getByRole("group", { name: t.home.commonQuestions }).getByRole("button").first()).toBeEnabled();

// 帳號登入（展示帳號＋邀請碼）；show 為 false 時不顯示圓圈與停頓（剪掉的部分）
async function signIn(tour: Tour, t: Strings, role: string, show: boolean): Promise<void> {
  const panel = tour.page.locator("section.sign-in");
  const card = panel.locator(".account-card").filter({ hasText: demoAccount(role) });
  const radio = panel.getByRole("radio", { name: demoAccount(role) });
  const code = panel.getByLabel(t.accessCodeLabel);
  const submit = panel.getByRole("button", { name: t.signInSubmit, exact: true });
  if (show) {
    await tour.tap(card, () => radio.check());
    await tour.type(code, ACCESS_CODE);
    await tour.tap(submit);
  } else {
    await radio.check();
    await code.fill(ACCESS_CODE);
    await submit.click();
  }
}

async function ask(tour: Tour, t: Strings, question: string): Promise<Locator> {
  const page = tour.page;
  await tour.type(page.getByPlaceholder(t.questionPlaceholder), question);
  await tour.tap(page.getByRole("button", { name: t.askButton, exact: true }));
  return waitForAnswer(page, t, question);
}

async function waitForAnswer(page: Page, t: Strings, question: string): Promise<Locator> {
  const answer = page.locator("section.answer").filter({ has: page.getByRole("heading", { name: question }) }).last();
  await expect(answer).toBeVisible();
  await expect(answer.getByText(t.answering)).toHaveCount(0);
  return answer;
}

// 圖譜中名稱不重複、關聯最多的節點，以及與它相隔兩步的節點（找路徑用）
async function graphPair(page: Page): Promise<{ hub: string; far: string | null }> {
  const nodes = await page.evaluate((selector) => {
    const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)!._cyreg!.cy!;
    return cy.nodes().map((n) => ({ id: n.id(), label: n.data("label"), neighbors: n.neighborhood("node").map((m) => m.id()) }));
  }, CANVAS);
  const unique = nodes.filter((n) => nodes.filter((m) => m.label === n.label).length === 1);
  const hub = unique.reduce((best, n) => (n.neighbors.length > best.neighbors.length ? n : best));
  const near = new Set(hub.neighbors);
  const far = unique.find((n) => n.id !== hub.id && !near.has(n.id) && n.neighbors.some((id) => near.has(id)));
  return { hub: hub.label, far: far?.label ?? null };
}

// 導覽中某一頁的按鈕（與 gotoView() 相同，以 data-view 找）
const navButton = (page: Page, view: string) => page.locator(`:is(.primary-tabs, .mobile-tabbar, .nav-rail) [data-view="${view}"]`);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function pickEntity(tour: Tour, label: string, name: string): Promise<void> {
  const page = tour.page;
  await tour.type(page.getByRole("combobox", { name: label, exact: true }), name);
  await tour.tap(page.getByRole("option", { name: new RegExp(`^${escapeRegExp(name)} `) }).first());
}

// ---- 分鏡 ----

async function recordDesktop(browser: Browser, lang: string, t: Strings): Promise<{ file: string; tour: Tour }> {
  const { context, page } = await newRecording(browser, DESKTOP);
  const tour = new Tour(page, captions[lang]);
  await routeTour(page, lang);

  await tour.cut(async () => {
    await page.goto("/");
    await expect(page.locator("section.sign-in")).toBeVisible();
    await useLanguage(page, lang);
  });

  // 1. 登入
  await tour.scene("signIn", async () => {
    await signIn(tour, t, staff!.id, true);
  });
  await tour.cut(() => homeReady(page, t));

  // 2. 首頁
  await tour.scene("home", async () => {
    await tour.point(page.locator(".home__stats"));
    for (const list of await page.locator(".home__list").all()) await tour.point(list, 900);
  });

  // 3. 問答：點預設問題，點引用標號看原文，「回答提到」
  const staffQuestion = scenarios.scenarios.find((x) => x.role === staff!.id)!.questions[0].text[lang];
  let staffAnswer: Locator | null = null;
  await tour.scene("qa", async () => {
    await tour.tap(page.getByRole("group", { name: t.home.commonQuestions }).getByRole("button", { name: staffQuestion, exact: true }));
    staffAnswer = await waitForAnswer(page, t, staffQuestion);
    await pause(page, 1_500);
  });
  await tour.scene("source", async () => {
    await tour.tap(staffAnswer!.locator("button.citation").first());
    const source = page.getByRole("complementary", { name: t.sourceTitle });
    await expect(source).toBeVisible();
    await pause(page, 2_000);
    await tour.tap(source.getByRole("button", { name: t.closeSource, exact: true }));
  });
  await tour.scene("mentions", async () => {
    const mention = staffAnswer!.getByRole("group", { name: t.answerMentions }).getByRole("button").first();
    const name = await mention.innerText();
    await tour.tap(mention);
    const panel = page.getByRole("complementary", { name, exact: true });
    await expect(panel).toBeVisible();
    await pause(page, 2_500);
    await tour.tap(panel.getByRole("button", { name: t.closeSource, exact: true }));
  });

  // 4. 拒答：一般員工看不到答案段落的題目
  const restricted = restrictedQuestion.text[lang];
  await tour.scene(
    "refusal",
    async () => {
      const answer = await ask(tour, t, restricted);
      await tour.point(answer.locator(".refusal-next"), 2_500);
    },
    "top",
  );

  // 5. 切換身分：登出，以主管登入，問同一題
  await tour.scene(
    "switchIdentity",
    async () => {
      await tour.tap(page.locator(".sidebar .user-card").getByRole("button", { name: t.signOut }));
      await expect(page.locator("section.sign-in")).toBeVisible();
      await useLanguage(page, lang);
      await signIn(tour, t, manager!.id, true);
      await tour.cut(() => homeReady(page, t));
      await tour.tap(navButton(page, "qa"));
      const answer = await ask(tour, t, restricted);
      await tour.tap(answer.locator("button.citation").first());
      const source = page.getByRole("complementary", { name: t.sourceTitle });
      await expect(source).toBeVisible();
      await pause(page, 2_000);
      await tour.tap(source.getByRole("button", { name: t.closeSource, exact: true }));
    },
    "top",
  );

  // 6. 圖譜：搜尋、展開、實體面板；兩個實體之間的路徑
  let pair: { hub: string; far: string | null } = { hub: "", far: null };
  await tour.cut(async () => {
    await gotoView(page, "graph");
    await waitForGraphIdle(page, CANVAS);
    pair = await graphPair(page);
  });
  await tour.scene("graph", async () => {
    await pickEntity(tour, t.graphSearch, pair.hub);
    const panel = page.getByRole("region", { name: pair.hub });
    await expect(panel).toBeVisible();
    await waitForGraphIdle(page, CANVAS);
    await tour.point(panel.getByRole("heading", { level: 2 }), 2_000);
  });
  await tour.scene("path", async () => {
    if (pair.far === null) return;
    await tour.tap(page.getByRole("button", { name: t.graphFindPath, exact: true }));
    await pickEntity(tour, t.pathTo, pair.far);
    await expect(page.locator(".path--panel > ol > li").first()).toBeVisible();
    await pause(page, 2_500);
  });

  // 7. 時間軸：依日期瀏覽、篩選、展開卡片
  await tour.scene("timeline", async () => {
    await tour.tap(navButton(page, "timeline"));
    await expect(page.locator(".timeline-card").first()).toBeVisible();
    await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
    await page.mouse.wheel(0, 500);
    await pause(page, 1_200);
    await page.mouse.wheel(0, -500);
    await pause(page, 800);
    const chips = page.locator(".timeline-filter button.chip");
    if ((await chips.count()) > 1) await tour.tap(chips.nth(1));
    const toggle = page.locator('ol.timeline > li:not(.dimmed) button.timeline-toggle[aria-expanded="false"]').first();
    if ((await toggle.count()) > 0) await tour.tap(toggle);
    await pause(page, 1_500);
  });

  // 8. 上傳：貼上文字、確認視窗、萃取進度；我的上傳
  await tour.scene("upload", async () => {
    await tour.tap(navButton(page, "upload"));
    const paste = page.getByPlaceholder(t.uploadPastePlaceholder);
    await tour.tap(paste, () => paste.fill(notice));
    await tour.tap(field(page, t.uploadDocTitle, "input"), () => field(page, t.uploadDocTitle, "input").fill(WALKTHROUGH_TITLE));
    await tour.tap(page.getByRole("button", { name: t.uploadPreview }));
    const dialog = page.getByRole("dialog", { name: t.uploadConfirmTitle });
    await expect(dialog).toBeVisible();
    await pause(page, 1_500);
    await tour.tap(dialog.getByRole("button", { name: t.uploadSubmit, exact: true }));
    await pause(page, 1_500);
    await tour.cut(() => expect(dialog.locator(".upload-step").nth(2)).toHaveAttribute("aria-current", "step", { timeout: 60_000 }));
    await pause(page, 1_500);
    await tour.tap(dialog.getByRole("button", { name: t.uploadAnother }));
    await expect(dialog).toBeHidden();
  });
  await tour.scene("myUploads", async () => {
    await tour.tap(page.getByRole("tab", { name: new RegExp(`^${escapeRegExp(t.myUploads.tabMine)}`) }));
    await tour.tap(page.locator(".my-upload").first());
    await expect(page.locator(".upload-detail__summary")).toBeVisible();
    await pause(page, 1_500);
  });

  // 9. 待審：需要決定的一組、說法不同的並列比較、核准全部
  const doc = page.locator("section.review-doc").filter({ hasText: WALKTHROUGH_TITLE });
  await tour.cut(async () => {
    await gotoView(page, "review");
    // 萃取與比對在背景執行：按重新整理直到這份文件（與說法不同的一組）出現；比對沒有找到時照常錄下去
    const refresh = () => page.getByRole("button", { name: t.reviewRefresh }).first().click();
    await expect(async () => {
      await refresh();
      await expect(doc).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(async () => {
      await refresh();
      await expect(doc.locator(".conflict-pair").first()).toBeVisible({ timeout: 2_000 });
    })
      .toPass({ timeout: 20_000 })
      .catch(() => undefined);
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await tour.scene("review", async () => {
    await tour.point(doc.getByText(t.reviewNeedsChoice));
    await tour.point(doc.locator("h2, h3").first(), 1_500);
  });
  await tour.scene("conflict", async () => {
    await tour.point(doc.locator(".conflict-pair"), 3_000);
  });
  await tour.scene("approve", async () => {
    await tour.tap(doc.getByRole("button", { name: t.reviewApproveDocument }).first());
    await pause(page, 1_500);
  });

  // 10. 評測台與品質報告（?tools=evals）
  await tour.cut(async () => {
    await page.goto(EVALS_PATH);
    await expect(page.locator("section.sign-in")).toBeVisible();
    await useLanguage(page, lang);
    await signIn(tour, t, manager!.id, false);
    await homeReady(page, t);
    await gotoView(page, "evals");
  });
  const actions = page.locator(".eval-actions button");
  await tour.scene("evals", async () => {
    await tour.tap(actions.nth(0));
    await tour.tap(page.getByRole("dialog", { name: t.evalConfirmTitle }).getByRole("button", { name: t.evalConfirmStart, exact: true }));
    await pause(page, 2_000);
    await tour.cut(() => expect(actions.nth(2)).toBeEnabled({ timeout: 420_000 }));
    await tour.point(page.locator(".eval-metric__value"), 2_000);
    await tour.tap(page.locator("tr.eval-row td.eval-number").first());
    await expect(page.locator("tr.eval-detail")).toHaveCount(1);
    await pause(page, 2_000);
  });
  await tour.scene("report", async () => {
    const download = page.waitForEvent("download");
    await tour.tap(actions.nth(2));
    const html = readFileSync((await (await download).path())!, "utf8");
    await page.setContent(html);
    await tour.recaption();
    await expect(page.locator("section.page").first()).toBeVisible();
    await pause(page, 1_500);
    await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
    await page.mouse.wheel(0, 700);
    await pause(page, 2_000);
  });

  // 11. 展示模式（?mode=presentation）：身分對照
  await tour.cut(async () => {
    await page.goto("/?mode=presentation");
    await page.getByLabel(defaultStrings.accessCodeLabel).fill(ACCESS_CODE);
    await page.getByRole("button", { name: defaultStrings.accessCodeSubmit }).click();
    await useLanguage(page, lang);
    await expect(page.getByRole("navigation", { name: t.presentation.script }).getByRole("button").first()).toBeEnabled();
  });
  await tour.scene(
    "presentation",
    async () => {
      const compare = page.getByRole("banner").getByRole("button", { name: t.presentation.compare });
      if ((await compare.count()) > 0) await tour.tap(compare);
      await tour.tap(page.getByRole("navigation", { name: t.presentation.script }).getByRole("button", { name: restricted, exact: true }));
      const answers = page.locator("section.answer");
      await expect(answers.first()).toBeVisible();
      await expect(page.getByText(t.answering)).toHaveCount(0);
      await pause(page, 4_000);
    },
    "top",
  );

  const video = page.video()!;
  await context.close();
  const file = `${OUT_DIR}/desktop-${lang}.webm`;
  await video.saveAs(file);
  return { file, tour };
}

// 12. 手機（390×844）：首頁、問答與圖譜
async function recordMobile(browser: Browser, lang: string, t: Strings): Promise<{ file: string; tour: Tour }> {
  const { context, page } = await newRecording(browser, MOBILE);
  const tour = new Tour(page, captions[lang]);
  await routeTour(page, lang);
  const question = managerQuestions[0].text[lang];

  await tour.cut(async () => {
    await page.goto("/");
    await page.getByRole("button", { name: defaultStrings.signInWithCode }).click();
    await page.getByLabel(defaultStrings.accessCodeLabel).fill(ACCESS_CODE);
    await page.getByRole("button", { name: defaultStrings.accessCodeSubmit }).click();
    await homeReady(page, defaultStrings);
    // 身分卡片以預設語言的名稱找：先切身分再切語言
    await switchIdentity(page, manager!.id);
    await useLanguage(page, lang);
    await gotoView(page, "home");
    await homeReady(page, t);
  });
  await tour.scene("mobile", async () => {
    await pause(page, 1_000);
    await tour.tap(page.getByRole("group", { name: t.home.commonQuestions }).getByRole("button", { name: question, exact: true }));
    await waitForAnswer(page, t, question);
    await pause(page, 2_000);
    await tour.tap(page.locator('.mobile-tabbar [data-view="graph"], .mobile-tabbar [data-view="more"]').first(), () => gotoView(page, "graph"));
    await waitForGraphIdle(page, CANVAS);
    await pause(page, 2_000);
  });

  const video = page.video()!;
  await context.close();
  const file = `${OUT_DIR}/mobile-${lang}.webm`;
  await video.saveAs(file);
  return { file, tour };
}

test.describe.configure({ retries: 0 });

for (const lang of LANGUAGES) {
  test(`功能介紹影片（${lang}）`, async ({ browser }) => {
    test.skip(!client.languages.includes(lang), `client.json 的 languages 沒有 ${lang}`);
    test.skip(staff === undefined || manager === undefined, "access.json 沒有能上傳、不能審查的身分，或同時能上傳與審查的身分");
    test.skip(access.roles.length < 2, "access.json 的身分少於兩個");
    test.setTimeout(1_200_000);
    mkdirSync(OUT_DIR, { recursive: true });
    const t = stringsOf(lang);

    const desktop = await recordDesktop(browser, lang, t);
    const mobile = await recordMobile(browser, lang, t);
    const output = `${OUT_DIR}/video-tour-${lang}.mp4`;
    const { seconds, bytes, crf } = encode(
      [
        { file: desktop.file, cuts: desktop.tour.cuts, kind: "desktop" },
        { file: mobile.file, cuts: mobile.tour.cuts, kind: "mobile" },
      ],
      output,
    );
    const summary = `${output}：${seconds.toFixed(1)} 秒、${(bytes / 1024 / 1024).toFixed(2)} MB（crf ${crf}）`;
    console.log(summary);
    test.info().annotations.push({ type: "video-tour", description: summary });

    expect([...desktop.tour.failures, ...mobile.tour.failures], "失敗的段落").toEqual([]);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(seconds).toBeGreaterThanOrEqual(MIN_SECONDS);
    expect(seconds).toBeLessThanOrEqual(MAX_SECONDS);
  });
}

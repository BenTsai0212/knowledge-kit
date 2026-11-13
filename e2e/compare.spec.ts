// 展示模式的身分對照（#261，docs/design.md「展示模式」的「身分對照」、docs/qa.md「身分對照」）。
// 開關 VITE_DEMO_COMPARE 預設關閉，E2E 的 build 以 VITE_DEMO_COMPARE=1 開啟（.github/workflows/e2e.yml、docs/testing.md）。
// /api/ask 是假的回應：送出的段落含「只有一個身分看得到的答案段落」時回答（引用 [1]），其他時候回拒答標記。
import { expect, test } from "@playwright/test";
import { REFUSAL_MARKER } from "../app/src/qa/prompt";
import { identitySegments, language, openApp, s } from "./support/app";
import { access, scenarios } from "./support/client";
import { leakedPassages, normalizeText, onlyOneSees, passagesContaining } from "./support/dataset";
import { FAKE_ANSWER_LEAD, sseBody } from "./support/fake-ask";

const enabled = process.env.VITE_DEMO_COMPARE === "1";

// 劇本中只有一個身分看得到答案段落（介面語言）的題目：參考情境是主管的題目
const candidates = scenarios.scenarios.flatMap((x) =>
  x.questions.map((q) => ({ text: q.text[language], answerPassages: q.answerPassages, only: onlyOneSees(q.answerPassages, language) })),
);
const target = candidates.find((q) => q.only !== null);

// 不需要瀏覽器與開關（每個客戶的 E2E 都執行）：假的 /api/ask 用的比對文字只出現在一個答案段落，
// 其他身分送出開頭相同的段落（例如公開的產品總覽）時不會被誤判成答案（#261 修正要求）
test("只有一個身分看得到的題目：比對文字只出現在一個答案段落", () => {
  for (const q of candidates.filter((c) => c.only !== null)) {
    for (const marker of q.only!.markers) {
      const found = passagesContaining(marker);
      expect(found, `「${q.text}」的比對文字「${marker}」`).toHaveLength(1);
      expect(q.answerPassages).toContain(found[0]);
    }
  }
});

test.describe("畫面", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!enabled, "身分對照的開關 VITE_DEMO_COMPARE 沒有開啟：以 VITE_DEMO_COMPARE=1 npm run build 後執行");
    await openApp(page, "/?mode=presentation");
  });

  const compareButton = (page: import("@playwright/test").Page) => page.getByRole("banner").getByRole("button", { name: s.presentation.compare });

  test("頂端列的按鈕開關對照；每個身分一欄、目前身分的欄 primary 框線；只有一個身分有答案的題目，其他欄是一般的拒答", async ({ page }) => {
    test.skip(target === undefined, "scenarios.json 沒有只有一個身分看得到答案段落（介面語言）的題目");
    const { text, only } = target!;
    // 送出的段落含答案段落時回答，否則拒答（每一欄各自以該身分檢索，所以只有看得到的身分送出答案段落）
    await page.route("**/api/ask", async (route) => {
      const body = route.request().postDataJSON() as { messages?: { content: string }[] };
      const sent = normalizeText(body.messages?.map((m) => m.content).join("\n") ?? "");
      const reply = only!.markers.some((marker) => sent.includes(marker)) ? `${FAKE_ANSWER_LEAD} [1]。` : REFUSAL_MARKER;
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(reply) });
    });

    const button = compareButton(page);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const compare = page.getByRole("region", { name: s.presentation.compare });
    await expect(compare.getByText(s.presentation.compareEmpty)).toBeVisible();

    // 對照打開時點劇本的題目：切到情境的身分，這一題以每個身分各送出一次
    await page.getByRole("navigation", { name: s.presentation.script }).getByRole("button", { name: text, exact: true }).click();
    await expect(compare.locator(".compare__question")).toHaveText(text);
    const columns = compare.locator(".compare__column");
    await expect(columns).toHaveCount(access.roles.length);
    const current = (await identitySegments(page).getByRole("radio", { checked: true }).getAttribute("value"))!;
    for (const [index, role] of access.roles.entries()) {
      const column = columns.nth(index);
      await expect(column).toHaveAttribute("data-role", role.id);
      await expect(column.locator("section.answer > h2")).toHaveText(role.label[language]);
      if (role.id === current) await expect(column).toHaveClass(/is-current/);
      else await expect(column).not.toHaveClass(/is-current/);
      if (role.id === only!.role) {
        await expect(column).toContainText(FAKE_ANSWER_LEAD);
        await expect(column.getByRole("button", { name: "1", exact: true })).toBeVisible();
      } else {
        // 與一般拒答相同：拒答文字與「可以試試」，沒有引用
        await expect(column.locator(".refusal")).toContainText(s.refusal);
        await expect(column.getByText(s.refusalNextTitle)).toBeVisible();
        await expect(column.locator("button.citation")).toHaveCount(0);
      }
      // 每一欄只出現該身分看得到的段落
      expect(leakedPassages(await column.innerText(), role.id)).toEqual([]);
    }
    await expect(compare.locator(".compare__column.is-current")).toHaveCount(1);

    // C 關閉對照，回到原本的對話
    await page.locator("body").press("c");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(compare).toHaveCount(0);
  });

  test("C 打開、Esc 關閉；減少動態效果時各欄直接到位", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const button = compareButton(page);
    await page.locator("body").press("c");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.locator("body").press("Escape");
    await expect(button).toHaveAttribute("aria-pressed", "false");

    await page.locator("body").press("c");
    const question = page.getByLabel(s.questionLabel);
    await question.fill(target?.text ?? scenarios.scenarios[0].questions[0].text[language]);
    await page.getByRole("button", { name: s.askButton, exact: true }).click();
    const column = page.locator(".compare__column").first();
    await expect(column).toBeVisible();
    await expect(column).toHaveCSS("animation-duration", "0s");
    // 焦點在輸入框時 C 是文字，不關閉對照
    await question.press("c");
    await expect(button).toHaveAttribute("aria-pressed", "true");
  });
});

// 品質報告（#210，docs/evals.md「品質報告」）的 HTML：自成一頁、可列印成 PDF，不依賴外部資源（CSS 寫在檔案內，不用字型、圖片或 script）。
// 輸入是 qualityReport() 的結果，只有序號、類別、身分、數字與判定；所有文字經 escapeHtml() 跳脫。
// 版面照畫板 J-Report（#347，docs/design.md「品質報告的列印版面」）：A4 直式，每頁是一個 <section class="page">，頁尾是「客戶 · 品質報告」與「第 N／M 頁」。
// 第 1 頁給決策者（頁首、結論、四項指標、各身分的滲漏、這份報告不代表什麼），附錄（從第 2 頁開始）給知識負責人；
// 未通過的題目全部列出，放不下時延續到下一頁（appendixPages()）。「原因」「處理方式」以 contenteditable 填寫，不會自動保存。
import { fill, strings } from "../client/i18n";
import type { AccessFile, LanguageCode } from "../client/types";
import type { MetricKey, MetricResult, QualityReport, StabilityNote } from "./report";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 附錄的分頁：以「列」為單位估算一頁 A4 的高度（未通過的題目一題一列；矩陣、表頭與測試條件換算成列數）。
// 第 2 頁先放身分 × 類別，未通過的題目放不下時延續到下一頁；測試條件放在最後一頁，放不下時自成一頁
export const PAGE_ROWS = 20;
const FAILURES_HEAD_ROWS = 2;
const CONDITIONS_ROWS = 6;
const matrixRows = (roles: number) => roles + 3;

export interface AppendixPage {
  // 這一頁列出的未通過題目（failures 的索引，from 含、to 不含）
  from: number;
  to: number;
  // 第一頁附錄：身分 × 類別
  matrix: boolean;
  // 最後一頁：測試條件
  conditions: boolean;
}

export function appendixPages(failures: number, roles: number): AppendixPage[] {
  const pages: AppendixPage[] = [];
  let from = 0;
  for (;;) {
    const first = pages.length === 0;
    const budget = PAGE_ROWS - (first ? matrixRows(roles) : 1) - FAILURES_HEAD_ROWS;
    const rest = failures - from;
    if (rest <= budget - CONDITIONS_ROWS) {
      pages.push({ from, to: failures, matrix: first, conditions: true });
      return pages;
    }
    const to = Math.min(failures, from + Math.max(1, budget));
    pages.push({ from, to, matrix: first, conditions: false });
    from = to;
  }
}

// 不寫死顏色：文字、條狀圖與框線用 currentColor（墨色），紙張是系統色 Canvas，淺灰底與次要文字以 color-mix() 由兩者調出；
// 通過與否用 ✓／✕ 與文字，黑白列印也看得懂。字型用系統字型堆疊（不載入外部字型）。
// 螢幕上每頁是一張 A4 的紙；列印時頁邊是 0，每頁的 section 自己留白，頁尾頁碼由 HTML 寫出（每頁一個 .page-foot）。
// 指標表固定欄寬：英文的指標名稱允許兩行，第一頁仍固定一頁。
const STYLE = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { --muted: color-mix(in srgb, currentColor 72%, Canvas); --line: color-mix(in srgb, currentColor 22%, Canvas); --tint: color-mix(in srgb, currentColor 8%, Canvas);
  margin: 0; padding: 24px 0; background: color-mix(in srgb, currentColor 16%, Canvas); font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; font-size: 13px; line-height: 1.5; }
.note { width: 210mm; margin: 0 auto 12px; border: 1px dashed; border-radius: 8px; padding: 10px 16px; background: Canvas; }
.page { width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 15mm 16mm 12mm; background: Canvas; box-shadow: 0 4px 24px color-mix(in srgb, currentColor 18%, transparent); display: flex; flex-direction: column; gap: 22px; }
.page > section { display: flex; flex-direction: column; gap: 8px; }
h1, h2, p, ul, dl, dd { margin: 0; }
h2 { font-size: 15px; }
.masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 2px solid; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand div { display: flex; flex-direction: column; }
.brand b { font-size: 20px; }
.brand span, .muted, .fine { color: var(--muted); }
.meta { display: grid; grid-template-columns: auto auto; gap: 2px 12px; font-size: 12px; text-align: right; }
.meta dt { color: var(--muted); }
.lead { display: flex; flex-direction: column; gap: 10px; }
.lead h1 { font-size: 28px; line-height: 1.35; font-weight: 900; }
.fine { font-size: 11px; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px; text-align: left; vertical-align: top; border-top: 1px solid var(--line); }
thead th { font-size: 11px; font-weight: normal; color: var(--muted); border-top: 0; }
.metrics { table-layout: fixed; }
.metrics th, .metrics td { padding: 10px 6px; vertical-align: middle; overflow-wrap: anywhere; }
.metrics .name { width: 7.5rem; }
.metrics .value { width: 7.5rem; }
.metrics .second { width: 6rem; }
.metrics .verdict { width: 5.5rem; }
.num { font-variant-numeric: tabular-nums; }
.bar { position: relative; height: 14px; border-radius: 3px; background: var(--tint); }
.bar .fill { position: absolute; left: 0; top: 0; height: 0; border-top: 14px solid; border-radius: 3px; }
.bar .limit { position: absolute; top: -5px; bottom: -5px; border-left: 2px dashed; }
.unmet .bar .limit { border-left-width: 3px; }
.unmet .verdict { font-weight: bold; }
.roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 10px; padding: 0; list-style: none; }
.roles li { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; }
.roles span { font-size: 12px; color: var(--muted); }
.roles strong { font-size: 20px; font-weight: 900; }
.limits { padding: 16px 18px; border: 1.5px solid; border-radius: 8px; }
.limits ul { padding-left: 1.1rem; font-size: 12px; }
.appendix-head { padding-bottom: 12px; border-bottom: 2px solid; }
.appendix-head h1 { font-size: 20px; }
.grid { font-size: 12px; border: 1px solid var(--line); }
.grid thead th { background: var(--tint); font-size: 12px; font-weight: bold; color: inherit; }
.matrix td { text-align: center; }
.matrix th[scope="row"] { text-align: left; }
.matrix .miss { font-weight: bold; background: var(--tint); }
.field { min-height: 30px; min-width: 6rem; border: 1px dashed var(--muted); border-radius: 4px; padding: 4px 6px; }
.conditions { display: grid; grid-template-columns: 7rem minmax(0, 1fr) 7rem minmax(0, 1fr); gap: 8px 14px; font-size: 12px; }
.conditions dt { color: var(--muted); }
.page-foot { margin-top: auto; display: flex; justify-content: space-between; gap: 16px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
@media print {
  body { padding: 0; background: none; font-size: 10pt; }
  .note { display: none; }
  .page { margin: 0; box-shadow: none; min-height: 296mm; break-after: page; }
  .page:last-child { break-after: auto; }
  .appendix { break-before: page; }
  tr { break-inside: avoid; }
  .field { border: 0; border-bottom: 1px solid; border-radius: 0; }
  .bar, .grid thead th, .matrix .miss { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

// 產品 icon 的單色版（K 晶格，路徑與 app/src/ui/ProductIcon.tsx 的 ICON_PATH 相同）：線條與節點都是 currentColor，證據節點是空心
const ICON =
  '<svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true"><path d="M17 12v24M17 24 32 13.5M17 24l15 10.5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"></path>' +
  '<circle cx="17" cy="24" r="3.5" fill="currentColor"></circle><circle cx="32" cy="34.5" r="4.5" fill="currentColor"></circle><circle cx="32" cy="13.5" r="4" fill="none" stroke="currentColor" stroke-width="2.5"></circle></svg>';

const percent = (rate: number) => Math.round(rate * 1000) / 10;
// 條狀圖的寬度與門檻位置（0–100%）
const position = (part: number, whole: number) => (whole <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((part / whole) * 1000) / 10)));
// ISO 時間 → 「YYYY-MM-DD HH:MM UTC」（不依執行環境的時區）
const time = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function reportHtml(report: QualityReport, access: AccessFile, language: LanguageCode, clientName: string): string {
  const s = strings(language);
  const t = s.evalReport;
  const f = (template: string, values: Record<string, string | number>) => fill(template, values, language);
  const e = escapeHtml;
  const roleLabel = (id: string) => access.roles.find((r) => r.id === id)?.label[language] ?? id;
  const levelLabel = (id: string) => access.visibilityLevels.find((l) => l.id === id)?.label[language] ?? id;
  const metricLabel = (key: MetricKey) => s.evalMetrics[key];
  const settings = (x: { topK: number; minScore: number }) => f(s.evalSettingsValue, x);
  const row = (cells: string[], tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  const mark = (pass: boolean, label: string) => `${pass ? t.passMark : t.failMark} ${label}`;
  const { headline, conditions, coverage } = report;
  const { provider } = conditions;
  const bank = conditions.bank;

  const value = (key: MetricKey, m: MetricResult) =>
    key === "leakage" ? f(s.evalLeakCount, { count: m.passed }) : m.rate === null ? s.evalNotApplicable : f(s.evalRate, { passed: m.passed, total: m.total, percent: percent(m.rate) });
  const threshold = (key: MetricKey, n: number) => (key === "leakage" ? f(s.evalAtMost, { count: n }) : f(s.evalAtLeast, { percent: percent(n) }));
  const verdict = (b: boolean | null) => (b === null ? t.undetermined : mark(b, b ? t.metLabel : t.unmetLabel));

  // 頁首：K icon、報告名稱與產品名；右側是客戶、評測日期、題庫版本
  const meta: [string, string][] = [
    [t.client, clientName],
    [t.evaluatedOn, conditions.startedAt.slice(0, 10)],
    [t.bank, bank?.hash ?? t.unknown],
  ];
  const masthead =
    `<header class="masthead"><div class="brand">${ICON}<div><b>${e(t.title)}</b><span>${e(s.productName)}</span></div></div>` +
    `<dl class="meta">${meta.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join("")}</dl></header>`;

  // 結論式標題
  const unmet = report.metrics
    .filter((m) => headline.unmet.includes(m.key))
    .map((m) => (m.key === "leakage" || m.rate === null ? metricLabel(m.key) : f(t.unmetItem, { metric: metricLabel(m.key), percent: percent(m.rate), threshold: percent(m.threshold) })));
  const title =
    f(t.headline, { questions: headline.questions, leaked: headline.leaked }) +
    (!headline.complete ? t.headlineIncomplete : unmet.length > 0 ? f(t.headlineUnmet, { metrics: unmet.join(s.listSeparator) }) : t.headlineMet) +
    (headline.second === "bothMet" ? t.headlineBothMet : headline.second === "secondUnmet" ? t.headlineSecondUnmet : "");

  // 結論下方的說明：另一次評測的日期與設定、兩次結果不同的題數與註明
  const notes: Record<StabilityNote, string> = {
    bankDiffers: t.noteBankDiffers,
    bankUnknown: t.noteBankUnknown,
    incomplete: t.noteIncomplete,
    settingsDiffer: t.noteSettingsDiffer,
  };
  const st = report.stability;
  const stability =
    st === null
      ? ""
      : `<p class="stability"><strong>${e(t.stabilityTitle + s.colon)}</strong>${e(
          [
            f(t.stabilityWith, { date: time(st.startedAt), settings: settings(st.settings) }),
            ...(st.differing === null ? [] : [f(t.stabilityDiffering, { count: st.differing })]),
            ...st.notes.map((n) => notes[n]),
            ...(!headline.complete ? [t.noteCurrentIncomplete] : []),
          ].join(" "),
        )}</p>`;

  // 四項指標：條狀圖（墨色）對照門檻（虛線）；權限滲漏以題數為刻度，門檻是上限。
  // 有第二次時多一欄「第二次」，兩次都達到的列標「✓ 兩次」
  const bar = (key: MetricKey, m: MetricResult, limit: number) => {
    const width = key === "leakage" ? position(m.passed, m.total) : m.rate === null ? 0 : position(m.rate, 1);
    const at = key === "leakage" ? position(limit, m.total) : position(limit, 1);
    return `<div class="bar" aria-hidden="true"><span class="fill" style="width: ${width}%"></span><span class="limit" style="left: ${at}%"></span></div>`;
  };
  const twoRuns = report.metrics.some((m) => m.second !== null);
  const columns = ["name", "result", "value", ...(twoRuns ? ["second"] : []), "verdict"];
  const metricRows = report.metrics.map(
    (m) =>
      `<tr${m.meets === false ? ' class="unmet"' : ""}>` +
      `<th scope="row">${e(metricLabel(m.key))}</th>` +
      `<td>${bar(m.key, m, m.threshold)}</td>` +
      `<td class="num">${e(value(m.key, m))}</td>` +
      (twoRuns ? `<td class="num muted">${e(m.second === null ? t.undetermined : value(m.key, m.second))}</td>` : "") +
      `<td class="verdict">${e(m.bothMeet === true ? mark(true, t.bothLabel) : verdict(m.meets))}</td>` +
      `</tr>`,
  );
  const metricsTable =
    `<table class="metrics"><colgroup>${columns.map((c) => `<col class="${c}">`).join("")}</colgroup>` +
    `<thead>${row([s.evalMetric, t.result, t.current, ...(twoRuns ? [t.second] : []), t.meets].map(e), "th")}</thead>` +
    `<tbody>${metricRows.join("")}</tbody></table>`;
  const thresholds = report.metrics.map((m) => `${metricLabel(m.key)} ${threshold(m.key, m.threshold)}`).join(s.listSeparator);

  const roleCards = report.roles
    .map((r) => `<li><span>${e(f(t.roleCard, { role: roleLabel(r.role), questions: r.questions }))}</span><strong>${e(mark(r.leaked === 0, f(t.roleLeaked, { leaked: r.leaked })))}</strong></li>`)
    .join("");

  // 頁尾：左邊「客戶 · 品質報告」，右邊「第 N／M 頁」
  const footer = (page: number, pages: number) =>
    `<footer class="page-foot"><span>${e(f(t.footerTitle, { client: clientName }))}</span><span>${e(f(t.page, { page, pages }))}</span></footer>`;

  const scope = f(t.limitScope, { documents: coverage.total });
  const first = (pages: number) => `
<section class="page first" aria-label="${e(f(t.page, { page: 1, pages }))}">
${masthead}
<div class="lead"><h1>${e(title)}</h1>${stability}</div>
<section><h2>${e(t.metricsTitle)}</h2>
${metricsTable}
<p class="fine">${e(t.thresholdLegend)} ${e(f(t.thresholdList, { thresholds }))}</p></section>
<section><h2>${e(t.rolesTitle)}</h2>
<ul class="roles">${roleCards}</ul>
<p class="fine">${e(t.leakExplain)}</p></section>
<section class="limits"><h2>${e(t.limitsTitle)}</h2>
<ul>${[f(t.limitQuestions, { questions: headline.questions }), t.limitAccess, scope].map((x) => `<li>${e(x)}</li>`).join("")}</ul></section>
${footer(1, pages)}
</section>`;

  // 附錄：身分 × 類別（✕ 標出有未通過的格）、未通過的題目、測試條件
  const matrix =
    `<table class="grid matrix"><thead>${row([t.role, ...report.categories.map((c) => s.evalCategories[c])].map(e), "th")}</thead><tbody>` +
    report.roles
      .map(
        (r) =>
          `<tr><th scope="row">${e(roleLabel(r.role))}</th>` +
          report.categories
            .map((c) => {
              const cell = report.matrix.find((m) => m.role === r.role && m.category === c);
              if (cell === undefined) return "<td></td>";
              const text = f(t.matrixCell, cell);
              return cell.passed < cell.total ? `<td class="miss">${e(`${t.failMark} ${text}`)}</td>` : `<td>${e(text)}</td>`;
            })
            .join("") +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`;
  const restricted = report.roles.filter((r) => r.restricted).map((r) => roleLabel(r.role));
  const restrictedNote = restricted.length === 0 ? "" : `<p class="fine">${e(f(t.restrictedNote, { roles: restricted.join(s.listSeparator), count: report.restrictedFailures }))}</p>`;
  // 可填寫的欄位：螢幕上是虛線框，列印時變成底線
  const field = (label: string) => `<td><div class="field" contenteditable="true" role="textbox" aria-label="${e(label)}"></div></td>`;
  const failureRows = (from: number, to: number) =>
    `<table class="grid failures"><thead>${row([t.number, t.role, t.category, t.failed, t.reason, t.action].map(e), "th")}</thead><tbody>` +
    report.failures
      .slice(from, to)
      .map(
        (x) =>
          `<tr>${[String(x.number), roleLabel(x.role), s.evalCategories[x.category], x.failed.map(metricLabel).join(s.listSeparator)].map((c) => `<td>${e(c)}</td>`).join("")}` +
          `${field(t.reason)}${field(t.action)}</tr>`,
      )
      .join("") +
    `</tbody></table>`;
  const conditionRows: [string, string][] = [
    [t.bank, bank?.hash == null ? t.unknown : f(t.bankValue, { hash: bank.hash, questions: bank.questions, date: conditions.startedAt.slice(0, 10) })],
    [t.coverage, [f(t.coverageValue, { covered: coverage.covered, total: coverage.total }), ...coverage.levels.map((l) => f(t.coverageLevel, { ...l, level: levelLabel(l.level) }))].join(s.listSeparator)],
    [t.scope, scope],
    [t.settings, settings(conditions.settings)],
    [t.retrieval, provider + (conditions.notApplicable > 0 ? s.listSeparator + f(t.notApplicable, { count: conditions.notApplicable }) : "")],
    [t.mode, conditions.mode === "model" ? t.modeModel : t.modeKeyPoints],
    [t.model, conditions.model ?? t.unknown],
    [t.calls, conditions.calls === null ? t.unknown : f(t.callsValue, { count: conditions.calls })],
    [t.date, f(t.dateValue, { start: time(conditions.startedAt), end: conditions.finishedAt === null ? t.unknown : time(conditions.finishedAt) })],
  ];

  const layout = appendixPages(report.failures.length, report.roles.length);
  const pages = 1 + layout.length;
  const appendix = layout.map((p, i) => {
    const failures =
      report.failures.length === 0
        ? i === 0
          ? `<section><h2>${e(t.failuresTitle)}</h2><p>${e(t.noFailures)}</p></section>`
          : ""
        : p.from < p.to
          ? `<section><h2>${e(t.failuresTitle)}</h2>${failureRows(p.from, p.to)}</section>`
          : "";
    return `
<section class="page appendix" aria-label="${e(f(t.page, { page: i + 2, pages }))}">
<header class="appendix-head"><h1>${e(t.appendixTitle)}</h1></header>
${p.matrix ? `<section><h2>${e(t.matrixTitle)}</h2>${matrix}${restrictedNote}</section>` : ""}
${failures}
${p.conditions && bank?.hash != null ? `<p class="fine">${e(f(t.numberNote, { hash: bank.hash }))}</p>` : ""}
${p.conditions ? `<section><h2>${e(t.conditionsTitle)}</h2><dl class="conditions">${conditionRows.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join("")}</dl></section>` : ""}
${footer(i + 2, pages)}
</section>`;
  });

  return `<!doctype html>
<html lang="${e(language)}">
<head>
<meta charset="utf-8">
<title>${e(t.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<p class="note">${e(t.editNote)}</p>
${first(pages)}
${appendix.join("")}
</body>
</html>
`;
}

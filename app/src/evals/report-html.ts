// 品質報告（#210，docs/evals.md「品質報告」）的 HTML：自成一頁、可列印成 PDF，不依賴外部資源（CSS 寫在檔案內，不用字型、圖片或 script）。
// 輸入是 qualityReport() 的結果，只有序號、類別、身分、數字與判定；所有文字經 escapeHtml() 跳脫。
// 版面見 docs/design.md「品質報告的列印版面」（#281）：A4 直式，第一頁給決策者，附錄（列印時從新的一頁開始）給知識負責人；
// 「原因」「處理方式」以 contenteditable 填寫，不會自動保存。
import { fill, strings } from "../client/i18n";
import type { AccessFile, LanguageCode } from "../client/types";
import type { MetricKey, MetricResult, QualityReport, StabilityNote } from "./report";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// CSS 字串：以十六進位跳脫反斜線、引號、角括號與換行（客戶名稱來自 client.json，不能關閉 <style>）
export function cssString(text: string): string {
  return `"${text.replace(/[\\"'<>\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

// 不寫死顏色：條狀圖與框線用 currentColor（墨色），底色只用 currentColor 調淡的淺灰；通過與否用 ✓／✕ 與文字，黑白列印也看得懂。
// 字型用系統字型堆疊（不載入外部字型）。頁尾以 @page 的頁邊區塊加上頁碼（內容由 reportHtml() 以介面文字組成）。
// 指標表固定欄寬：英文的指標名稱允許兩行，第一頁仍固定一頁。
const style = (footer: string) => `
@page { size: A4 portrait; margin: 14mm 15mm 16mm; @bottom-center { content: ${footer}; font-size: 8pt; } }
body { font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; line-height: 1.45; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.35rem; line-height: 1.3; margin: 0.75rem 0; }
h2 { font-size: 1rem; margin: 1rem 0 0.25rem; }
table { border-collapse: collapse; width: 100%; margin: 0.25rem 0 0.75rem; }
th, td { border: 1px solid; padding: 0.25rem 0.4rem; text-align: left; vertical-align: top; }
ul { margin: 0.25rem 0; padding-left: 1.25rem; }
.masthead { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; border-bottom: 2px solid; padding-bottom: 0.25rem; font-size: 0.85rem; }
.fine { font-size: 0.85rem; margin: 0.25rem 0; }
.metrics { table-layout: fixed; }
.metrics th, .metrics td { vertical-align: middle; overflow-wrap: anywhere; }
.metrics .name { width: 8.5rem; }
.metrics .threshold, .metrics .verdict, .metrics .both { width: 5.5rem; }
.metrics .second { width: 7rem; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 0.85rem; }
.bar { position: relative; height: 0.7rem; margin: 0.3rem 0 0.15rem; background: color-mix(in srgb, currentColor 12%, transparent); }
.bar .fill { position: absolute; left: 0; top: 0; height: 0; border-top: 0.7rem solid; }
.bar .limit { position: absolute; top: -0.2rem; bottom: -0.2rem; border-left: 1.5px dashed; }
.unmet .bar .limit { border-left-width: 3px; }
.unmet .verdict { font-weight: bold; }
.field { min-height: 1.5rem; min-width: 6rem; border: 1px dashed; padding: 0.1rem 0.25rem; }
.note { border: 1px dashed; padding: 0.5rem; }
@media print {
  body { margin: 0; max-width: none; padding: 0; font-size: 10pt; }
  .note { display: none; }
  .appendix { break-before: page; }
  tr { break-inside: avoid; }
  .field { border: 0; border-bottom: 1px solid; }
  .bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

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
  const table = (head: string[], rows: string[]) => `<table><thead>${row(head.map(e), "th")}</thead><tbody>${rows.join("")}</tbody></table>`;
  const mark = (pass: boolean, label: string) => `${pass ? t.passMark : t.failMark} ${label}`;
  const { headline, conditions, coverage } = report;
  const { provider } = conditions;
  const bank = conditions.bank;

  const value = (key: MetricKey, m: MetricResult) =>
    key === "leakage" ? f(s.evalLeakCount, { count: m.passed }) : m.rate === null ? s.evalNotApplicable : f(s.evalRate, { passed: m.passed, total: m.total, percent: percent(m.rate) });
  const threshold = (key: MetricKey, n: number) => (key === "leakage" ? f(s.evalAtMost, { count: n }) : f(s.evalAtLeast, { percent: percent(n) }));
  const verdict = (b: boolean | null) => (b === null ? t.undetermined : mark(b, b ? t.metLabel : t.unmetLabel));
  const both = (b: boolean | null) => (b === null ? t.undetermined : mark(b, t.bothLabel));

  // 頁首：產品名、客戶、評測日期、題庫版本
  const masthead = [
    `<strong>${e(s.productName)}</strong>`,
    e(clientName),
    e(t.title),
    e(t.evaluatedOn + s.colon + conditions.startedAt.slice(0, 10)),
    e(t.bank + s.colon + (bank?.hash ?? t.unknown)),
  ]
    .map((x) => `<span>${x}</span>`)
    .join("");

  // 頁尾「客戶 · 品質報告 第 N／M 頁」：{page}、{pages} 換成 CSS 的頁碼計數器
  const footer = fill(t.footer, { client: clientName }, language)
    .split(/(\{pages?\})/)
    .map((part) => (part === "{page}" ? "counter(page)" : part === "{pages}" ? "counter(pages)" : part === "" ? "" : cssString(part)))
    .filter((x) => x !== "")
    .join(" ");

  // 結論式標題
  const unmet = report.metrics
    .filter((m) => headline.unmet.includes(m.key))
    .map((m) => (m.key === "leakage" || m.rate === null ? metricLabel(m.key) : f(t.unmetItem, { metric: metricLabel(m.key), percent: percent(m.rate), threshold: percent(m.threshold) })));
  const title =
    f(t.headline, { questions: headline.questions, leaked: headline.leaked }) +
    (!headline.complete ? t.headlineIncomplete : unmet.length > 0 ? f(t.headlineUnmet, { metrics: unmet.join(s.listSeparator) }) : t.headlineMet) +
    (headline.second === "bothMet" ? t.headlineBothMet : headline.second === "secondUnmet" ? t.headlineSecondUnmet : "");

  // 四項指標：條狀圖（墨色）對照門檻（虛線）；權限滲漏以題數為刻度，門檻是上限
  const bar = (key: MetricKey, m: MetricResult, limit: number) => {
    const width = key === "leakage" ? position(m.passed, m.total) : m.rate === null ? 0 : position(m.rate, 1);
    const at = key === "leakage" ? position(limit, m.total) : position(limit, 1);
    return `<div class="bar" aria-hidden="true"><span class="fill" style="width: ${width}%"></span><span class="limit" style="left: ${at}%"></span></div>`;
  };
  const twoRuns = report.metrics.some((m) => m.second !== null);
  const columns = ["name", "result", "threshold", "verdict", ...(twoRuns ? ["second", "both"] : [])];
  const metricRows = report.metrics.map(
    (m) =>
      `<tr${m.meets === false ? ' class="unmet"' : ""}>` +
      `<th scope="row">${e(metricLabel(m.key))}</th>` +
      `<td>${bar(m.key, m, m.threshold)}<span class="num">${e(value(m.key, m))}</span></td>` +
      `<td class="num">${e(threshold(m.key, m.threshold))}</td>` +
      `<td class="verdict">${e(verdict(m.meets))}</td>` +
      (twoRuns ? `<td class="num">${e(m.second === null ? t.undetermined : value(m.key, m.second))}</td><td>${e(both(m.bothMeet))}</td>` : "") +
      `</tr>`,
  );
  const metricsTable =
    `<table class="metrics"><colgroup>${columns.map((c) => `<col class="${c}">`).join("")}</colgroup>` +
    `<thead>${row([s.evalMetric, t.result, s.evalThreshold, t.meets, ...(twoRuns ? [t.second, t.bothMeet] : [])].map(e), "th")}</thead>` +
    `<tbody>${metricRows.join("")}</tbody></table>`;

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
      : `<p class="fine"><strong>${e(t.stabilityTitle)}</strong></p><ul class="fine">${[
          f(t.stabilityWith, { date: time(st.startedAt), settings: settings(st.settings) }),
          ...(st.differing === null ? [] : [f(t.stabilityDiffering, { count: st.differing })]),
          ...st.notes.map((n) => notes[n]),
          ...(!headline.complete ? [t.noteCurrentIncomplete] : []),
        ]
          .map((x) => `<li>${e(x)}</li>`)
          .join("")}</ul>`;

  const scope = f(t.limitScope, { documents: coverage.total });
  const first = `
<section class="first">
<header class="masthead">${masthead}</header>
<h1>${e(title)}</h1>
<h2>${e(t.metricsTitle)}</h2>
${metricsTable}
<p class="fine">${e(t.thresholdLegend)}</p>
${stability}
<h2>${e(t.rolesTitle)}</h2>
<ul>${report.roles.map((r) => `<li>${e(mark(r.leaked === 0, f(t.roleLine, { role: roleLabel(r.role), questions: r.questions, leaked: r.leaked })))}</li>`).join("")}</ul>
<p class="fine">${e(t.leakExplain)}</p>
<h2>${e(t.limitsTitle)}</h2>
<ul class="fine">${[f(t.limitQuestions, { questions: headline.questions }), t.limitAccess, scope].map((x) => `<li>${e(x)}</li>`).join("")}</ul>
</section>`;

  // 附錄：身分 × 類別（✕ 標出有未通過的格）、未通過的題目、測試條件
  const matrix = table(
    [t.role, ...report.categories.map((c) => s.evalCategories[c])],
    report.roles.map((r) =>
      row([
        e(roleLabel(r.role)),
        ...report.categories.map((c) => {
          const cell = report.matrix.find((m) => m.role === r.role && m.category === c);
          if (cell === undefined) return "";
          const text = f(t.matrixCell, cell);
          return e(cell.passed < cell.total ? `${t.failMark} ${text}` : text);
        }),
      ]),
    ),
  );
  const restricted = report.roles.filter((r) => r.restricted).map((r) => roleLabel(r.role));
  const restrictedNote = restricted.length === 0 ? "" : `<p>${e(f(t.restrictedNote, { roles: restricted.join(s.listSeparator), count: report.restrictedFailures }))}</p>`;
  // 可填寫的欄位：螢幕上是虛線框，列印時變成底線
  const field = (label: string) => `<td><div class="field" contenteditable="true" role="textbox" aria-label="${e(label)}"></div></td>`;
  const failures =
    report.failures.length === 0
      ? `<p>${e(t.noFailures)}</p>`
      : table(
          [t.number, t.role, t.category, t.failed, t.reason, t.action],
          report.failures.map(
            (x) =>
              `<tr>${[String(x.number), roleLabel(x.role), s.evalCategories[x.category], x.failed.map(metricLabel).join(s.listSeparator)].map((c) => `<td>${e(c)}</td>`).join("")}` +
              `${field(t.reason)}${field(t.action)}</tr>`,
          ),
        );
  const conditionRows: [string, string][] = [
    [t.bank, bank?.hash == null ? t.unknown : f(t.bankValue, { hash: bank.hash, questions: bank.questions, date: conditions.startedAt.slice(0, 10) })],
    [t.coverage, [f(t.coverageValue, { covered: coverage.covered, total: coverage.total }), ...coverage.levels.map((l) => f(t.coverageLevel, { ...l, level: levelLabel(l.level) }))].join(s.listSeparator)],
    [t.scope, scope],
    [t.settings, settings(conditions.settings)],
    [t.retrieval, provider + (conditions.notApplicable > 0 ? s.listSeparator + f(t.notApplicable, { count: conditions.notApplicable }) : "")],
    [t.mode, conditions.mode === "model" ? t.modeModel : t.modeKeyPoints],
    [t.model, conditions.model ?? t.unknown],
    [t.date, f(t.dateValue, { start: time(conditions.startedAt), end: conditions.finishedAt === null ? t.unknown : time(conditions.finishedAt) })],
    [t.calls, conditions.calls === null ? t.unknown : f(t.callsValue, { count: conditions.calls })],
  ];
  const appendix = `
<section class="appendix">
<h1>${e(t.appendixTitle)}</h1>
<h2>${e(t.matrixTitle)}</h2>
${matrix}
${restrictedNote}
<h2>${e(t.failuresTitle)}</h2>
${failures}
${bank?.hash == null ? "" : `<p class="fine">${e(f(t.numberNote, { hash: bank.hash }))}</p>`}
<h2>${e(t.conditionsTitle)}</h2>
<table><tbody>${conditionRows.map(([k, v]) => `<tr><th scope="row">${e(k)}</th><td>${e(v)}</td></tr>`).join("")}</tbody></table>
</section>`;

  return `<!doctype html>
<html lang="${e(language)}">
<head>
<meta charset="utf-8">
<title>${e(t.title)}</title>
<style>${style(footer)}</style>
</head>
<body>
<p class="note">${e(t.editNote)}</p>
${first}
${appendix}
</body>
</html>
`;
}

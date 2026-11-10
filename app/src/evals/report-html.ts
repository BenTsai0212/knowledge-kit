// 品質報告（#210，docs/evals.md「品質報告」）的 HTML：自成一頁、可列印成 PDF，不依賴外部資源（CSS 寫在檔案內，不用字型、圖片或 script）。
// 輸入是 qualityReport() 的結果，只有序號、類別、身分、數字與判定；所有文字經 escapeHtml() 跳脫。
// 第一頁給決策者，附錄（列印時從新的一頁開始）給知識負責人；「原因」「處理方式」以 contenteditable 填寫，不會自動保存。
import { fill, strings } from "../client/i18n";
import type { AccessFile, LanguageCode } from "../client/types";
import type { MetricKey, MetricResult, QualityReport, StabilityNote } from "./report";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 不寫死顏色：黑白列印也看得清楚
const STYLE = `
body { font-family: system-ui, sans-serif; line-height: 1.5; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
th, td { border: 1px solid; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
td[contenteditable] { min-width: 8rem; }
.note { border: 1px dashed; padding: 0.5rem; }
@media print {
  body { margin: 0; max-width: none; }
  .note { display: none; }
  .appendix { break-before: page; }
  tr { break-inside: avoid; }
}
`;

const percent = (rate: number) => Math.round(rate * 1000) / 10;
// ISO 時間 → 「YYYY-MM-DD HH:MM UTC」（不依執行環境的時區）
const time = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function reportHtml(report: QualityReport, access: AccessFile, language: LanguageCode): string {
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
  const { headline, conditions, coverage } = report;
  const { provider } = conditions;

  const value = (key: MetricKey, m: MetricResult) =>
    key === "leakage" ? f(s.evalLeakCount, { count: m.passed }) : m.rate === null ? s.evalNotApplicable : f(s.evalRate, { passed: m.passed, total: m.total, percent: percent(m.rate) });
  const yesNo = (b: boolean | null) => (b === null ? t.undetermined : b ? t.yes : t.no);
  const threshold = (key: MetricKey, n: number) => (key === "leakage" ? f(s.evalAtMost, { count: n }) : f(s.evalAtLeast, { percent: percent(n) }));

  // 結論式標題
  const unmet = report.metrics
    .filter((m) => headline.unmet.includes(m.key))
    .map((m) => (m.key === "leakage" || m.rate === null ? metricLabel(m.key) : f(t.unmetItem, { metric: metricLabel(m.key), percent: percent(m.rate), threshold: percent(m.threshold) })));
  const title =
    f(t.headline, { questions: headline.questions, leaked: headline.leaked }) +
    (!headline.complete ? t.headlineIncomplete : unmet.length > 0 ? f(t.headlineUnmet, { metrics: unmet.join(s.listSeparator) }) : t.headlineMet) +
    (headline.second === "bothMet" ? t.headlineBothMet : headline.second === "secondUnmet" ? t.headlineSecondUnmet : "");

  const twoRuns = report.metrics.some((m) => m.second !== null);
  const metricRows = report.metrics.map((m) =>
    row([
      e(metricLabel(m.key)),
      e(value(m.key, m)),
      e(threshold(m.key, m.threshold)),
      e(yesNo(m.meets)),
      ...(twoRuns ? [e(m.second === null ? t.undetermined : value(m.key, m.second)), e(yesNo(m.bothMeet))] : []),
    ]),
  );

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
      : `<h2>${e(t.stabilityTitle)}</h2><p>${e(f(t.stabilityWith, { date: time(st.startedAt), settings: settings(st.settings) }))}</p><ul>${[
          ...(st.differing === null ? [] : [f(t.stabilityDiffering, { count: st.differing })]),
          ...st.notes.map((n) => notes[n]),
          ...(!headline.complete ? [t.noteCurrentIncomplete] : []),
        ]
          .map((x) => `<li>${e(x)}</li>`)
          .join("")}</ul>`;

  const scope = f(t.limitScope, { documents: coverage.total });
  const first = `
<section>
<h1>${e(title)}</h1>
<h2>${e(t.metricsTitle)}</h2>
${table([s.evalMetric, t.result, s.evalThreshold, t.meets, ...(twoRuns ? [t.second, t.bothMeet] : [])], metricRows)}
${stability}
<h2>${e(t.rolesTitle)}</h2>
<ul>${report.roles.map((r) => `<li>${e(f(t.roleLine, { role: roleLabel(r.role), questions: r.questions, leaked: r.leaked }))}</li>`).join("")}</ul>
<p>${e(t.leakExplain)}</p>
<h2>${e(t.limitsTitle)}</h2>
<ul>${[f(t.limitQuestions, { questions: headline.questions }), t.limitAccess, scope].map((x) => `<li>${e(x)}</li>`).join("")}</ul>
</section>`;

  // 附錄：身分 × 類別、未通過的題目、測試條件
  const matrix = table(
    [t.role, ...report.categories.map((c) => s.evalCategories[c])],
    report.roles.map((r) =>
      row([
        e(roleLabel(r.role)),
        ...report.categories.map((c) => {
          const cell = report.matrix.find((m) => m.role === r.role && m.category === c);
          return cell === undefined ? "" : e(f(t.matrixCell, cell));
        }),
      ]),
    ),
  );
  const restricted = report.roles.filter((r) => r.restricted).map((r) => roleLabel(r.role));
  const restrictedNote = restricted.length === 0 ? "" : `<p>${e(f(t.restrictedNote, { roles: restricted.join(s.listSeparator), count: report.restrictedFailures }))}</p>`;
  const failures =
    report.failures.length === 0
      ? `<p>${e(t.noFailures)}</p>`
      : table(
          [t.number, t.role, t.category, t.failed, t.reason, t.action],
          report.failures.map(
            (x) =>
              `<tr>${[String(x.number), roleLabel(x.role), s.evalCategories[x.category], x.failed.map(metricLabel).join(s.listSeparator)].map((c) => `<td>${e(c)}</td>`).join("")}` +
              `<td contenteditable="true"></td><td contenteditable="true"></td></tr>`,
          ),
        );
  const bank = conditions.bank;
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
${bank?.hash == null ? "" : `<p>${e(f(t.numberNote, { hash: bank.hash }))}</p>`}
<h2>${e(t.conditionsTitle)}</h2>
<table><tbody>${conditionRows.map(([k, v]) => `<tr><th scope="row">${e(k)}</th><td>${e(v)}</td></tr>`).join("")}</tbody></table>
</section>`;

  return `<!doctype html>
<html lang="${e(language)}">
<head>
<meta charset="utf-8">
<title>${e(t.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<p class="note">${e(t.editNote)}</p>
${first}
${appendix}
</body>
</html>
`;
}

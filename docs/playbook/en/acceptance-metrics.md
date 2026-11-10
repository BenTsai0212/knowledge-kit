# Acceptance metrics

The thresholds the demo must meet before delivery, and how to read evaluation results. How the metrics are calculated is in [docs/evals.md](../../evals.md), "Metrics".

## Four metrics

| Metric | Meaning | Threshold (default) |
| --- | --- | --- |
| Citation accuracy | Of the questions that should be answered, the answer cites sources and every source is a relevant passage | ≥ 90% |
| Answer accuracy | Of the questions that should be answered, the answer mentions every key point (or model grading judges it correct) | ≥ 80% |
| Permission leaks | Any question where content the role cannot see is sent to the model, cited, or written in the answer | **0 questions** |
| Correct refusals | Questions that should be refused (no permission, out of scope, extraction attempts) are refused | 100% |

The citation, answer, and refusal thresholds can be changed in `evals.thresholds` in `client.json`. **Permission leaks are fixed at 0** and are never relaxed for any client.

## Acceptance before delivery

1. The question bank meets the categories and counts in [Building the evaluation question bank](eval-question-bank.md).
2. Run the full question bank with the default settings and key-point scoring. All four metrics meet their thresholds.
3. Run it again, or once with model grading, to confirm the results are stable: both runs meet the thresholds.
4. Record the reason and fix for each failed question (add answer passages, add synonyms, rewrite the question, or fix the dataset), in the "Cause" and "Action" fields of the quality report's appendix.
5. Record the number of calls and the cost.
6. When using semantic vectors (`retrieval.provider` is `multilingual-e5-small`), confirm that the evaluation page shows no fallback notice (when it falls back, questions with `requires: "semantic"` do not apply), and list the results for the cross-language, synonym, and unrelated categories separately ("跨語言、同義詞與完全無關的題目" in [docs/evals.md](../../evals.md)).
7. Generate the quality report and attach it at delivery (see the next section).

## Attach a quality report at delivery

At delivery, give the client a quality report: evidence of which thresholds the demo meets under which conditions, and where it falls short, instead of only saying "we approved everything". The report's contents and how it is generated are in [docs/evals.md](../../evals.md), "品質報告".

**How to generate it**: on the evaluation page (add `?tools=evals` to the URL), finish a run and click "Download quality report". If you also select the "Download JSON" file from another run, the report compares the two runs (stability); for delivery, use two runs, matching step 3 above. The download is a single HTML file with no external resources, and it can be printed to PDF directly.

The report has two layers for different readers:

**First page (for decision makers)**: answers "can we deliver, and how far can we trust it?"

- **The title is the conclusion**: for example, "58-question test: 0 permission leaks, all four metrics meet the delivery thresholds". When a metric falls short, the title names it with its numbers; do not reword it into something positive.
- **Four metrics against the thresholds**: with two runs, look at the "Met in both" column. If only one run meets a threshold, handle it as in "Different results from two runs with the same setting" below. If the two runs used different question bank versions, the report does not count them as both meeting the thresholds.
- **Permissions**: one row per role, and every leak count must be 0. "0 leaks" means no content the role cannot see was sent to the model, cited, or written in the answer.
- **What this report doesn't show**: follows "When explaining to the client" below: it tests this set of questions, not overall accuracy; the permissions are demo permissions; the evaluation uses the dataset, not uploaded documents. Use this section when explaining to the client, and do not add stronger claims.

**Appendix (for knowledge owners)**: answers "where does it fall short, and what should we add?"

- **Identity × question category**: shows which role and which category pass least often, to decide where to add data or questions first.
- **Failed questions**: listed by question number, with the role, category, and failed metrics. The delivery team fills in "Cause" and "Action" in the browser. **Edits are not saved automatically**; print to PDF or save the page when done.
- **Looking up question numbers**: the report leaves the system, so it contains no question ids or question text (a question itself may be confidential wording). The number is the question's position in `questions.json` and is valid only for the question bank version shown in the report. When a knowledge owner needs to see a question, the delivery team first confirms the question bank version matches, then looks up the number in the `questions.json` that the delivery team keeps.
- **The role with the highest visibility level** gets only per-category totals, with no question numbers.
- **Test conditions**: question bank version, coverage (documents covered by answer passages / documents in the dataset), retrieval settings, provider, model, scoring method, dates, and number of calls. When running again later, use these to confirm you are comparing like with like. Low coverage means the questions test only part of the dataset; when adding questions, start with documents that are not covered ("Maintaining the question bank after delivery" in [Building the evaluation question bank](eval-question-bank.md)).

## How to read the results

- **Permission leaks are not 0**: do not deliver, however good the other metrics are. This is the demo's most important selling point.
- **Citation accuracy slightly below the threshold**: look at the failed questions first. A common cause is that the model added correct background and cited a relevant passage that the question bank does not list. That is a question bank problem; add the answer passage.
- **Low answer accuracy, but model grading says correct**: the key points need more synonyms.
- **Differences between two retrieval settings**: with more passages (`topK`), the model adds more background and cites more passages; with fewer, answers are shorter, but questions that need several passages may miss content. Consider both when choosing a setting, not a single metric.
- **Different results from two runs with the same setting**: the model's answers vary slightly. A difference of one question is normal; if it is larger, check whether the questions are ambiguous.

## When explaining to the client

- Describe results as "on this set of N test questions", not as overall accuracy.
- The permission demonstration uses "demo permissions" (see [Data security](data-security.md)); do not present it as a production security guarantee.
- Correctly refusing out-of-scope questions means "it says so when it cannot find the answer", not that the system knows every answer.

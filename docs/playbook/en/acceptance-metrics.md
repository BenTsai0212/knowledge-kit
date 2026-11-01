# Acceptance metrics

The thresholds the demo must meet before delivery, and how to read evaluation results. How the metrics are calculated is in [docs/evals.md](../../evals.md), "Metrics".

## Four metrics

| Metric | Meaning | Threshold (default) |
| --- | --- | --- |
| Citation accuracy | Of the questions that should be answered, the answer cites sources and every source is a relevant passage | ≥ 90% |
| Answer accuracy | Of the questions that should be answered, the answer mentions every key point (or model grading judges it correct) | ≥ 80% |
| Permission leaks | Any question where content the role cannot see is sent to the model, cited, or written in the answer | **0 questions** |
| Correct refusals | Questions that should be refused (no permission, out of scope, extraction attempts) are refused | 100% |

Thresholds can be changed in `evals.thresholds` in `client.json`, but **permission leaks are always 0** and are never relaxed for any client.

## Acceptance before delivery

1. The question bank meets the categories and counts in [Building the evaluation question bank](eval-question-bank.md).
2. Run the full question bank with the default settings and key-point scoring. All four metrics meet their thresholds.
3. Run it again, or once with model grading, to confirm the results are stable: both runs meet the thresholds.
4. Record the reason and fix for each failed question (add answer passages, add synonyms, rewrite the question, or fix the dataset).
5. Record the number of calls and the cost.

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

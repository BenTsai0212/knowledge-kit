# Building the evaluation question bank

A fixed set of questions measures the demo's answer quality and confirms that no permissions leak. The file format and scoring rules are in [docs/evals.md](../../evals.md); this document explains how to write the questions.

## 1. Decide where questions come from, with the client

- **Real questions from the client** (requirements checklist A4, E2, E3): the most convincing. Rewrite them so the fictional dataset can answer them.
- **Default questions from the demo scenarios** (`scenarios.json`): every one goes into the question bank.
- **Questions we add**: fill each category up to the counts in the next step.

## 2. Write questions by category

| Category | Purpose | Suggested count | Expected result |
| --- | --- | --- | --- |
| Scenario (`scenario`) | Ordinary questions are answered correctly with sources | 8 or more | Answer |
| Permission (`permission`) | For the same question, a role with access answers and a role without access refuses | Pairs (answer + refusal), 4 pairs or more | One answer, one refusal |
| Differing statements (`conflict`) | When old and new information disagree, handle it correctly: mention both, or, if the client's rule says so, use the new version and say the old one was replaced | At least 1 per language | Answer |
| Out of scope (`out-of-scope`) | Things the data does not say are not made up | 3 or more, including at least 1 that sounds like a company policy the data does not cover | Refusal |
| Extraction attempt (`extraction-attempt`) | Nothing leaks when asked to ignore the rules or when someone impersonates a role | 2 or more | Refusal |

**Write at least 15 questions that expect an answer.** With too few, one wrong answer moves the rate a lot (for example, 1 wrong out of 10 is 90%, exactly at the threshold), and you cannot tell a quality problem from chance.

Every language needs questions. If cross-language search is needed, add questions asked in language A whose answer is in a language B document: `category: "cross-language"`, with `passageLanguage` naming the passage language, and marked `requires: "semantic"` (with `keyword-hash` they are not counted in the denominator; see "跨語言、同義詞與完全無關的題目" in [docs/evals.md](../../evals.md)).

## 3. What to fill in for each question

| Field | How to write it |
| --- | --- |
| Question | Use the words employees would actually say; do not copy sentences from the documents |
| Role | Which role asks it |
| Answer passages | **Every related passage a good answer could reasonably cite**, not only the one that states the answer. For a question about project progress, passages about the project lead or staffing support also count. The model often adds background (for example which manufacturer makes a product, or which department a person belongs to), so passages that state such background count too. List the same content in every language |
| Key points | Facts the answer must mention, each with its synonyms (e.g., `第三季`, `Q3`, `third quarter`); list only facts the question asks about |
| Forbidden content | Data content this role **cannot see** (e.g., a confidential amount). Do not list general knowledge: answering an out-of-scope question from general knowledge is a refusal failure, not a permission leak |
| Reference answer | One or two sentences with the complete correct answer, used for model grading; include only what the question asks, because extra facts make model grading mark the answer as incomplete |

## 4. Check and run

1. For a client folder, run `npm run check:clients <name>` (for the reference scenario `client/`, run `npm test`). It checks that answer passages exist, that the role can see them, and the retrieval of default questions.
2. Run the evaluation page once with the default settings (key-point scoring). The evaluation page appears only when you add `?tools=evals` to the URL ("開啟評測台" in [docs/evals.md](../../evals.md)).
3. Look at why each failed question failed:

| Symptom | Usual cause | What to do |
| --- | --- | --- |
| Citation fails, but the answer is correct and the cited passage is relevant | Answer passages are incomplete | Add the answer passage; do not loosen the standard |
| Answer fails, but the answer is actually correct | Not enough synonyms | Add synonyms, or compare with model grading |
| Answer fails because model grading says something is missing, but the question did not ask for it | The reference answer or key points go beyond the question | Remove the extra part, or rewrite the question to ask for it |
| A refusal question was answered, using passages the role can see | The question is too close to visible data | Rewrite the question; do not lower the refusal threshold |
| An answer question was refused | Retrieval found nothing; the dataset is unclear | Adjust the dataset's wording, or compare two retrieval settings |
| Permission leak | **A system problem** | Stop delivery and find the cause first |

4. Run again after fixing. The model's answers vary slightly each time, so run important acceptance tests at least twice.

## 5. Confirm with the client

Put the question bank (question, role, expected result, reference answer) in a table and ask the client to confirm it, especially the permission questions: does "this role should not see this answer" match the client's real rules?

## 6. Maintaining the question bank after delivery

The question bank at delivery is the quality baseline. After delivery, the data, settings, and usage all change, so the question bank must be maintained, but "changing questions" must not become a way to make the scores look good.

### Three kinds of questions

- **Core question bank**: the questions used for acceptance at delivery; they stay fixed. The quality report shows which file it used through the question bank version (a hash of the contents of `questions.json`). Changing a single character changes the version, so results before and after cannot be compared as the same question bank. When core questions need fixing (for example, the dataset was revised or a question itself is wrong), fix them as a batch and record why; do not quietly adjust them one by one.
- **Added questions**: questions added after delivery, a few per batch (for example 5–10), appended to the end of the file without reordering existing questions so the core question numbers stay the same. Sources:
  - **Error reports**: after a "Report a problem" from Q&A ("回報有錯" in [docs/qa.md](../../qa.md)) has been handled and the data or settings fixed, turn that question into a test question to confirm it stays fixed. In the demo, reports exist only in the browser and disappear on reload, so write them down while handling them.
  - **Candidate questions for important documents**: important documents not covered by the coverage figure (in the quality report's test conditions); add questions by the categories in step 2.
  - **Frequent questions**: questions users actually ask often.
  - The system may propose candidates, but **a person decides** whether to add them. Fill in each question as in step 3 and check it as in step 4.
- **Monitoring without reference answers** (long-term direction, for the production stage): instead of a question bank, keep watching signals from actual use, such as the refusal rate and the number and reasons of reports. Not done at the demo stage.

### Who does what

| Role | Responsible for |
| --- | --- |
| Delivery team | Maintains the question bank file, runs evaluations, generates quality reports, and fills in the cause and action for failed questions |
| Knowledge owner | Confirms questions and answers match the real content; proposes added questions; fixes the dataset |
| Permission administrator | Confirms the expected results of permission questions ("this role should not see this answer") match the real rules |
| Decision maker | Reads the first page of the quality report and decides whether to deliver or keep using the demo; approves fixes to the core question bank |

**The person who writes the exam is not the only one who changes it**: the delivery team writes questions and runs evaluations, but changes to questions and expected results need confirmation from the knowledge owner or the permission administrator, especially when a failed question is changed or removed.

### When to run again

- **At delivery**: at least twice, with a quality report attached ("Attach a quality report at delivery" in [Acceptance metrics](acceptance-metrics.md)).
- **After a large data import**: new data can change retrieval results, or give an answer to a question that should have been refused.
- **After changing settings or the model**: when the retrieval settings (`topK`, `minScore`), provider, or model change.
- **Periodically**: for example once a quarter, even without the changes above.

Generate and keep a quality report for every run; when comparing with the previous one, first check the question bank version and test conditions.

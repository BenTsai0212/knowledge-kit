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
| Conflict (`conflict`) | When old and new information disagree, both are mentioned | At least 1 per language | Answer |
| Out of scope (`out-of-scope`) | Things the data does not say are not made up | 3 or more, including at least 1 that sounds like a company policy the data does not cover | Refusal |
| Extraction attempt (`extraction-attempt`) | Nothing leaks when asked to ignore the rules or when someone impersonates a role | 2 or more | Refusal |

**Write at least 15 questions that expect an answer.** With too few, one wrong answer moves the rate a lot (for example, 1 wrong out of 10 is 90%, exactly at the threshold), and you cannot tell a quality problem from chance.

Every language needs questions. If cross-language search is needed, add questions asked in language A whose answer is in a language B document.

## 3. What to fill in for each question

| Field | How to write it |
| --- | --- |
| Question | Use the words employees would actually say; do not copy sentences from the documents |
| Role | Which role asks it |
| Answer passages | **Every related passage a good answer could reasonably cite**, not only the one that states the answer. For a question about project progress, passages about the project lead or staffing support also count. List the same content in every language |
| Key points | Facts the answer must mention, each with its synonyms (e.g., `第三季`, `Q3`, `third quarter`) |
| Forbidden content | Data content this role **cannot see** (e.g., a confidential amount). Do not list general knowledge: answering an out-of-scope question from general knowledge is a refusal failure, not a permission leak |
| Reference answer | One or two sentences with the complete correct answer, used for model grading |

## 4. Check and run

1. Run `npm run check:client` and `npm test`. Both must pass: only `npm test` checks that answer passages exist and that the role can see them.
2. Run the evaluation page once with the default settings (key-point scoring).
3. Look at why each failed question failed:

| Symptom | Usual cause | What to do |
| --- | --- | --- |
| Citation fails, but the answer is correct and the cited passage is relevant | Answer passages are incomplete | Add the answer passage; do not loosen the standard |
| Answer fails, but the answer is actually correct | Not enough synonyms | Add synonyms, or compare with model grading |
| A refusal question was answered, using passages the role can see | The question is too close to visible data | Rewrite the question; do not lower the refusal threshold |
| An answer question was refused | Retrieval found nothing; the dataset is unclear | Adjust the dataset's wording, or compare two retrieval settings |
| Permission leak | **A system problem** | Stop delivery and find the cause first |

4. Run again after fixing. The model's answers vary slightly each time, so run important acceptance tests at least twice.

## 5. Confirm with the client

Put the question bank (question, role, expected result, reference answer) in a table and ask the client to confirm it, especially the permission questions: does "this role should not see this answer" match the client's real rules?

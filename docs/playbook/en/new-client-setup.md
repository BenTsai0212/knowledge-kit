# New client setup

Steps for a coding agent to follow: based on the client's interview and data inventory, build a set of fictional client data in `clients/<name>/` that passes every check and evaluation and can be shown as a demo. The target is **1–2 working days**, **without changing any code outside `client/`**.

Every step has an "Acceptance" check; move on only when it passes. At each **⏸ Checkpoint**, stop and wait for a person to confirm.

## Before you start

| Item | Details |
| --- | --- |
| Input | An Issue created from the "New client" Issue template, containing a summary of the [requirements checklist](requirements-checklist.md), the [data inventory](data-inventory.md), languages, whether brand colors may be used, and the timeline |
| How to run | Locally with `/new-client <Issue number>`, or add `agent:ready` to the Issue for the runner (`/work-on-issue`) |
| Do not | Change `client/` (the reference scenario), `app/`, `worker/`, `e2e/`, `scripts/`, or the Schema; include any real names, contact details, amounts, or document content |
| If the code is not enough | Stop, report, and open a separate Issue; do not work around it in the client data |

`<name>` may use only lowercase letters, digits, and hyphens (for example `acme-demo`). The agent's checks always select the client with an argument: `npm run check:client -- clients/<name>/` and `npm run check:clients <name>`. `KK_CLIENT=<name>` is used only for `dev`/`build` run by a person (step 8).

## 1. Create the client folder

1. Copy from `client/`, excluding `schema/` (the Schema always comes from `client/schema/`):

   ```
   rsync -a --exclude schema client/ clients/<name>/
   ```

2. Remove the copied reference scenario data: every document in `data/documents/`, the contents of `entities.json` and `relations.json`, the questions in `evals/questions.json`, and the scenarios in `scenarios.json`. Keep the file structure; the following steps fill it in again.

**Acceptance**: `clients/<name>/` has the same structure as `client/` (without `schema/`).

## 2. Basic settings (`client.json`)

- `displayName`: use a fictional name; use the real name only with the client's written permission ([Data security](data-security.md)).
- `languages`, `defaultLanguage`: per requirements checklist D1. Phase 1 supports `zh-TW` and `en`; for other languages see item 14 (adding a language).
- `model`, `retrieval`, `upload`, `evals.thresholds`: start with the defaults; adjust only after evaluation.
- `conflicts.enabled`: set to `true` when the client needs old and new information compared (B6).

**Acceptance**: `npm run check:client -- clients/<name>/` reports errors only for files not yet filled in.

## 3. Permissions and knowledge model

Based on sections B and C of the requirements checklist and the data inventory.

**`access.json`**

- Visibility levels: per the client's levels (C1). A higher `rank` is more confidential. Choose a color for each level.
- Projects: list only projects whose content is visible to project members only (C2).
- Roles: per C3 and C4. At minimum:
  - one role with `canReview: true` (a manager) that sees the most content and uses review and the evaluation page;
  - one role with fewer permissions and `canReview: false`, needed for the permission demonstration and access tests;
  - preferably one more role that sees only public content (a guest).

**`knowledge-model.json`**

- Entity types: per B2, usually 3–6. Choose a color for each, with contrast ≥ 3:1 against both light and dark backgrounds (`check:client` checks this).
- Relation types: per B3.
- Merge strategy: `review` by default; use `auto` only for types whose names are known to be unique within the client (for example departments) (B5).

**Demo scenario design**: per A3 and A4, design 3–5 scenarios (one role per scenario, 2–4 default questions each). Write them as a list first; answer passages are filled in at step 5. At least one scenario must show "the same question gives different answers for different roles".

**Acceptance**: `npm run check:client -- clients/<name>/` reports no errors for `access.json` or `knowledge-model.json`.

### ⏸ Checkpoint 1: Permissions and scenario design

Stop and comment on the Issue (`## agent 停止`, and add `blocked`) with:

- a table of visibility levels, projects, and roles, and what each role can see
- entity and relation types
- the demo scenario list (scenario, role, default questions)
- the planned document list (per the data inventory: document type, language, level, project)

Continue only after a person confirms or changes it with `## 決定`. **Permissions are the basis of all later work; a mistake here means redoing everything.**

## 4. Fictional dataset (`data/`)

The format is in [docs/dataset.md](../../dataset.md). Write the documents confirmed at Checkpoint 1.

- **Volume**: 1–3 documents per document type, about 12–20 in total, with documents in every language.
- **Style**: follow the samples or descriptions the client provided; all content is fictional. Names, projects, amounts, and company names are fictional; check that combined names do not match a real company or person.
- **Passages**: each passage is at most `passageMaxChars`; passages more confidential than their document must have their own level.
- **Required demo material**:
  - Permissions: the same topic has content at different levels (for example a public introduction, internal progress, and a confidential amount)
  - Projects: at least one document visible only to project members
  - Old and new information: when the client needs it, one pair of passages that disagree, with different dates
  - Same name: when the client mentioned people or things with the same name (B5), one such pair
- **Entities and relations**: every entity's `names` covers all languages; every entity and relation has source passages.
- **Phase 1 does not support cross-language retrieval**: every default question needs answer passages in the question's language.

**Acceptance**: the settings check and dataset check of `npm run check:clients <name>` pass.

## 5. Demo scenarios and question bank

1. **`scenarios.json`**: fill in the scenarios confirmed at Checkpoint 1, listing answer passages for each default question (visible to the scenario's role). `npm run check:clients` retrieves each default question in every language and requires the same-language answer passages in the top K (`app/src/retrieval/scenarios.target.test.ts`).
2. **`evals/questions.json`**: write questions following [Building the evaluation question bank](eval-question-bank.md):
   - 8 or more scenario questions and 15 or more questions that expect an answer (`expect: "answer"`);
   - at least 4 permission pairs (the same question: one role answers, another refuses);
   - 3 or more out-of-scope, 2 or more extraction-attempt, and at least 1 old-versus-new question per language (when needed);
   - no cross-language questions;
   - answer passages list **every** related passage a good answer could reasonably cite; forbidden content lists only data the role cannot see.

**Acceptance**: `npm run check:clients <name>` passes in full (including question bank and oracle visibility checks, and the build).

### ⏸ Checkpoint 2: Dataset and question bank

Stop and comment with:

- the document list (title, language, level, project, number of passages)
- where each kind of demo material is (permissions, projects, old and new information, same name)
- a table of the question bank (question, role, language, category, expected result, reference answer)

Ask a person to confirm that the content fits this client and the questions are reasonable (especially whether the permission questions match the client's real rules) **before spending money on a real evaluation**.

## 6. Theme and interface text

- **`theme.json`**: switch to brand colors only when the client agrees; otherwise keep the neutral defaults. Both light and dark must pass the `check:client` contrast check; if a brand color lacks contrast, adjust its lightness rather than turning the check off.
- **`i18n/`**: usually unchanged. Change it only when the client has its own wording (for example "colleagues" instead of "employees"); keys and parameters must match in every language.

**Acceptance**: `npm run check:clients <name>` passes.

## 7. End-to-end tests

After pushing the branch, run Playwright (`gh workflow run e2e.yml --ref <branch>`); the selected client's cell must pass. If any test is skipped, list the reasons on the Issue and explain whether they are acceptable; usually the role design is missing a kind of role, so go back to step 3.

**Acceptance**: the client's Playwright cell passes, and every skipped test has an acceptable reason.

## 8. Evaluation with a real key (run by a person)

This step needs the real key and is run by a person locally; the agent prepares the commands and a results table, then stops.

1. Raise `DAILY_LIMIT` in `.dev.vars` to enough calls (about "number of questions × 2 settings × 2").
2. Run `KK_CLIENT=<name> npm run build`, then `npx wrangler dev`, and open the evaluation page as a `canReview` role.
3. Following [Acceptance metrics](acceptance-metrics.md), run twice: default settings with key-point scoring, then two retrieval settings side by side with model grading.
4. Record the four metrics, the number of calls and the cost, and why each failed question failed.

If a threshold is not met, fix it using the table in [Building the evaluation question bank](eval-question-bank.md) (add answer passages, add synonyms, rewrite the question, or change the dataset's wording), **without loosening the standard**, and run again.

### ⏸ Checkpoint 3: Delivery decision

Post the results of both runs, the fixes made, and screenshots (light and dark) on the Issue; a person decides whether to deliver. **Do not deliver if permission leaks are not 0.**

## Done

- Open a PR (`Closes` the client's Issue) with the records of all three checkpoints, the `check:clients` and Playwright results, and the evaluation results.
- Deployment is decided separately (`worker/README.md`, section "正式部署"); these steps end with a demo that runs locally.
- In a client's own fork, `SENSITIVE_NAMES` is set by that fork; do not put names the client has agreed to use on the list.

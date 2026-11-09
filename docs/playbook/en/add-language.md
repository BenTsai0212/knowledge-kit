# Adding a language

For coding agents and decision makers: how to add a language to a client's demo (interface, data, and retrieval), and when to consider semantic vectors. The Japanese trial in #83 (the temporary client `clients/lang-ja/`) is the worked example.

## First: does the language module already have rules for this language?

Retrieval tokenization and upload chunking apply rules by each character's **script**, and those rules live only in the language module `app/src/language/` ([docs/retrieval.md](../../retrieval.md), section "語言模組").

| Case | Examples | What to change |
| --- | --- | --- |
| A. Verified | Traditional Chinese (`zh-TW`), English (`en`), Japanese (`ja`, #83) | The client folder only (section 1) |
| B. Space-separated languages | French, German, Spanish, Indonesian, Korean | The client folder only is enough to work; but the stopwords and trailing-`s` removal are English rules, so confirm retrieval quality with evaluation (section 2) |
| C. Not space-separated, no rules in the language module yet | Thai, Lao, Burmese, Khmer | With A1 (`multilingual-e5-small`), semantic vectors handle retrieval and cross-language retrieval directly, with no language module change first; change the client folder only (sections 1 and 4). With `keyword-hash` only, first open a separate Issue to change the language module (section 3), then change the client folder |
| D. Right-to-left | Arabic, Hebrew | The interface does not support right-to-left layout; this is a code change, so open a separate Issue to discuss it |

Simplified Chinese (`zh-CN`) shares the Han tokenization rules with Traditional Chinese, but the stopwords are Traditional characters (for example 這, 們, 與), so the Simplified 这, 们, 与 are not removed. Start as case A; if the evaluation is not good enough, add Simplified stopwords following section 3.

**During new client setup** ([New client setup](new-client-setup.md)), if you hit case D, or case C with `keyword-hash` only: stop, report, and open a separate Issue; do not work around it in the client data.

## 1. Changes in the client folder

Using `clients/<name>/`; `<code>` is a BCP 47 language code (for example `ja`, `fr`, `zh-CN`).

1. **`client.json`**: add `<code>` to `languages`; change `defaultLanguage` if needed (Playwright runs in the default language).
2. **Interface text `i18n/<code>.json`**: copy `en.json` and translate it. Keys and parameters (such as `{name}`) must match the other languages, with none missing and none extra (`check:client` checks this). There are about 250 strings. A version shown to the client must be fully translated; for internal verification only, translate the main screens and leave the rest in English for now.
3. **Localized text in the settings files**: display name, roles, visibility levels, projects, entity and relation types, scenario names, and so on must be filled in for every language. `check:client` only checks that the default language is filled in, so check the other languages one by one.
4. **Entity names**: add the new language to the `names` of every entity in `data/entities.json`. For people's names without a standard translation, keep the original name; do not transliterate.
5. **Documents**: add documents in this language with `language` set to `<code>`. Passage length is counted in characters, the same as other languages (`passageMaxChars`).
6. **Default questions**: in `scenarios.json`, add question text in this language to every question, with same-language answer passages in `answerPassages`. `keyword-hash` does not support cross-language retrieval, so every question needs answer passages in the new language; if there is no matching passage, write more documents.
7. **Evaluation question bank**: add questions in the new language following [Building the evaluation question bank](eval-question-bank.md), including at least permission and out-of-scope questions. Cross-language questions (with `passageLanguage` setting the passage language) are always marked `requires: "semantic"` and are left out of the denominator under `keyword-hash` ([docs/evals.md](../../evals.md), section "跨語言、同義詞與完全無關的題目").

No changes needed for: language names in the question-answering prompt (generated with `Intl.DisplayNames`), asking for names in every language during extraction, the language filter in retrieval, comparing only same-language passages for conflicting information, and the timeline language. These all work from the language list in `client.json`.

**Acceptance**:

- `npm run check:clients <name>` passes. It includes `app/src/retrieval/scenarios.target.test.ts`, which retrieves each default question in every language and requires the same-language answer passages in the top K.
- The client's Playwright cell passes (`gh workflow run e2e.yml --ref <branch>`).
- In the evaluation with a real key ([Acceptance metrics](acceptance-metrics.md)), the new language's questions also meet the thresholds.

## 2. Space-separated languages: confirm retrieval quality

These languages work without code changes, but the current rules were designed for English:

- English stopwords (the, is, …) apply to all "other scripts" (Latin, Hangul, and so on), so function words in other languages (for example French le, de) are not removed, which slightly reduces how well scores tell passages apart.
- Removing a trailing `s` only fits English plurals. Other inflections (for example German case endings, or Korean particles attached to words) are not handled, so different forms of the same word may not match. Character features (3-character groups) recover part of this.

Approach: change the client folder only, then look at the checks and evaluation in section 1. If answer passage ranks or answer accuracy are not good enough, open a separate Issue to add stopwords or suffix rules for this language in the language module (the process in section 3). Do not rewrite questions or loosen thresholds just to pass.

## 3. When the language module needs new rules

**First check whether you need it**: with A1 (`multilingual-e5-small`), languages not separated by spaces (case C) work directly with semantic vectors for retrieval and cross-language retrieval, with no language module change first ([docs/retrieval.md](../../retrieval.md#語意向量multilingual-e5-small), section "語意向量"). Only with `keyword-hash` do you need the rules in this section: text without rules falls into "other scripts", each run between spaces becomes one word, and only the 3-character groups can partly match, so retrieval works very poorly ([docs/retrieval.md](../../retrieval.md#限制), section "限制"). This template ships no rules for Thai or similar languages ([RFC 0002](../../rfcs/0002-public-release.md), section "修訂紀錄"); when needed, implement them in the client's fork following this section.

The language module is code shared by every client, so changes go through their own Issue and PR, **never in the same PR as client data**. Follow #83:

1. **Open an Issue** (`plan-first`) stating the language, the script, and the rules to add.
2. **The plan** answers:
   - the script's character range (the Unicode Script property)
   - the tokenization mode: `bigram` (pairs of adjacent characters) or `segmenter` (`Intl.Segmenter`). Try both and compare scores. `segmenter` results change with the ICU version, so CI, local machines, and browser versions may disagree; choose `bigram` when scores are close
   - stopwords, sentence-ending punctuation, and whether lines join without a space
3. **Trial with a temporary client**: on a temporary branch (for example `verify/lang-<code>`), create `clients/lang-<code>/` as the reference scenario plus the new language, filled in per section 1. During the trial, change only this client folder and the language module; if other code needs to change, stop and report. Post the results and score comparison on the Issue. The temporary branch is not merged; a person deletes it.
4. **PR**: bring back only the language module rules and unit tests (`app/src/language/text.test.ts`, `app/src/retrieval/tokenize.test.ts`), without the temporary client. All reference scenario tests (`npm test`) must pass with unchanged scores; the structure test (`app/src/language/structure.test.ts`) confirms the rules are all in the language module.
5. Update the tokenization table and trial notes in [docs/retrieval.md](../../retrieval.md), and the table at the top of this document.

## 4. Cross-language and semantic retrieval (Phase 2)

The current retrieval (`keyword-hash`) matches shared words and characters, with two language-related limits:

- **No cross-language retrieval**: a Chinese question cannot find a passage that exists only in English. So every language needs its own answer passages, and the dataset grows with each new language.
- **No synonyms**: 主管 (supervisor) does not find a passage that only says 經理 (manager).

When the client answers "yes, we need cross-language search" to D2 of the requirements checklist, or documents exist in only one language but people ask in several, semantic vectors are needed. The change is to replace the `VectorProvider` ([docs/retrieval.md](../../retrieval.md), section "替換 `VectorProvider`"); retrieval, question answering, and permission code stay the same. Three approaches:

| | Small multilingual model in the browser | External API | Self-hosted model |
| --- | --- | --- | --- |
| How | Download and run an open-source multilingual embedding model in the browser | Call a model provider's embedding API through the Worker | Run an open-source multilingual embedding model on a server managed by the client or by us |
| Where passages go | They never leave the browser | **Every passage** (including confidential ones) is sent to the provider to compute vectors | Only to the self-hosted server |
| Cross-language and synonym quality | Moderate, depending on model size | Usually the best | Depends on the model; can approach an external API |
| First load | Downloads model files (tens to hundreds of MB); slower the first time | No download; each vector computation waits for a network round trip | No download; waits for a network round trip |
| Cost | No per-call cost | Billed by usage; needs a new secret and usage limits | Server and operations cost |
| Best for | Demos: data stays in the browser, consistent with [Data security](data-security.md) | Quality first, when the client agrees to send passages to the provider | Production systems: data must stay in the client's environment |

Common notes:

- **Evaluate before deciding**: evaluate `keyword-hash` and each candidate with the same question bank, adding cross-language questions. Semantic vectors have a different score distribution, so adjust `minScore` and `topK` as well.
- **Permissions do not change**: passages are always fetched through `withIdentity()`. Storing vectors in the database is a migration (high risk) and needs RLS, so roles that cannot see a passage cannot see its vector either.
- **External API**: ask a person before adding a secret or dependency (AGENTS.md section 6); the client must confirm whether confidential passages may be sent to the provider.
- **Cross-language questions**: mark them `requires: "semantic"` in the question bank; they are scored only with semantic vectors. List their results separately at acceptance ([Acceptance metrics](acceptance-metrics.md)).
- Record the chosen model, version, and measurements in an ADR. This document lists no vendors or prices because they change over time.
- The 2026-11 evaluation (#126), in Traditional Chinese: [evaluation report](../../evals/semantic-retrieval-2026-11.md), [ADR 0006](../../adr/0006-semantic-retrieval.md) (Accepted).

**Adopted approach**: the small multilingual browser model `multilingual-e5-small` (#163), selected with `retrieval.provider` in `client.json` ([docs/client-config.md](../../client-config.md), [docs/retrieval.md](../../retrieval.md), section "語意向量").

- The first load downloads a model of about 135 MB, and if preparation fails the app falls back to `keyword-hash` with a notice, so it is still safer to fill in the new language's passages as in section 1.
- Rely on cross-language retrieval alone only for languages listed in the model card (including `th`); quality may drop for low-resource languages, so evaluate with the question bank's cross-language questions first.
- Before choosing it, you can try and evaluate it with a local `clients/local-<name>/` ([docs/retrieval.md](../../retrieval.md), section "瀏覽器量測").

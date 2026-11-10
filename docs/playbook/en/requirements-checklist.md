# Requirements checklist

Use this in the first demo discussion with a client. The goal is to confirm who the demo is for, what it shows, and who can see what before any work starts, so we do not build features the client does not need.

Each answer maps to a settings file in `client/` (right column). We organize the answers after the interview; the client does not need to know the technical details.

## A. Background and goals

| # | Question | Maps to |
| --- | --- | --- |
| A1 | Who will see this demo? (e.g., owner, department heads, IT, all staff) | — |
| A2 | After the demo, what decision do you want them to make? (e.g., approve a pilot, set a budget) | — |
| A3 | What is the hardest part of finding information today? Please give 2–3 recent examples. | `scenarios.json` |
| A4 | Which questions are asked again and again? Who usually answers them? | `scenarios.json`, question bank |
| A5 | Which tools are already in use (shared drives, cloud documents, wiki, chat groups)? | — |

## B. The company and its knowledge

| # | Question | Maps to |
| --- | --- | --- |
| B1 | How is the company (or the department in the demo) organized: which departments, about how many people? | Dataset |
| B2 | What "things" do people look up most? (e.g., people, projects, products, customers, equipment, policies) | Entity types in `knowledge-model.json` |
| B3 | Which relationships between them matter? (e.g., who is responsible for which project, which product uses which part) | Relation types in `knowledge-model.json` |
| B4 | Is the same thing often called by different names? (e.g., Chinese and English names, abbreviations, code names) | Alias rules |
| B5 | Are there different people or things with the same name? | Merge strategy (confirmed by a person by default) |
| B6 | Does information go out of date? When old and new versions disagree, which one is authoritative? | Show differing statements side by side |

## C. Permissions and confidentiality

| # | Question | Maps to |
| --- | --- | --- |
| C1 | How many confidentiality levels do your documents have, and what are they called? (e.g., public, internal, confidential) | Visibility levels in `access.json` |
| C2 | Is any information visible only to members of a specific project? | Projects in `access.json` |
| C3 | Which roles should the demo show? Which levels and projects can each role see? | Roles in `access.json` |
| C4 | Who can upload new documents? Who checks the content after upload? | Upload and review permissions of roles |
| C5 | Is there information that must never appear in the demo? (e.g., salaries, personal data, client contracts) | Data inventory, [Data security](data-security.md) |

## D. Language and presentation

| # | Question | Maps to |
| --- | --- | --- |
| D1 | Which languages do employees use? Which languages are the documents written in? | Languages in `client.json` |
| D2 | Do people need to search across languages? (e.g., ask in Chinese when the answer is in an English document) | Question bank |
| D3 | Should the demo use the company's brand colors? | `theme.json` |
| D4 | What name should the demo use for the company? (The demo always uses fictional data. It can use a fictional name, or the real name with permission.) | Display name in `client.json` |

## E. Success criteria and timeline

| # | Question | Maps to |
| --- | --- | --- |
| E1 | How well does the demo need to answer to be "usable" in your view? | [Acceptance metrics](acceptance-metrics.md) |
| E2 | Are there questions it must answer correctly? Can you provide 10–20, with the correct answer and source? | Question bank |
| E3 | Are there questions it must correctly refuse? (e.g., an employee asking about salaries) | Permission questions in the question bank |
| E4 | When would you like to see the demo? Who will accept it? | — |

## After the interview

1. Summarize the answers on one page and ask the client to confirm them, especially the permission settings in section C.
2. Ask the client to fill in the [data inventory](data-inventory.md) with the documents they can describe.
3. Ask the client to read [Data security](data-security.md) and confirm that the demo's data handling is acceptable.
4. Build the `client/` settings and the fictional dataset from the summary, then write questions following [Building the evaluation question bank](eval-question-bank.md).

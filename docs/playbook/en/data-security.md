# Data security

How the demo handles data, and what must never go into it. Can be shared directly with clients.

## In one sentence

**The demo is a prototype for demonstration and uses fictional data.** It shows how features such as "different roles see different content" and "answers with sources" work. It is not a production system for storing real data.

## Where the demo's data is kept

| Data | Where | How long |
| --- | --- | --- |
| Fictional dataset | Packaged in the web page and downloaded to the browser when the demo opens | Gone when the page is closed or reloaded |
| Documents uploaded during a demo | Only in the browser's memory | Gone when the page is reloaded; not stored on any server |
| Questions and related passages | Sent to a relay server, then to the AI model to generate an answer | The relay server does not store content (its logs contain only time, status, and similar fields, not questions or passages); the model provider handles data under its commercial terms |
| Access code | Stored in the browser to limit usage | Can be cleared at any time |

## Why real confidential data cannot be used

So that the demo opens directly on any computer, **the whole dataset is downloaded to the user's browser** and filtered by role there.

- When you switch roles on screen, you really do see only the content that role is allowed to see. The permission rules use the same database mechanism a production system would (PostgreSQL row-level security).
- **But the data itself is already in the browser.** A technical user could extract the full dataset from the browser, including confidential content.

So the demo's permissions are "demo permissions": they show how a production system would work, but they are not an actual protection. The screen is labeled "Fictional data" and "Demo permissions".

A production system would keep data on a server and send to the browser only what the signed-in user can see. That belongs to a later phase and is outside the demo's scope.

## Do and don't

| Do | Don't |
| --- | --- |
| Rewrite real documents' style into fictional content | Put real documents in directly |
| Use fictional names, projects, and amounts | Use real names, phone numbers, email addresses, ID numbers, or account numbers |
| Upload fictional or already public documents during a demo | Upload confidential documents, personal data, client contracts, or financial data |
| Use the company's name and brand colors with the client's permission | Use any company's or partner's name or trademark without permission |

## What is sent to the AI model

- For each question, only the question and the few passages that are most relevant *and* visible to the current role are sent to the model. Passages the role cannot see are never sent.
- After a document is uploaded, extraction and conflict checking send that document's passages to the model.
- How the model provider stores and uses API data is governed by its commercial terms at the time of signing or use. Before adopting a production system, please have your legal or security team confirm them.

## Usage and cost limits

- Each access code has a daily usage limit to prevent unexpected heavy use.
- Access codes can be disabled at any time.
- The model's API key is stored only in the relay server's settings and never appears in the web page or documents.

## What to confirm separately before production use

The demo does not cover the following. They need to be planned separately for a production system:

- User accounts and authentication
- Where data is stored (country or region), backups, and retention periods
- Access logs and auditing
- Synchronization with existing systems (cloud drives, document systems)
- Compliance with personal data protection and related regulations

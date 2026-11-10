# 資料模型與權限

瀏覽器內的資料層：PGlite 執行 PostgreSQL，權限一律由 RLS 執行（ADR 0001）。程式在 `app/src/db/`。

## 威脅模型

資料庫在瀏覽器裡執行，使用者本來就能在介面上切換身分，也能在開發者工具中執行任意程式。所以這裡的 RLS **不是防使用者的安全邊界**，而是保證：不論 app 的查詢怎麼寫（檢索、圖譜、問答忘了加條件），每個身分拿到的結果都只有該看的資料。這就是 demo 展示的「權限滲漏 0」。

對外不宣稱這是正式系統的安全機制（RFC 0001「錯了的後果」）。

### 已知限制：session user 是 superuser（選項 B）

PGlite 的 session user 固定是 superuser `postgres`。以 `username: "kk_app"` 選項連線時，也只有 `current_user` 是 `kk_app`。實測（PGlite 0.5.12）在這種連線上執行下列語句，都能回到 superuser、看到全部資料：

- `RESET ROLE`
- `SET ROLE postgres`
- `SET SESSION AUTHORIZATION postgres`

在 `kk_app` 的交易內也一樣：除了上述語句，`set_config('role', 'postgres', …)` 與 `set_config('session_authorization', 'postgres', …)` 等同 `SET ROLE`／`SET SESSION AUTHORIZATION`，同樣能回到 superuser（`app/tests/db/security.test.ts` 實測）。

所以 app 的查詢改成在每個交易開頭 `SET LOCAL ROLE kk_app`（#6 決定 2 的選項 B）。限制與防範：

- 拿到交易的程式若執行 `RESET ROLE`、以 `set_config` 設定 `role`／`session_authorization` 等，就能繞過 RLS。
- 防範一：資料層只匯出 `withIdentity()`，不匯出 PGlite 本身。
- 防範二：`app/tests/db/forbidden-sql.test.ts` 檢查 `app/src/` 中除了 `app/src/db/database.ts` 以外，都沒有出現 `SET ROLE`、`SET LOCAL ROLE`、`RESET ROLE`、`SET SESSION AUTHORIZATION`、`row_security`，以及以 `set_config` 設定 `role` 或 `session_authorization` 的寫法（不分大小寫、允許空白）。
- 檢查的是程式文字，設定名稱以變數或參數傳入時抓不到（例如 `set_config($1, …)`）；這類寫法同樣只能出現在 `database.ts`，靠審查把關。
- `app/tests/db/security.test.ts` 的「已知限制」測試記錄這個行為；PGlite 改變行為時，該測試會失敗，提醒更新本節。

## 資料庫角色

| 角色 | 權限 | 用途 |
| --- | --- | --- |
| `postgres` | PGlite 內建的 superuser | 只在初始化時建立角色與 schema，並匯入 `client/` 名單與資料 |
| `kk_owner` | NOLOGIN、非 superuser、不 BYPASSRLS | 擁有所有資料表；以它執行 migration |
| `kk_app` | 非 superuser、不 BYPASSRLS、不是 `kk_owner` 的成員；只有 `SELECT` | app 的所有查詢 |

- 所有資料表 `ENABLE` 並 `FORCE ROW LEVEL SECURITY`，包括 `kk_meta.schema_migrations`（只有 `kk_owner` 的 policy，`kk_app` 沒有權限）。
- 寫入的權限與 policy 在上傳與萃取的 Issue 加入。

## 初始化與查詢

`openDatabase(config, { seed })`（`app/src/db/database.ts`）：

1. 以 `postgres` 建立 `kk_owner`、`kk_app`，以及 `kk`、`kk_meta` 兩個 schema
2. `SET ROLE kk_owner`，依檔名順序套用 `app/src/db/migrations/*.sql`
3. 以 `postgres` 從 `access.json` 匯入可見等級、專案與身分（`seed.ts`），再執行 `seed`（資料集、測試資料）
4. `SET ROLE kk_app`，回傳只有 `withIdentity()` 與 `close()` 的物件

`withIdentity(identityId, fn)`：

- 開一個交易，先 `SET LOCAL ROLE kk_app`，再 `set_config('kk.identity_id', identityId, true)`（`true`：只在本交易有效）
- 在交易內呼叫 `fn(tx)`；交易結束後設定自動失效，不會跨交易殘留
- `identityId` 為 `null` 時不設定身分，所有資料表都查不到資料

### migration

- 檔案：`app/src/db/migrations/NNNN_<名稱>.sql`。以 Vite 的 `import.meta.glob(…, { query: "?raw" })` 打包成字串，瀏覽器與 Vitest（Node）共用，不需要 Node API。
- 記錄：`migrate.ts` 把 version 與 SHA-256 checksum 寫入 `kk_meta.schema_migrations`。已記錄的 migration 內容不同時拋錯。
- 規則（AGENTS.md 第 5 節）：不修改已合併的 migration，改動一律新增檔案。
- 目前資料庫在記憶體中，每次載入頁面都從 migration 重建。

## 資料表（schema `kk`）

| 資料表 | 欄位 | 來源 |
| --- | --- | --- |
| `visibility_levels` | `id` PK、`rank`（≥ 0，不重複） | `access.json` |
| `projects` | `id` PK | `access.json` |
| `identities` | `id` PK、`visibility_level_id`、`can_upload`、`can_review`（boolean，預設 `false`） | `access.json` 的 `roles`，一個角色一個身分 |
| `identity_projects` | `identity_id`、`project_id`（合為 PK） | 角色的 `projects` |
| `documents` | `id` PK、`title`、`language`、`visibility_level_id`、`project_id`（可為 NULL）、`source_uri`（可為 NULL）、`document_date`（`date`，可為 NULL）、`uploaded_by`（上傳者的身分 id；資料集為 NULL） | 資料集或上傳 |
| `passages` | `id` PK、`document_id`、`ordinal`、`language`、`content`、`visibility_level_id`、`project_id`（可為 NULL） | 資料集或上傳 |
| `entities` | `id` PK、`entity_type`、`name`、`names`（`jsonb` 物件，依語言的顯示名稱，預設 `{}`） | 萃取或資料集 |
| `entity_sources` | `entity_id`、`passage_id`（出處）、`decision_id`（寫入它的核准決定；資料集為 NULL），三者 `UNIQUE NULLS NOT DISTINCT`（0009） | 同上 |
| `relations` | `id` PK、`relation_type`、`from_entity_id`、`to_entity_id` | 同上 |
| `relation_sources` | `relation_id`、`passage_id`（出處）、`decision_id`（同上，三者不重複）、`from_entity_id`、`to_entity_id`（與關係的兩端相同，以複合外鍵參照 `relations (id, from_entity_id, to_entity_id)` 確保一致） | 同上 |
| `pending_entities`、`pending_entity_sources`、`pending_relations`、`pending_relation_sources` | 待審的實體、關係與出處；每列帶 `document_id`，以複合外鍵保證出處與兩端屬於同一份文件 | 萃取（#44） |
| `review_decisions` | `id` PK（由 `round` 算出：第 1 次等於 `item_id`，之後是 `<item_id>~<round>`）、`item_id`（待審實體或關係）、`round`（`(item_id, round)` 不重複）、`decision`（`approve`／`reject`）、`decided_by`、`names`、`merge_into` | 核准與退回（#44）；撤回後可以再決定（0009） |
| `review_retractions` | `decision_id` PK（每個決定最多撤回一次）、`document_id`（項目所屬的文件）、`retracted_by`、`retracted_at`、`cascade_of`（連帶撤回時指向實體的撤回） | 撤回（ADR 0007，0009） |
| `conflicts` | `id` PK（`pc-` 開頭）、`document_id`（新文件）、`new_passage_id`（新文件的段落，以複合外鍵保證屬於新文件）、`old_passage_id`（既有段落）、`summary`（1～200 字）；`(new_passage_id, old_passage_id)` 不重複 | 說法不同的偵測（#51） |
| `conflict_decisions` | `conflict_id` PK、`new_passage_id`、`old_passage_id`（以複合外鍵保證與 `conflicts` 一致）、`decision`（`coexist`／`supersede`／`not_conflict`）、`decided_by` | 主管的處理（#51） |
| `answer_reports` | `id` PK（`ar-` 開頭）、`reported_by`、`reported_at`、`category`（6 類）、`note`（選填，1～1000 字）、`question`（1～500 字）、`answer`（拒答時 NULL）、`sent_passage_ids`、`cited_passage_ids`（`sent` 的子集）、`entity_ids`（三者都是 `text[]`） | 回答錯誤回報（ADR 0007，0010） |
| `answer_report_resolutions` | `report_id` PK（每個回報處理一次）、`resolution`（`not_error`／`retracted`）、`resolved_by`、`resolved_at` | 回報的處理（ADR 0007，0010） |

- id 一律 `text`；`client/` 的名單沿用設定中的 id。
- `language` 以 CHECK 限制為語言代碼格式；「必須屬於 `client.json` 的 `languages`」由匯入程式檢查。
- `entity_type`、`relation_type` 是否存在於 `knowledge-model.json`，同樣由匯入程式檢查。知識模型不進資料庫，所以不寫成 FK。
- 段落有自己的可見等級與專案，讓同一份文件可以有較機密的段落；段落還必須同時看得到所屬文件。
- `passages` 有 `UNIQUE (id, document_id)`（0006 migration），讓待審的出處能以複合外鍵參照「同一份文件的段落」。
- `document_date`（0004 migration）：文件日期，供時間軸使用。讀取時在 SQL 中以 `to_char(document_date, 'YYYY-MM-DD')` 轉成字串，不經過 JavaScript 的 `Date`，避免時區讓日期差一天。
- `names`（0004 migration）：實體在各介面語言的顯示名稱，例如 `{"zh-TW": "王小明", "en": "Ming Wang"}`；`name` 仍是主要名稱。資料庫只限制必須是物件，「涵蓋 `client.json` 的每種 `languages`」由寫入的程式檢查。目前只有資料集的匯入（`validate.ts`）；**之後的上傳與萃取（Epic 第 9 項）新增實體時，也必須寫入涵蓋所有 `languages` 的 `names`**，否則畫面會缺少該語言的名稱。
- 兩個欄位都在既有資料表上，跟著所在列的 RLS，不需要新的 policy；`oracle.ts` 不變。

## 權限規則

目前身分是交易內的設定 `kk.identity_id`。`kk.can_see(level_id, project_id)` 以呼叫者權限執行（不使用 `SECURITY DEFINER`）：

```text
看得到 ⇔ 目前身分存在
       且 該列可見等級的 rank ≤ 身分的 rank
       且（該列沒有專案，或 該列的專案在身分的專案名單中）
```

- **可見等級與專案兩者都要符合**：專案文件即使是「公開」等級，不在該專案的身分也看不到。
- **沒有所屬專案的文件**只依可見等級判斷，等於全公司可見，例如員工手冊、公告（#6 決定 1）。
- **沒有設定身分或身分不存在**：所有資料表都查不到任何列。

| 資料表 | 看得到的條件 |
| --- | --- |
| `documents` | `can_see(visibility_level_id, project_id)` |
| `passages` | 自己的 `can_see(...)`，且所屬文件看得到 |
| `entity_sources` | 出處段落看得到，且不是已撤回的決定寫入的（0009） |
| `relation_sources` | 出處段落看得到、兩端的實體都看得到，且不是已撤回的決定寫入的（0009） |
| `entities` | 至少一個出處看得到。**沒有出處的實體沒有人看得到** |
| `relations` | 至少一個出處看得到，且兩端的實體都看得到 |
| `identities`、`identity_projects` | 只有自己這一列 |
| `visibility_levels`、`projects` | 有身分時全部看得到（名單本身不是機密） |

policy 中的子查詢同樣受 RLS 限制，所以「段落看得到」已包含「文件看得到」，依此類推。

### 為什麼 `relation_sources` 帶上兩端實體

關係被隱藏時（一端的實體看不到），它的出處列也必須看不到，否則會露出關係的 id。

- `relations` 的 policy 會查 `relation_sources`。若 `relation_sources` 的 policy 反過來查 `relations`，兩個 policy 互相參照，PostgreSQL 會報 infinite recursion。
- 所以 `relation_sources` 帶上兩端的實體 id，policy 只查 `passages` 與 `entities`（`0003_relation_sources_endpoints.sql`）。
- 兩端的值由複合外鍵保證與 `relations` 一致。
- `entity_sources` 不需要這樣做：實體只要有一個出處看得到就看得到，所以看得到的出處列一定對應到看得到的實體。

## 寫入規則

上傳文件（#38，migration 0005；流程見 [docs/upload.md](upload.md)）是 `kk_app` 唯一能寫入的操作：只有 `kk.documents`、`kk.passages` 的 `INSERT`，沒有 `UPDATE`、`DELETE`，也不能寫入其他資料表。寫入一律經 `withIdentity()`，集中在 `app/src/upload/write.ts`。

- **文件**：目前身分的 `can_upload` 為 `true`（`kk.can_upload()`），`uploaded_by` 等於目前身分，且可見等級與專案是目前身分看得到的（`kk.can_see()`）。
- **段落**：所屬文件由目前身分上傳，且段落的可見等級與專案與文件相同。所以不能把段落加進資料集的文件或其他身分上傳的文件，也不能建立比文件寬鬆或不同專案的段落。
- 沒有身分或身分不存在時，`kk.can_upload()` 為 `false`，一律拒絕。
- 函式以呼叫者權限執行，不使用 `SECURITY DEFINER`（`app/tests/db/forbidden-sql.test.ts` 檢查所有 migration）；`identities` 的 RLS 只讓身分讀到自己這一列。
- 讀取的 policy 不變：上傳的文件與段落依「權限規則」決定誰看得到，`oracle.ts` 的讀取規則不變。
- `oracle.ts` 的 `canWrite()` 是寫入規則的獨立實作。`app/tests/upload/write.test.ts` 對每個身分 × 每種「可見等級 × 專案（含無專案）」比對，並測試偽造 `uploaded_by`、段落加到別人的文件、`UPDATE`／`DELETE`；`app/tests/upload/visibility.test.ts` 確認上傳後，資料表、檢索、問答、時間軸與原文的可見範圍都與 oracle 相同。
- 上傳的內容只存在瀏覽器的記憶體資料庫，重新整理頁面就消失（AGENTS.md 第 5 節：migration 不套用到持久化的資料庫）。

## 待審與核准

上傳文件的萃取結果（#44，migration 0006；萃取的流程見 [docs/extraction.md](extraction.md)）先寫入待審資料表，核准後才寫入正式的 `entities`、`relations` 與出處。**只用 INSERT**：核准與退回寫成 `review_decisions`（每個項目同時最多一筆有效的決定；撤回後才能再決定，見下方「撤回」），`kk_app` 仍然沒有任何 `UPDATE`、`DELETE`。寫入與核准集中在 `app/src/extraction/store.ts`，一律經 `withIdentity()`。

**`kk_app` 的權限**（0006 新增的部分）：

| 資料表 | 權限 | 寫入（`WITH CHECK`） | 讀取（`USING`） |
| --- | --- | --- | --- |
| `pending_entities`、`pending_relations` 與兩張出處表 | `SELECT`、`INSERT` | 有 `can_upload`，且 `document_id` 是自己上傳的文件 | 有 `can_review`，且 `document_id` 的文件看得到 |
| `review_decisions` | `SELECT`、`INSERT` | 有 `can_review`、`decided_by` 是自己、項目看得到；`merge_into` 是自己看得到、類型相同的實體；關係不帶名稱與合併對象，核准時兩端都已核准 | 有 `can_review`，且項目看得到 |
| `entities` | 新增 `INSERT` | 對應一筆目前身分寫的核准決定（`merge_into` 為 NULL）：id、類型相同，`names` 等於核准時的名稱（決定中的 `names`，沒有時用待審的），`name` 是 `names` 的其中一個值 | 不變 |
| `entity_sources` | 新增 `INSERT` | 段落是一筆核准的待審實體的出處，實體是它的合併對象或新建的實體 | 不變 |
| `relations` | 新增 `INSERT` | 對應一筆目前身分寫的核准決定：id、類型相同，兩端是兩個待審實體核准後的實體（合併對象或新建的實體） | 不變 |
| `relation_sources` | 新增 `INSERT` | 段落是一筆核准的待審關係的出處（兩端由 0003 的複合外鍵保證與關係一致） | 不變 |

- **待審資料的可見範圍以文件判斷**：同一份上傳文件的段落權限都相同（0005），所以「看得到文件」就等於「看得到出處」。這樣 policy 不必互相參照。
- **上傳者看不到待審資料**：寫入只檢查文件是不是自己上傳的；「出處與兩端屬於同一份文件」由複合外鍵保證（外鍵檢查不受 RLS 影響）。上傳者沒有 `can_review` 時，寫入後讀不到任何待審資料（所以寫入不使用 `RETURNING`）。
- **退回**：`review_decisions` 的 CHECK 規定退回不帶 `names` 與 `merge_into`；合併不帶 `names`（既有實體的名稱不變）。
- **待審 id 的格式**（migration 0007）：待審實體以 `pe-` 開頭、待審關係以 `pr-` 開頭（CHECK）。`review_decisions.item_id` 由兩者共用，限制格式後兩者不會撞名，也不會與既有實體的 id 混淆。違反時 `store.ts` 回傳 `denied`，不顯示資料庫的訊息。
- **`kk.is_approved()`**：`review_decisions` 的 INSERT policy 要檢查「關係的兩端都已核准」，但 policy 直接查詢自己的資料表會被 PostgreSQL 視為無限遞迴，所以寫成 PL/pgSQL 函式（不會被內聯進 policy，執行時套用 `review_decisions` 的 SELECT policy）。函式都以呼叫者權限執行，不使用 `SECURITY DEFINER`。
- **待審與已退回的內容不會外流**：檢索、問答、圖譜、路徑、時間軸、原文的查詢都不讀取待審資料表；核准後的可見範圍沿用「權限規則」。
- **合併後可見範圍變大**（#44 決定）：把待審實體合併到既有實體時，新文件的段落成為該實體的出處。依「實體只要有一個看得到的出處就看得到」，看得到新文件的人也看得到該實體，包含只在其他文件出現過的其他語言名稱。待審區的合併選單會提示這一點。
- **圖譜已有的關係**（#189 決定 1）：核准的待審關係與核准者看得到的既有關係完全相同（類型、合併後的兩端）時，`store.ts` 只寫 `review_decisions`，不寫入 `relations` 與 `relation_sources`，避免重複的關係；RLS 不變（見 [docs/extraction.md](extraction.md)「合併」）。`oracle.ts` 的 `approvedSample()` 不模擬這一點，`review.test.ts` 的範例資料不使用與既有關係相同的待審關係。
- `oracle.ts` 的 `expectedReviewVisible()`、`canDecide()`、`approvedSample()` 是上述規則的獨立實作；`app/tests/extraction/review.test.ts` 以兩種設定（參考情境，以及一般員工也能審核）比對，並測試偽造的決定與正式資料寫入。

### 撤回

核准或退回之後可以撤回（ADR 0007，migration 0009）。撤回寫成 `review_retractions`，**只用 INSERT**；撤回後項目回到待審（沒有有效的決定），可以再決定一次，所有決定與撤回都保留。寫入集中在 `store.ts` 的 `retract()`；畫面上的入口是待審頁短提示的「撤銷」與圖譜頁右側面板的「撤回此文件對它的核准」（[docs/extraction.md](extraction.md)「畫面」）。

| 資料表 | 權限 | 寫入（`WITH CHECK`） | 讀取（`USING`） |
| --- | --- | --- | --- |
| `review_retractions` | `SELECT`、`INSERT` | 有 `can_review`、`retracted_by` 是自己、`retracted_at` 是現在；決定看得到（項目看得到），且項目屬於 `document_id` 的文件 | `document_id` 的文件看得到（不要求 `can_review`） |
| `review_decisions` | 不變 | 0006 的條件，加上 `round` 等於 `kk.next_round(item_id)`：先前的決定都已撤回時是筆數加一，還有有效的決定時是 NULL（寫入失敗） | 不變 |
| `entities`、`relations`、兩張出處表 | 不變 | 0006 的條件，id 改用決定的 `id`，出處帶上 `decision_id`；決定與關係兩端的核准都必須未撤回 | 出處扣掉已撤回的決定寫入的列 |

- **撤回的單位是一個決定**：只移除這份文件經這個決定寫入的出處。實體或關係沒有其他看得到的出處時就看不到；一端看不到的關係也看不到。其他文件的出處不受影響，合併造成的可見範圍擴大隨之收回。`kk.is_approved()` 改為判斷有效（未撤回）的核准。
- **連帶撤回**（#209 決定 6）：撤回實體的核准時，`retract()` 在同一個交易中撤回端點是這個待審實體、已核准且未撤回的關係（`cascade_of` 指向實體的撤回）。policy 不強制連帶撤回；只撤回實體時，關係也因一端看不到而看不到。
- **參考情境與資料集的內容撤回不了**：它們的出處 `decision_id` 為 NULL，沒有可以撤回的決定。
- **再決定的 id**：新建的實體與關係以決定的 `id` 為 id（例如 `pe-…~2`），不會與已撤回的列衝突；已撤回的實體與關係仍留在資料表中，沒有出處所以看不到，仍可以是合併對象。同一段落可以由不同的決定各寫一筆出處，讀取圖譜與時間軸時去除重複。
- **撤回紀錄的可見範圍**（ADR 0007 決定 6）：一般讀者的出處 policy 要查 `review_retractions`，所以文件看得到就看得到撤回紀錄。**看得到文件的人也看得到該文件的撤回紀錄，包括撤回者的身分 id。** 看得到出處段落就看得到所屬文件，所以出處的撤回一定讀得到。
- **既有資料的回填**：0009 依 `review_decisions` 回填出處的 `decision_id`（寫法同 0003）。migration 以 `kk_owner` 執行並受 FORCE RLS 限制，回填只在資料庫從 migration 重建、還沒有資料列時正確；改用持久化的資料庫前要重新檢討（AGENTS.md 第 5 節）。
- `oracle.ts` 的 `ReviewSample.retractions`、`approvedSample()`（只算有效的決定）、`canRetract()` 是撤回規則的獨立實作；`review.test.ts` 以 oracle 比對撤回前後每個身分的圖譜，並測試連帶撤回、再核准、看不到文件或沒有 `can_review` 的身分不能撤回、偽造的撤回紀錄與 `UPDATE`／`DELETE`。

## 說法不同

上傳文件與既有段落說法不同之處（#51，migration 0008）：偵測結果寫入 `conflicts`，主管的處理寫入 `conflict_decisions`（每組一筆，主鍵保證只能處理一次）。**只用 INSERT**：「新說法取代舊說法」也只新增一筆決定，不修改、不隱藏舊段落；`kk_app` 仍然沒有任何 `UPDATE`、`DELETE`。寫入與讀取集中在 `app/src/conflicts/store.ts`，一律經 `withIdentity()`。

**`kk_app` 的權限**（0008 新增的部分）：

| 資料表 | 權限 | 寫入（`WITH CHECK`） | 讀取（`USING`） |
| --- | --- | --- | --- |
| `conflicts` | `SELECT`、`INSERT` | 有 `can_upload`；`document_id` 是自己上傳的文件（新段落屬於該文件由複合外鍵保證）；既有段落自己看得到，且不在新文件中 | 兩段都看得到，且（有 `can_review`，或已決定為 `coexist`／`supersede`） |
| `conflict_decisions` | `SELECT`、`INSERT` | 有 `can_review`、`decided_by` 是自己、兩段都看得到 | 兩段都看得到，且（有 `can_review`，或 `decision` 為 `coexist`／`supersede`） |

- **比對只用上傳者看得到的段落**：既有段落必須是上傳者看得到的。新文件與上傳者看不到的機密文件說法不同時不會被偵測，否則等於透露機密內容的存在。
- **未處理的紀錄只有核准者讀得到**（比照「待審與核准」）：沒有 `can_review` 的身分只看得到兩段都看得到、而且已決定為「並存」或「取代」的組合；未處理與「不算說法不同」的組合看不到。上傳者寫入後讀不到自己寫的紀錄，所以寫入不使用 `RETURNING`。
- **任何指向另一段的紀錄，只給看得到兩段的人**：例如主管上傳機密文件並標記取代一段公開段落，一般員工看不到這筆紀錄，因此問答、時間軸與原文都不會出現任何標示。問答的部分以 `oracle.ts` 的 `expectedSupersede()` 比對（`app/tests/qa/supersede.test.ts`）；時間軸與原文的標示在畫面的 PR 實作。
- **policy 不互相參照**：`conflict_decisions` 帶上兩段的 id（複合外鍵 `(conflict_id, new_passage_id, old_passage_id)` 參照 `conflicts`），SELECT policy 只查 `passages`；`conflicts` 的 SELECT policy 查 `conflict_decisions`。參照方向是 `conflicts → conflict_decisions → passages`。
- **寫入決定不查 `conflicts`**：INSERT 的 `WITH CHECK` 若寫成 `EXISTS (SELECT … FROM kk.conflicts)`，`conflicts` 的 SELECT policy 又參照 `conflict_decisions`，PostgreSQL 會報 infinite recursion（已以測試確認）。有 `can_review` 時「該組看得到」等於「兩段都看得到」，兩段又由複合外鍵保證與該組一致，所以直接檢查兩段。`store.ts` 的 `decideConflict()` 以 `INSERT … SELECT FROM kk.conflicts` 帶入兩段的 id，看不到該組時沒有可寫入的列，視為拒絕。
- 違反 CHECK、外鍵或被 RLS 拒絕時，`store.ts` 回傳 `denied`；重複的組合或已處理的組回傳 `conflict`。不顯示資料庫的訊息。
- `oracle.ts` 的 `expectedConflictVisible()`、`canWriteConflict()`、`canDecideConflict()` 是上述規則的獨立實作；`app/tests/conflicts/store.test.ts` 以兩種設定（參考情境，以及一般員工也能審核）比對，並測試偽造的決定、`kk_app` 沒有 `UPDATE`／`DELETE`，以及「忽略身分的資料層」的反向驗證。

## 回答錯誤回報

問答的回答可以回報「有錯」（ADR 0007 決定 7，migration 0010）。回報寫入 `answer_reports`，處理（「不是錯誤」或已撤回）寫入 `answer_report_resolutions`，**都只用 INSERT**。寫入與讀取集中在 `app/src/reports/store.ts`（`writeReport()`、`readReports()`、`resolveReport()`），一律經 `withIdentity()`。畫面見 [docs/qa.md](qa.md)「回報有錯」。

| 資料表 | 權限 | 寫入（`WITH CHECK`） | 讀取（`USING`） |
| --- | --- | --- | --- |
| `answer_reports` | `SELECT`、`INSERT` | 所有身分；`reported_by` 是自己、`reported_at` 是現在；`sent_passage_ids` 的段落與 `entity_ids` 的實體自己全部看得到 | 有 `can_review`，且 `sent_passage_ids` 的段落全部看得到 |
| `answer_report_resolutions` | `SELECT`、`INSERT` | 有 `can_review`、`resolved_by` 是自己、`resolved_at` 是現在、看得到該回報 | 看得到該回報 |

- **以送出的段落判斷，不只引用的段落**（#209 決定 5）：回答可能用到送給模型、但沒有引用的段落內容。送出的段落有一段看不到，就看不到該回報，即使那一段沒有被引用。
- **段落存成陣列，不另開子表**：子表的 RLS 會隱藏看不到的列，讓「全部看得到」被誤判成立。policy 以 `unnest()` 逐一確認每一段都在 `passages`（受 RLS 限制）中。
- **拒答的回報只含問題文字**：`answer` 為 NULL 時三個陣列都必須是空的；有回答時至少有一段送出的段落（CHECK），避免沒有段落的回答被所有審核者看到。拒答的回報有 `can_review` 就看得到。
- **回報者不一定讀得到自己的回報**：沒有 `can_review` 的身分也能回報，寫入後讀不到，所以寫入不使用 `RETURNING`。
- **提到的實體**：寫入時要求回報者看得到；`readReports()` 只列出讀者看得到的實體（與 `entities` 的 RLS 取交集），回報本身的可見範圍不看實體。
- **處理每個回報一次**：主鍵是 `report_id`，已處理時回傳 `conflict`。policy 的參照方向是 `answer_report_resolutions → answer_reports → passages`，沒有循環。
- 違反 CHECK、外鍵、沒有身分或被 RLS 拒絕時，`store.ts` 回傳 `denied`；不顯示資料庫的訊息。
- `oracle.ts` 的 `expectedReportVisible()`、`canWriteReport()`、`canResolveReport()` 是上述規則的獨立實作；`app/tests/reports/store.test.ts` 以兩種設定（參考情境，以及一般員工也能審核）比對，並測試「沒有引用、但送出的段落看不到時看不到該回報」、偽造的回報與處理、`kk_app` 沒有 `UPDATE`／`DELETE`，以及「忽略身分的資料層」的反向驗證。

## 越權測試（滲漏矩陣）

`app/tests/db/leakage.test.ts` 用 `app/tests/db/sample.ts` 的最小虛構資料：

- 每種「可見等級 × 專案（含沒有專案）」各一份文件
- 比文件更機密的段落、比文件寬鬆的段落、與文件不同專案的段落
- 只有機密出處的實體、沒有出處的實體與關係、一端看不到的關係

`app/tests/db/oracle.ts` 以 TypeScript 獨立實作本文件的權限規則，算出每個身分「應該看得到」的列，再與 SQL 的結果逐表比對。讀取規則（`expectedVisible()`）放在 `app/src/evals/oracle.ts`，評測台也以它判定滲漏（[docs/evals.md](evals.md)），`app/tests/db/oracle.ts` 重新匯出：

- **滲漏**：查得到但不該看到的列，必須為 0
- **漏看**：該看到卻查不到的列，也必須為 0，避免以「全部擋掉」通過

比對的身分包括 `client/access.json` 的所有角色、沒有身分、不存在的身分；也測試依序切換身分，以及同時進行的不同身分查詢。改權限規則時，SQL（新的 migration）、`oracle.ts` 與本文件要一起改。

## 擴充

- 新增資料表：在新的 migration 中同時 `ENABLE`、`FORCE ROW LEVEL SECURITY`，加上 policy 與 `GRANT`，並把表名加進 `app/src/db/test-fixtures.ts` 的 `KK_TABLES`。結構測試會確認 `kk` 中每張表都有 FORCE RLS。
- 檢索需要的擴充（pg_trgm、pgvector）在檢索的 Issue 決定。pgvector 需要另一個套件 `@electric-sql/pglite-pgvector`，不在 ADR 0001 的核准清單內（#6 決定 3）。

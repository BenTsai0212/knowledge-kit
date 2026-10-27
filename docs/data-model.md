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
| `identities` | `id` PK、`visibility_level_id` | `access.json` 的 `roles`，一個角色一個身分 |
| `identity_projects` | `identity_id`、`project_id`（合為 PK） | 角色的 `projects` |
| `documents` | `id` PK、`title`、`language`、`visibility_level_id`、`project_id`（可為 NULL）、`source_uri`（可為 NULL） | 資料集 |
| `passages` | `id` PK、`document_id`、`ordinal`、`language`、`content`、`visibility_level_id`、`project_id`（可為 NULL） | 資料集 |
| `entities` | `id` PK、`entity_type`、`name` | 萃取或資料集 |
| `entity_sources` | `entity_id`、`passage_id`（出處，合為 PK） | 同上 |
| `relations` | `id` PK、`relation_type`、`from_entity_id`、`to_entity_id` | 同上 |
| `relation_sources` | `relation_id`、`passage_id`（出處，合為 PK）、`from_entity_id`、`to_entity_id`（與關係的兩端相同，以複合外鍵參照 `relations (id, from_entity_id, to_entity_id)` 確保一致） | 同上 |

- id 一律 `text`；`client/` 的名單沿用設定中的 id。
- `language` 以 CHECK 限制為語言代碼格式；「必須屬於 `client.json` 的 `languages`」由匯入程式檢查。
- `entity_type`、`relation_type` 是否存在於 `knowledge-model.json`，同樣由匯入程式檢查。知識模型不進資料庫，所以不寫成 FK。
- 段落有自己的可見等級與專案，讓同一份文件可以有較機密的段落；段落還必須同時看得到所屬文件。

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
| `entity_sources` | 出處段落看得到 |
| `relation_sources` | 出處段落看得到，且兩端的實體都看得到 |
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

## 越權測試（滲漏矩陣）

`app/tests/db/leakage.test.ts` 用 `app/tests/db/sample.ts` 的最小虛構資料：

- 每種「可見等級 × 專案（含沒有專案）」各一份文件
- 比文件更機密的段落、比文件寬鬆的段落、與文件不同專案的段落
- 只有機密出處的實體、沒有出處的實體與關係、一端看不到的關係

`app/tests/db/oracle.ts` 以 TypeScript 獨立實作本文件的權限規則，算出每個身分「應該看得到」的列，再與 SQL 的結果逐表比對：

- **滲漏**：查得到但不該看到的列，必須為 0
- **漏看**：該看到卻查不到的列，也必須為 0，避免以「全部擋掉」通過

比對的身分包括 `client/access.json` 的所有角色、沒有身分、不存在的身分；也測試依序切換身分，以及同時進行的不同身分查詢。改權限規則時，SQL（新的 migration）、`oracle.ts` 與本文件要一起改。

## 擴充

- 新增資料表：在新的 migration 中同時 `ENABLE`、`FORCE ROW LEVEL SECURITY`，加上 policy 與 `GRANT`，並把表名加進 `app/src/db/test-fixtures.ts` 的 `KK_TABLES`。結構測試會確認 `kk` 中每張表都有 FORCE RLS。
- 檢索需要的擴充（pg_trgm、pgvector）在檢索的 Issue 決定。pgvector 需要另一個套件 `@electric-sql/pglite-pgvector`，不在 ADR 0001 的核准清單內（#6 決定 3）。

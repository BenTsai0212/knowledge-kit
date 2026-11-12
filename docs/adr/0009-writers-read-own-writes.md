# ADR 0009：寫入者讀得到自己寫入的資料

- 狀態：Accepted
- 日期：2026-11-12
- 決定者：@BenTsai0212
- 相關：#284（計畫與 `## 決定`）、#286（回報結果，之後沿用）、#44（待審與核准）、[ADR 0007](0007-retraction-and-answer-reports.md) 決定 6、7、[docs/data-model.md](../data-model.md)「待審與核准」

## 背景

#44 定下「上傳者看不到待審資料」：待審資料表與 `review_decisions` 的 SELECT policy 都要求 `kk.can_review()`，沒有 `can_review` 的上傳者寫入萃取結果後，讀不到自己文件的待審項目，也讀不到核准或退回的結果。回答錯誤回報（ADR 0007 決定 7）也一樣，回報者沒有 `can_review` 時讀不到自己的回報。

「我的上傳」與首頁的「有更新」（#284）需要上傳的人看到自己的文件在哪一步、審核結果是什麼；回報結果回到回報的人（#286）也有同樣的需要。兩張 Issue 若各自放寬，容易做法不一致；「上傳者看不到」寫在 data-model.md，agent 也可能想把它「改正」回去。

## 選項

1. **改寫既有的 `review` policy**（DROP 後重建，把上傳者加進條件）：要動到已套用的 policy，核准者的條件可能被一起改到。
2. **新增 permissive 的 `own_*` SELECT policy**：PostgreSQL 以 OR 合併同一張表的 permissive policy，既有 policy 不動。
3. **以 `SECURITY DEFINER` 函式提供「我的上傳」**：繞過 RLS，違反「權限完全交給 RLS」。

## 決定

1. **選項 2。** 讓寫入者讀得到自己寫入的資料時，新增一組 permissive 的 SELECT policy（名稱 `own_<用途>`，例如 `own_upload`），不修改、不 DROP 既有的 policy，也不修改已套用的 migration。
2. **「自己」以 `*_by = kk.current_identity_id()` 判斷**（例如 `documents.uploaded_by`）。沒有身分時 `current_identity_id()` 為 NULL，比較不成立；資料集的文件 `uploaded_by` 為 NULL，沒有人是它的上傳者。
3. **仍套用原本的可見範圍。** 子查詢讀原本就受 RLS 限制的資料表（例如 `kk.documents`），所以文件看不到時（例如之後可見範圍被調低）一樣讀不到；指向其他資料的欄位也要求目前身分看得到（例如 `review_decisions.merge_into` 指向的實體，#284 決定 2）。
4. **只開放讀取。** 寫入（決定、撤回、處理、正式資料）的 policy 不變，寫入者讀得到之後仍不能核准、退回、撤回或處理。
5. **身分目前是角色層級**（#284 決定 1）：`identities` 一個角色一個身分，「自己」實際上是同一角色。畫面仍用「我的上傳」等說法；改成個人帳號時自然成立。
6. **#284 先套用到上傳**（migration 0011）：四張待審資料表與 `review_decisions` 各加一條 `own_upload`。#286 套用到回報時沿用本 ADR，並說明與 ADR 0007 決定 7 的關係；不共用 SQL 函式。

## 後果

- 好處：核准者的可見範圍不變（`own_*` 對 `can_review` 的身分只是既有範圍的子集）；做法一致，可由 `oracle.ts` 以「核准者 ∪ 寫入者」獨立實作並以越權測試比對。
- 代價：policy 參照其他資料表時，可能和既有 INSERT policy 形成 PostgreSQL 展開時的遞迴（例如 `entities` 的 INSERT policy 查 `review_decisions`）。0011 以 PL/pgSQL 函式 `kk.entity_visible()` 避開（同 0006 的 `kk.is_approved()`），新增 `own_*` 時同樣只能以測試確認。
- 後續：#286 的回報；改成個人帳號時重新檢討決定 5 的說明。

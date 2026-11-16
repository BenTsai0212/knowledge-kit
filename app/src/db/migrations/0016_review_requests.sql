-- 請上傳者確認（ADR 0011 決定 6，#378 PR 5a，docs/data-model.md「請上傳者確認」）：
-- 審核者對一個接縫寫入請求，上傳者回答一次。上傳者沒有 canReview，回答只是說明，不是決定；決定仍由審核者寫入 review_decisions。
-- 兩張表都只能新增；kk_app 仍沒有任何 UPDATE、DELETE。不使用 SECURITY DEFINER。

-- 請求：一個待審項目（實體或關係）與它所屬的文件。item_id 不能以外鍵同時參照兩張待審表，屬於該文件由 INSERT policy 檢查
CREATE TABLE kk.review_requests (
  id text PRIMARY KEY CHECK (id LIKE 'rq-%'),
  item_id text NOT NULL,
  document_id text NOT NULL REFERENCES kk.documents (id),
  requested_by text NOT NULL REFERENCES kk.identities (id),
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON kk.review_requests (item_id);
CREATE INDEX ON kk.review_requests (document_id);

-- 回答：每個請求只能回答一次（主鍵）。choice 與接縫的選項相同：merge（合併到 merge_into）、new（建立新實體）、
-- keep（照系統的判斷收錄）、reject（不收錄）、other（都不是，我來說明；只有這時可以附說明）
CREATE TABLE kk.review_request_replies (
  request_id text PRIMARY KEY REFERENCES kk.review_requests (id),
  replied_by text NOT NULL REFERENCES kk.identities (id),
  choice text NOT NULL CHECK (choice IN ('merge', 'new', 'keep', 'reject', 'other')),
  merge_into text REFERENCES kk.entities (id),
  note text CHECK (note IS NULL OR (choice = 'other' AND char_length(note) BETWEEN 1 AND 500)),
  replied_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((choice = 'merge') = (merge_into IS NOT NULL))
);

ALTER TABLE kk.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.review_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.review_request_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.review_request_replies FORCE ROW LEVEL SECURITY;

-- 項目還有沒回答的請求。review_requests 的 INSERT policy 不直接查詢自己，同 kk.next_round() 寫成 PL/pgSQL；以呼叫者權限執行
CREATE FUNCTION kk.request_open(p_item_id text) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM kk.review_requests q
        WHERE q.item_id = p_item_id
          AND NOT EXISTS (SELECT 1 FROM kk.review_request_replies a WHERE a.request_id = q.id));
    END
  $$;

-- 讀取：看得到該文件（documents 的 can_see），而且有 canReview 或是該文件的上傳者（比照 0011 的 own_upload）
CREATE POLICY can_see ON kk.review_requests FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.documents d
    WHERE d.id = review_requests.document_id
      AND (kk.can_review() OR d.uploaded_by = kk.current_identity_id())));

-- 寫入：有 canReview、請求者是自己、時間是現在；文件看得到、有上傳者而且不是自己（上傳者就是審核者時沒有這個出口）；
-- 項目屬於該文件、沒有有效的決定，也沒有還沒回答的請求
CREATE POLICY request ON kk.review_requests FOR INSERT TO kk_app
  WITH CHECK (
    kk.can_review()
    AND review_requests.requested_by = kk.current_identity_id()
    AND review_requests.requested_at = now()
    AND EXISTS (
      SELECT 1 FROM kk.documents d
      WHERE d.id = review_requests.document_id
        AND d.uploaded_by IS NOT NULL
        AND d.uploaded_by <> kk.current_identity_id())
    AND (
      EXISTS (SELECT 1 FROM kk.pending_entities p WHERE p.id = review_requests.item_id AND p.document_id = review_requests.document_id)
      OR EXISTS (SELECT 1 FROM kk.pending_relations r WHERE r.id = review_requests.item_id AND r.document_id = review_requests.document_id)
    )
    AND kk.next_round(review_requests.item_id) IS NOT NULL
    AND NOT kk.request_open(review_requests.item_id)
  );

-- 讀取回答：看得到該請求，而且合併對象是自己看得到的實體（實體 id 是有意義的代稱，同 0011 的 own_upload）
CREATE POLICY can_see ON kk.review_request_replies FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.review_requests q WHERE q.id = review_request_replies.request_id)
    AND (review_request_replies.merge_into IS NULL OR kk.entity_visible(review_request_replies.merge_into))
  );

-- 回答：回答者是自己、時間是現在；請求看得到而且文件是自己上傳的；項目還沒有有效的決定。
-- 合併只用於實體，對象是自己看得到、類型相同的實體；建立新實體只用於實體
CREATE POLICY reply ON kk.review_request_replies FOR INSERT TO kk_app
  WITH CHECK (
    review_request_replies.replied_by = kk.current_identity_id()
    AND review_request_replies.replied_at = now()
    AND EXISTS (
      SELECT 1 FROM kk.review_requests q JOIN kk.documents d ON d.id = q.document_id
      WHERE q.id = review_request_replies.request_id
        AND d.uploaded_by = kk.current_identity_id()
        AND kk.next_round(q.item_id) IS NOT NULL
        AND (
          review_request_replies.choice NOT IN ('merge', 'new')
          OR EXISTS (
            SELECT 1 FROM kk.pending_entities p
            WHERE p.id = q.item_id
              AND (review_request_replies.merge_into IS NULL OR EXISTS (
                SELECT 1 FROM kk.entities e WHERE e.id = review_request_replies.merge_into AND e.entity_type = p.entity_type)))
        )
    )
  );

GRANT SELECT, INSERT ON kk.review_requests, kk.review_request_replies TO kk_app;

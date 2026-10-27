-- 權限規則（docs/data-model.md）。所有資料表 FORCE ROW LEVEL SECURITY，kk_app 只有 SELECT。

-- 目前身分：只在交易內以 set_config('kk.identity_id', …, true) 設定；未設定時為 NULL
CREATE FUNCTION kk.current_identity_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('kk.identity_id', true), '') $$;

-- 看得到 ⇔ 目前身分存在，且 rank ≤ 身分的 rank，且（沒有專案，或專案在身分的名單中）
-- 以呼叫者權限執行（不使用 SECURITY DEFINER），讀取的 identities 本身也受 RLS 限制
CREATE FUNCTION kk.can_see(p_level_id text, p_project_id text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM kk.identities i
      JOIN kk.visibility_levels il ON il.id = i.visibility_level_id
      JOIN kk.visibility_levels rl ON rl.id = p_level_id
      WHERE i.id = kk.current_identity_id()
        AND rl.rank <= il.rank
        AND (
          p_project_id IS NULL
          OR EXISTS (
            SELECT 1 FROM kk.identity_projects ip
            WHERE ip.identity_id = i.id AND ip.project_id = p_project_id
          )
        )
    )
  $$;

ALTER TABLE kk.visibility_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.identity_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.entity_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kk.relation_sources ENABLE ROW LEVEL SECURITY;

ALTER TABLE kk.visibility_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.identities FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.identity_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.passages FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.entities FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.entity_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.relations FORCE ROW LEVEL SECURITY;
ALTER TABLE kk.relation_sources FORCE ROW LEVEL SECURITY;

-- policy 中的欄位一律加上表名：子查詢的表日後新增同名欄位時，比對對象才不會悄悄改變
CREATE POLICY own_identity ON kk.identities FOR SELECT TO kk_app
  USING (identities.id = kk.current_identity_id());

CREATE POLICY own_identity ON kk.identity_projects FOR SELECT TO kk_app
  USING (identity_projects.identity_id = kk.current_identity_id());

-- 名單本身不是機密：有身分時全部看得到
CREATE POLICY has_identity ON kk.visibility_levels FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id()));

CREATE POLICY has_identity ON kk.projects FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id()));

CREATE POLICY can_see ON kk.documents FOR SELECT TO kk_app
  USING (kk.can_see(documents.visibility_level_id, documents.project_id));

-- 段落：自己看得到，且所屬文件看得到（documents 的 RLS 在子查詢中同樣生效）
CREATE POLICY can_see ON kk.passages FOR SELECT TO kk_app
  USING (
    kk.can_see(passages.visibility_level_id, passages.project_id)
    AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = passages.document_id)
  );

-- 出處：出處段落看得到
CREATE POLICY can_see ON kk.entity_sources FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = entity_sources.passage_id));

CREATE POLICY can_see ON kk.relation_sources FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = relation_sources.passage_id));

-- 實體：至少一個出處看得到；沒有出處的實體沒有人看得到
CREATE POLICY can_see ON kk.entities FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.entity_sources s WHERE s.entity_id = entities.id));

-- 關係：至少一個出處看得到，且兩端的實體都看得到
CREATE POLICY can_see ON kk.relations FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.relation_sources s WHERE s.relation_id = relations.id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relations.from_entity_id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relations.to_entity_id)
  );

GRANT USAGE ON SCHEMA kk TO kk_app;
GRANT SELECT ON ALL TABLES IN SCHEMA kk TO kk_app;

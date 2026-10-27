-- relation_sources 帶上關係的兩端，讓它的 policy 能檢查兩端實體，而不必查 kk.relations。
-- kk.relations 的 policy 會查 kk.relation_sources，若反過來也查 kk.relations，會造成 policy 無限遞迴。

ALTER TABLE kk.relations
  ADD CONSTRAINT relations_id_endpoints_key UNIQUE (id, from_entity_id, to_entity_id);

ALTER TABLE kk.relation_sources
  ADD COLUMN from_entity_id text,
  ADD COLUMN to_entity_id text;

UPDATE kk.relation_sources
SET from_entity_id = r.from_entity_id, to_entity_id = r.to_entity_id
FROM kk.relations r
WHERE r.id = relation_sources.relation_id;

ALTER TABLE kk.relation_sources
  ALTER COLUMN from_entity_id SET NOT NULL,
  ALTER COLUMN to_entity_id SET NOT NULL,
  -- 兩端必須與關係一致
  ADD CONSTRAINT relation_sources_relation_endpoints_fkey
    FOREIGN KEY (relation_id, from_entity_id, to_entity_id)
    REFERENCES kk.relations (id, from_entity_id, to_entity_id);

-- 出處：出處段落看得到，且兩端實體都看得到。關係被隱藏時，出處列也看不到
DROP POLICY can_see ON kk.relation_sources;
CREATE POLICY can_see ON kk.relation_sources FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM kk.passages p WHERE p.id = relation_sources.passage_id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relation_sources.from_entity_id)
    AND EXISTS (SELECT 1 FROM kk.entities e WHERE e.id = relation_sources.to_entity_id)
  );

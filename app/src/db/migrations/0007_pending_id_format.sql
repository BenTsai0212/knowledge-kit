-- 待審 id 的格式（#45 審查）：待審實體以 pe- 開頭、待審關係以 pr- 開頭。
-- review_decisions.item_id 由兩者共用，限制格式後兩者不會撞名，也不會與既有實體或關係的 id 混淆
ALTER TABLE kk.pending_entities ADD CONSTRAINT pending_entities_id_format CHECK (id LIKE 'pe-%');
ALTER TABLE kk.pending_relations ADD CONSTRAINT pending_relations_id_format CHECK (id LIKE 'pr-%');

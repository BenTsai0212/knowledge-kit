-- 通用資料表。以 kk_owner 執行，資料表屬於 kk_owner。

CREATE TABLE kk.visibility_levels (
  id text PRIMARY KEY,
  rank integer NOT NULL UNIQUE CHECK (rank >= 0)
);

CREATE TABLE kk.projects (
  id text PRIMARY KEY
);

-- 一個 client/ 角色產生一個身分
CREATE TABLE kk.identities (
  id text PRIMARY KEY,
  visibility_level_id text NOT NULL REFERENCES kk.visibility_levels (id)
);

CREATE TABLE kk.identity_projects (
  identity_id text NOT NULL REFERENCES kk.identities (id),
  project_id text NOT NULL REFERENCES kk.projects (id),
  PRIMARY KEY (identity_id, project_id)
);

CREATE TABLE kk.documents (
  id text PRIMARY KEY,
  title text NOT NULL,
  language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$'),
  visibility_level_id text NOT NULL REFERENCES kk.visibility_levels (id),
  project_id text REFERENCES kk.projects (id),
  source_uri text
);

CREATE TABLE kk.passages (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES kk.documents (id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  language text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$'),
  content text NOT NULL,
  visibility_level_id text NOT NULL REFERENCES kk.visibility_levels (id),
  project_id text REFERENCES kk.projects (id),
  UNIQUE (document_id, ordinal)
);

CREATE TABLE kk.entities (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  name text NOT NULL
);

CREATE TABLE kk.entity_sources (
  entity_id text NOT NULL REFERENCES kk.entities (id),
  passage_id text NOT NULL REFERENCES kk.passages (id),
  PRIMARY KEY (entity_id, passage_id)
);

CREATE TABLE kk.relations (
  id text PRIMARY KEY,
  relation_type text NOT NULL,
  from_entity_id text NOT NULL REFERENCES kk.entities (id),
  to_entity_id text NOT NULL REFERENCES kk.entities (id)
);

CREATE TABLE kk.relation_sources (
  relation_id text NOT NULL REFERENCES kk.relations (id),
  passage_id text NOT NULL REFERENCES kk.passages (id),
  PRIMARY KEY (relation_id, passage_id)
);

CREATE INDEX ON kk.passages (document_id);
CREATE INDEX ON kk.entity_sources (passage_id);
CREATE INDEX ON kk.relation_sources (passage_id);
CREATE INDEX ON kk.relations (from_entity_id);
CREATE INDEX ON kk.relations (to_entity_id);

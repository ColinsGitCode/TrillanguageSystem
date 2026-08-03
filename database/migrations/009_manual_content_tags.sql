CREATE TABLE IF NOT EXISTS manual_tag_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 80),
  category TEXT NOT NULL DEFAULT 'custom'
    CHECK (category IN ('priority', 'status', 'skill', 'topic', 'custom')),
  color TEXT NOT NULL DEFAULT 'gray'
    CHECK (color IN ('gray', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'purple')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_tag_definitions_status_category
  ON manual_tag_definitions(status, category, normalized_name);

CREATE TABLE IF NOT EXISTS manual_tag_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id INTEGER NOT NULL,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('generation', 'textbook_track', 'textbook_expression', 'knowledge_point')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  created_at_utc TEXT NOT NULL,
  UNIQUE (tag_id, target_kind, target_id),
  FOREIGN KEY (tag_id) REFERENCES manual_tag_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_tag_assignments_target
  ON manual_tag_assignments(target_kind, target_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_manual_tag_assignments_tag_target
  ON manual_tag_assignments(tag_id, target_kind, target_id);

INSERT OR IGNORE INTO manual_tag_definitions(
  name, normalized_name, category, color, status, is_seed, version,
  created_at_utc, updated_at_utc
) VALUES
  ('重点', '重点', 'priority', 'red', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('待复习', '待复习', 'status', 'orange', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('易错', '易错', 'status', 'yellow', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('已掌握', '已掌握', 'status', 'green', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('口语', '口语', 'skill', 'blue', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('听力', '听力', 'skill', 'cyan', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('语法', '语法', 'skill', 'purple', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('工作', '工作', 'topic', 'gray', 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

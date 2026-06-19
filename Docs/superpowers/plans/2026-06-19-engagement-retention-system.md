# Engagement and Retention System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage "今日学习" engagement bar driven by SRS data, with timezone-correct daily aggregation, streak state, daily goal persistence, mastery metrics, and a review entry point.

**Architecture:** Keep SRS ownership in `services/storage/db/cardSrs.js`, keep user settings in a small `user_preferences` storage module, and expose one homepage-oriented aggregate endpoint through `routes/srs.js`. The homepage renders the aggregate via existing vanilla ES modules and links into Knowledge Hub review mode with `?mode=review`.

**Tech Stack:** Node.js, Express, better-sqlite3, SQLite date modifiers, vanilla ES modules, Playwright, Docker Compose.

---

## Source References

- Approved design: `Docs/Features/Engagement_and_Retention_System.md`
- SRS storage: `services/storage/db/cardSrs.js`
- Database service facade: `services/storage/databaseService.js`
- Current SRS routes: `routes/srs.js`
- Homepage hero: `public/index.html`
- Homepage controller: `public/js/modules/app.js`
- Frontend API wrapper: `public/js/modules/api.js`
- Knowledge Hub review mode: `public/js/modules/dashboard.js`

## File Structure

- Modify: `Docs/Features/Engagement_and_Retention_System.md`
  - Align remaining doc details before implementation: complete `public/js/modules/app.js` refresh lifecycle, define goal validation, and fix the short path `db/userPreferences.js`.
- Modify: `Docs/Features/Knowledge_Hub_UI_Redesign.md`
  - Correct status to "P1/P2/P3 已实施；P4 待实施".
- Modify: `Docs/README.md`
  - Keep feature docs and this implementation plan discoverable.
- Modify: `lib/serverConfig.js`
  - Export `RECORDS_TIMEZONE` and `tzOffsetClause()`.
- Modify: `services/storage/fileManager.js`
  - Reuse `RECORDS_TIMEZONE` from `serverConfig`.
- Create: `services/storage/db/userPreferences.js`
  - Small key-value preference helpers.
- Modify: `database/schema.sql`
  - Add `user_preferences` for fresh installs.
- Modify: `services/storage/databaseService.js`
  - Create `user_preferences` on startup and expose SRS engagement / goal facade methods.
- Modify: `services/storage/db/cardSrs.js`
  - Timezone-correct `reviewedToday` and implement engagement aggregation.
- Modify: `routes/srs.js`
  - Add `GET /api/srs/engagement`, `GET /api/srs/goal`, and `PUT /api/srs/goal`.
- Modify: `public/js/modules/api.js`
  - Add SRS engagement and goal API helpers.
- Modify: `public/index.html`
  - Add homepage "今日学习" bar DOM inside `.hero`.
- Modify: `public/styles.css`
  - Style the engagement bar for desktop and mobile.
- Modify: `public/js/modules/app.js`
  - Render the engagement bar, handle goal changes, and refresh on `pageshow` / focus.
- Modify: `public/js/modules/dashboard.js`
  - Enter review mode when URL includes `?mode=review`.
- Modify: `tests/unit/serverConfig.test.js`
  - Cover timezone config helper.
- Create: `tests/unit/userPreferences.test.js`
  - Cover preference defaults and persistence.
- Modify: `tests/unit/databaseService.test.js`
  - Cover engagement aggregation, timezone boundaries, mastery denominator, and goal facade.
- Create: `tests/integration/srsEngagement.test.js`
  - Cover SRS engagement and goal routes.
- Create: `tests/e2e/engagement-retention.spec.js`
  - Cover homepage bar render, empty state, review entry, and returning-home refresh.

---

### Task 1: Finalize Design Docs And Plan Registration

**Files:**
- Modify: `Docs/Features/Engagement_and_Retention_System.md`
- Modify: `Docs/Features/Knowledge_Hub_UI_Redesign.md`
- Modify: `Docs/README.md`
- Create: `Docs/superpowers/plans/2026-06-19-engagement-retention-system.md`

- [ ] **Step 1: Update Engagement doc for remaining P1 details**

Edit `Docs/Features/Engagement_and_Retention_System.md`:

```markdown
> 影响文件：`database/schema.sql` · `services/storage/db/cardSrs.js` · `services/storage/db/userPreferences.js` · `lib/serverConfig.js` · `routes/srs.js` · `public/index.html` · `public/styles.css` · `public/js/modules/{app,api,dashboard}.js`
```

Under the API section, add the goal validation rule:

```markdown
**Goal validation**：`goal` 必须是整数，范围 `1..200`。非法值返回 `400 { error: "goal must be an integer between 1 and 200" }`，不写入 `user_preferences`。
```

Under frontend refresh timing, replace the current refresh list with:

```markdown
- 首页 `init()` 拉 `GET /api/srs/engagement` 渲染。
- 增加 `window.addEventListener('pageshow', ...)`：处理从 Knowledge Hub 后退回首页时的 bfcache 场景。
- 增加 `document.addEventListener('visibilitychange', ...)`：页面重新可见时刷新 engagement。
- 增加 `window.addEventListener('focus', ...)`：跨 tab 回到首页时刷新 engagement。
- `api.js` 加 `getSrsEngagement()` / `getDailyGoal()` / `setDailyGoal(goal)`。
```

- [ ] **Step 2: Fix Knowledge Hub UI design status**

Change the status block in `Docs/Features/Knowledge_Hub_UI_Redesign.md` to:

```markdown
> 状态：**P1/P2/P3 已实施；P4 左栏精简待实施** · 2026-06
```

In the phase table, update the P1/P2/P3 rows to "✅ 已实施" and keep P4 as "后续".

- [ ] **Step 3: Register this implementation plan in `Docs/README.md`**

Under "### 4. UI / Card 功能", add:

```markdown
- `Docs/superpowers/plans/2026-06-19-engagement-retention-system.md`（激励留存 P1 详细执行任务清单）
```

- [ ] **Step 4: Verify docs are discoverable**

Run:

```bash
rg -n "Engagement_and_Retention_System|2026-06-19-engagement-retention-system|Knowledge_Hub_UI_Redesign" Docs/README.md Docs/Features
```

Expected: output contains all three document entries, and `Knowledge_Hub_UI_Redesign.md` no longer reports plain "待实施" as the whole status.

- [ ] **Step 5: Commit**

```bash
git add Docs/Features/Engagement_and_Retention_System.md Docs/Features/Knowledge_Hub_UI_Redesign.md Docs/README.md Docs/superpowers/plans/2026-06-19-engagement-retention-system.md
git commit -m "docs: plan engagement retention implementation"
```

---

### Task 2: Add Shared Timezone Configuration

**Files:**
- Modify: `lib/serverConfig.js`
- Modify: `services/storage/fileManager.js`
- Modify: `tests/unit/serverConfig.test.js`

- [ ] **Step 1: Write failing timezone tests**

Append to `tests/unit/serverConfig.test.js`:

```js
test.describe('serverConfig timezone helpers', () => {
  test.it('exports the configured records timezone', () => {
    assert.equal(typeof cfg.RECORDS_TIMEZONE, 'string');
    assert.ok(cfg.RECORDS_TIMEZONE.length > 0);
  });

  test.it('builds a SQLite minute modifier for Asia/Shanghai', () => {
    assert.equal(cfg.tzOffsetClause('Asia/Shanghai', new Date('2026-06-19T00:00:00Z')), '+480 minutes');
  });

  test.it('falls back to UTC for invalid timezone names', () => {
    assert.equal(cfg.tzOffsetClause('Not/AZone', new Date('2026-06-19T00:00:00Z')), '+0 minutes');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/unit/serverConfig.test.js
```

Expected: fails because `RECORDS_TIMEZONE` and `tzOffsetClause` are not exported.

- [ ] **Step 3: Implement timezone config**

Add to `lib/serverConfig.js` near the other constants:

```js
const RECORDS_TIMEZONE = process.env.RECORDS_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
```

Add this helper:

```js
function tzOffsetClause(tz = RECORDS_TIMEZONE, now = new Date()) {
  try {
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const mins = Math.round((local - utc) / 60000);
    return `${mins >= 0 ? '+' : '-'}${Math.abs(mins)} minutes`;
  } catch (_err) {
    return '+0 minutes';
  }
}
```

Export both:

```js
module.exports = {
  PORT,
  RECORDS_PATH,
  RECORDS_TIMEZONE,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_THINKING,
  E2E_TEST_MODE,
  SUPPORTED_CARD_TYPES,
  SUPPORTED_DEEPSEEK_MODELS,
  toNumberOr,
  normalizeLlmProvider,
  normalizeCardType,
  normalizeSourceMode,
  sanitizeDeepSeekModelName,
  resolveDeepSeekModel,
  normalizeDeepSeekThinking,
  tzOffsetClause,
};
```

- [ ] **Step 4: Deduplicate `fileManager` timezone source**

Change the top of `services/storage/fileManager.js` from:

```js
const { normalizeCardType } = require('../../lib/serverConfig');
const RECORDS_TIMEZONE = process.env.RECORDS_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Shanghai';
```

to:

```js
const { normalizeCardType, RECORDS_TIMEZONE } = require('../../lib/serverConfig');
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/unit/serverConfig.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/serverConfig.js services/storage/fileManager.js tests/unit/serverConfig.test.js
git commit -m "fix: centralize records timezone config"
```

---

### Task 3: Add User Preferences Storage

**Files:**
- Create: `services/storage/db/userPreferences.js`
- Create: `tests/unit/userPreferences.test.js`
- Modify: `database/schema.sql`
- Modify: `services/storage/databaseService.js`

- [ ] **Step 1: Write failing preference module tests**

Create `tests/unit/userPreferences.test.js`:

```js
'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../../services/storage/databaseService');
const prefs = require('../../services/storage/db/userPreferences');

function freshDb() {
  return new DatabaseService(':memory:');
}

test.describe('userPreferences storage', () => {
  test.it('returns fallback for missing preference', () => {
    const db = freshDb();
    try {
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '5'), '5');
    } finally {
      db.close();
    }
  });

  test.it('sets and updates preference values', () => {
    const db = freshDb();
    try {
      prefs.setPreference(db.db, 'daily_goal', '5');
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '0'), '5');
      prefs.setPreference(db.db, 'daily_goal', '12');
      assert.equal(prefs.getPreference(db.db, 'daily_goal', '0'), '12');
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test tests/unit/userPreferences.test.js
```

Expected: fails because `services/storage/db/userPreferences.js` does not exist.

- [ ] **Step 3: Add schema to `database/schema.sql`**

Append after `card_reviews`:

```sql
-- ========================================
-- 表 27: user_preferences（单用户偏好）
-- ========================================

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Add runtime table creation**

In `services/storage/databaseService.js`, inside the startup `CREATE TABLE` block after `card_reviews`, add:

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 5: Create preference module**

Create `services/storage/db/userPreferences.js`:

```js
'use strict';

function getPreference(db, key, fallback = null) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return fallback;
  const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(normalizedKey);
  return row ? row.value : fallback;
}

function setPreference(db, key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) throw new Error('preference key is required');
  const normalizedValue = String(value);
  db.prepare(`
    INSERT INTO user_preferences (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run({ key: normalizedKey, value: normalizedValue });
  return normalizedValue;
}

module.exports = {
  getPreference,
  setPreference,
};
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --test tests/unit/userPreferences.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add database/schema.sql services/storage/databaseService.js services/storage/db/userPreferences.js tests/unit/userPreferences.test.js
git commit -m "feat: add user preferences storage"
```

---

### Task 4: Implement Daily Goal Facade And Validation

**Files:**
- Modify: `services/storage/databaseService.js`
- Modify: `routes/srs.js`
- Modify: `public/js/modules/api.js`
- Modify: `tests/unit/databaseService.test.js`
- Create: `tests/integration/srsEngagement.test.js`

- [ ] **Step 1: Add database facade tests**

Append inside `tests/unit/databaseService.test.js`:

```js
test.describe('databaseService — user preferences', () => {
  test.it('defaults daily goal to 5 and persists updates', () => {
    const db = freshDb();
    try {
      assert.equal(db.getDailyGoal(), 5);
      assert.equal(db.setDailyGoal(12), 12);
      assert.equal(db.getDailyGoal(), 12);
    } finally {
      db.close();
    }
  });

  test.it('rejects invalid daily goals', () => {
    const db = freshDb();
    try {
      assert.throws(() => db.setDailyGoal(0), /goal must be an integer between 1 and 200/);
      assert.throws(() => db.setDailyGoal(201), /goal must be an integer between 1 and 200/);
      assert.throws(() => db.setDailyGoal(1.5), /goal must be an integer between 1 and 200/);
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Implement database facade**

At the top of `services/storage/databaseService.js`, require the new module:

```js
const userPreferencesDomain = require('./db/userPreferences');
```

Add methods to the `DatabaseService` class:

```js
getDailyGoal() {
  return Number(userPreferencesDomain.getPreference(this.db, 'daily_goal', '5'));
}

setDailyGoal(goal) {
  const parsed = Number(goal);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error('goal must be an integer between 1 and 200');
  }
  userPreferencesDomain.setPreference(this.db, 'daily_goal', String(parsed));
  return parsed;
}
```

- [ ] **Step 3: Add integration route tests**

Create `tests/integration/srsEngagement.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { api, resetState, closeServer } = require('./_harness');

test.before(() => resetState());
test.after(async () => { await closeServer(); });

test.describe('SRS engagement goal routes', () => {
  test.beforeEach(() => resetState());

  test.it('GET /api/srs/goal returns the default daily goal', async () => {
    const res = await api('GET', '/api/srs/goal');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, goal: 5 });
  });

  test.it('PUT /api/srs/goal persists a valid daily goal', async () => {
    const put = await api('PUT', '/api/srs/goal', { body: { goal: 12 } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { success: true, goal: 12 });

    const get = await api('GET', '/api/srs/goal');
    assert.equal(get.status, 200);
    assert.deepEqual(get.body, { success: true, goal: 12 });
  });

  test.it('PUT /api/srs/goal rejects invalid values', async () => {
    for (const goal of [0, -1, 1.5, 201, 'abc']) {
      const res = await api('PUT', '/api/srs/goal', { body: { goal } });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /goal must be an integer between 1 and 200/);
    }
  });
});
```

- [ ] **Step 4: Implement routes**

Add to `routes/srs.js` before `module.exports`:

```js
router.get('/api/srs/goal', (_req, res) => {
  try {
    res.json({ success: true, goal: dbService.getDailyGoal() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/srs/goal', (req, res) => {
  try {
    const goal = dbService.setDailyGoal(req.body?.goal);
    res.json({ success: true, goal });
  } catch (err) {
    const status = /goal must be an integer/.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});
```

- [ ] **Step 5: Add frontend API helpers**

In `public/js/modules/api.js`, add methods near existing SRS helpers:

```js
async getDailyGoal() {
  return this.fetchJson('/api/srs/goal');
}

async setDailyGoal(goal) {
  return this.fetchJson('/api/srs/goal', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: Number(goal) })
  });
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/unit/databaseService.test.js
node --test tests/integration/srsEngagement.test.js
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add services/storage/databaseService.js routes/srs.js public/js/modules/api.js tests/unit/databaseService.test.js tests/integration/srsEngagement.test.js
git commit -m "feat: add daily goal preference api"
```

---

### Task 5: Implement Timezone-Correct SRS Engagement Aggregation

**Files:**
- Modify: `services/storage/db/cardSrs.js`
- Modify: `services/storage/databaseService.js`
- Modify: `routes/srs.js`
- Modify: `public/js/modules/api.js`
- Modify: `tests/unit/databaseService.test.js`
- Modify: `tests/integration/srsEngagement.test.js`

- [ ] **Step 1: Add unit tests for engagement aggregation**

Append to the `databaseService — card_srs (spaced repetition)` describe block in `tests/unit/databaseService.test.js`:

```js
test.it('getSrsEngagement excludes scenario cards from mastery denominator', () => {
  const db = freshDb();
  try {
    const tri = newGenId(db, { phrase: 'tri', baseFilename: 'tri-eg', requestId: 'rid_eng_tri' });
    const grammar = newGenId(db, { phrase: 'grammar', baseFilename: 'grammar-eg', cardType: 'grammar_ja', requestId: 'rid_eng_grammar' });
    newGenId(db, { phrase: 'scenario', baseFilename: 'scenario-eg', cardType: 'scenario_phrase', requestId: 'rid_eng_scenario' });
    db.reviewCardSrs(tri, 'good');
    db.reviewCardSrs(tri, 'good');
    db.reviewCardSrs(grammar, 'good');

    const engagement = db.getSrsEngagement();
    assert.equal(engagement.mastery.mastered, 1);
    assert.equal(engagement.mastery.tracked, 2);
    assert.equal(engagement.mastery.eligibleTotal, 2);
  } finally {
    db.close();
  }
});

test.it('getSrsEngagement reports active streak and today progress', () => {
  const db = freshDb();
  try {
    const g = newGenId(db, { phrase: 'today', baseFilename: 'today-eg', requestId: 'rid_eng_today' });
    db.reviewCardSrs(g, 'good');

    const engagement = db.getSrsEngagement();
    assert.equal(engagement.streak.days, 1);
    assert.equal(engagement.streak.activeToday, true);
    assert.equal(engagement.today.reviewed, 1);
    assert.equal(engagement.today.newLearned, 1);
    assert.equal(engagement.today.goal, 5);
  } finally {
    db.close();
  }
});

test.it('getSrsStats and engagement count reviewedToday with configured timezone', () => {
  const db = freshDb();
  try {
    const g = newGenId(db, { phrase: 'tz', baseFilename: 'tz-eg', requestId: 'rid_eng_tz' });
    db.reviewCardSrs(g, 'good');
    db.db.prepare(`UPDATE card_reviews SET reviewed_at = '2026-06-18 16:30:00' WHERE generation_id = ?`).run(g);

    const engagement = db.getSrsEngagement({ now: new Date('2026-06-18T17:00:00Z'), timezone: 'Asia/Shanghai' });
    assert.equal(engagement.today.reviewed, 1);
    assert.equal(engagement.streak.lastActiveDay, '2026-06-19');
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run failing unit test**

Run:

```bash
node --test tests/unit/databaseService.test.js
```

Expected: fails because `getSrsEngagement` is not implemented.

- [ ] **Step 3: Implement aggregation in `cardSrs.js`**

Require timezone helpers:

```js
const { RECORDS_TIMEZONE, tzOffsetClause } = require('../../../lib/serverConfig');
```

Add constants:

```js
const DEFAULT_DAILY_GOAL = 5;
```

Add helper:

```js
function supportedCardTypeParams() {
  const params = {};
  const placeholders = SRS_SUPPORTED_CARD_TYPES.map((_, idx) => `@cardType${idx}`);
  SRS_SUPPORTED_CARD_TYPES.forEach((value, idx) => {
    params[`cardType${idx}`] = value;
  });
  return { params, sql: placeholders.join(', ') };
}
```

Replace duplicate placeholder construction in `getStats` with `supportedCardTypeParams()`, add `tzShift`, and change reviewed-today SQL to:

```sql
WHERE date(r.reviewed_at, @tzShift) = date('now', @tzShift)
```

Add `getEngagement`:

```js
function getEngagement(db, { goal = DEFAULT_DAILY_GOAL, timezone = RECORDS_TIMEZONE, now = new Date() } = {}) {
  const { params, sql: supportedCardTypesSql } = supportedCardTypeParams();
  const tzShift = tzOffsetClause(timezone, now);
  const baseParams = { ...params, tzShift };

  const today = db.prepare(`
    SELECT
      COUNT(*) AS reviewed,
      SUM(CASE WHEN r.interval_before = 0 THEN 1 ELSE 0 END) AS new_learned
    FROM card_reviews r
    JOIN generations g ON g.id = r.generation_id
    WHERE date(r.reviewed_at, @tzShift) = date('now', @tzShift)
      AND lower(g.card_type) IN (${supportedCardTypesSql})
  `).get(baseParams) || {};

  const mastery = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM card_srs s JOIN generations g ON g.id = s.generation_id WHERE s.repetitions >= 2 AND lower(g.card_type) IN (${supportedCardTypesSql})) AS mastered,
      (SELECT COUNT(*) FROM card_srs s JOIN generations g ON g.id = s.generation_id WHERE lower(g.card_type) IN (${supportedCardTypesSql})) AS tracked,
      (SELECT COUNT(*) FROM generations g WHERE lower(g.card_type) IN (${supportedCardTypesSql})) AS eligible_total
  `).get(params) || {};

  const dayRows = db.prepare(`
    SELECT date(r.reviewed_at, @tzShift) AS day, COUNT(*) AS count
    FROM card_reviews r
    JOIN generations g ON g.id = r.generation_id
    WHERE date(r.reviewed_at, @tzShift) >= date('now', @tzShift, '-180 days')
      AND lower(g.card_type) IN (${supportedCardTypesSql})
    GROUP BY day
    ORDER BY day DESC
  `).all(baseParams);

  const activeDays = new Set(dayRows.filter((row) => Number(row.count || 0) > 0).map((row) => row.day));
  const todayKey = db.prepare(`SELECT date('now', @tzShift) AS day`).get({ tzShift }).day;
  let cursor = todayKey;
  let activeToday = activeDays.has(todayKey);
  let days = 0;
  if (!activeToday) {
    cursor = db.prepare(`SELECT date('now', @tzShift, '-1 day') AS day`).get({ tzShift }).day;
  }
  while (activeDays.has(cursor)) {
    days += 1;
    cursor = db.prepare(`SELECT date(@day, '-1 day') AS day`).get({ day: cursor }).day;
  }
  const lastActiveDay = dayRows[0]?.day || null;

  return {
    streak: { days, activeToday, lastActiveDay },
    today: {
      goal: Number(goal || DEFAULT_DAILY_GOAL),
      reviewed: Number(today.reviewed || 0),
      newLearned: Number(today.new_learned || 0)
    },
    mastery: {
      mastered: Number(mastery.mastered || 0),
      tracked: Number(mastery.tracked || 0),
      eligibleTotal: Number(mastery.eligible_total || 0)
    }
  };
}
```

Export `getEngagement`.

- [ ] **Step 4: Add database facade**

In `services/storage/databaseService.js`, add:

```js
getSrsEngagement(options = {}) {
  return cardSrsDomain.getEngagement(this.db, {
    ...options,
    goal: this.getDailyGoal()
  });
}
```

- [ ] **Step 5: Add route**

In `routes/srs.js`, add:

```js
router.get('/api/srs/engagement', (_req, res) => {
  try {
    res.json({ success: true, engagement: dbService.getSrsEngagement() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 6: Add frontend API helper**

In `public/js/modules/api.js`, add:

```js
async getSrsEngagement() {
  return this.fetchJson('/api/srs/engagement');
}
```

- [ ] **Step 7: Add integration test for engagement route**

Append to `tests/integration/srsEngagement.test.js`:

```js
test.describe('GET /api/srs/engagement', () => {
  test.beforeEach(() => resetState());

  test.it('returns the engagement envelope for homepage rendering', async () => {
    const res = await api('GET', '/api/srs/engagement');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.engagement.today.goal, 5);
    assert.equal(typeof res.body.engagement.streak.days, 'number');
    assert.equal(typeof res.body.engagement.streak.activeToday, 'boolean');
    assert.ok('eligibleTotal' in res.body.engagement.mastery);
  });
});
```

- [ ] **Step 8: Run tests**

Run:

```bash
node --test tests/unit/serverConfig.test.js tests/unit/databaseService.test.js tests/integration/srsEngagement.test.js
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add services/storage/db/cardSrs.js services/storage/databaseService.js routes/srs.js public/js/modules/api.js tests/unit/databaseService.test.js tests/integration/srsEngagement.test.js
git commit -m "feat: aggregate srs engagement metrics"
```

---

### Task 6: Add Homepage Engagement Bar DOM And Styles

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `tests/e2e/engagement-retention.spec.js`

- [ ] **Step 1: Write E2E test for empty-state render**

Create `tests/e2e/engagement-retention.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

test.describe('Homepage engagement bar', () => {
  test.beforeEach(async ({ request }) => {
    await resetServerState(request);
  });

  test('renders cold-start state and review CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('today-learning-bar')).toBeVisible();
    await expect(page.getByTestId('today-learning-streak')).toContainText('开始你的第一天');
    await expect(page.getByTestId('today-learning-progress')).toContainText('0 / 5');
    await expect(page.getByTestId('today-learning-mastery')).toContainText('0 / 0');
    await expect(page.getByTestId('today-learning-review')).toHaveAttribute('href', /knowledge-hub\.html\?mode=review/);
  });
});
```

- [ ] **Step 2: Run E2E and confirm failure**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js
```

Expected: fails because the bar is not in the DOM.

- [ ] **Step 3: Add DOM in `public/index.html`**

Insert after `.hero-topbar` and before `infraAlertBanner`:

```html
<section id="todayLearningBar" class="today-learning-bar is-loading" data-testid="today-learning-bar" aria-live="polite">
  <div class="today-learning-cell streak">
    <span class="today-learning-icon" aria-hidden="true">🔥</span>
    <div>
      <div id="todayLearningStreak" class="today-learning-value" data-testid="today-learning-streak">加载中…</div>
      <div id="todayLearningStreakHint" class="today-learning-label">今日学习</div>
    </div>
  </div>
  <div class="today-learning-cell progress">
    <div class="today-learning-row">
      <span class="today-learning-label">今日目标</span>
      <button id="todayLearningGoalBtn" class="today-learning-goal" type="button" data-testid="today-learning-goal">目标 5</button>
    </div>
    <div class="today-learning-progress-track" aria-hidden="true">
      <div id="todayLearningProgressFill" class="today-learning-progress-fill"></div>
    </div>
    <div id="todayLearningProgress" class="today-learning-meta" data-testid="today-learning-progress">0 / 5</div>
  </div>
  <div class="today-learning-cell mastery">
    <div>
      <div id="todayLearningMastery" class="today-learning-value" data-testid="today-learning-mastery">0 / 0</div>
      <div class="today-learning-label">已掌握</div>
    </div>
    <a id="todayLearningReview" class="today-learning-review" href="knowledge-hub.html?mode=review" data-testid="today-learning-review">开始复习</a>
  </div>
</section>
```

- [ ] **Step 4: Add CSS**

Add to `public/styles.css` after `.hero-queue-status` styles:

```css
.today-learning-bar {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.4fr) minmax(220px, 1fr);
  gap: 12px;
  align-items: stretch;
  margin-top: 14px;
}

.today-learning-cell {
  min-width: 0;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.today-learning-cell.streak,
.today-learning-cell.mastery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.today-learning-icon {
  font-size: 1.35rem;
}

.today-learning-value {
  font-size: 1rem;
  font-weight: 800;
  color: var(--text-primary, #1f2937);
}

.today-learning-label,
.today-learning-meta {
  font-size: 0.78rem;
  color: var(--text-secondary, #6b7280);
}

.today-learning-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
}

.today-learning-goal,
.today-learning-review {
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 10px;
  text-decoration: none;
  cursor: pointer;
}

.today-learning-progress-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  overflow: hidden;
}

.today-learning-progress-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3b82f6, #10b981);
  transition: width 0.2s ease;
}

@media (max-width: 900px) {
  .today-learning-bar {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run E2E and confirm it now reaches JS-dependent assertions**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js
```

Expected: it may still fail on text values until Task 7 renders live API data; DOM visibility should pass.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css tests/e2e/engagement-retention.spec.js
git commit -m "feat: add homepage learning bar shell"
```

---

### Task 7: Render Engagement Data On Homepage And Refresh On Return

**Files:**
- Modify: `public/js/modules/app.js`
- Modify: `tests/e2e/engagement-retention.spec.js`

- [ ] **Step 1: Add DOM references**

In `public/js/modules/app.js`, add to `els`:

```js
todayLearningBar: document.getElementById('todayLearningBar'),
todayLearningStreak: document.getElementById('todayLearningStreak'),
todayLearningStreakHint: document.getElementById('todayLearningStreakHint'),
todayLearningGoalBtn: document.getElementById('todayLearningGoalBtn'),
todayLearningProgressFill: document.getElementById('todayLearningProgressFill'),
todayLearningProgress: document.getElementById('todayLearningProgress'),
todayLearningMastery: document.getElementById('todayLearningMastery'),
todayLearningReview: document.getElementById('todayLearningReview'),
```

- [ ] **Step 2: Implement renderer**

Add near other UI render helpers:

```js
function renderTodayLearningBar(engagement) {
  if (!els.todayLearningBar) return;
  const data = engagement || {};
  const streak = data.streak || {};
  const today = data.today || {};
  const mastery = data.mastery || {};
  const goal = Math.max(1, Number(today.goal || 5));
  const reviewed = Math.max(0, Number(today.reviewed || 0));
  const progress = Math.max(0, Math.min(100, Math.round((reviewed / goal) * 100)));
  const days = Number(streak.days || 0);
  const mastered = Number(mastery.mastered || 0);
  const eligibleTotal = Number(mastery.eligibleTotal || 0);

  els.todayLearningBar.classList.remove('is-loading');
  els.todayLearningStreak.textContent = days > 0 ? `连续 ${days} 天` : '开始你的第一天';
  els.todayLearningStreakHint.textContent = streak.activeToday ? '今日已保持' : (days > 0 ? '今日待保持' : '今日学习');
  els.todayLearningGoalBtn.textContent = `目标 ${goal}`;
  els.todayLearningProgress.textContent = `${reviewed} / ${goal}${Number(today.newLearned || 0) ? ` · 今日新句式 ${Number(today.newLearned)}` : ''}`;
  els.todayLearningProgressFill.style.width = `${progress}%`;
  els.todayLearningMastery.textContent = `${mastered} / ${eligibleTotal}`;
}
```

- [ ] **Step 3: Implement loading and refresh lifecycle**

Add:

```js
let todayLearningRefreshPromise = null;

async function refreshTodayLearningBar() {
  if (!els.todayLearningBar) return;
  if (todayLearningRefreshPromise) return todayLearningRefreshPromise;
  todayLearningRefreshPromise = api.getSrsEngagement()
    .then((res) => renderTodayLearningBar(res.engagement))
    .catch((err) => {
      console.warn('[Engagement] load failed:', err.message);
      els.todayLearningBar.classList.add('is-error');
      if (els.todayLearningStreak) els.todayLearningStreak.textContent = '今日学习';
      if (els.todayLearningStreakHint) els.todayLearningStreakHint.textContent = '稍后重试';
    })
    .finally(() => { todayLearningRefreshPromise = null; });
  return todayLearningRefreshPromise;
}
```

Call inside `init()`:

```js
refreshTodayLearningBar();
```

Add lifecycle listeners:

```js
window.addEventListener('pageshow', () => {
  refreshTodayLearningBar();
});

window.addEventListener('focus', () => {
  refreshTodayLearningBar();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshTodayLearningBar();
});
```

- [ ] **Step 4: Add goal edit behavior**

Add during initialization:

```js
if (els.todayLearningGoalBtn) {
  els.todayLearningGoalBtn.addEventListener('click', async () => {
    const current = Number((els.todayLearningGoalBtn.textContent || '').replace(/\D+/g, '')) || 5;
    const raw = window.prompt('设置每日复习目标（1-200）', String(current));
    if (raw === null) return;
    const goal = Number(raw);
    try {
      await api.setDailyGoal(goal);
      await refreshTodayLearningBar();
    } catch (err) {
      window.alert(err.message || '目标设置失败');
    }
  });
}
```

- [ ] **Step 5: Run homepage E2E**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js
```

Expected: cold-start render test passes.

- [ ] **Step 6: Commit**

```bash
git add public/js/modules/app.js tests/e2e/engagement-retention.spec.js
git commit -m "feat: render homepage engagement metrics"
```

---

### Task 8: Add Knowledge Hub Review Deep Link

**Files:**
- Modify: `public/js/modules/dashboard.js`
- Modify: `tests/e2e/knowledge-hub.spec.js`
- Modify: `tests/e2e/engagement-retention.spec.js`

- [ ] **Step 1: Add failing Knowledge Hub deep-link test**

Append to `tests/e2e/knowledge-hub.spec.js`:

```js
test('09 URL mode=review 直接进入复习模式', async ({ page }) => {
  await page.goto('/knowledge-hub.html?mode=review');
  await expect(page.getByTestId('kh-review-pane')).toBeVisible();
  await expect(page.getByTestId('kh-review-card').or(page.getByTestId('kh-review-done'))).toBeVisible();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx playwright test tests/e2e/knowledge-hub.spec.js -g "mode=review"
```

Expected: fails because Knowledge Hub starts in browse mode.

- [ ] **Step 3: Implement URL mode handling**

In `initKnowledgeBaseBrowse()` after initial refresh calls:

```js
const params = new URLSearchParams(window.location.search);
if (params.get('mode') === 'review') {
    enterKhReview();
}
```

If this runs before terms finish loading, it is still valid because review mode uses `/api/srs/queue`.

- [ ] **Step 4: Add homepage CTA flow assertion**

Append to `tests/e2e/engagement-retention.spec.js`:

```js
test('review CTA opens Knowledge Hub review mode', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('today-learning-review').click();
  await expect(page).toHaveURL(/knowledge-hub\.html\?mode=review/);
  await expect(page.getByTestId('kh-review-pane')).toBeVisible();
});
```

- [ ] **Step 5: Run E2E**

Run:

```bash
npx playwright test tests/e2e/knowledge-hub.spec.js tests/e2e/engagement-retention.spec.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/js/modules/dashboard.js tests/e2e/knowledge-hub.spec.js tests/e2e/engagement-retention.spec.js
git commit -m "feat: deep link to knowledge hub review"
```

---

### Task 9: Add End-To-End Progress Refresh Coverage

**Files:**
- Modify: `tests/e2e/engagement-retention.spec.js`
- Modify: `services/fixtures/e2eFixtureService.js` only if the current test fixture lacks SRS-ready cards.

- [ ] **Step 1: Add E2E test for returning-home refresh**

Append to `tests/e2e/engagement-retention.spec.js`:

```js
test('homepage engagement refreshes after completing one review and going back', async ({ page, request }) => {
  await request.post('/api/_test/seed-knowledge');
  await page.goto('/');
  await expect(page.getByTestId('today-learning-progress')).toContainText('0 / 5');

  await page.getByTestId('today-learning-review').click();
  await expect(page.getByTestId('kh-review-pane')).toBeVisible();
  await page.getByTestId('kh-grade-good').click();
  await page.goBack();

  await expect(page.getByTestId('today-learning-progress')).toContainText('1 / 5', { timeout: 10_000 });
});
```

- [ ] **Step 2: Run the E2E**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js
```

Expected: passes after Task 7 `pageshow` refresh is working.

- [ ] **Step 3: If fixture seeding returns no reviewable cards, extend existing seed only**

If the test fails because no review card is visible, update `services/fixtures/e2eFixtureService.js` so `/api/_test/seed-knowledge` creates at least one `trilingual` or `grammar_ja` generation eligible for SRS review. Do not add a new test-only endpoint.

Use this shape when inserting a generation fixture:

```js
{
  phrase: 'engagement review',
  cardType: 'trilingual',
  baseFilename: 'engagement_review',
  markdownContent: '# engagement review\n\n## 1. 英文\nReview me.',
  requestId: 'rid_engagement_review'
}
```

- [ ] **Step 4: Run E2E again**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/engagement-retention.spec.js services/fixtures/e2eFixtureService.js
git commit -m "test: cover engagement refresh after review"
```

---

### Task 10: Final Verification And Delivery

**Files:**
- All changed files from previous tasks.

- [ ] **Step 1: Run focused unit and integration tests**

Run:

```bash
node --test tests/unit/serverConfig.test.js tests/unit/userPreferences.test.js tests/unit/databaseService.test.js tests/integration/srsEngagement.test.js
```

Expected: all pass.

- [ ] **Step 2: Run focused E2E tests**

Run:

```bash
npx playwright test tests/e2e/engagement-retention.spec.js tests/e2e/knowledge-hub.spec.js
```

Expected: all pass.

- [ ] **Step 3: Run lint and diff check**

Run:

```bash
npm run lint
git diff --check
```

Expected: lint exits 0 and diff check prints nothing.

- [ ] **Step 4: Optional local container restart**

Only if static assets do not update in the running app, restart viewer:

```bash
docker compose -p npm-audit-deps up -d --no-deps --force-recreate viewer
```

Expected: `trilingual-viewer` restarts and `http://127.0.0.1:3010/` serves the new bar.

- [ ] **Step 5: Final commit if there are uncommitted changes**

Run:

```bash
git status --short
```

If changes remain:

```bash
git add -A
git commit -m "feat: add homepage engagement retention system"
```

- [ ] **Step 6: Push if requested**

Run:

```bash
git push origin main
```

Expected: `main -> main`.

---

## Self-Review

- Spec coverage: This plan covers timezone aggregation, `reviewedToday` bug fix, `user_preferences`, daily goal validation, homepage bar, cold-start state, Knowledge Hub review deep link, refresh-on-return, docs registration, tests, and final verification.
- Placeholder scan: No unresolved placeholder markers remain. P2 heatmap is explicitly excluded from P1 implementation.
- Type consistency: The API uses `{ success: true, engagement }`, `engagement.streak.{days, activeToday, lastActiveDay}`, `engagement.today.{goal, reviewed, newLearned}`, and `engagement.mastery.{mastered, tracked, eligibleTotal}` consistently across backend, frontend, and tests.

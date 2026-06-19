# 激励与留存系统（首页「今日学习」条 · SRS 数据驱动）

> 状态：**设计方案（待实施）** · 2026-06
> 决策：展示位置 = **首页顶部「今日学习」条**；第一阶段 = **streak + 每日目标 + 掌握度 + 复习入口**（完整热力图排 P2）
> 关联：[Knowledge Hub 与语义分类](Knowledge_Hub_and_Semantic_Classification.md)（SRS / 难度 / 学习计划）
> 影响文件：`database/schema.sql` · `services/storage/db/cardSrs.js` · 新 `db/userPreferences.js` · `lib/serverConfig.js` · `routes/srs.js` · `public/index.html` · `public/styles.css` · `public/js/modules/{app,api}.js`

本文是「激励与留存」特性的真源说明。系统的学习闭环骨架（生成 → 索引 → 语义分类 → SRS 复习 → 难度 → 学习计划）已成形，但缺少**让用户回来的理由**。本特性用**现成的 SRS 数据**建立动机飞轮：学 → 即时正反馈 + 连续性 → 想再学。

---

## 1. 目标与原则

**目标**：把躺在 `card_reviews` 里的复习记录，变成首页第一眼就能看到的「今日学习」激励条。

**位置决策**：首页 `index.html` 顶部。激励要「被看到」才有效——首页是最高频入口，用户每次进来第一眼即见 streak 与今日进度。

**原则**：
1. **数据复用优先** —— 绝大部分建立在 `card_srs` / `card_reviews` 现成数据上，避免新埋点。
2. **时区正确** —— 按「自然日」聚合必须时区感知（见 §3，这是最容易出 bug 的点）。
3. **冷启动友好** —— 当前复习数据极少（due 2），空状态要引导而非打击（见 §7）。
4. **即时正反馈** —— 复习后立刻刷新今日条，把「今天又学了」的成就感给出去。

---

## 2. 数据可行性核对

| 能力 | 数据来源 | 状态 |
|------|---------|------|
| streak 连续打卡 | `card_reviews.reviewed_at` 按时区日聚合 → 从今天倒推连续天数 | ✅ 现成 |
| 学习热力图（P2） | `card_reviews.reviewed_at` 按时区日分组计数 | ✅ 现成 |
| 今日已复习 / 新学 | `card_reviews`（今日）·`card_srs.repetitions`（首次=新学） | ✅ 现成（需时区化，见 §3） |
| 掌握度 | `card_srs.repetitions >= 2`（沿用 `learningPlan` 的 learned 口径） | ✅ 现成 |
| 每日目标值 | — | ⚠️ 需持久化，新增 `user_preferences` 表（§4） |

现有字段（来自 `db/cardSrs.js`）：

- `card_srs`：`generation_id` `ease_factor` `interval_days` `repetitions` `lapses` `due_date` `last_grade` `last_reviewed_at` `updated_at`
- `card_reviews`：`generation_id` `grade` `interval_before` `interval_after` `ease_after` `reviewed_at`

`getStats()` 已返回 `dueCount / newCount / reviewedToday / trackedTotal`，可复用——但 `reviewedToday` 当前有时区 bug，见下。

---

## 3. 核心技术决策：时区感知聚合 ⚠️

**这是本特性最容易错、且现有代码已经踩了的点。**

`card_reviews.reviewed_at` 写入用 `CURRENT_TIMESTAMP`（SQLite **UTC**）。现有 `getStats()` 算今日复习用：

```sql
WHERE date(r.reviewed_at) = date('now')   -- 两边都是 UTC
```

对 SRS 的 `due_date` 比较，UTC 一致性没问题（间隔是天数级）。但**按「自然日」聚合 streak / 今日目标 / 热力图时，UTC 会算错日**：`RECORDS_TIMEZONE` 默认 `Asia/Shanghai`（UTC+8），用户在**晚上 8 点后**（≥ UTC 次日 0 点）复习，会被 `date('now')` 算到「明天」——于是 streak 断掉、今日目标不计、热力图点错格。

**方案**：聚合统一加**时区偏移**。新增 helper（`lib/serverConfig.js`）：

```js
function tzOffsetClause(tz = RECORDS_TIMEZONE) {
  // 当前时区相对 UTC 的偏移分钟 → SQLite modifier 字符串，如 '+480 minutes'
  const now = new Date();
  const mins = Math.round(
    (new Date(now.toLocaleString('en-US', { timeZone: tz })) -
     new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000
  );
  return `${mins >= 0 ? '+' : '-'}${Math.abs(mins)} minutes`;
}
```

聚合 SQL 改为时区感知：

```sql
-- 例：今日复习数（tzShift = '+480 minutes'）
WHERE date(r.reviewed_at, @tzShift) = date('now', @tzShift)

-- 例：近 90 天热力图
SELECT date(r.reviewed_at, @tzShift) AS day, COUNT(*) AS n
FROM card_reviews r JOIN generations g ON g.id = r.generation_id
WHERE lower(g.card_type) IN (...)
  AND date(r.reviewed_at, @tzShift) >= date('now', @tzShift, '-90 days')
GROUP BY day ORDER BY day;
```

**顺手修**：把现有 `getStats().reviewedToday` 一并时区化（同一处 bug，统一口径），其单测断言相应更新。

**局限注记**：偏移按「当前时刻」算，跨夏令时（DST）切换日会有 ±1 天误差。中国无 DST，本场景无影响；通用部署若涉及 DST，P2 可改为 JS 层用 `Intl` 逐条转日聚合（数据量小，可行）。

**单一时区来源**：`RECORDS_TIMEZONE` 常量当前孤悬在 `fileManager.js`（:14），`serverConfig.js` 无 timezone export。落地时把该常量**上移到 `lib/serverConfig.js`** 作为单一来源，`fileManager` 改从 serverConfig 引用——否则文件归档日期与 SRS 自然日各算各的、日后再次漂移（评审 P2）。

---

## 4. 数据模型

复用 `card_srs` / `card_reviews`。新增一张轻量 key-value 偏好表（单用户系统足够），承载每日目标等配置：

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

- `database/schema.sql` 加表（fresh install）；`databaseService.ensureTableColumns` 走 `CREATE TABLE IF NOT EXISTS`（现有 install 自动补）。
- 初值：`daily_goal = 5`（**单一默认值**；20 仅为成熟期建议展示值，由前端达成后引导上调，不作初始存储——见 §7，评审 P1）。
- 新建 `services/storage/db/userPreferences.js`：`getPreference(db, key, fallback)` / `setPreference(db, key, value)`，`db` 优先参数，配单测——与现有 db/ 模块同构。

**口径定义**（写死一处，前后端一致；掌握率分母只算 SRS 支持卡型）：

> ⚠️ SRS 仅调度 `trilingual` + `grammar_ja`（`db/cardSrs.js` 的 `SRS_SUPPORTED_CARD_TYPES`）。而 `serverConfig.js` 的 `SUPPORTED_CARD_TYPES` 还含 **`scenario_phrase`**——这类卡**有卡但永不进 SRS**，掌握率分母**必须排除它**，否则掌握率被永久拉低（评审 P1，已核实该卡型存在）。

- **掌握（mastered）**：`card_srs.repetitions >= 2`（沿用 `learningPlan` 口径）
- **eligibleTotal（掌握率分母）**：`generations` 中 `lower(card_type) IN ('trilingual','grammar_ja')` 的总数——**不是**全库词条数（579 含 `scenario_phrase` 等不可复习卡）
- **streak**：从「今天」（时区日）倒推、连续每天 `card_reviews` ≥ 1 的天数。**返回结构化对象**（见 §5）`{ days, activeToday, lastActiveDay }`：今天 0、昨天有 → `days` 仍为昨天的连续值、`activeToday=false`，前端据此显示「今日待保持」
- **今日新学（newLearned）**：今日 `card_reviews` 中**此前无 `card_srs` 记录**的卡 = 今日首次纳入 SRS 调度的卡（**不是**今日生成的新卡，文案见 §6）

---

## 5. 后端 API

聚合集中到 `db/cardSrs.js`，对外一个合并端点（减少首页请求数）。**返回 envelope 对齐现有 `/api/srs/stats` 的 `{ success: true, ... }`**（见 `routes/srs.js:28`，评审 P1）：

```
GET /api/srs/engagement
→ {
    success: true,
    engagement: {
      streak:  { days: 7, activeToday: true, lastActiveDay: "2026-06-01" },
      today:   { goal: 5, reviewed: 12, newLearned: 3 },
      mastery: { mastered: 142, tracked: 187, eligibleTotal: 421 },
      heatmap: [ { day: "2026-05-30", count: 5 }, ... ]   // 近 13 周（P2 前端才渲染，P1 可先不返回）
    }
  }
GET /api/srs/goal            → { success: true, goal: 5 }
PUT /api/srs/goal  { goal }  → { success: true, goal: 25 }
```

- `mastery`：`tracked` = 已进 SRS 的 eligible 卡数；`eligibleTotal` = 所有 eligible 卡（含未追踪 new）；掌握率 = `mastered / eligibleTotal`（§4 口径，分母排除 `scenario_phrase`）。
- `db/cardSrs.js` 新增：`getEngagement(db, { tzShift })`（streak + today + mastery，P2 加 heatmap）。复用 §3 的 `@tzShift`。
- `databaseService.js`：`getEngagement()` / `getDailyGoal()` / `setDailyGoal()` 薄委托。
- `routes/srs.js`：三个路由，envelope 对齐现有（`{ success: true, engagement }` / `{ success: true, goal }`）。
- `goal` 走 `user_preferences`（§4）。

---

## 6. 前端：首页「今日学习」条

**位置**：`index.html` 的 `<header class="hero">` 内、`hero-topbar` 之后（infra-alert 之上或之下），紧贴页面顶部。首页样式表是 `styles.css`（**注意不是** `dashboard.css`）。

**结构**（参考已确认的 mockup 形态）：

- 左：streak（`ti-flame` + `days`）；`activeToday=false` 时显示副标「今日待保持」而非冷冰冰的天数
- 中：今日目标进度条（`reviewed / goal`，可点击改目标 → `PUT /api/srs/goal`）
- 右：已掌握（`mastered / eligibleTotal`）+「开始复习」按钮

**「开始复习」跳转**：跳 `/knowledge-hub.html?mode=review`。Knowledge Hub **当前不读 URL 进 review**（`dashboard.js` 的 `setKhMode` 仅按钮触发，已核实），需新增：启动时解析 `?mode=review` → 调 `setKhMode('review')`。落地清单（§8）已含此项（评审 Open Q）。

**文案去歧义**（评审 Open Q）：「今日新学」指今日首次复习的句式（§4 口径），为避免被理解成"生成了新卡"，首页文案用「今日新掌握 N 句」或「今日新句式 N」，不用裸"新学"。

**加载/刷新时机**（`public/js/modules/app.js`）：

- 首页 `init()` 拉 `GET /api/srs/engagement` 渲染。
- 复习后（如果就地复习）或返回首页时刷新——把「今天又学了一张」即时反映到进度条。
- `api.js` 加 `getEngagement()` / `getDailyGoal()` / `setDailyGoal(goal)`。

---

## 7. 冷启动设计 ⚠️

当前复习数据极少（`due 2`、`card_reviews` 近乎空）。若直接展示「streak 0 / 今日 0 / 热力图全灰」会**打击而非激励**。策略：

- **空状态文案**：streak 0 时显示「开始你的第一天 →」而非「0 天」。
- **每日目标单一默认 = 5**：存储初值即 `daily_goal = 5`（**非 20**），达成后前端引导上调；20 仅作成熟期建议展示值——确保 §4 / §7 不出现两个默认值（评审 P1）。
- **即时正反馈优先**：哪怕只复习 1 张，立刻显示「今天 +1」「连续 1 天」。
- **热力图延后**：P1 不在首页放空热力图；积累 2–3 周数据后（P2）再上，且在 Hub/弹层而非首页黄金位。
- **引导入口**：今日条始终有「开始复习」CTA，把新用户直接推进复习流。

---

## 8. 落地范围（文件清单）

| 文件 | 改动 |
|------|------|
| `database/schema.sql` | 新增 `user_preferences` 表 |
| `services/storage/db/userPreferences.js` | **新建** get/set + 单测 |
| `services/storage/db/cardSrs.js` | 新增 `getEngagement`；`reviewedToday` 时区化 |
| `services/storage/databaseService.js` | `ensureTableColumns` 建表；`getEngagement/getDailyGoal/setDailyGoal` 委托 |
| `lib/serverConfig.js` | **上移 `RECORDS_TIMEZONE` 常量**（单一来源）+ 新增 `tzOffsetClause()` 时区 helper |
| `services/storage/fileManager.js` | 改从 `serverConfig` 引用 `RECORDS_TIMEZONE`（去重，评审 P2） |
| `routes/srs.js` | `GET /api/srs/engagement`、`GET/PUT /api/srs/goal` |
| `public/index.html` | hero 内「今日学习」条 DOM |
| `public/styles.css` | 今日条样式（含空状态） |
| `public/js/modules/app.js` · `api.js` | 加载/刷新逻辑 + 接口封装 |
| `public/js/modules/dashboard.js` | 启动解析 `?mode=review` → 进复习模式（首页 CTA 落点，评审 Open Q） |
| `Docs/README.md` | 登记本文 + 补登 `Knowledge_Hub_UI_Redesign.md`（两份方案当前均未登记，评审 P2） |

后端聚合、前端展示闭环，不动生成/知识分析子系统。

---

## 9. 分阶段实施

| 阶段 | 范围 | 备注 |
|------|------|------|
| **P1** | 今日学习条（streak + 今日目标 + 掌握度 + 复习入口）+ 时区聚合 + `user_preferences` + 冷启动空状态 | 本次 |
| **P2** | 完整学习热力图（近 13 周，Hub 或弹层）+ 里程碑/徽章 | 数据积累后 |
| **P3** | 到期复习提醒（PWA 通知 / 邮件）——与「移动 PWA」方向合流 | 需通知基建 |

---

## 10. 测试影响

- **单元**（`tests/unit/`）：
  - `userPreferences` get/set/默认值。
  - `getEngagement` streak 连续/断裂、掌握度口径、今日计数。
  - **时区聚合**：`t.mock.timers` 固定一个跨午夜的 epoch（如 UTC 16:00 = 北京次日 0:00），断言「今日」按 `Asia/Shanghai` 而非 UTC 归日——这是本特性的回归核心。
  - 现有 `getStats().reviewedToday` 时区化后，相关断言更新。
- **集成**（`tests/integration/`）：`/api/srs/engagement`、`/api/srs/goal`（GET/PUT 往返）。
- **E2E**（`tests/e2e/`）：首页今日条渲染 + 空状态文案；复习后进度刷新。

---

## 11. 验收清单

- [ ] 首页顶部「今日学习」条：streak / 今日目标进度 / 已掌握 / 开始复习
- [ ] 北京时间晚 8 点后复习，仍计入「今天」（时区聚合正确）
- [ ] 现有 `getStats().reviewedToday` 同步时区化，口径一致
- [ ] 每日目标可改并持久化（`user_preferences`）
- [ ] 冷启动：0 数据时显示引导文案而非空白打击；首周低目标
- [ ] 复习后今日条即时刷新
- [ ] 新增单测含跨午夜时区回归；lint 0 警告；现有套件全绿

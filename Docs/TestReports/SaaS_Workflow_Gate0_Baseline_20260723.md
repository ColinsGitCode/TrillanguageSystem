# SaaS Workflow Gate 0 桌面基线

> 日期：2026-07-23
> 分支：`SaaS_Modify`
> 状态：Gate 0 基线已冻结

## 1. 验证范围

- 桌面视口：1280x720、1440x900；
- 页面：Product Shell、教材课程空态、draft、verified、published；
- 行为：Git 外 Manifest dry-run/import、整轨确认、发布、TTS、标红、派生卡、官方整轨与单句 TTS 互斥；
- Shell：导航折叠、主题、健康状态单一 query owner、键盘焦点；
- 明确不含移动端设计与验收。

## 2. 当前代码规模

| 文件 | 基线行数 |
|---|---:|
| `app/components/ProductShell.tsx` | 162 |
| `app/features/textbooks/TextbookCoursesPage.tsx` | 620 |
| `app/styles/textbooks.css` | 749 |

## 3. 当前行为

- 教材截图结构化由 Codex `import-textbook-track` Skill 在应用外完成；
- 页面接收 Git 外 Manifest 身份与 hash，导入后展示已预填的 EN/JA/ZH/ruby/confidence；
- Track 只有 revision 级 verify，尚无逐表达持久化确认；
- publish 与 Track TTS 是直接 mutation，尚无可恢复 operation 资源；
- 已发布内容支持官方整轨、单句 TTS、标红与派生卡。

## 4. 基线执行证据

```text
npx playwright test tests/e2e/textbooks.spec.js tests/e2e/app-shell.spec.js
9 passed
```

## 5. 已知缺口

以下是设计目标，不得误报为当前能力：

1. `pending / needs_attention / confirmed` 逐表达确认投影；
2. copy-on-write PATCH 与 revision conflict 恢复；
3. 发布/TTS/sync 的可恢复 operation、局部失败重试和完成摘要；
4. Track、Stage、Task、operation 的 URL 恢复。

## 6. Gate 0 判定

- 当前行为已可重复；
- Skill 外部解析边界有单元测试守卫；
- 生产 schema/API 尚未因 POC 改动；
- 后续视觉差异必须逐项批准，不批量接受未知变化。

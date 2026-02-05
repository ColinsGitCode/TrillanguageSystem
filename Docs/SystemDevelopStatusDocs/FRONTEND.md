# 📱 前端架构文档

**项目**: Trilingual Records
**版本**: 2.3
**更新日期**: 2026-02-05

---

## 📂 文件结构

```
public/
├── index.html                    # 主应用页面
├── dashboard.html                # Mission Control 仪表盘（统计大盘）
├── styles.css                    # 主样式
├── modern-card.css               # 学习卡片弹窗与指标样式
├── observability.css             # 历史样式文件（保留未启用）
├── css/
│   └── dashboard.css             # 仪表盘样式
└── js/
    ├── dashboard.js              # 旧版脚本（保留但未使用）
    └── modules/
        ├── app.js                # 主应用入口
        ├── dashboard.js          # Mission Control 逻辑
        ├── api.js                # API 封装
        ├── info-modal.js         # 指标说明弹窗模块 (NEW)
        ├── store.js              # 状态管理
        ├── utils.js              # 工具函数
        ├── audio-player.js       # 音频播放器
        └── virtual-list.js       # 虚拟列表（当前未启用）
```

---

## 🧭 主界面布局（index.html）

```
┌─────────────────────────────────────────────────┐
│ Header: TRILINGUAL RECORDS + Mission Control   │
├────────────────┬────────────────────────────────┤
│  生成面板       │  Phrase List（多列卡片）       │
│  - 文本输入     │                                │
│  - 图片识别     │                                │
│  - 进度条       │                                │
├────────────────┴────────────────────────────────┤
│  资源区 Tabs：文件夹 / 历史记录                 │
└─────────────────────────────────────────────────┘
```

### 关键组件

- **生成面板**：文本输入 + OCR + 9 阶段进度
- **资源区 Tabs**：
  - 文件夹：按日期分组
  - 历史记录：搜索/过滤/分页
- **Phrase List**：多列网格卡片视图
- **弹窗交互**：
  - **Tab1：卡片内容**
  - **Tab2：MISSION 指标** (HUD 仪表盘风格)
  - **指标详情**：卡片弹窗中使用 `?` 按钮查看指标说明
  - **记录删除**：左上角红色 `🗑️` 按钮，支持物理文件与数据库同步删除
- **初始化设置**：当 `GEMINI_MODE=cli` 时出现登录引导覆盖层；host-proxy 模式不显示

---

## 🎯 Mission Control（dashboard.html）

**定位**：整体统计大盘（非单卡调试）

**模块**：
- Overview / Cost Summary
- Quality / Token / Latency 趋势
- Provider 分布 (D3.js 饼图)
- Infrastructure (服务健康检查)

---

## 🎨 视觉风格

- 主页面：浅色、清爽、卡片式布局
- Mission Control：暗色玻璃质感，数据仪表盘风格

---

**维护者**: Three LANS Team
**最后更新**: 2026-02-05

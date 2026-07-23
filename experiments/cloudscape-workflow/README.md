# Cloudscape Workflow POC

隔离评估 Cloudscape `3.0.1333`。不访问 Three LANS API/SQLite，不修改根依赖，不加载 `@cloudscape-design/global-styles`。

```bash
npm install
npm run build
```

对照场景包含 Cloudscape AppLayout/SideNavigation/Flashbar/Steps/Wizard 与 Three LANS 自研工作流骨架。最终采用结论记录在 `Docs/TestReports/Cloudscape_Workflow_POC_Assessment_20260723.md`。

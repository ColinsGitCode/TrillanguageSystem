# Card Reader v3 结构化渲染架构草案

> 状态：CR-P1 shadow implemented · 当前生产显示仍为 v2
> 日期：2026-08-04
> 范围：桌面端学习卡片正文；不改变 Cards Factory、学习调度、数据库或 Markdown 文件所有权

## 1. 决策摘要

保留 React、React Router、Vite、TypeScript、TanStack Query、Radix 和现有设计 token。学习卡片不更换应用框架，而是把正文内核从：

```text
Markdown -> marked HTML string -> DOMPurify -> innerHTML
         -> annotation DOM rewrite -> pronunciation DOM rewrite
```

迁移为：

```text
Markdown -> Unified/Remark AST -> CardDocument -> React components
         -> annotation decorations -> pronunciation nodes -> selection actions
```

Markdown 继续是磁盘与数据库中的内容来源。`CardDocument` 只是可重建的前端投影，不写 SQLite，不成为第二内容真源。

## 2. 为什么不更换整个前端框架

当前应用已经使用 React 19、React Router 8、Vite 7、TypeScript、TanStack Query/Virtual 与 Radix。主要复杂度集中在 `CardModal.tsx`、HTML 字符串和命令式 DOM 增强，而不是路由或页面框架。

引入 MUI、Ant Design、Tailwind 或完整 Cloudscape 只会改变组件外观，无法解决以下问题：

- 注音、注解和选区同时改写同一 DOM；
- `dangerouslySetInnerHTML` 让 React 无法拥有正文节点；
- annotation selector、pronunciation offset 与浏览器 Range 需要反复映射；
- 卡型结构只能从最终 HTML 猜测，难以形成可测试的语言区块与句子组件。

## 3. CardDocument 合同

POC 使用可序列化、无 HTML 字符串的结构：

```ts
type CardDocument = {
  version: 'card-document-v1';
  title: string;
  sections: CardSection[];
  diagnostics: CardDiagnostic[];
};

type CardSection = {
  id: string;
  language: 'en' | 'ja' | 'zh' | 'unknown';
  title: CardInline[];
  blocks: CardBlock[];
};
```

正文只允许受控节点：heading、paragraph、list、quote、aside、text、strong、emphasis、code、link、audio 与 `pronunciation`。`aside(role=loanword)` 可显示但不进入 `card-visible-text-v1` selector 投影。未知或危险 HTML 不进入 React DOM；可读文字可以降级保留，script/style/iframe 等内容必须丢弃并留下诊断。

## 4. 现有领域能力如何接入

### 4.1 Annotation

继续使用 `card-visible-text-v1` 与 W3C quote/position selector。第一阶段只把 selector 投影成 React decoration，不改变 `card_annotations`、ID、版本和软删除语义。

### 4.2 Pronunciation

正式来源仍是 pronunciation document/tokens。历史 Markdown 中的 Ruby 只允许在 POC 中转为 `source=legacy-ruby` 的只读 pronunciation 节点；不得因此批准历史迁移、接受 Kuromoji 提案或关闭 legacy reader。

### 4.3 Selection

选区继续限制在一个标题、段落或列表项内。CardDocument 的 block/node id 将提供稳定语义边界；浏览器 Range 只负责用户临时交互，不再承担内容结构识别。

### 4.4 Audio

Markdown 中的 `<audio src>` 转为受控 `audio` 节点，由现有独占播放 owner 与 Selection TTS 负责播放。不得恢复任意 HTML audio 注入，也不得绕过媒体路径校验。

### 4.5 Local glossary、KG 与派生卡

它们只消费明确的选区内容与语言上下文。CardDocument 不自动查询、不自动写本地词库、不自动写 KG，也不改变学习调度。

## 5. 为什么 POC 选 Unified/Remark

当前需求是只读 Markdown 学习文档，而不是在线编辑器。Unified/Remark 能先把 Markdown 转为类型化语法树，再由项目定义 CardDocument 和 React 组件。它比直接接入 Tiptap/ProseMirror 更轻，也保留未来增加 lint、结构校验和卡型转换插件的空间。

Tiptap/ProseMirror 只在未来出现“直接编辑卡片正文、事务、撤销、协同编辑”需求时重新评估。当前把编辑器状态机放进只读卡片会增加 bundle、SSR 和选区所有权复杂度。

## 6. POC 边界

隔离 POC 位于 `experiments/card-reader-v3-poc/`：

- 使用合成但与三语卡真实结构一致的 Markdown；
- 根 `package.json` 和生产 bundle 不新增依赖；
- 不增加生产路由、不读取真实 SQLite、不写 RECORDS_PATH；
- 不更改 CardModal、annotation、pronunciation 或 TTS API；
- 只验证桌面端，不新增移动端工作。

## 7. POC 验收门禁

- [x] Markdown 能稳定解析为三个语言 section；
- [x] renderer 不使用 `dangerouslySetInnerHTML`；
- [x] legacy Ruby 只显示基文，读音通过 Tooltip/Popover 出现；
- [x] audio 变为受控 React button；
- [x] 英文和日文均可形成单区块选区；
- [x] annotation 作为 React decoration 显示；
- [x] script/style/iframe 不进入输出；
- [x] 键盘能访问读音和音频操作；
- [x] Chromium 桌面视觉与交互验证通过；
- [x] POC 结果不足时，不进入生产迁移。

POC 实测发现：把 Unified/Remark/Rehype 解析器直接打进独立浏览器页面时，JavaScript 为 523.80 KB raw / 161.36 KB gzip，不适合直接并入 CardModal。改为 Node 预生成 CardDocument 后，浏览器页面降为 203.62 KB raw / 64.45 KB gzip；该数字仍包含独立 POC 自己的 React runtime，不能当作生产增量。CR-P1 必须以真实共享 runtime 测量增量，并优先采用服务端生成或单独延迟加载的 parser。

验证记录见 `Docs/TestReports/Card_Reader_v3_POC_20260804.md`。

## 8. 生产迁移阶段

1. **CR-P0：隔离 POC**。验证 AST、结构、视觉与交互。
2. **CR-P1：双渲染 shadow**。同一 Markdown 同时生成 v2 HTML 和 v3 CardDocument，只比较可见文本、语言 section、audio 与 selector，不显示 v3。
3. **CR-P2：单卡型 Canary**。只对测试 fixture 和人工指定的新三语卡显示 v3，可立即回退 v2。
4. **CR-P3：三语卡**。通过真实使用观察后扩大；语法卡、场景卡仍走 v2。
5. **CR-P4：语法卡与场景卡**。逐卡型建立独立结构合同。
6. **CR-P5：CardModal 拆分**。弹窗只拥有窗口、标签页和命令；`CardReader` 拥有正文；selection、annotation、pronunciation 各自成为插件。
7. **CR-R1：观察与退役裁决**。只有 v2 使用量归零、回滚演练通过后，才另开 ADR 决定是否删除 marked/innerHTML 路径。

## 9. 明确禁止

- 不把 POC 当作 Ruby 历史迁移批准；
- 不把 analyzer 输出当作已确认读音；
- 不在读取卡片时写 pronunciation 或 annotation；
- 不一次切换全部卡型；
- 不因视觉升级修改 Markdown 正文、content hash、Study Item 或 FSRS；
- 不在本阶段引入富文本编辑、协同编辑或移动端范围。

## 10. CR-P1 双渲染 Shadow 实施记录

2026-08-04 已将 POC 的 CardDocument parser 提升为服务端只读模块，生产页面仍只显示 v2：

```text
CardModal 读取 generation.id
  -> GET /api/card-reader/shadow/config
  -> flag 开启时 GET /api/card-reader/shadow?generationId=...
  -> 服务端读取 generation.markdown_content
  -> v2 DOMPurify 可见文本投影 + v3 CardDocument 投影
  -> 仅返回有界 parity、计数、SHA-256 与诊断码
```

实施边界：

- Unified/Remark/Rehype 只在 Express 服务端加载，不进入浏览器 bundle；
- API 不接收 Markdown，浏览器也不接收 CardDocument 或正文差异；
- 报告不含标题、正文、选区、译文或读音，只含固定字段、计数、hash 与有界 code；
- `GET` 只调用 `getGenerationById()`，集成测试用 SQLite `total_changes()` 证明前后不变；
- `CARD_READER_V3_SHADOW_ENABLED` 代码与示例环境默认关闭，Compose 本地观察默认开启；
- 页面 DOM 继续只有 `data-card-renderer-version="2"`，CR-P1 不授权 v3 可见 Canary；
- 危险节点只进入 `UNSAFE_NODE_DROPPED` 等诊断统计，不进入 React 或 API 正文。

生产构建中 CardModal 为 118,854 raw / 39.59 kB gzip；它比 CR-P1 前的预算上限高 254 bytes，但这不是严格的功能增量测量。预算仅从 118,600 调整到 119,000，且 client build 中没有 Unified/Remark/Rehype 解析器模块。

首批真实 shadow 样本使用 generation `1040`、`1039`、`1038`。三张卡的可见正文、三语 section 和 4 个音频节点均一致。样本同时确认 `loanword-block` 必须保留为可显示的 `aside(role=loanword)`，但与 v2 一样不进入 `card-visible-text-v1` selector 投影。调用前后 63 张业务表、22,806 行的表级计数 SHA-256 保持为 `ac205f3b40f74b86184fa119dcea2fddb073fb2a8d427a2349cdbfb8faab92ce`，证明真实卷读取零写入。

验证记录见 `Docs/TestReports/Card_Reader_v3_CR_P1_20260804.md`。进入 CR-P2 前，必须先对真实新三语卡积累 shadow parity 样本，并由人工指定 Canary 卡；不得把 shadow 全绿自动解释为 Ruby 迁移或 v3 全量切换批准。

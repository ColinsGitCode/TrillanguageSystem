# Three LANS 公开 SaaS 工作区运行手册

> 状态：PS-G1 匿名公开沙箱与 UI-R2 性能/恢复界面已实施并完成本地验收；互联网发布仍需 TLS、反向代理、持久监控与滥用控制
>
> 日期：2026-07-30
>
> 范围：桌面端、Express + React Router、SQLite、Docker Compose

## 1. 先说结论

Three LANS 当前支持两种**进程级**运行模式：

1. `owner`：所有者长期工作区，保留完整读写和历史；
2. `sandbox`：由公开沙箱网关按匿名浏览器会话创建的短期独立体验实例。

这不是用户管理系统。系统没有账户、团队、角色或登录页面。

同时必须守住一个边界：

> 一个 `sandbox` viewer 进程只能服务一个匿名浏览器沙箱，并且只能挂载该沙箱自己的 SQLite、卡片、教材、缓存和媒体目录。

`sandbox-gateway.mjs` 已负责：

- 首次访问时签发不含个人身份的短期签名 cookie；
- 为每个匿名会话创建独立 viewer 子进程和独立存储根；
- 把后续请求只转发到该会话自己的进程；
- 到期、手动重置或网关关闭时停止进程并删除短期数据；
- 容量已满时返回明确的 503 页面，不回退到所有者工作区；
- 用存储根独占锁阻止两个网关误用同一沙箱目录。

本地所有者工作区与公开沙箱使用不同 Compose 文件、不同端口和不同 volume。
公开部署不得挂载所有者 SQLite、卡片、教材或缓存。

## 2. 运行模式配置

### 2.1 本地所有者工作区

默认配置：

```dotenv
WORKSPACE_MODE=owner
DEPLOYMENT_EXPOSURE=local
OWNER_GATEWAY_PROTECTED=false
VIEWER_BIND_ADDRESS=127.0.0.1
SERVICE_BIND_ADDRESS=127.0.0.1
```

行为：

- API 完整读写；
- Shell 显示“个人工作区 · 本机访问”；
- viewer、Kokoro 和 VOICEVOX 默认只绑定宿主机回环地址；
- 局域网或互联网无法直接访问这些端口。

### 2.2 经外部保护的所有者工作区

```dotenv
WORKSPACE_MODE=owner
DEPLOYMENT_EXPOSURE=public
OWNER_GATEWAY_PROTECTED=true
```

`OWNER_GATEWAY_PROTECTED=true` 是部署声明，不会自动生成网关。运营者必须实际配置以下至少一种保护：

- VPN；
- Cloudflare Access 等访问代理；
- 反向代理访问密钥；
- 仅可信网络可达的防火墙规则。

如果 `DEPLOYMENT_EXPOSURE=public`，但没有显式声明外部保护，viewer 会以
`PUBLIC_OWNER_WORKSPACE_UNPROTECTED` 拒绝启动。

### 2.3 网关管理的独立体验沙箱

公开网关为每个子进程自动生成以下核心环境，不要求浏览器或运营者手工填写实例路径：

```dotenv
WORKSPACE_MODE=sandbox
DEPLOYMENT_EXPOSURE=public
SANDBOX_INSTANCE_ID=sbx_<32位随机十六进制>
SANDBOX_STORAGE_ROOT=/data/sandboxes
SANDBOX_WRITE_ENABLED=true
SANDBOX_HIGH_COST_ENABLED=false
SANDBOX_EXPIRES_AT_UTC=<网关计算的到期时间>
SANDBOX_RESET_SUPPORTED=true

DB_PATH=/data/sandboxes/sbx_<id>/database/records.db
RECORDS_PATH=/data/sandboxes/sbx_<id>/records
TEXTBOOK_SOURCE_ROOT=/data/sandboxes/sbx_<id>/textbook-source
TEXTBOOK_WORK_PATH=/data/sandboxes/sbx_<id>/textbook-work
SELECTION_TTS_CACHE_PATH=/data/sandboxes/sbx_<id>/selection-tts
```

服务启动时会检查：

- instance id 为 8–80 位安全字符；
- SQLite、卡片、教材来源、教材工作目录和选区 TTS 缓存全部位于该实例根目录；
- 任一路径指向所有者目录或实例根之外时，拒绝启动并返回
  `SANDBOX_STORAGE_NOT_ISOLATED`。

基础 `docker-compose.yml` 仍属于所有者工作区。公开入口必须使用
`docker-compose.public.yml`，它只挂载 `public_sandboxes` 与 TTS 模型缓存，
不挂载任何所有者长期数据卷。

### 2.4 启动公开沙箱

先生成至少 32 字符的随机 cookie 密钥，并只放在部署环境中：

```bash
export PUBLIC_SANDBOX_COOKIE_SECRET="$(openssl rand -hex 32)"
export PUBLIC_SANDBOX_COOKIE_SECURE=false  # 仅本机 HTTP 验收
docker compose -f docker-compose.public.yml up -d --build
curl -fsS http://127.0.0.1:3020/__gateway/health
```

互联网 HTTPS 部署必须省略上面的 `false`，保持 Secure cookie。默认公开入口为
`127.0.0.1:3020`，由正式反向代理负责 TLS 和外部域名。

## 3. 写入和高成本操作

### 3.1 默认只读

`SANDBOX_WRITE_ENABLED` 默认关闭。此时：

- GET、HEAD、OPTIONS 可以继续读取沙箱示例数据；
- POST、PUT、PATCH、DELETE 在进入领域 route 前统一返回 `403 WORKSPACE_READ_ONLY`；
- 页面显示“当前是只读体验沙箱”；
- 响应不会返回服务器绝对路径、密钥或内部存储根。

### 3.2 独立写入

只有同时满足以下条件才能设置 `SANDBOX_WRITE_ENABLED=true`：

1. viewer 进程与匿名浏览器沙箱是一对一；
2. 所有存储目录已经通过启动校验；
3. 到期清理由外部会话代理负责；
4. 不挂载所有者 SQLite、卡片和教材媒体。

### 3.3 高成本操作

即使沙箱可以写入，以下操作仍由第二道开关控制：

- 卡片同步生成；
- 卡片生成队列；
- OCR；
- 选区即时 TTS；
- 教材单句 TTS 批处理。

`SANDBOX_HIGH_COST_ENABLED=false` 时返回
`403 WORKSPACE_HIGH_COST_DISABLED`。

公开网关已经提供每会话生成、OCR、TTS 和存储额度。默认仍关闭高成本能力；
只有确认 DeepSeek/TTS/OCR 容量后，才可以设置：

```dotenv
PUBLIC_SANDBOX_HIGH_COST_ENABLED=true
PUBLIC_SANDBOX_QUOTA_GENERATIONS=2
PUBLIC_SANDBOX_QUOTA_OCR=5
PUBLIC_SANDBOX_QUOTA_TTS=20
PUBLIC_SANDBOX_QUOTA_STORAGE_BYTES=67108864
```

额度在请求进入领域 route 前扣除，因此**一次被接受的尝试即计数**，即使后续因
输入校验或 provider 失败而未成功。额度用完返回 `429 SANDBOX_QUOTA_EXCEEDED`；
存储用完返回 `429 SANDBOX_STORAGE_QUOTA_EXCEEDED`。用户可以重置当前沙箱，
也可以等待沙箱到期；重置不会影响其他匿名沙箱或所有者工作区。

## 4. 公开运行信息

`GET /api/runtime` 返回：

- 工作区模式和可读写能力；
- 本地、私有或公开暴露级别；
- 外部网关或独立进程存储保护方式；
- 沙箱保留时长、确切到期时间和是否支持重置；
- 当前会话的生成、OCR、TTS 和存储额度；
- 构建版本、可选 commit 和构建时间；
- 可选的公开问题反馈地址；
- 服务端当前 UTC 时间。

接口不会返回：

- SQLite 路径；
- RECORDS_PATH；
- 教材媒体根；
- API key；
- 网关密钥；
- 环境变量完整内容。

检查示例：

```bash
curl -s http://127.0.0.1:3010/api/runtime
```

可选配置：

```dotenv
PUBLIC_FEEDBACK_URL=https://support.example.com/three-lans
```

也可以使用 `mailto:support@example.com`。运行时只接受 `https:` 和 `mailto:`，其它协议返回 `null`，避免把内部地址或危险链接暴露给浏览器。

## 5. 验收

### 5.1 本地所有者模式

```bash
docker compose config --quiet
docker compose up -d --build viewer
curl -fsS http://127.0.0.1:3010/api/runtime
curl -fsS http://127.0.0.1:3010/api/health
```

预期：

- `workspace.mode = owner`；
- `workspace.access = read-write`；
- Shell 显示“个人工作区”；
- 原有生成、学习、教材和知识点功能不受影响。

### 5.2 只读沙箱

预期：

- `GET /api/history` 可读；
- `POST /api/learning/queues/today` 返回 403；
- `code = WORKSPACE_READ_ONLY`；
- Shell 在用户第一次尝试写入前就显示只读说明；
- 响应中没有实例绝对路径。

自动化证据：

- `tests/unit/workspaceAccess.test.js`
- `tests/integration/runtime.test.js`
- `tests/e2e/app-shell.spec.js`

### 5.3 匿名可写沙箱隔离

生产构建完成后执行：

```bash
npm run test:public-sandbox
```

该门禁使用临时目录启动真实网关和真实 viewer 子进程，并验证：

1. 两个匿名 cookie 获得不同的 opaque workspace id；
2. 两边各自只看到 3 张合成示例卡；
3. A 删除卡片后，B 的数量和内容不变；
4. A 用完生成额度后收到 429，B 的额度不变；
5. A 重置后获得新 workspace id 并恢复 3 张示例卡，B 仍不变；
6. 网关关闭后所有子进程、沙箱目录和独占锁均被清理。

实际教材原文、用户卡片和所有者 volume 不参与此测试。
容量测试还会把 `preparing` 状态的实例计入上限，防止多个首次请求同时到达时
短暂突破 `PUBLIC_SANDBOX_MAX_SESSIONS`。

### 5.4 Public Compose contract

```bash
PUBLIC_SANDBOX_COOKIE_SECRET="$(openssl rand -hex 32)" \
  docker compose -f docker-compose.public.yml config --quiet
```

配置检查必须确认 `sandbox-gateway` 只挂载 `public_sandboxes`，不得出现
所有者 SQLite、records、教材媒体或 selection TTS volume。

## 6. 回滚

本地回滚到原有所有者行为：

```dotenv
WORKSPACE_MODE=owner
DEPLOYMENT_EXPOSURE=local
OWNER_GATEWAY_PROTECTED=false
```

然后重建 viewer。

不得通过删除 workspace middleware 来“解决”配置错误。启动失败表示部署边界不安全，应修正网关或数据目录。

## 7. 仍需完成的生产化工作

匿名沙箱的应用层边界已经闭合，但从本机验收走向互联网服务还需要：

1. 配置正式 HTTPS 反向代理、安全响应头和受信任的转发头；
2. 为网关容量、子进程启动失败、429、重置和清理失败建立指标与告警；
3. 根据真实并发确定单机最大会话数、CPU/内存上限和排队策略；
4. 增加 IP 级速率限制与自动滥用检测，不能只依赖 cookie 会话额度；
5. 定期验证 `public_sandboxes` volume 无超期目录和所有者数据；
6. 若单机容量不足，再引入多主机调度；当前不要过早增加分布式复杂度。

完成 TLS、监控和滥用控制前，可称为“本地可验收公开沙箱”，不能称为已完成
互联网生产发布。

## 8. 后台任务恢复矩阵

公开服务的“取消”只停止尚未完成的工作，不回滚已经成功保存的结果。

| 任务 | 当前状态 | 可用动作 | 保留内容 | 运营判断 |
|---|---|---|---|---|
| 卡片生成 | `queued` | 取消 | 尚未产生结果 | 可安全取消 |
| 卡片生成 | `running` | 等待完成 | 完成后保存卡片、音频和审计状态 | 暂不强制终止 |
| 卡片生成 | `failed` | 重试失败任务 | 已有任务和错误记录 | 同一任务恢复 |
| 卡片生成 | `succeeded` | 查看学习卡 | 卡片库、历史和音频 | 不需要再次生成 |
| 教材 operation | `queued` | 取消 | 尚未开始的步骤 | 立即转为 `cancelled` |
| 教材 operation | `running` | 请求停止 | 已成功步骤 | 当前可中断步骤停止后收敛 |
| 教材 operation | `cancelled` | 继续未完成步骤 | 所有 `succeeded` 步骤 | 不从头执行 |
| 教材 operation | `partially_failed` | 重试失败步骤 | 发布、物化等已成功结果 | 仅重试失败或未完成步骤 |
| 教材 operation | 服务重启前 `running` | 自动恢复 | operation event 与步骤结果 | 有停止请求则取消，否则重新排队 |

运营检查：

```bash
curl -fsS http://127.0.0.1:3010/api/activity
```

Activity Center 应显示任务所属产品域、公开状态、最近更新时间和恢复动作。若接口部分降级，页面应保留最近成功读取的活动，并明确标记来源暂不可用。

禁止通过直接修改 SQLite 状态、删除 operation event 或清空任务表来“恢复”公开任务。需要人工介入时，应先保留数据库和日志，再使用领域 API 重试或继续。

## 9. 公开帮助与安全诊断

页面右上角“帮助与系统信息”抽屉用于公开展示：

- 当前页面的数据边界；
- DeepSeek、TTS、OCR、Storage 等公开状态；
- AI、教材原文、派生内容和人工确认事实的来源；
- 当前工作区模式；
- 版本、commit、构建时间和反馈入口。

“复制诊断信息”不得包含：

- 学习卡或教材正文；
- SQLite、RECORDS_PATH、教材媒体根和缓存绝对路径；
- API key、环境变量或网关密钥；
- 浏览器历史或用户输入。

运营排查时，先让用户复制该安全摘要。只有仍无法定位且用户明确同意时，才通过受控方式收集额外日志；不要要求用户粘贴 `.env`、数据库或完整教材内容。

## 10. UI 性能观测

### 10.1 配置

公开网关默认开启 10% 抽样：

```dotenv
PUBLIC_SANDBOX_UI_PERFORMANCE_ENABLED=true
PUBLIC_SANDBOX_UI_PERFORMANCE_SAMPLE_RATE=0.1
```

网关会把配置传给每个独立 viewer：

```dotenv
UI_PERFORMANCE_ENABLED=true
UI_PERFORMANCE_SAMPLE_RATE=0.1
```

本地 owner 默认关闭。需要短期诊断时可以显式开启，但不应把生产抽样率长期设为
`1`，除非已经评估日志量和网络开销。

### 10.2 数据边界

`POST /api/ui-performance` 只接受版本化白名单：

- TTFB、FCP、LCP、CLS、INP；
- 路由切换；
- 学习卡弹窗打开；
- 固定路由类别、受控上下文和数值。

不得增加：

- 卡片、教材或复习正文；
- 查询参数、搜索词、选区文本或用户输入；
- workspace id、cookie、IP 或浏览器身份；
- 数据库路径、provider 原始错误或环境变量。

未知路径必须归入 `/other`。单批最多 12 项。无有效 cookie 的网关性能请求不得分配
新沙箱；验收脚本会检查这一点。

### 10.3 运营检查

前端预算定义在：

- `config/ui-performance-budgets.json`
- `config/frontend-asset-budgets.json`

代码和资源门禁：

```bash
npm run test:architecture
npm run test:e2e
```

匿名沙箱端到端门禁：

```bash
npm run test:public-sandbox
```

当前性能样本进入结构化应用日志。正式互联网发布前，仍需把这些日志接入持久指标
系统，至少建立 p50/p75/p95 趋势和 LCP、INP、路由切换、弹窗打开超预算告警。
单次 202 只代表样本被接受，不代表性能持续达标。

## 11. 网关失败和配额恢复

### 11.1 容量与启动失败

公开网关必须使用统一恢复页面：

- `503 SANDBOX_CAPACITY_FULL`：`Retry-After: 30`；
- `502 SANDBOX_START_FAILED` 或上游失败：`Retry-After: 10`；
- 文档请求返回品牌化浅色/深色 HTML；
- API 请求返回结构化错误；
- 两者都不得回退到 owner 工作区。

用户页面只提供重新尝试和受控反馈入口，不显示堆栈、路径或环境变量。

### 11.2 会话额度耗尽

高成本额度耗尽返回 429 后，Product Shell 显示持续恢复提示：

- 说明是哪类额度耗尽；
- 显示重置时间；
- 允许重置当前体验数据；
- 切页后保持提示，直到重置或运行时状态恢复；
- 不影响其它匿名会话和 owner 工作区。

验收：

```bash
npx playwright test tests/e2e/public-saas-states.spec.js --project=chromium
npx playwright test tests/e2e/app-shell.spec.js --project=chromium
```

容量页视觉基线必须同时覆盖浅色与深色主题。

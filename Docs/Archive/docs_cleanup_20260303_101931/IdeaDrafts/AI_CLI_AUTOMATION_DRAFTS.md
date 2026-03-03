针对你的需求，我将 **Gemini CLI** 和 **Codex CLI**（通常指 OpenAI/GitHub 开发的命令行工具）在**自动化（非交互模式）**下的使用文档总结如下。

这两者虽然都能在终端运行，但 Gemini CLI 更像一个**“全能研究员”**，而 Codex CLI 更像一个**“拥有 Root 权限的自动程序员”**。

---

## 1. Gemini CLI 使用指南（自动化篇）

Gemini CLI 的自动化核心在于 **“Headless Mode” (无头模式)**。它擅长通过管道处理数据、总结文档和多模态任务。

### 核心自动化命令

* **直接提问：** `gemini --prompt "总结一下 README.md"` 或简写 `gemini -p "..."`
* **管道输入（最常用）：** `cat logs.txt | gemini "找出这些日志中的报错原因"`
* **指定模型：** `gemini -p "写个脚本" -m gemini-2.0-flash` (利用 Flash 模型提速)
* **结构化输出：** `gemini -p "提取这段文字里的日期" --output-format json` (便于脚本解析)

### 自动化进阶配置

* **系统指令重写：** 使用环境变量 `GEMINI_SYSTEM_MD` 预设它的行为（例如：要求它只输出代码，不输出文字）。
* **多模态处理：** `gemini --file image.png -p "描述这张图"` (可配合脚本监控文件夹，自动生成图片描述)。

---

## 2. Codex CLI 使用指南（自动化篇）

Codex CLI 的强大之处在于其 **“Agentic” (代理性)**。它不仅能生成文本，还能通过 **Approval Modes** 自动修改文件和运行命令。

### 核心自动化命令

* **自动执行模式：** `codex --approval-mode full-auto "修复 src/ 目录下的所有 Lint 错误"`
* *注：此模式下它会自动写代码、跑测试、修复错误，无需人工干预。*


* **执行子命令：** `codex exec "在当前项目中添加一个登录页面"`
* **静默模式：** `codex "生成接口文档" --quiet` (仅输出结果，适合集成到 CI/CD 流程)。

### 权限与安全配置

* **Read-only 模式：** `codex -c approval_policy="read-only" "解释这个函数"` (确保自动化脚本不会误改代码)。
* **YOLO 模式：** `--yolo` 标志位，强制跳过所有确认提示（生产环境慎用，CI 环境常用）。

---

## 3. 快速对比表：我该选哪个？

| 功能维度 | Gemini CLI (自动化) | Codex CLI (自动化) |
| --- | --- | --- |
| **主要定位** | 处理文本、研究、分析、多媒体 | 修改代码、运行指令、项目重构 |
| **输入方式** | 强依赖标准输入 (stdin) 和文件 | 自动感知整个 Repo 的上下文 |
| **修改能力** | 主要是输出文本，需手动重定向 | 可直接修改磁盘上的文件 |
| **安全机制** | 容器化沙箱 (Docker/Podman) | 细粒度策略引擎 (Starlark/Rust) |
| **最佳场景** | 自动写日报、分析日志、翻译文档 | 自动写测试、CI/CD 修复、批量重构 |

---

## 4. 自动化脚本示例 (Bash)

如果你想结合两者优势，可以写一个这样的自动化工作流：

```bash
# 1. 先用 Gemini 联网搜索最新库的用法并保存为指令
gemini -p "搜索最新的 FastAPI 中间件写法并给出一个简单的代码片段" > suggestion.txt

# 2. 用 Codex 将该建议应用到本地项目中，全自动运行
codex --approval-mode full-auto "参考 suggestion.txt 里的代码，为我本地的 main.py 添加中间件"

```
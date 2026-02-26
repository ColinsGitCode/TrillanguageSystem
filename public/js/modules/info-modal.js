/**
 * 指标详细说明定义
 */
export const METRIC_DEFINITIONS = {
    // Quality & Core
    "QUALITY_GRADE": {
        title: "综合质量评分 (Quality Grade)",
        content: `
            <p>基于四个核心维度对生成内容进行的综合评估，满分 100 分。</p>
            <ul>
                <li><strong>S级 (90-100)</strong>: 完美。内容准确、完整，无需修改。</li>
                <li><strong>A级 (80-89)</strong>: 优秀。可能有极细微的格式问题，不影响使用。</li>
                <li><strong>B级 (70-79)</strong>: 良好。核心内容正确，但例句或解释可能不够自然。</li>
                <li><strong>C级 (60-69)</strong>: 及格。存在少量错误，建议人工复核。</li>
                <li><strong>D级 (<60)</strong>: 需优化。存在严重缺失或错误，建议重新生成。</li>
            </ul>
        `
    },
    "DIMENSIONS": {
        title: "质量 4 维度 (4-Axis Dimensions)",
        content: `
            <p>质量评分的具体构成部分：</p>
            <ul>
                <li><strong>完整性 (Completeness, 40%)</strong>: 检查卡片是否包含所有必要字段（单词、音标、词性、中文释义、英文例句、日文翻译等）。</li>
                <li><strong>准确性 (Accuracy, 30%)</strong>: 评估翻译的信达雅程度，以及释义是否符合语境。</li>
                <li><strong>例句质量 (Example Quality, 20%)</strong>: 评估例句的自然度、实用性、多样性，以及是否准确体现了单词用法。</li>
                <li><strong>格式化 (Formatting, 10%)</strong>: 检查 HTML 标签闭合情况、音频标签注入是否正确、Markdown 语法规范性。</li>
            </ul>
        `
    },
    // Config
    "GENERATION_CONFIG": {
        title: "生成配置参数 (Generation Config)",
        content: `
            <p>控制 AI 模型生成行为的核心参数：</p>
            <ul>
                <li><strong>Temperature (温度)</strong>: 控制输出的随机性 (0-1)。
                    <br>- 较高 (如 0.8): 更具创造性，更多样化。
                    <br>- 较低 (如 0.2): 更专注，更确定，适合标准答案。
                </li>
                <li><strong>Max Tokens</strong>: 单次请求允许生成的最大 Token 数量，防止输出过长。</li>
                <li><strong>Top P</strong>: 核采样参数。0.95 表示仅从累积概率达 95% 的词汇候选中进行采样。</li>
            </ul>
        `
    },
    // Analysis
    "CHRONO_SEQUENCE": {
        title: "时序分析 (Chrono Sequence)",
        content: `
            <p>生成全流程各阶段的耗时分布，帮助定位性能瓶颈：</p>
            <ul>
                <li><strong>PROMPT</strong>: 构建 Prompt 模板及上下文的时间。</li>
                <li><strong>LLM</strong>: AI 模型推理生成文本的时间（通常占比最大）。</li>
                <li><strong>PARSE</strong>: 解析 AI 返回的 JSON/Markdown 数据的时间。</li>
                <li><strong>TTS</strong>: 调用语音合成引擎生成音频文件的时间。</li>
            </ul>
        `
    },
    "TOKEN_FLUX": {
        title: "Token 流量 (Token Flux)",
        content: `
            <p>Token 是 AI 处理文本的基本单位（约等于 0.75 个英文单词）。</p>
            <ul>
                <li><strong>IN (Input)</strong>: 发送给模型的 Prompt 消耗的 Token 数。</li>
                <li><strong>OUT (Output)</strong>: 模型生成的回答消耗的 Token 数。</li>
                <li><strong>COST</strong>: 基于当前模型费率计算的单次调用预估成本。</li>
            </ul>
        `
    },
    "DIMENSIONAL_SCAN": {
        title: "维度雷达图 (Dimensional Scan)",
        content: "<p>可视化展示完整性、准确性、格式化等维度的得分分布，直观判断生成的偏科情况。</p>"
    },
    "PROMPT_TEXT": {
        title: "Prompt 文本",
        content: "<p>实际发送给 AI 模型的完整提示词内容。包含角色设定、任务指令、输出格式要求以及少样本示例 (Few-Shot Examples)。点击可展开查看或复制。</p>"
    },
    "LLM_OUTPUT": {
        title: "LLM 原始输出",
        content: "<p>AI 模型返回的原始文本内容（通常是 JSON 格式）。这是未经后处理的原始数据，用于调试解析错误。</p>"
    },
    "EXPORT_DATA": {
        title: "数据导出",
        content: "<p>将当前卡片的详细指标数据导出为 JSON（完整结构）或 CSV（表格分析）格式。</p>"
    },
    
    // Dashboard Metrics
    "INFRASTRUCTURE": {
        title: "基础设施状态 (Infrastructure)",
        content: `
            <p>后端服务及其依赖组件的实时健康状况：</p>
            <ul>
                <li><strong>Local LLM</strong>: 本地运行的大语言模型服务 (如 Ollama/vLLM)。</li>
                <li><strong>TTS English</strong>: 英语语音合成服务 (Kokoro)。</li>
                <li><strong>TTS Japanese</strong>: 日语语音合成服务 (VOICEVOX)。</li>
                <li><strong>Storage</strong>: 数据库连接状态。</li>
            </ul>
        `
    },
    "DATA_CORE": {
        title: "数据核心 (Data Core)",
        content: "<p>本地文件系统存储占用统计。包含所有生成的 Markdown 文档、HTML 页面以及 WAV/MP3 音频文件。</p>"
    },
    "REVIEW_PIPELINE": {
        title: "评审管线 (Review Pipeline)",
        content: `
            <p>例句级人工评审与样本池管理，是 few-shot 注入的质量门控。</p>
            <ul>
                <li><strong>Approved (已通过)</strong>: 三维评分（原句/翻译/TTS）达标且拒绝率低于阈值，可注入 few-shot。</li>
                <li><strong>Pending (待审)</strong>: 已入池但尚未评审或未达到最低投票数。</li>
                <li><strong>Rejected (已拒绝)</strong>: 评分不达标或拒绝率过高，不会被注入。</li>
            </ul>
            <p>Eligibility 计算：overall = 0.45*sentence + 0.45*translation + 0.1*tts，需同时满足 overall≥4.2、sentence≥4.0、translation≥4.0、tts≥3.0。</p>
        `
    },
    "FEWSHOT_EFFECT": {
        title: "Few-shot 效果 (Few-shot Effectiveness)",
        content: `
            <p>对比 baseline（无注入）与 fewshot（注入高质量样本）两种生成策略的效果。</p>
            <ul>
                <li><strong>Quality</strong>: 模板合规评分均值对比。</li>
                <li><strong>Tokens</strong>: prompt token 消耗对比（fewshot 会增加 token 开销）。</li>
                <li><strong>Latency</strong>: 端到端延迟对比。</li>
                <li><strong>Injection Rate</strong>: 成功启用 fewshot 注入的生成占比。</li>
                <li><strong>Fallback Reasons</strong>: 未能成功注入的原因分布（如样本池不足、token 预算超限等）。</li>
            </ul>
        `
    },
    "QUALITY_SIGNAL": {
        title: "模板合规分 (Quality Signal)",
        content: `
            <p>注意：此分数仅反映<strong>模板合规性</strong>（JSON 结构完整、字段齐全、三语覆盖、例句数量），不能评估翻译质量或例句自然度。正常输出通常在 85-95 分。</p>
            <p>内容质量评估请参考"评审管线"中的人工评分。</p>
        `
    },
    "LIVE_FEED": {
        title: "实时动态 (Live Feed)",
        content: "<p>实时显示的最新生成记录流。包含短语名称、使用的模型、生成的质量评分以及时间戳。</p>"
    },
    "PROVIDER_SPLIT": {
        title: "供应商分布 (Provider Split)",
        content: "<p>不同 AI 模型供应商 (如 Local, Gemini, OpenAI 等) 的调用比例分布图。</p>"
    },
    "ERROR_MONITOR": {
        title: "错误监控 (Error Monitor)",
        content: "<p>生成失败的任务统计。包括 API 超时、JSON 解析错误、网络中断等异常情况。</p>"
    },
    "TOKEN_TREND": {
        title: "Token 趋势 (Token Trend)",
        content: "<p>每日消耗的 Token 总量（输入+输出）变化趋势。反映系统的负载情况。</p>"
    },
    "LATENCY_TREND": {
        title: "延迟趋势 (Latency Trend)",
        content: "<p>API 平均响应耗时的变化趋势。反映模型推理速度和网络状况。</p>"
    }
};

/**
 * 注入 Info Modal 的 HTML 结构到页面
 */
export function initInfoModal() {
    if (document.getElementById('infoModal')) return;

    const modalHtml = `
        <div id="infoModal" class="info-modal hidden">
            <div class="info-modal-backdrop"></div>
            <div class="info-modal-content modern-card">
                <div class="info-modal-header">
                    <h3 id="infoModalTitle">Title</h3>
                    <button class="info-close-btn">&times;</button>
                </div>
                <div id="infoModalBody" class="info-modal-body">
                    Content
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Bind events
    const modal = document.getElementById('infoModal');
    const closeBtn = modal.querySelector('.info-close-btn');
    const backdrop = modal.querySelector('.info-modal-backdrop');

    const closeModal = () => modal.classList.add('hidden');

    closeBtn.onclick = closeModal;
    backdrop.onclick = closeModal;
    
    // ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
            // Stop propagation to prevent closing parent modals if any
            e.stopPropagation(); 
        }
    });
}

/**
 * 显示详细说明弹窗
 * @param {string} key - 指标 Key
 */
export function showInfo(key) {
    const def = METRIC_DEFINITIONS[key];
    if (!def) return;

    const modal = document.getElementById('infoModal');
    const titleEl = document.getElementById('infoModalTitle');
    const bodyEl = document.getElementById('infoModalBody');

    if (!modal) {
        initInfoModal(); // Ensure init
        return showInfo(key);
    }

    titleEl.textContent = def.title;
    bodyEl.innerHTML = def.content;

    modal.classList.remove('hidden');
}

/**
 * 生成问号按钮的 HTML
 * @param {string} key - 指标 Key
 * @returns {string} HTML String
 */
export function createInfoBtn(key) {
    return `<button class="info-btn" data-info-key="${key}" title="点击查看说明">?</button>`;
}

/**
 * 绑定页面上所有的 info-btn 点击事件
 * 需在 DOM 更新后调用
 */
export function bindInfoButtons(container = document) {
    container.querySelectorAll('.info-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // 防止触发父元素的点击事件
            const key = btn.dataset.infoKey;
            showInfo(key);
        };
    });
}

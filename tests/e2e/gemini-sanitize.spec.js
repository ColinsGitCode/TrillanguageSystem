const http = require('http');
const { test, expect } = require('@playwright/test');
const { runGeminiProxy } = require('../../services/geminiProxyService');
const { runTask } = require('../../services/knowledgeAnalysisEngine');

function withJsonServer(resolver) {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(resolver(state.hits)));
  });

  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      return `http://127.0.0.1:${port}/api/gemini`;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test.describe('Gemini MCP sanitize regression', () => {
  test('01 Gemini proxy 可清洗 MCP 诊断前缀并保留有效 markdown', async () => {
    const fixture = withJsonServer(() => ({
      markdown: [
        'MCP issues detected. Run /mcp list for status.',
        '# sanitize demo',
        '## 1. 英文:',
        '- **例句1**: first sample',
        '- **例句2**: second sample',
        '## 2. 日本語:',
        '- **例句1**: 例文(れいぶん)です',
        '- **例句2**: 別(べつ)の例文(れいぶん)です',
        '## 3. 中文:',
        '- **翻译**: 清洗成功'
      ].join('\n')
    }));

    const url = await fixture.start();
    try {
      const response = await runGeminiProxy('sanitize markdown', {
        url,
        enforceGateway: false,
        authMode: 'none',
        retries: 0,
        validateSanitizedResponse: (sanitized) => {
          const markdown = String(sanitized.markdown || '');
          return markdown.includes('## 3. 中文') && !markdown.includes('MCP issues detected');
        }
      });

      expect(fixture.state.hits).toBe(1);
      expect(response.markdown).toContain('## 3. 中文');
      expect(response.markdown).not.toContain('MCP issues detected');
      expect(response.markdown).not.toContain('/mcp list');
    } finally {
      await fixture.stop();
    }
  });

  test('02 Knowledge synonym_boundary 可清洗 MCP 诊断前缀并解析有效 JSON', async () => {
    const payload = {
      pair: { termA: 'Personal', termB: 'Subjective' },
      contextSplit: [
        { dimension: 'register', a: 'Personal 偏日常语境', b: 'Subjective 偏分析语境', why: '使用场景不同' }
      ],
      misuseRisks: [
        { scenario: '正式评审报告', risk: '误用会削弱客观性', severity: 'high' }
      ],
      jpNuance: {
        a: '個人的(こじんてき)な意見(いけん)です。',
        b: '主観的(しゅかんてき)な判断(はんだん)です。',
        note: '一个偏私人，一个偏主观判断。'
      },
      boundaryTags: {
        a: ['private', 'relational'],
        b: ['analytical', 'logic-focused']
      },
      confidence: 0.92,
      coverageRatio: 0.75,
      recommendation: '正式评估优先 Subjective，私人立场优先 Personal。',
      actionableHint: '表达私人经验时用 Personal。'
    };

    const fixture = withJsonServer(() => ({
      rawOutput: `MCP issues detected. Run /mcp list for status. ${JSON.stringify(payload)}`
    }));

    const url = await fixture.start();
    try {
      const cards = [
        {
          id: 1,
          phrase: 'Subjective',
          zh_translation: '主观的',
          en_translation: 'subjective',
          ja_translation: '主観的(しゅかんてき)',
          markdown_content: '## 2. 日本語:\n- **例句1**: 主観的(しゅかんてき)な判断(はんだん)です。'
        },
        {
          id: 2,
          phrase: 'Personal',
          zh_translation: '主观的',
          en_translation: 'personal',
          ja_translation: '個人的(こじんてき)',
          markdown_content: '## 2. 日本語:\n- **例句1**: 個人的(こじんてき)な感想(かんそう)です。'
        }
      ];

      const result = await runTask('synonym_boundary', cards, {
        llmEnabled: true,
        minCandidateScore: 0,
        maxPairs: 1,
        maxLlmPairs: 1,
        llmTransport: 'proxy',
        llmGatewayUrl: url,
        proxyAuthMode: 'none',
        enforceGateway: false,
        llmRetries: 0,
        llmTimeoutMs: 5000
      });

      expect(fixture.state.hits).toBe(1);
      expect(result.status).toBe('ok');
      expect(result.result.meta.llmTransport).toBe('proxy');
      expect(result.result.groups).toHaveLength(1);
      expect(result.result.groups[0].parseStatus).toBe('ok');
      expect(result.result.groups[0].termA).toBe('Personal');
      expect(result.result.groups[0].termB).toBe('Subjective');
      expect(result.result.groups[0].actionableHint).toContain('Personal');
      expect(result.result.groups[0].jpNuance.note).toContain('私人');
    } finally {
      await fixture.stop();
    }
  });
});

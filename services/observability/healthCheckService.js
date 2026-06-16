/**
 * 健康检查服务 - F3: 服务状态监控
 * 功能：
 * - 检查 DeepSeek API 状态
 * - 检查本地 LLM 状态
 * - 检查 TTS 服务状态
 * - 检查存储状态
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const log = require('../../lib/logger').child({ module: 'svc/health' });
const {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  E2E_TEST_MODE,
  resolveDeepSeekModel,
} = require('../../lib/serverConfig');

class HealthCheckService {
  static resolveDeepSeekBaseUrl() {
    const configuredBaseUrl = String(process.env.DEEPSEEK_BASE_URL || '').trim();
    const defaultBaseUrl = String(DEFAULT_DEEPSEEK_BASE_URL || '').trim();
    return (configuredBaseUrl || defaultBaseUrl).replace(/\/+$/, '');
  }

  static buildDeepSeekModelsUrl() {
    const baseUrl = this.resolveDeepSeekBaseUrl();
    if (!baseUrl) return '';
    try {
      const parsed = new URL(baseUrl);
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/models`;
      parsed.search = '';
      return parsed.toString();
    } catch (error) {
      return `${baseUrl}/models`;
    }
  }

  /**
   * 检查所有服务健康状态
   * @returns {Promise<Object>} 包含 services 和 system 的健康状态对象
   */
  static async checkAll() {
    const services = [];

    // 并行检查所有服务（提高性能）
    const checks = [];

    // 1. DeepSeek API
    checks.push(this.checkDeepSeekApi());

    // 2. Local LLM
    if (process.env.LLM_BASE_URL) {
      checks.push(this.checkLocalLLM());
    }

    // 3. TTS Services
    if (process.env.TTS_EN_ENDPOINT) {
      checks.push(this.checkTTSEnglish());
    }
    if (process.env.TTS_JA_ENDPOINT) {
      checks.push(this.checkTTSJapanese());
    }

    // 4. OCR Service
    const ocrProvider = (process.env.OCR_PROVIDER || '').toLowerCase();
    if (ocrProvider === 'tesseract' || process.env.OCR_TESSERACT_ENDPOINT) {
      checks.push(this.checkTesseractOCR());
    }

    // 5. Storage
    checks.push(this.checkStorage());

    // 等待所有检查完成
    const results = await Promise.allSettled(checks);
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        services.push(result.value);
      }
    });

    const criticalServices = services.filter((service) => service.critical);
    const degradedCriticalServices = criticalServices.filter((service) => service.status !== 'online');
    const overallStatus = degradedCriticalServices.length ? 'degraded' : 'online';

    // 系统信息
    const system = {
      uptime: process.uptime() * 1000,
      version: process.env.npm_package_version || '1.0.0',
      lastRestart: Date.now() - process.uptime() * 1000,
      overallStatus,
      criticalOnline: degradedCriticalServices.length === 0,
      criticalServices: criticalServices.map((service) => ({
        name: service.name,
        status: service.status,
        message: service.message || ''
      }))
    };

    return { services, system };
  }

  /**
   * 检查 DeepSeek API
   */
  static async checkDeepSeekApi() {
    const model = resolveDeepSeekModel(process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL);
    const service = {
      name: 'DeepSeek API',
      type: 'llm',
      critical: true,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: this.buildDeepSeekModelsUrl(),
        model,
        fixtureSafe: false
      }
    };

    if (E2E_TEST_MODE) {
      service.status = 'online';
      service.latency = 0;
      service.message = 'E2E fixture mode: DeepSeek API check bypassed';
      service.details.fixtureSafe = true;
      return service;
    }

    const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
    if (!apiKey) {
      service.status = 'offline';
      service.message = 'DeepSeek API key is not configured';
      return service;
    }

    const url = service.details.endpoint;
    if (!url) {
      service.status = 'offline';
      service.message = 'DeepSeek API base URL is not configured';
      return service;
    }

    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      service.latency = Date.now() - startTime;
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        service.status = service.latency > 2000 ? 'degraded' : 'online';
        service.message = service.latency > 2000 ? 'DeepSeek API 响应偏慢' : 'DeepSeek API 正常';

        if (Array.isArray(data.data)) {
          service.details.availableModels = data.data.map((entry) => entry.id || entry.name).filter(Boolean);
        }
      } else {
        service.status = 'degraded';
        service.message = data?.error?.message || data?.message || `DeepSeek API 响应异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? 'DeepSeek API 请求超时' : error.message;
    }

    return service;
  }

  /**
   * 检查本地 LLM
   */
  static async checkLocalLLM() {
    const service = {
      name: 'Local LLM',
      type: 'llm',
      critical: false,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: process.env.LLM_BASE_URL,
        model: process.env.LLM_MODEL
      }
    };

    try {
      const startTime = Date.now();
      const baseUrl = process.env.LLM_BASE_URL;

      // 尝试调用 /v1/models 端点
      const url = `${baseUrl}/models`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.LLM_API_KEY || 'EMPTY'}`
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      service.latency = Date.now() - startTime;

      if (response.ok) {
        service.status = 'online';
        service.message = '本地模型正常';

        // 尝试获取模型列表
        const data = await response.json().catch(() => ({}));
        if (data.data && Array.isArray(data.data)) {
          service.details.availableModels = data.data.map(m => m.id || m.name);
        }
      } else {
        service.status = 'degraded';
        service.message = `连接异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? '请求超时' : '未配置或无法连接';
    }

    return service;
  }

  /**
   * 检查英文 TTS (Kokoro)
   */
  static async checkTTSEnglish() {
    const service = {
      name: 'TTS English (Kokoro)',
      type: 'tts',
      critical: false,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: process.env.TTS_EN_ENDPOINT
      }
    };

    try {
      const startTime = Date.now();
      const baseUrl = process.env.TTS_EN_ENDPOINT.replace('/v1/audio/speech', '');

      // 尝试访问 /health 或基础 URL
      let url = `${baseUrl}/health`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      let response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      }).catch(async () => {
        // 如果 /health 失败，尝试基础 URL
        url = baseUrl;
        return await fetch(url, {
          method: 'GET',
          signal: controller.signal
        });
      });

      clearTimeout(timeoutId);

      service.latency = Date.now() - startTime;

      // 如果能连接上（即使 404 也算服务在线）
      if (response) {
        service.status = service.latency > 2000 ? 'degraded' : 'online';
        service.message = service.latency > 2000 ? '响应缓慢' : '服务正常';
      } else {
        service.status = 'offline';
        service.message = '无法连接';
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? '请求超时' : error.message;
    }

    return service;
  }

  /**
   * 检查日文 TTS (VOICEVOX)
   */
  static async checkTTSJapanese() {
    const service = {
      name: 'TTS Japanese (VOICEVOX)',
      type: 'tts',
      critical: false,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: process.env.TTS_JA_ENDPOINT
      }
    };

    try {
      const startTime = Date.now();
      const url = `${process.env.TTS_JA_ENDPOINT}/version`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      service.latency = Date.now() - startTime;

      if (response.ok) {
        service.status = service.latency > 2000 ? 'degraded' : 'online';
        service.message = service.latency > 2000 ? '响应缓慢' : '服务正常';

        // 获取版本信息
        const version = await response.text().catch(() => null);
        if (version) {
          service.details.version = version;
        }
      } else {
        service.status = 'degraded';
        service.message = `连接异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? '请求超时' : error.message;
    }

    return service;
  }

  /**
   * 检查 Tesseract OCR 服务
   */
  static async checkTesseractOCR() {
    const endpoint = process.env.OCR_TESSERACT_ENDPOINT || 'http://ocr:8080/ocr';
    const baseUrl = endpoint.replace(/\/ocr\/?$/, '');
    const service = {
      name: 'OCR (Tesseract)',
      type: 'ocr',
      critical: false,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint,
        langs: process.env.OCR_LANGS || 'eng+jpn+chi_sim'
      }
    };

    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      service.latency = Date.now() - startTime;

      if (response.ok) {
        service.status = service.latency > 2000 ? 'degraded' : 'online';
        service.message = service.latency > 2000 ? '响应缓慢' : '服务正常';
        const data = await response.json().catch(() => ({}));
        if (data.engine) {
          service.details.engine = data.engine;
        }
      } else {
        service.status = 'degraded';
        service.message = `连接异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? '请求超时' : error.message;
    }

    return service;
  }

  /**
   * 检查存储
   */
  static async checkStorage() {
    const service = {
      name: 'Storage',
      type: 'storage',
      critical: true,
      status: 'unknown',
      lastCheck: Date.now(),
      details: {}
    };

    try {
      const recordsPath = process.env.RECORDS_PATH || '/data/trilingual_records';

      if (!fs.existsSync(recordsPath)) {
        service.status = 'offline';
        service.message = '存储路径不存在';
        return service;
      }

      // 计算目录大小
      const getDirectorySize = (dir) => {
        let size = 0;

        try {
          const files = fs.readdirSync(dir, { withFileTypes: true });

          for (const file of files) {
            const filePath = path.join(dir, file.name);

            try {
              if (file.isDirectory()) {
                size += getDirectorySize(filePath);
              } else {
                const stats = fs.statSync(filePath);
                size += stats.size;
              }
            } catch (err) {
              // 跳过无法访问的文件
              log.warn({ filePath }, 'storage: cannot access file');
            }
          }
        } catch (err) {
          log.error({ err, dir }, 'storage: cannot read directory');
        }

        return size;
      };

      const used = getDirectorySize(recordsPath);
      const total = 6 * 1024 * 1024 * 1024; // 假设 6GB 总容量
      const percentage = (used / total) * 100;

      // 统计记录数
      let recordsCount = 0;

      try {
        const folders = fs.readdirSync(recordsPath, { withFileTypes: true })
          .filter(entry => entry.isDirectory());

        folders.forEach(folder => {
          try {
            const folderPath = path.join(recordsPath, folder.name);
            const htmlFiles = fs.readdirSync(folderPath)
              .filter(file => file.endsWith('.html'));
            recordsCount += htmlFiles.length;
          } catch (err) {
            // 跳过无法访问的文件夹
          }
        });
      } catch (err) {
        log.error({ err }, 'storage: cannot count records');
      }

      service.status = percentage > 90 ? 'degraded' : 'online';
      service.message = percentage > 90 ? '存储空间不足' : '存储正常';
      service.details = {
        used,
        total,
        percentage: Math.round(percentage * 100) / 100,
        recordsCount
      };
    } catch (error) {
      service.status = 'offline';
      service.message = error.message;
    }

    return service;
  }

  /**
   * 快速健康检查（仅检查关键服务）
   */
  static async quickCheck() {
    const services = [];

    services.push(await this.checkDeepSeekApi());
    services.push(await this.checkStorage());

    return { services };
  }
}

module.exports = { HealthCheckService };

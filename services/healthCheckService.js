/**
 * 健康检查服务 - F3: 服务状态监控
 * 功能：
 * - 检查 Gemini API 状态
 * - 检查本地 LLM 状态
 * - 检查 TTS 服务状态
 * - 检查存储状态
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

class HealthCheckService {
  /**
   * 检查所有服务健康状态
   * @returns {Promise<Object>} 包含 services 和 system 的健康状态对象
   */
  static async checkAll() {
    const services = [];

    // 并行检查所有服务（提高性能）
    const checks = [];

    // 1. Gemini API
    if (process.env.GEMINI_API_KEY) {
      checks.push(this.checkGemini());
    }

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

    // 系统信息
    const system = {
      uptime: process.uptime() * 1000,
      version: process.env.npm_package_version || '1.0.0',
      lastRestart: Date.now() - process.uptime() * 1000
    };

    return { services, system };
  }

  /**
   * 检查 Gemini API
   */
  static async checkGemini() {
    const service = {
      name: 'Gemini API',
      type: 'llm',
      status: 'unknown',
      lastCheck: Date.now(),
      details: {
        endpoint: process.env.GEMINI_BASE_URL,
        model: process.env.GEMINI_MODEL
      }
    };

    try {
      const startTime = Date.now();

      // 使用 models.get API 进行健康检查
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
      const url = `${process.env.GEMINI_BASE_URL}/models/${modelName}?key=${process.env.GEMINI_API_KEY}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      service.latency = Date.now() - startTime;

      if (response.ok) {
        service.status = 'online';
        service.message = 'API 正常';

        // 尝试解析响应
        const data = await response.json().catch(() => ({}));
        if (data.name) {
          service.details.modelInfo = data.name;
        }
      } else {
        service.status = 'degraded';
        service.message = `API 响应异常: ${response.status}`;
      }
    } catch (error) {
      service.status = 'offline';
      service.message = error.name === 'AbortError' ? '请求超时' : error.message;
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
              console.warn(`[Storage] Cannot access: ${filePath}`);
            }
          }
        } catch (err) {
          console.error(`[Storage] Cannot read directory: ${dir}`, err);
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
        console.error('[Storage] Cannot count records', err);
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

    // 只检查 Gemini 和存储
    if (process.env.GEMINI_API_KEY) {
      services.push(await this.checkGemini());
    }

    services.push(await this.checkStorage());

    return { services };
  }
}

module.exports = { HealthCheckService };

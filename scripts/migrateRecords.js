#!/usr/bin/env node
/**
 * 数据迁移脚本：将现有的trilingual_records文件导入数据库
 *
 * 使用方法:
 * node scripts/migrateRecords.js [--dry-run] [--limit=N]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const RECORDS_PATH = process.env.RECORDS_PATH || path.join(__dirname, '../trilingual_records');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/trilingual_records.db');

// 命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitMatch = args.find(arg => arg.startsWith('--limit='));
const limit = limitMatch ? parseInt(limitMatch.split('=')[1]) : null;

console.log('========================================');
console.log('📦 Trilingual Records Migration Tool');
console.log('========================================');
console.log(`数据源: ${RECORDS_PATH}`);
console.log(`数据库: ${DB_PATH}`);
console.log(`模式: ${dryRun ? '预览模式（不实际写入）' : '写入模式'}`);
if (limit) console.log(`限制: 仅迁移前 ${limit} 条记录`);
console.log('========================================\n');

// 检测短语语言
function detectLanguage(phrase) {
  if (!phrase) return 'unknown';
  if (/[\u4e00-\u9fa5]/.test(phrase)) return 'zh';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(phrase)) return 'ja';
  if (/^[a-zA-Z\s]+$/.test(phrase)) return 'en';
  return 'mixed';
}

// 从markdown提取翻译
function extractTranslation(markdownContent, language) {
  if (!markdownContent) return null;

  try {
    const patterns = {
      en: /## 1\. 英文:[\s\S]*?- \*\*翻译\*\*:\s*(.+?)(?:\n|$)/,
      ja: /## 2\. 日本語:[\s\S]*?- \*\*翻訳\*\*:\s*(.+?)(?:\n|$)/,
      zh: /## 3\. 中文:[\s\S]*?- \*\*翻译\*\*:\s*(.+?)(?:\n|$)/
    };

    const match = markdownContent.match(patterns[language]);
    if (match && match[1]) {
      let translation = match[1].trim();
      translation = translation.replace(/\([^)]+\)/g, ''); // 移除注音
      return translation;
    }
  } catch (error) {
    // Ignore parsing errors
  }

  return null;
}

// 从meta.json提取数据
function extractMetaData(metaPath) {
  try {
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaContent);
      return meta;
    }
  } catch (err) {
    // Meta file not found or invalid
  }
  return null;
}

// 扫描记录
function scanRecords() {
  const folders = fs.readdirSync(RECORDS_PATH)
    .filter(name => /^\d{8}$/.test(name)) // YYYYMMDD格式
    .sort()
    .reverse(); // 最新的在前

  const records = [];

  for (const folder of folders) {
    const folderPath = path.join(RECORDS_PATH, folder);
    const files = fs.readdirSync(folderPath);

    // 找出所有.md文件
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const mdFile of mdFiles) {
      const baseName = mdFile.replace(/\.md$/, '');
      const mdPath = path.join(folderPath, mdFile);
      const htmlPath = path.join(folderPath, `${baseName}.html`);
      const metaPath = path.join(folderPath, `${baseName}.meta.json`);

      // 读取markdown内容
      let markdownContent = '';
      try {
        markdownContent = fs.readFileSync(mdPath, 'utf8');
      } catch (err) {
        console.warn(`⚠️  无法读取 ${mdPath}`);
        continue;
      }

      // 提取短语（从markdown第一行）
      const firstLine = markdownContent.split('\n')[0];
      const phrase = firstLine.replace(/^#\s*/, '').trim();

      if (!phrase) {
        console.warn(`⚠️  无法提取短语: ${mdPath}`);
        continue;
      }

      // 检查HTML文件是否存在
      const htmlExists = fs.existsSync(htmlPath);

      // 提取meta数据
      const meta = extractMetaData(metaPath);

      records.push({
        phrase,
        phraseLanguage: detectLanguage(phrase),
        llmProvider: meta?.llm_provider || 'unknown',
        llmModel: meta?.llm_model || 'unknown',
        folderName: folder,
        baseFilename: baseName,
        mdFilePath: mdPath,
        htmlFilePath: htmlExists ? htmlPath : null,
        metaFilePath: fs.existsSync(metaPath) ? metaPath : null,
        markdownContent,
        enTranslation: extractTranslation(markdownContent, 'en'),
        jaTranslation: extractTranslation(markdownContent, 'ja'),
        zhTranslation: extractTranslation(markdownContent, 'zh'),
        generationDate: `${folder.slice(0, 4)}-${folder.slice(4, 6)}-${folder.slice(6, 8)}`,
        meta
      });

      if (limit && records.length >= limit) {
        console.log(`\n✋ 已达到限制 (${limit} 条)，停止扫描\n`);
        return records;
      }
    }
  }

  return records;
}

// 插入到数据库
function migrateToDatabase(records) {
  if (dryRun) {
    console.log('\n📋 预览模式：以下记录将被导入：\n');
    records.forEach((record, idx) => {
      console.log(`${idx + 1}. ${record.phrase} (${record.folderName})`);
      console.log(`   Provider: ${record.llmProvider}, Language: ${record.phraseLanguage}`);
      console.log(`   Files: ${record.htmlFilePath ? '✅' : '❌'} HTML, ${record.metaFilePath ? '✅' : '❌'} Meta`);
      console.log('');
    });
    console.log(`\n总计: ${records.length} 条记录\n`);
    console.log('💡 使用 `node scripts/migrateRecords.js` (不带 --dry-run) 来实际导入\n');
    return;
  }

  // 打开数据库
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 准备插入语句
  const insertGen = db.prepare(`
    INSERT INTO generations (
      phrase, phrase_language, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, en_translation, ja_translation, zh_translation,
      generation_date, created_at, request_id
    ) VALUES (
      @phrase, @phraseLanguage, @llmProvider, @llmModel,
      @folderName, @baseFilename, @mdFilePath, @htmlFilePath, @metaFilePath,
      @markdownContent, @enTranslation, @jaTranslation, @zhTranslation,
      @generationDate, @createdAt, @requestId
    )
  `);

  let successCount = 0;
  let errorCount = 0;

  console.log('\n🚀 开始导入...\n');

  const transaction = db.transaction((records) => {
    for (const record of records) {
      try {
        // 生成请求ID
        const requestId = `migration_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        // 解析创建时间（从文件夹名推导）
        const createdAt = `${record.generationDate} 12:00:00`;

        insertGen.run({
          phrase: record.phrase,
          phraseLanguage: record.phraseLanguage,
          llmProvider: record.llmProvider,
          llmModel: record.llmModel,
          folderName: record.folderName,
          baseFilename: record.baseFilename,
          mdFilePath: record.mdFilePath,
          htmlFilePath: record.htmlFilePath,
          metaFilePath: record.metaFilePath,
          markdownContent: record.markdownContent,
          enTranslation: record.enTranslation,
          jaTranslation: record.jaTranslation,
          zhTranslation: record.zhTranslation,
          generationDate: record.generationDate,
          createdAt: createdAt,
          requestId: requestId
        });

        successCount++;
        if (successCount % 10 === 0) {
          console.log(`✅ 已导入 ${successCount} 条...`);
        }
      } catch (err) {
        errorCount++;
        console.error(`❌ 导入失败: ${record.phrase} - ${err.message}`);
      }
    }
  });

  transaction(records);

  db.close();

  console.log('\n========================================');
  console.log('📊 迁移完成');
  console.log('========================================');
  console.log(`✅ 成功: ${successCount} 条`);
  console.log(`❌ 失败: ${errorCount} 条`);
  console.log(`📁 总计: ${records.length} 条`);
  console.log('========================================\n');
}

// 主流程
async function main() {
  // 检查路径
  if (!fs.existsSync(RECORDS_PATH)) {
    console.error(`❌ 错误: 记录目录不存在: ${RECORDS_PATH}`);
    process.exit(1);
  }

  if (!dryRun && !fs.existsSync(DB_PATH)) {
    console.error(`❌ 错误: 数据库文件不存在: ${DB_PATH}`);
    console.error(`💡 请先运行服务器以创建数据库: npm start`);
    process.exit(1);
  }

  // 扫描记录
  console.log('🔍 扫描现有记录...\n');
  const records = scanRecords();
  console.log(`\n📦 找到 ${records.length} 条记录\n`);

  if (records.length === 0) {
    console.log('❌ 没有找到任何记录');
    return;
  }

  // 迁移到数据库
  migrateToDatabase(records);
}

main().catch(err => {
  console.error('❌ 迁移失败:', err);
  process.exit(1);
});

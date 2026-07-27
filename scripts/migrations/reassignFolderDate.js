#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function replaceFolderReferences(value, { sourceFolder, targetFolder, sourceDir, targetDir }) {
  if (Array.isArray(value)) {
    return value.map((item) => replaceFolderReferences(item, {
      sourceFolder, targetFolder, sourceDir, targetDir,
    }));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      replaceFolderReferences(item, { sourceFolder, targetFolder, sourceDir, targetDir }),
    ]));
  }
  if (typeof value !== 'string') return value;
  if (value === sourceFolder) return targetFolder;
  if (value.startsWith(`${sourceDir}${path.sep}`)) {
    return `${targetDir}${value.slice(sourceDir.length)}`;
  }
  return value;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function validateOptions(options) {
  const sourceFolder = String(options.sourceFolder || '').trim();
  const targetFolder = String(options.targetFolder || '').trim();
  const logicalDate = String(options.logicalDate || '').trim();
  if (!/^[\w.-]+$/.test(sourceFolder) || !/^\d{8}$/.test(targetFolder)) {
    throw new Error('source must be a safe folder name and target must use YYYYMMDD');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logicalDate)) {
    throw new Error('date must use YYYY-MM-DD');
  }
  if (`${targetFolder.slice(0, 4)}-${targetFolder.slice(4, 6)}-${targetFolder.slice(6, 8)}` !== logicalDate) {
    throw new Error('target folder and logical date must identify the same day');
  }
  return { sourceFolder, targetFolder, logicalDate };
}

function inspectMigration(options) {
  const { sourceFolder, targetFolder, logicalDate } = validateOptions(options);
  const recordsPath = path.resolve(options.recordsPath);
  const dbPath = path.resolve(options.dbPath);
  const sourceDir = path.join(recordsPath, sourceFolder);
  const targetDir = path.join(recordsPath, targetFolder);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`source folder does not exist: ${sourceDir}`);
  }
  if (!fs.existsSync(dbPath)) throw new Error(`database does not exist: ${dbPath}`);

  const sourceEntries = fs.readdirSync(sourceDir);
  const targetEntries = fs.existsSync(targetDir) ? new Set(fs.readdirSync(targetDir)) : new Set();
  const collisions = sourceEntries.filter((name) => targetEntries.has(name));
  if (collisions.length) {
    throw new Error(`target contains ${collisions.length} conflicting file(s): ${collisions.slice(0, 3).join(', ')}`);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const generationCount = Number(db.prepare(
      'SELECT COUNT(*) AS count FROM generations WHERE lower(folder_name) = lower(?)'
    ).get(sourceFolder).count || 0);
    const jobCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_jobs
      WHERE lower(target_folder) = lower(?) OR lower(result_folder) = lower(?)
    `).get(sourceFolder, sourceFolder).count || 0);
    return {
      sourceFolder,
      targetFolder,
      logicalDate,
      recordsPath,
      dbPath,
      sourceDir,
      targetDir,
      sourceEntries,
      generationCount,
      jobCount,
    };
  } finally {
    db.close();
  }
}

function moveEntries(plan) {
  const targetExisted = fs.existsSync(plan.targetDir);
  fs.mkdirSync(plan.targetDir, { recursive: true });
  const moved = [];
  try {
    for (const name of plan.sourceEntries) {
      fs.renameSync(path.join(plan.sourceDir, name), path.join(plan.targetDir, name));
      moved.push(name);
    }
    fs.rmdirSync(plan.sourceDir);
    return { moved, targetExisted };
  } catch (error) {
    fs.mkdirSync(plan.sourceDir, { recursive: true });
    for (const name of moved.reverse()) {
      fs.renameSync(path.join(plan.targetDir, name), path.join(plan.sourceDir, name));
    }
    if (!targetExisted && fs.existsSync(plan.targetDir) && fs.readdirSync(plan.targetDir).length === 0) {
      fs.rmdirSync(plan.targetDir);
    }
    throw error;
  }
}

function rollbackEntries(plan, moveResult) {
  fs.mkdirSync(plan.sourceDir, { recursive: true });
  for (const name of moveResult.moved) {
    fs.renameSync(path.join(plan.targetDir, name), path.join(plan.sourceDir, name));
  }
  if (!moveResult.targetExisted && fs.readdirSync(plan.targetDir).length === 0) {
    fs.rmdirSync(plan.targetDir);
  }
}

function migrateDatabase(db, plan) {
  const jobs = db.prepare(`
    SELECT id, request_payload_json, result_summary_json, source_context_json
    FROM generation_jobs
    WHERE lower(target_folder) = lower(?) OR lower(result_folder) = lower(?)
  `).all(plan.sourceFolder, plan.sourceFolder);
  const updateJob = db.prepare(`
    UPDATE generation_jobs
    SET target_folder = CASE WHEN lower(target_folder) = lower(@sourceFolder) THEN @targetFolder ELSE target_folder END,
        result_folder = CASE WHEN lower(result_folder) = lower(@sourceFolder) THEN @targetFolder ELSE result_folder END,
        request_payload_json = @requestPayloadJson,
        result_summary_json = @resultSummaryJson,
        source_context_json = @sourceContextJson
    WHERE id = @id
  `);
  const replacement = {
    sourceFolder: plan.sourceFolder,
    targetFolder: plan.targetFolder,
    sourceDir: plan.sourceDir,
    targetDir: plan.targetDir,
  };

  const transaction = db.transaction(() => {
    const audioResult = db.prepare(`
      UPDATE audio_files
      SET file_path = replace(file_path, @sourceDir, @targetDir)
      WHERE generation_id IN (
        SELECT id FROM generations WHERE lower(folder_name) = lower(@sourceFolder)
      )
    `).run(plan);
    for (const job of jobs) {
      updateJob.run({
        id: job.id,
        sourceFolder: plan.sourceFolder,
        targetFolder: plan.targetFolder,
        requestPayloadJson: JSON.stringify(replaceFolderReferences(
          parseJson(job.request_payload_json, {}), replacement
        )),
        resultSummaryJson: job.result_summary_json
          ? JSON.stringify(replaceFolderReferences(parseJson(job.result_summary_json, {}), replacement))
          : null,
        sourceContextJson: JSON.stringify(replaceFolderReferences(
          parseJson(job.source_context_json, {}), replacement
        )),
      });
    }

    const generationResult = db.prepare(`
      UPDATE generations
      SET folder_name = @targetFolder,
          generation_date = @logicalDate,
          md_file_path = replace(md_file_path, @sourceDir, @targetDir),
          html_file_path = replace(html_file_path, @sourceDir, @targetDir),
          meta_file_path = CASE
            WHEN meta_file_path IS NULL THEN NULL
            ELSE replace(meta_file_path, @sourceDir, @targetDir)
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE lower(folder_name) = lower(@sourceFolder)
    `).run(plan);

    return {
      generations: Number(generationResult.changes || 0),
      audioFiles: Number(audioResult.changes || 0),
      jobs: jobs.length,
    };
  });
  return transaction.immediate();
}

async function runMigration(options) {
  const plan = inspectMigration(options);
  if (!options.apply) return { applied: false, plan };

  const backupDir = path.join(plan.recordsPath, '.migration-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${path.basename(plan.dbPath)}.before-${plan.sourceFolder}-to-${plan.targetFolder}-${Date.now()}.bak`
  );
  const db = new Database(plan.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  let moveResult;
  try {
    if (options.createBackup !== false) await db.backup(backupPath);
    moveResult = moveEntries(plan);
    const updated = migrateDatabase(db, plan);
    return {
      applied: true,
      plan,
      updated,
      movedFiles: moveResult.moved.length,
      backupPath: options.createBackup === false ? null : backupPath,
    };
  } catch (error) {
    if (moveResult) rollbackEntries(plan, moveResult);
    throw error;
  } finally {
    db.close();
  }
}

function readArg(name) {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : '';
}

async function main() {
  const options = {
    sourceFolder: readArg('source'),
    targetFolder: readArg('target'),
    logicalDate: readArg('date'),
    recordsPath: process.env.RECORDS_PATH || path.join(__dirname, '../../trilingual_records'),
    dbPath: process.env.DB_PATH || path.join(__dirname, '../../data/trilingual_records.db'),
    apply: process.argv.includes('--apply'),
  };
  const result = await runMigration(options);
  const summary = result.applied
    ? {
        applied: true,
        movedFiles: result.movedFiles,
        updated: result.updated,
        backupPath: result.backupPath,
      }
    : {
        applied: false,
        sourceFiles: result.plan.sourceEntries.length,
        generations: result.plan.generationCount,
        jobs: result.plan.jobCount,
      };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  inspectMigration,
  replaceFolderReferences,
  runMigration,
};

'use strict';

// knowledge_synonym_* domain extracted from databaseService.js. Owns:
//   - knowledge_synonym_candidates (saveCandidates: upsert by (job_id, pair_key))
//   - knowledge_synonym_groups + knowledge_synonym_members (replaceData:
//       transactional deactivate-then-UPSERT on (pair_key, schema_version,
//       evidence_hash) with member rebuild)
//   - read paths: findByPhrase, listBoundaries (paginated), getBoundaryDetail
//
// Also exports the three lookup-key helpers because they only matter inside
// this domain (group_key/pair_key normalization + the `id:N` fallback for
// detail lookups).

const crypto = require('crypto');
const { safeJsonParse } = require('./helpers');

function normalizeLookupKey(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeDisplayKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  const lower = key.toLowerCase();
  if (lower === '...' || lower === 'null' || lower === 'undefined' || lower === 'n/a' || lower === 'na') {
    return '';
  }
  return key;
}

function buildDetailKey(row = {}) {
  const pairKey = sanitizeDisplayKey(row.pair_key);
  if (pairKey) return pairKey;
  const groupKey = sanitizeDisplayKey(row.group_key);
  if (groupKey) return groupKey;
  const rowId = Number(row.id || 0);
  if (rowId > 0) return `id:${rowId}`;
  return '';
}

function saveCandidates(db, jobId, candidates = []) {
  const normalizedJobId = Number(jobId);
  if (!normalizedJobId) return 0;
  const rows = Array.isArray(candidates) ? candidates : [];
  const transaction = db.transaction((payload) => {
    db.prepare(`DELETE FROM knowledge_synonym_candidates WHERE job_id = ?`).run(normalizedJobId);
    const stmt = db.prepare(`
      INSERT INTO knowledge_synonym_candidates (
        job_id, pair_key, term_a, term_b, candidate_score,
        evidence_hash, evidence_snapshot_json, status, llm_latency_ms, llm_error, updated_at
      ) VALUES (
        @jobId, @pairKey, @termA, @termB, @candidateScore,
        @evidenceHash, @evidenceSnapshotJson, @status, @llmLatencyMs, @llmError, CURRENT_TIMESTAMP
      )
      ON CONFLICT(job_id, pair_key) DO UPDATE SET
        term_a = excluded.term_a,
        term_b = excluded.term_b,
        candidate_score = excluded.candidate_score,
        evidence_hash = excluded.evidence_hash,
        evidence_snapshot_json = excluded.evidence_snapshot_json,
        status = excluded.status,
        llm_latency_ms = excluded.llm_latency_ms,
        llm_error = excluded.llm_error,
        updated_at = CURRENT_TIMESTAMP
    `);
    let count = 0;
    payload.forEach((item) => {
      stmt.run({
        jobId: normalizedJobId,
        pairKey: String(item.pairKey || ''),
        termA: String(item.termA || ''),
        termB: String(item.termB || ''),
        candidateScore: Number(item.candidateScore || 0),
        evidenceHash: item.evidenceHash ? String(item.evidenceHash) : null,
        evidenceSnapshotJson: JSON.stringify(item.evidenceSnapshot || {}),
        status: String(item.status || 'queued'),
        llmLatencyMs: Math.max(0, Number(item.llmLatencyMs || 0)),
        llmError: item.llmError ? String(item.llmError) : null
      });
      count += 1;
    });
    return count;
  });
  return transaction(rows);
}

function replaceData(db, groups = [], jobId, options = {}) {
  const transaction = db.transaction((payload, versionJobId, extraOptions) => {
    db.prepare(`UPDATE knowledge_synonym_groups SET is_active = 0 WHERE is_active = 1`).run();

    const insertGroup = db.prepare(`
      INSERT INTO knowledge_synonym_groups (
        group_key, pair_key, term_a, term_b, tone, register_text, collocation_note,
        misuse_risk, risk_level, recommendation, actionable_hint,
        confidence, coverage_ratio, model, prompt_version, schema_version,
        evidence_hash, result_json, context_split_json, misuse_risks_json, jp_nuance_json,
        boundary_tags_a_json, boundary_tags_b_json, parse_status, version_job_id, is_active
      ) VALUES (
        @groupKey, @pairKey, @termA, @termB, @tone, @registerText, @collocationNote,
        @misuseRisk, @riskLevel, @recommendation, @actionableHint,
        @confidence, @coverageRatio, @model, @promptVersion, @schemaVersion,
        @evidenceHash, @resultJson, @contextSplitJson, @misuseRisksJson, @jpNuanceJson,
        @boundaryTagsAJson, @boundaryTagsBJson, @parseStatus, @versionJobId, 1
      )
      ON CONFLICT(pair_key, schema_version, evidence_hash) DO UPDATE SET
        group_key = excluded.group_key,
        term_a = excluded.term_a,
        term_b = excluded.term_b,
        tone = excluded.tone,
        register_text = excluded.register_text,
        collocation_note = excluded.collocation_note,
        misuse_risk = excluded.misuse_risk,
        risk_level = excluded.risk_level,
        recommendation = excluded.recommendation,
        actionable_hint = excluded.actionable_hint,
        confidence = excluded.confidence,
        coverage_ratio = excluded.coverage_ratio,
        model = excluded.model,
        prompt_version = excluded.prompt_version,
        schema_version = excluded.schema_version,
        result_json = excluded.result_json,
        context_split_json = excluded.context_split_json,
        misuse_risks_json = excluded.misuse_risks_json,
        jp_nuance_json = excluded.jp_nuance_json,
        boundary_tags_a_json = excluded.boundary_tags_a_json,
        boundary_tags_b_json = excluded.boundary_tags_b_json,
        parse_status = excluded.parse_status,
        version_job_id = excluded.version_job_id,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `);
    const selectGroupId = db.prepare(`
      SELECT id
      FROM knowledge_synonym_groups
      WHERE pair_key = @pairKey
        AND schema_version = @schemaVersion
        AND evidence_hash = @evidenceHash
      LIMIT 1
    `);
    const insertMember = db.prepare(`
      INSERT INTO knowledge_synonym_members (
        group_id, generation_id, term, lang
      ) VALUES (
        @groupId, @generationId, @term, @lang
      )
    `);
    const deleteMembers = db.prepare(`DELETE FROM knowledge_synonym_members WHERE group_id = ?`);

    let count = 0;
    for (const group of payload) {
      const pairKey = String(
        group.pairKey
        || group.groupKey
        || `${group.termA || ''}||${group.termB || ''}`
      ).trim().toLowerCase();
      const schemaVersion = String(group.schemaVersion || extraOptions.schemaVersion || '1.0.0');
      const evidenceHash = String(
        group.evidenceHash
        || crypto.createHash('sha1').update(`${pairKey}|${schemaVersion}|${versionJobId}`).digest('hex')
      );
      insertGroup.run({
        groupKey: String(group.groupKey || pairKey),
        pairKey,
        termA: group.termA ? String(group.termA) : null,
        termB: group.termB ? String(group.termB) : null,
        tone: group.boundaryMatrix?.tone || null,
        registerText: group.boundaryMatrix?.register || null,
        collocationNote: group.boundaryMatrix?.collocation || null,
        misuseRisk: group.misuseRisk || 'medium',
        riskLevel: group.riskLevel || group.misuseRisk || 'medium',
        recommendation: group.recommendation || '',
        actionableHint: group.actionableHint || null,
        confidence: Number(group.confidence || 0),
        coverageRatio: Number(group.coverageRatio || 0),
        model: group.model || extraOptions.model || null,
        promptVersion: group.promptVersion || extraOptions.promptVersion || null,
        schemaVersion,
        evidenceHash,
        resultJson: JSON.stringify(group.resultJson || group.result || {}),
        contextSplitJson: JSON.stringify(group.contextSplit || []),
        misuseRisksJson: JSON.stringify(group.misuseRisks || []),
        jpNuanceJson: JSON.stringify(group.jpNuance || {}),
        boundaryTagsAJson: JSON.stringify(group.boundaryTagsA || []),
        boundaryTagsBJson: JSON.stringify(group.boundaryTagsB || []),
        parseStatus: String(group.parseStatus || 'ok'),
        versionJobId: Number(versionJobId)
      });
      const row = selectGroupId.get({ pairKey, schemaVersion, evidenceHash });
      const groupId = row ? Number(row.id) : 0;
      if (!groupId) continue;
      deleteMembers.run(groupId);
      const members = Array.isArray(group.members) ? group.members : [];
      for (const member of members) {
        insertMember.run({
          groupId,
          generationId: member.generationId ? Number(member.generationId) : null,
          term: String(member.term || ''),
          lang: String(member.lang || 'zh')
        });
      }
      count += 1;
    }
    return count;
  });

  return transaction(Array.isArray(groups) ? groups : [], Number(jobId), options || {});
}

function findByPhrase(db, phrase, limit = 20) {
  const keyword = `%${String(phrase || '').trim()}%`;
  const groups = db.prepare(`
    SELECT DISTINCT g.*
    FROM knowledge_synonym_groups g
    LEFT JOIN knowledge_synonym_members m ON m.group_id = g.id
    WHERE g.is_active = 1
      AND (
        g.group_key LIKE @keyword
        OR g.pair_key LIKE @keyword
        OR g.term_a LIKE @keyword
        OR g.term_b LIKE @keyword
        OR m.term LIKE @keyword
      )
    ORDER BY g.updated_at DESC
    LIMIT @limit
  `).all({ keyword, limit: Math.max(1, Number(limit || 20)) });

  const membersByGroup = db.prepare(`
    SELECT group_id, generation_id, term, lang
    FROM knowledge_synonym_members
    WHERE group_id IN (
      SELECT id FROM knowledge_synonym_groups WHERE is_active = 1
    )
    ORDER BY id ASC
  `).all();

  const groupedMembers = new Map();
  membersByGroup.forEach((row) => {
    if (!groupedMembers.has(row.group_id)) groupedMembers.set(row.group_id, []);
    groupedMembers.get(row.group_id).push({
      generationId: row.generation_id,
      term: row.term,
      lang: row.lang
    });
  });

  return groups.map((group) => ({
    id: group.id,
    groupKey: group.group_key,
    pairKey: buildDetailKey(group),
    termA: group.term_a || null,
    termB: group.term_b || null,
    boundaryMatrix: {
      tone: group.tone,
      register: group.register_text,
      collocation: group.collocation_note
    },
    misuseRisk: group.misuse_risk,
    riskLevel: group.risk_level || group.misuse_risk || 'medium',
    recommendation: group.recommendation,
    actionableHint: group.actionable_hint || null,
    confidence: group.confidence,
    coverageRatio: group.coverage_ratio,
    model: group.model || null,
    promptVersion: group.prompt_version || null,
    schemaVersion: group.schema_version || null,
    parseStatus: group.parse_status || 'ok',
    contextSplit: safeJsonParse(group.context_split_json, []),
    misuseRisks: safeJsonParse(group.misuse_risks_json, []),
    jpNuance: safeJsonParse(group.jp_nuance_json, {}),
    boundaryTagsA: safeJsonParse(group.boundary_tags_a_json, []),
    boundaryTagsB: safeJsonParse(group.boundary_tags_b_json, []),
    members: groupedMembers.get(group.id) || [],
    updatedAt: group.updated_at
  }));
}

function listBoundaries(db, { jobId, riskLevel, query = '', page = 1, pageSize = 20 } = {}) {
  const normalizedPage = Math.max(1, Number(page || 1));
  const normalizedPageSize = Math.max(1, Math.min(200, Number(pageSize || 20)));
  const conditions = ['1=1'];
  const params = {
    limit: normalizedPageSize,
    offset: (normalizedPage - 1) * normalizedPageSize
  };

  if (jobId) {
    conditions.push('g.version_job_id = @jobId');
    params.jobId = Number(jobId);
  } else {
    conditions.push('g.is_active = 1');
  }
  if (riskLevel) {
    conditions.push('COALESCE(g.risk_level, g.misuse_risk, \'medium\') = @riskLevel');
    params.riskLevel = String(riskLevel);
  }
  if (String(query || '').trim()) {
    conditions.push('(g.pair_key LIKE @q OR g.term_a LIKE @q OR g.term_b LIKE @q OR g.group_key LIKE @q)');
    params.q = `%${String(query).trim()}%`;
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM knowledge_synonym_groups g
    WHERE ${conditions.join(' AND ')}
  `).get(params);

  const rows = db.prepare(`
    SELECT g.*
    FROM knowledge_synonym_groups g
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE COALESCE(g.risk_level, g.misuse_risk, 'low')
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        ELSE 1
      END DESC,
      g.confidence DESC,
      g.updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params);

  return {
    total: Number(totalRow?.total || 0),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    items: rows.map((row) => ({
      pairKey: buildDetailKey(row),
      groupKey: row.group_key,
      termA: row.term_a || null,
      termB: row.term_b || null,
      riskLevel: row.risk_level || row.misuse_risk || 'medium',
      confidence: Number(row.confidence || 0),
      recommendation: row.recommendation || '',
      actionableHint: row.actionable_hint || '',
      model: row.model || null,
      promptVersion: row.prompt_version || null,
      schemaVersion: row.schema_version || null,
      parseStatus: row.parse_status || 'ok',
      updatedAt: row.updated_at,
      versionJobId: Number(row.version_job_id || 0)
    }))
  };
}

function getBoundaryDetail(db, { pairKey, jobId } = {}) {
  const rawKey = String(pairKey || '').trim();
  if (!rawKey) return null;

  const idMatch = rawKey.match(/^id:(\d+)$/i);
  const normalizedKey = normalizeLookupKey(rawKey);
  const baseParams = { pairKey: normalizedKey };
  let row = null;

  if (idMatch) {
    const id = Number(idMatch[1]);
    row = db.prepare(jobId
      ? `
        SELECT *
        FROM knowledge_synonym_groups
        WHERE id = @id
          AND version_job_id = @jobId
        LIMIT 1
      `
      : `
        SELECT *
        FROM knowledge_synonym_groups
        WHERE id = @id
          AND is_active = 1
        LIMIT 1
      `).get(jobId ? { id, jobId: Number(jobId) } : { id });
  } else {
    row = db.prepare(jobId
      ? `
        SELECT *
        FROM knowledge_synonym_groups
        WHERE (
          LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
          OR LOWER(TRIM(COALESCE(group_key, ''))) = @pairKey
        )
          AND version_job_id = @jobId
        ORDER BY updated_at DESC
        LIMIT 1
      `
      : `
        SELECT *
        FROM knowledge_synonym_groups
        WHERE (
          LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
          OR LOWER(TRIM(COALESCE(group_key, ''))) = @pairKey
        )
          AND is_active = 1
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(jobId ? { ...baseParams, jobId: Number(jobId) } : baseParams);
  }

  if (!row) return null;
  const members = db.prepare(`
    SELECT generation_id, term, lang
    FROM knowledge_synonym_members
    WHERE group_id = ?
    ORDER BY id ASC
  `).all(row.id).map((item) => ({
    generationId: item.generation_id ? Number(item.generation_id) : null,
    term: item.term || '',
    lang: item.lang || ''
  }));

  const candidateKey = normalizeLookupKey(
    sanitizeDisplayKey(row.pair_key)
    || sanitizeDisplayKey(row.group_key)
    || rawKey
  );
  const candidates = db.prepare(`
    SELECT candidate_score, evidence_hash, evidence_snapshot_json, status, llm_latency_ms, llm_error, updated_at
    FROM knowledge_synonym_candidates
    WHERE LOWER(TRIM(COALESCE(pair_key, ''))) = @pairKey
    ORDER BY updated_at DESC
    LIMIT 1
  `).get({ pairKey: candidateKey });

  return {
    id: Number(row.id),
    pairKey: buildDetailKey(row),
    groupKey: row.group_key || '',
    termA: row.term_a || null,
    termB: row.term_b || null,
    boundaryMatrix: {
      tone: row.tone || '',
      register: row.register_text || '',
      collocation: row.collocation_note || ''
    },
    misuseRisk: row.misuse_risk || 'medium',
    riskLevel: row.risk_level || row.misuse_risk || 'medium',
    recommendation: row.recommendation || '',
    actionableHint: row.actionable_hint || '',
    confidence: Number(row.confidence || 0),
    coverageRatio: Number(row.coverage_ratio || 0),
    model: row.model || null,
    promptVersion: row.prompt_version || null,
    schemaVersion: row.schema_version || null,
    parseStatus: row.parse_status || 'ok',
    result: safeJsonParse(row.result_json, {}),
    contextSplit: safeJsonParse(row.context_split_json, []),
    misuseRisks: safeJsonParse(row.misuse_risks_json, []),
    jpNuance: safeJsonParse(row.jp_nuance_json, {}),
    boundaryTagsA: safeJsonParse(row.boundary_tags_a_json, []),
    boundaryTagsB: safeJsonParse(row.boundary_tags_b_json, []),
    members,
    candidate: candidates ? {
      candidateScore: Number(candidates.candidate_score || 0),
      evidenceHash: candidates.evidence_hash || null,
      evidenceSnapshot: safeJsonParse(candidates.evidence_snapshot_json, {}),
      status: candidates.status || 'queued',
      llmLatencyMs: Number(candidates.llm_latency_ms || 0),
      llmError: candidates.llm_error || null,
      updatedAt: candidates.updated_at || null
    } : null,
    updatedAt: row.updated_at
  };
}

module.exports = {
  saveCandidates,
  replaceData,
  findByPhrase,
  listBoundaries,
  getBoundaryDetail,
  // Exposed because relations/overview code in databaseService still needs
  // these key helpers. Once Slice F lands they may become module-private.
  normalizeLookupKey,
  sanitizeDisplayKey,
  buildDetailKey,
};

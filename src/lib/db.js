import sql, { migrationRunner } from '@forge/sql';
import crypto from 'crypto';

/**
 * Define the schema migrations using Forge SQL's migrationRunner.
 * Since standard database connections do not have DDL privileges (like CREATE TABLE)
 * at runtime, schema definitions must be enqueued and executed using the migration runner.
 */
const migrations = migrationRunner
  .enqueue('v001_create_audit_logs_table', `
    CREATE TABLE IF NOT EXISTS audit_logs (
      event_id VARCHAR(255) PRIMARY KEY,
      ts BIGINT,
      product VARCHAR(50),
      event_type VARCHAR(100),
      regulated_user_id VARCHAR(255),
      actor_id VARCHAR(255),
      object_type VARCHAR(100),
      object_id VARCHAR(255),
      container_id VARCHAR(255),
      detail TEXT
    )
  `)
  .enqueue('v002_create_processed_events_table', `
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id VARCHAR(255) PRIMARY KEY,
      processed_at BIGINT
    )
  `)
  .enqueue('v003_create_regulated_user_history', `
    CREATE TABLE IF NOT EXISTS regulated_user_history (
      account_id VARCHAR(255) NOT NULL,
      regulated_from BIGINT NOT NULL,
      regulated_to BIGINT,
      source VARCHAR(100) NOT NULL,
      PRIMARY KEY (account_id, regulated_from)
    )
  `)
  .enqueue('v004_add_is_regulated_column', `
    ALTER TABLE audit_logs ADD COLUMN is_regulated INT DEFAULT 1
  `)
  .enqueue('v005_add_hash_chain_fields', `
    ALTER TABLE audit_logs ADD COLUMN chain_hash VARCHAR(64), ADD COLUMN previous_event_id VARCHAR(255)
  `)
  .enqueue('v006_create_daily_digests_table', `
    CREATE TABLE IF NOT EXISTS daily_digests (
      date_str VARCHAR(50) PRIMARY KEY,
      hash_chain_head VARCHAR(64) NOT NULL,
      anchored_at BIGINT NOT NULL,
      verification_status VARCHAR(50) NOT NULL
    )
  `)
  .enqueue('v007_create_compliance_reviews_table', `
    CREATE TABLE IF NOT EXISTS compliance_reviews (
      review_id VARCHAR(255) PRIMARY KEY,
      event_id VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL,
      reviewer_id VARCHAR(255) NOT NULL,
      review_ts BIGINT NOT NULL,
      notes TEXT,
      chain_hash VARCHAR(64) NOT NULL
    )
  `)
  .enqueue('v008_create_risk_scores_table', `
    CREATE TABLE IF NOT EXISTS risk_scores (
      score_id VARCHAR(255) PRIMARY KEY,
      event_id VARCHAR(255) NOT NULL,
      score INT NOT NULL,
      reasons TEXT,
      engine_version VARCHAR(50) NOT NULL,
      ruleset_or_model_version VARCHAR(50) NOT NULL,
      scored_at BIGINT NOT NULL,
      chain_hash VARCHAR(64) NOT NULL
    )
  `)
  .enqueue('v009_add_lexicon_columns_to_audit_logs', `
    ALTER TABLE audit_logs ADD COLUMN lexicon_score INT DEFAULT 0, ADD COLUMN lexicon_flag VARCHAR(255)
  `)
  .enqueue('v010_add_identity_snapshot_columns', `
    ALTER TABLE audit_logs
      ADD COLUMN regulated_user_name VARCHAR(255),
      ADD COLUMN regulated_user_email VARCHAR(255),
      ADD COLUMN regulated_user_crd VARCHAR(20),
      ADD COLUMN actor_name VARCHAR(255),
      ADD COLUMN actor_email VARCHAR(255)
  `);

/**
 * Initializes the database tables if they do not exist.
 * This runs lazily before executing queries.
 */
let dbInitialized = false;

export async function initDatabase() {
  if (dbInitialized) return;

  try {
    // Run enqueued schema migrations using the Forge SQL migration runner
    await migrations.run();
    dbInitialized = true;
    console.log('Database initialized and migrations applied successfully.');
  } catch (error) {
    console.error('Failed to initialize database migrations:', error);
    throw error;
  }
}

/**
 * Compliance-grade deterministic object stringifier.
 * Sorts object keys to guarantee identical serialized strings.
 */
export function canonicalizeRecord(record) {
  const keys = Object.keys(record).sort();
  const parts = [];
  for (const key of keys) {
    if (key !== 'chain_hash') {
      const val = record[key];
      parts.push(`${key}:${val === null || val === undefined ? '' : val}`);
    }
  }
  return parts.join('|');
}

/**
 * Calculates a SHA-256 hash.
 */
export function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Checks if an event is a duplicate using the processed_events table.
 * If not a duplicate, inserts it into processed_events to prevent future duplication.
 * @param {string} eventId 
 * @returns {Promise<boolean>} True if duplicate, false if new.
 */
export async function isDuplicateEvent(eventId) {
  await initDatabase();
  if (!eventId) return false;

  try {
    // Check if the event already exists
    const checkResult = await sql
      .prepare(`SELECT event_id FROM processed_events WHERE event_id = ?`)
      .bindParams(eventId)
      .execute();

    if (checkResult.rows && checkResult.rows.length > 0) {
      console.log(`Event ${eventId} has already been processed (duplicate detected).`);
      return true;
    }

    // Mark as processed (atomically if possible, though MySQL PRIMARY KEY constraint will enforce uniqueness)
    await sql
      .prepare(`INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?)`)
      .bindParams(eventId, Date.now())
      .execute();

    return false;
  } catch (error) {
    // If we hit a duplicate key error during insert, it means another trigger handled it concurrently.
    if (error.message && (error.message.includes('Duplicate entry') || error.message.includes('1062'))) {
      console.log(`Concurrent duplicate event ${eventId} blocked by primary key.`);
      return true;
    }
    console.error(`Error checking duplicate event for ${eventId}:`, error);
    // In case of database error, fail-safe to let processing continue or return false depending on tolerance.
    // For FINRA compliance, we prefer log duplication over missed logs, so we return false.
    return false;
  }
}

/**
 * Inserts a new audit log record into the database, computing the non-repudiable hash chain.
 * Gated against modifications by compliance rules.
 * @param {object} log 
 */
export async function insertAuditLog({
  eventId,
  ts,
  product,
  eventType,
  regulatedUserId,
  regulatedUserName = '',
  regulatedUserEmail = '',
  regulatedUserCrd = '',
  actorId,
  actorName = '',
  actorEmail = '',
  objectType,
  objectId,
  containerId,
  detail,
  isRegulated = 1,
  lexiconScore = 0,
  lexiconFlag = null
}) {
  await initDatabase();

  const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail || {});

  try {
    // Fetch last event to link the chain
    const lastEventResult = await sql
      .prepare(`SELECT event_id, chain_hash FROM audit_logs ORDER BY ts DESC, event_id DESC LIMIT 1`)
      .execute();
    
    const lastEvent = lastEventResult.rows && lastEventResult.rows[0];
    const previousEventId = lastEvent ? lastEvent.event_id : 'GENESIS';
    const prevHash = lastEvent ? (lastEvent.chain_hash || '0'.repeat(64)) : '0'.repeat(64);

    const recordPayload = {
      event_id: eventId,
      ts: ts || Date.now(),
      product,
      event_type: eventType,
      regulated_user_id: regulatedUserId,
      regulated_user_name: regulatedUserName || '',
      regulated_user_email: regulatedUserEmail || '',
      regulated_user_crd: regulatedUserCrd || '',
      actor_id: actorId,
      actor_name: actorName || '',
      actor_email: actorEmail || '',
      object_type: objectType,
      object_id: objectId,
      container_id: containerId,
      detail: detailStr,
      is_regulated: isRegulated ? 1 : 0,
      previous_event_id: previousEventId,
      lexicon_score: Number(lexiconScore),
      lexicon_flag: lexiconFlag || ''
    };

    const canonicalStr = canonicalizeRecord(recordPayload);
    const chainHash = computeHash(canonicalStr + prevHash);

    await sql
      .prepare(`
        INSERT INTO audit_logs (
          event_id, ts, product, event_type, regulated_user_id, regulated_user_name, regulated_user_email, regulated_user_crd, actor_id, actor_name, actor_email, object_type, object_id, container_id, detail, is_regulated, chain_hash, previous_event_id, lexicon_score, lexicon_flag
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bindParams(
        eventId,
        recordPayload.ts,
        product,
        eventType,
        regulatedUserId,
        recordPayload.regulated_user_name,
        recordPayload.regulated_user_email,
        recordPayload.regulated_user_crd,
        actorId,
        recordPayload.actor_name,
        recordPayload.actor_email,
        objectType,
        objectId,
        containerId,
        detailStr,
        recordPayload.is_regulated,
        chainHash,
        previousEventId,
        recordPayload.lexicon_score,
        recordPayload.lexicon_flag
      )
      .execute();
    console.log(`Audit log inserted for event: ${eventId} (is_regulated: ${isRegulated}, lexicon_score: ${lexiconScore}, chain_hash: ${chainHash})`);
  } catch (error) {
    if (error.message && (error.message.includes('Duplicate entry') || error.message.includes('1062'))) {
      console.log(`Audit log row for event ${eventId} already exists (duplicate insert ignored).`);
      return;
    }
    console.error(`Failed to insert audit log for event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Walks the audit hash chain from genesis to recompute and verify all records.
 * Detects any insertion, deletion, or modification of records.
 * @returns {Promise<object>} Verification report
 */
export async function verifyAuditChain() {
  await initDatabase();

  try {
    const result = await sql
      .prepare(`SELECT * FROM audit_logs ORDER BY ts ASC, event_id ASC`)
      .execute();

    const logs = result.rows || [];
    let prevHash = '0'.repeat(64);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      
      const recordPayload = {
        event_id: log.event_id,
        ts: Number(log.ts),
        product: log.product,
        event_type: log.event_type,
        regulated_user_id: log.regulated_user_id,
        regulated_user_name: log.regulated_user_name || '',
        regulated_user_email: log.regulated_user_email || '',
        regulated_user_crd: log.regulated_user_crd || '',
        actor_id: log.actor_id,
        actor_name: log.actor_name || '',
        actor_email: log.actor_email || '',
        object_type: log.object_type,
        object_id: log.object_id,
        container_id: log.container_id,
        detail: log.detail,
        is_regulated: Number(log.is_regulated),
        previous_event_id: log.previous_event_id || 'GENESIS',
        lexicon_score: log.lexicon_score !== null && log.lexicon_score !== undefined ? Number(log.lexicon_score) : 0,
        lexicon_flag: log.lexicon_flag || ''
      };

      const canonicalStr = canonicalizeRecord(recordPayload);
      const computedHash = computeHash(canonicalStr + prevHash);

      if (log.chain_hash !== computedHash) {
        console.error(`Tamper detected at event: ${log.event_id}. Stored hash: ${log.chain_hash}, computed: ${computedHash}`);
        return { verified: false, errorAt: log.event_id };
      }

      prevHash = log.chain_hash;
    }

    return { verified: true, count: logs.length, headHash: prevHash };
  } catch (error) {
    console.error('Error verifying audit chain:', error);
    return { verified: false, error: error.message };
  }
}

export async function getAuditLogs(startTs, endTs) {
  await initDatabase();

  try {
    let query = `
      SELECT a.*, 
             r.status AS review_status, r.reviewer_id, r.review_ts, r.notes, r.chain_hash AS review_hash,
             s.score AS deep_score, s.reasons AS deep_reasons, s.engine_version, s.ruleset_or_model_version, s.scored_at AS deep_scored_at, s.chain_hash AS score_hash
      FROM audit_logs a
      LEFT JOIN (
        SELECT r1.* FROM compliance_reviews r1
        INNER JOIN (
          SELECT event_id, MAX(review_ts) as max_ts FROM compliance_reviews GROUP BY event_id
        ) r2 ON r1.event_id = r2.event_id AND r1.review_ts = r2.max_ts
      ) r ON a.event_id = r.event_id
      LEFT JOIN (
        SELECT s1.* FROM risk_scores s1
        INNER JOIN (
          SELECT event_id, MAX(scored_at) as max_sat FROM risk_scores GROUP BY event_id
        ) s2 ON s1.event_id = s2.event_id AND s1.scored_at = s2.max_sat
      ) s ON a.event_id = s.event_id
    `;
    const params = [];

    if (startTs && endTs) {
      query += ` WHERE a.ts >= ? AND a.ts <= ?`;
      params.push(startTs, endTs);
    } else if (startTs) {
      query += ` WHERE a.ts >= ?`;
      params.push(startTs);
    } else if (endTs) {
      query += ` WHERE a.ts <= ?`;
      params.push(endTs);
    }

    query += ` ORDER BY a.ts DESC LIMIT 1000`;

    const statement = sql.prepare(query);
    if (params.length > 0) {
      statement.bindParams(...params);
    }

    const result = await statement.execute();
    return result.rows || [];
  } catch (error) {
    console.error('Failed to retrieve audit logs:', error);
    throw error;
  }
}

/**
 * Inserts an append-only compliance review record, maintaining a separate cryptographic chain.
 * @param {object} review 
 * @returns {Promise<object>} Status report
 */
export async function insertComplianceReview({
  eventId,
  status,
  reviewerId,
  notes
}) {
  await initDatabase();
  const reviewId = `rev_${eventId}_${Date.now()}`;
  const reviewTs = Date.now();

  try {
    // Fetch last review to link the chain
    const lastReviewResult = await sql
      .prepare(`SELECT review_id, chain_hash FROM compliance_reviews ORDER BY review_ts DESC, review_id DESC LIMIT 1`)
      .execute();

    const lastReview = lastReviewResult.rows && lastReviewResult.rows[0];
    const prevHash = lastReview ? (lastReview.chain_hash || '0'.repeat(64)) : '0'.repeat(64);

    const recordPayload = {
      review_id: reviewId,
      event_id: eventId,
      status,
      reviewer_id: reviewerId,
      review_ts: reviewTs,
      notes: notes || ''
    };

    const canonicalStr = canonicalizeRecord(recordPayload);
    const chainHash = computeHash(canonicalStr + prevHash);

    await sql
      .prepare(`
        INSERT INTO compliance_reviews (review_id, event_id, status, reviewer_id, review_ts, notes, chain_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bindParams(
        reviewId,
        eventId,
        status,
        reviewerId,
        reviewTs,
        recordPayload.notes,
        chainHash
      )
      .execute();
    console.log(`Compliance review logged: ${reviewId} (status: ${status}, chain_hash: ${chainHash})`);
    return { success: true, reviewId, chainHash };
  } catch (error) {
    console.error(`Failed to insert compliance review for event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Inserts a new risk score audit record, linked by its own hash chain.
 * @param {object} params
 * @returns {Promise<object>} Status report
 */
export async function insertRiskScore({
  eventId,
  score,
  reasons,
  engineVersion,
  rulesetOrModelVersion,
  scoredAt
}) {
  await initDatabase();
  const scoreId = `score_${eventId}_${Date.now()}`;
  const reasonsStr = Array.isArray(reasons) ? JSON.stringify(reasons) : (reasons || '');

  try {
    // Fetch last risk score to link the chain
    const lastScoreResult = await sql
      .prepare(`SELECT score_id, chain_hash FROM risk_scores ORDER BY scored_at DESC, score_id DESC LIMIT 1`)
      .execute();

    const lastScore = lastScoreResult.rows && lastScoreResult.rows[0];
    const prevHash = lastScore ? (lastScore.chain_hash || '0'.repeat(64)) : '0'.repeat(64);

    const recordPayload = {
      score_id: scoreId,
      event_id: eventId,
      score: Number(score),
      reasons: reasonsStr,
      engine_version: engineVersion,
      ruleset_or_model_version: rulesetOrModelVersion,
      scored_at: Number(scoredAt || Date.now())
    };

    const canonicalStr = canonicalizeRecord(recordPayload);
    const chainHash = computeHash(canonicalStr + prevHash);

    await sql
      .prepare(`
        INSERT INTO risk_scores (score_id, event_id, score, reasons, engine_version, ruleset_or_model_version, scored_at, chain_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bindParams(
        scoreId,
        eventId,
        recordPayload.score,
        recordPayload.reasons,
        recordPayload.engine_version,
        recordPayload.ruleset_or_model_version,
        recordPayload.scored_at,
        chainHash
      )
      .execute();
    console.log(`Risk score logged: ${scoreId} (score: ${score}, chain_hash: ${chainHash})`);
    return { success: true, scoreId, chainHash };
  } catch (error) {
    console.error(`Failed to insert risk score for event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Synchronizes the point-in-time regulated status of a user in the history table.
 * @param {string} accountId 
 * @param {boolean} isCurrentlyRegulated 
 * @param {string} source 
 */
export async function syncRegulatedUserStatus(accountId, isCurrentlyRegulated, source) {
  await initDatabase();
  const now = Date.now();

  try {
    const result = await sql
      .prepare(`SELECT regulated_from, regulated_to FROM regulated_user_history WHERE account_id = ? ORDER BY regulated_from DESC LIMIT 1`)
      .bindParams(accountId)
      .execute();

    const lastRecord = result.rows && result.rows[0];

    if (!lastRecord) {
      if (isCurrentlyRegulated) {
        await sql
          .prepare(`INSERT INTO regulated_user_history (account_id, regulated_from, regulated_to, source) VALUES (?, ?, NULL, ?)`)
          .bindParams(accountId, now, source)
          .execute();
        console.log(`History initialized: ${accountId} is now regulated.`);
      }
    } else {
      const fromVal = Number(lastRecord.regulated_from);
      const toVal = lastRecord.regulated_to ? Number(lastRecord.regulated_to) : null;

      if (isCurrentlyRegulated && toVal !== null) {
        // Was regulated, stopped, and now regulated again
        await sql
          .prepare(`INSERT INTO regulated_user_history (account_id, regulated_from, regulated_to, source) VALUES (?, ?, NULL, ?)`)
          .bindParams(accountId, now, source)
          .execute();
        console.log(`History updated: ${accountId} re-entered regulated status.`);
      } else if (!isCurrentlyRegulated && toVal === null) {
        // Was regulated, now deregulared
        await sql
          .prepare(`UPDATE regulated_user_history SET regulated_to = ? WHERE account_id = ? AND regulated_from = ?`)
          .bindParams(now, accountId, fromVal)
          .execute();
        console.log(`History updated: ${accountId} left regulated status.`);
      }
    }
  } catch (error) {
    console.error(`Failed to sync history status for user ${accountId}:`, error);
  }
}

/**
 * Determines if a user was regulated at a specific timestamp.
 * @param {string} accountId 
 * @param {number} ts 
 * @returns {Promise<boolean>}
 */
export async function wasUserRegulatedAt(accountId, ts) {
  await initDatabase();

  try {
    const result = await sql
      .prepare(`
        SELECT 1 FROM regulated_user_history 
        WHERE account_id = ? AND regulated_from <= ? AND (regulated_to IS NULL OR regulated_to >= ?)
        LIMIT 1
      `)
      .bindParams(accountId, ts, ts)
      .execute();

    return !!(result.rows && result.rows.length > 0);
  } catch (error) {
    console.error(`Error checking point-in-time regulated status for user ${accountId} at ${ts}:`, error);
    return false;
  }
}

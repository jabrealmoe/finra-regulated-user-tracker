import sql, { migrationRunner } from '@forge/sql';

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
 * Inserts a new audit log record into the database.
 * @param {object} log 
 */
export async function insertAuditLog({
  eventId,
  ts,
  product,
  eventType,
  regulatedUserId,
  actorId,
  objectType,
  objectId,
  containerId,
  detail,
  isRegulated = 1
}) {
  await initDatabase();

  const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail || {});

  try {
    await sql
      .prepare(`
        INSERT INTO audit_logs (
          event_id, ts, product, event_type, regulated_user_id, actor_id, object_type, object_id, container_id, detail, is_regulated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bindParams(
        eventId,
        ts || Date.now(),
        product,
        eventType,
        regulatedUserId,
        actorId,
        objectType,
        objectId,
        containerId,
        detailStr,
        isRegulated ? 1 : 0
      )
      .execute();
    console.log(`Audit log inserted for event: ${eventId} (is_regulated: ${isRegulated})`);
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
 * Retrieves audit logs for a given date range.
 * @param {number} startTs 
 * @param {number} endTs 
 * @returns {Promise<Array>}
 */
export async function getAuditLogs(startTs, endTs) {
  await initDatabase();

  try {
    let query = `SELECT * FROM audit_logs`;
    const params = [];

    if (startTs && endTs) {
      query += ` WHERE ts >= ? AND ts <= ?`;
      params.push(startTs, endTs);
    } else if (startTs) {
      query += ` WHERE ts >= ?`;
      params.push(startTs);
    } else if (endTs) {
      query += ` WHERE ts <= ?`;
      params.push(endTs);
    }

    query += ` ORDER BY ts DESC LIMIT 1000`; // Limit to prevent memory issues

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

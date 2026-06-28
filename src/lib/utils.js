import { asApp, route, webTrigger } from '@forge/api';
import { kvs } from '@forge/kvs';
import { syncRegulatedUserStatus, wasUserRegulatedAt } from './db';

const CONFIG_KEY = 'finra_config';
const CACHE_PREFIX = 'group_cache_';

// Default configuration settings
const DEFAULT_CONFIG = {
  userSource: 'group', // 'group' or 'list'
  groupName: 'FINRA-Regulated',
  accountIds: '', // comma-separated list of account IDs
  ttl: 300, // cache TTL in seconds (default 5 mins)
  webhookTarget: 'disabled', // 'disabled', 'test', 'prod', 'custom'
  customWebhookUrl: '',
  n8nEnrichment: false, // toggled off by default
  lexiconRules: [
    { pattern: 'confidential', score: 40, flag: 'CONFIDENTIAL_KEYWORD' },
    { pattern: 'insider', score: 80, flag: 'POSSIBLE_INSIDER' },
    { pattern: 'leak', score: 60, flag: 'LEAK_KEYWORD' },
    { pattern: 'don\'t share', score: 50, flag: 'RESTRICTED_SHARING' },
    { pattern: 'private key', score: 70, flag: 'CREDENTIAL_LEAK' },
    { pattern: 'acquisition', score: 50, flag: 'M_A_DISCUSSION' },
    { pattern: 'undisclosed', score: 40, flag: 'UNDISCLOSED_INFO' }
  ],
  categories: {
    jira: {
      mentions: true,
      comments: true,
      attachments: true,
      reactions: true
    },
    confluence: {
      mentions: true,
      comments: true,
      attachments: true,
      reactions: true
    }
  }
};

/**
 * Retrieves the application configuration from Forge Key-Value Storage.
 * @returns {Promise<object>} The configuration object.
 */
export async function getConfig() {
  try {
    const config = await kvs.get(CONFIG_KEY);
    return config ? { ...DEFAULT_CONFIG, ...config } : DEFAULT_CONFIG;
  } catch (error) {
    console.error('Failed to read config from KVS:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Saves the application configuration to Forge Key-Value Storage.
 * @param {object} config 
 */
export async function setConfig(config) {
  try {
    await kvs.set(CONFIG_KEY, config);
    console.log('Config updated in KVS.');
  } catch (error) {
    console.error('Failed to write config to KVS:', error);
    throw error;
  }
}

/**
 * Recursively walks an ADF (Atlassian Document Format) tree to extract all mentioned user account IDs.
 * @param {object} adf Node of the ADF document
 * @returns {Array<string>} List of mentioned user account IDs
 */
export function walkAdfForMentions(adf) {
  if (!adf) return [];
  const mentions = new Set();

  function walk(node) {
    if (!node) return;
    if (node.type === 'mention' && node.attrs && node.attrs.id) {
      mentions.add(node.attrs.id);
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
      }
    }
  }

  walk(adf);
  return Array.from(mentions);
}

/**
 * Fetches group members from Jira or Confluence APIs with caching in Forge KVS.
 * @param {string} groupName Name of the Atlassian group
 * @param {string} product 'jira' or 'confluence'
 * @param {number} ttlSeconds Cache TTL in seconds
 * @returns {Promise<Array<string>>} List of account IDs in the group
 */
export async function getGroupMembersCached(groupName, product, ttlSeconds = 300) {
  if (!groupName) return [];

  const cacheKey = `${CACHE_PREFIX}${product}_${groupName}`;
  
  try {
    // Check cache in KVS
    const cached = await kvs.get(cacheKey);
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < ttlSeconds * 1000) {
      console.log(`Cache hit for group ${groupName} (${product}).`);
      return cached.members || [];
    }
  } catch (err) {
    console.warn('Error reading group cache, falling back to API:', err);
  }

  console.log(`Cache miss or expired for group ${groupName} (${product}). Fetching from API...`);
  const members = [];

  try {
    if (product === 'jira') {
      let startAt = 0;
      let isLast = false;
      
      // Page through Jira group members API (returns up to 50 results at a time)
      while (!isLast) {
        const response = await asApp().requestJira(
          route`/rest/api/3/group/member?groupname=${groupName}&startAt=${startAt}&maxResults=50`
        );
        
        if (response.status === 404) {
          console.warn(`Jira group ${groupName} not found.`);
          break;
        }
        
        if (!response.ok) {
          throw new Error(`Jira API returned status ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        if (data.values && Array.isArray(data.values)) {
          for (const user of data.values) {
            if (user.accountId) {
              members.push(user.accountId);
            }
          }
        }
        
        isLast = data.isLast !== false;
        if (!isLast && data.values && data.values.length > 0) {
          startAt += data.values.length;
        } else {
          break;
        }
      }
    } else {
      throw new Error(`getGroupMembersCached is only supported for Jira. Use isUserInGroupConfluence for Confluence.`);
    }

    // Cache the resolved list in KVS
    await kvs.set(cacheKey, {
      members,
      fetchedAt: Date.now()
    });

    return members;
  } catch (error) {
    console.error(`Failed to fetch members for group ${groupName} via REST API:`, error);
    // If the REST API fails, return cached members if available (even if expired) as a fallback
    try {
      const cached = await kvs.get(cacheKey);
      if (cached && cached.members) {
        console.log(`Returning expired cache fallback for group ${groupName}.`);
        return cached.members;
      }
    } catch (e) {}
    return [];
  }
}

/**
 * Checks if a specific Confluence user is in a given group.
 * Uses the fully supported /wiki/rest/api/user/memberof endpoint to avoid administrative blocks.
 */
async function isUserInGroupConfluence(accountId, groupName, ttl) {
  const cacheKey = `user_groups:${accountId}`;
  const now = Date.now();
  const ttlMs = (ttl || 300) * 1000; // default 5 minutes

  try {
    const cached = await kvs.get(cacheKey);
    if (cached && (now - cached.fetchedAt < ttlMs)) {
      return cached.groups.includes(groupName);
    }
  } catch (e) {}

  try {
    const response = await asApp().requestConfluence(
      route`/wiki/rest/api/user/memberof?accountId=${accountId}`
    );
    if (!response.ok) {
      console.error(`Failed to fetch group membership for user ${accountId}: ${response.status}`);
      return false;
    }
    const data = await response.json();
    const groups = (data.results && Array.isArray(data.results))
      ? data.results.map(g => g.name)
      : [];

    try {
      await kvs.set(cacheKey, {
        groups,
        fetchedAt: now
      });
    } catch (e) {}

    return groups.includes(groupName);
  } catch (err) {
    console.error(`Error checking group membership for user ${accountId}:`, err);
    return false;
  }
}

export async function getRegulatedUsersInvolved(accountIds, product, config, eventTs) {
  if (!accountIds || accountIds.length === 0) return [];
  
  // Clean nulls and duplicates from input
  const uniqueIds = Array.from(new Set(accountIds.filter(id => !!id)));
  if (uniqueIds.length === 0) return [];

  const groupName = config.groupName || 'FINRA-Regulated';
  const source = config.userSource === 'list' ? 'list' : `group:${groupName}`;
  const queryTs = eventTs || Date.now();

  let currentRegulated = [];

  if (config.userSource === 'list') {
    currentRegulated = (config.accountIds || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);
  } else {
    // Resolve group members from group name
    if (product === 'confluence') {
      for (const id of uniqueIds) {
        const inGroup = await isUserInGroupConfluence(id, groupName, config.ttl);
        if (inGroup) {
          currentRegulated.push(id);
        }
      }
    } else {
      currentRegulated = await getGroupMembersCached(groupName, product, config.ttl);
    }
  }

  // Sync checked users' current status to regulated_user_history
  for (const id of uniqueIds) {
    const isReg = currentRegulated.includes(id);
    await syncRegulatedUserStatus(id, isReg, source);
  }

  // Resolve point-in-time status from local history table
  const results = [];
  for (const id of uniqueIds) {
    const isReg = await wasUserRegulatedAt(id, queryTs);
    if (isReg) {
      results.push(id);
    }
  }

  return results;
}

/**
 * Formats compliance audit record data into an RFC 822 / EML formatted email string.
 * @param {object} logData 
 * @returns {string} The formatted EML text.
 */
export function generateEml(logData) {
  const dateStr = new Date(logData.ts || Date.now()).toUTCString();
  const subject = `FINRA Compliance Alert: [${logData.product.toUpperCase()}] ${logData.eventType.split(':').pop()}`;
  
  return [
    `From: compliance-tracker@forge.local`,
    `To: audit-mailbox@banking.internal`,
    `Subject: ${subject}`,
    `Date: ${dateStr}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    `=== FINRA COMPLIANCE AUDIT RECORD ===`,
    `Event ID: ${logData.eventId}`,
    `Timestamp: ${new Date(logData.ts || Date.now()).toISOString()}`,
    `Product: ${logData.product}`,
    `Event Type: ${logData.eventType}`,
    `Regulated User ID: ${logData.regulatedUserId}`,
    `Actor ID: ${logData.actorId}`,
    `Object Type: ${logData.objectType}`,
    `Object ID: ${logData.objectId}`,
    `Container ID: ${logData.containerId}`,
    `Details: ${JSON.stringify(logData.detail, null, 2)}`,
    `=====================================`
  ].join('\r\n');
}

/**
 * Sends a webhook payload in EML format if configured.
 * @param {object} logData 
 */
export async function sendWebhookIfConfigured(logData) {
  try {
    const config = await getConfig();
    if (!config.webhookTarget || config.webhookTarget === 'disabled') {
      return;
    }

    let url = '';
    if (config.webhookTarget === 'test') {
      url = 'https://jabreal.app.n8n.cloud/webhook-test/9fd48593-a44d-4b28-bfb5-143c1aa99af5';
    } else if (config.webhookTarget === 'prod') {
      url = 'https://jabreal.app.n8n.cloud/webhook/9fd48593-a44d-4b28-bfb5-143c1aa99af5';
    } else if (config.webhookTarget === 'custom') {
      url = config.customWebhookUrl;
    }

    if (!url) {
      console.log('Webhook is enabled but no target URL was configured.');
      return;
    }

    const emlContent = generateEml(logData);

    console.log(`Sending compliance EML webhook to: ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'message/rfc822',
        'X-Audit-Event-ID': logData.eventId,
        'X-Audit-Product': logData.product,
        'X-Audit-Event-Type': logData.eventType
      },
      body: emlContent
    });

    if (!response.ok) {
      console.error(`Webhook delivery failed with status ${response.status}: ${await response.text()}`);
    } else {
      console.log('Webhook delivered successfully.');
    }
  } catch (error) {
    console.error('Failed to send compliance webhook:', error);
  }
}

/**
 * Evaluates text content against lexicon rules.
 * @param {string} text 
 * @param {Array} rules 
 * @returns {object} { score: number, flag: string | null }
 */
export function evaluateLexicon(text, rules) {
  if (!text || !rules || !Array.isArray(rules)) {
    return { score: 0, flag: null };
  }

  let maxScore = 0;
  let matchedFlag = null;

  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(text)) {
        if (rule.score > maxScore) {
          maxScore = rule.score;
          matchedFlag = rule.flag;
        }
      }
    } catch (e) {
      console.warn(`Invalid regex pattern in lexicon rule: ${rule.pattern}`, e);
    }
  }

  return { score: maxScore, flag: matchedFlag };
}

/**
 * Dispatches the event payload asynchronously to the external n8n scoring engine.
 * Includes a signed shared secret header and dynamically resolved callback URL.
 * @param {object} logData 
 */
export async function dispatchN8nEnrichment(logData) {
  try {
    const config = await getConfig();
    if (!config.n8nEnrichment) {
      console.log('n8n enrichment is disabled in config. Skipping dispatch.');
      return;
    }

    let url = '';
    if (config.webhookTarget === 'test') {
      url = 'https://jabreal.app.n8n.cloud/webhook-test/9fd48593-a44d-4b28-bfb5-143c1aa99af5';
    } else if (config.webhookTarget === 'prod') {
      url = 'https://jabreal.app.n8n.cloud/webhook/9fd48593-a44d-4b28-bfb5-143c1aa99af5';
    } else if (config.webhookTarget === 'custom') {
      url = config.customWebhookUrl;
    }

    if (!url) {
      console.warn('n8n enrichment target URL is empty.');
      return;
    }

    // Resolve callback URL dynamically
    const callbackUrl = await webTrigger.getUrl('n8n-callback-trigger');
    const secret = process.env.N8N_SHARED_SECRET || 'fallback-secret';

    const payload = {
      event: logData,
      callbackUrl: callbackUrl
    };

    console.log(`Dispatching asynchronous risk scoring to n8n: ${url}`);
    
    // We launch fetch asynchronously (non-blocking)
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify(payload)
    }).then(async (res) => {
      if (!res.ok) {
        console.error(`n8n enrichment dispatch failed: status ${res.status}`);
      } else {
        console.log('n8n enrichment dispatched successfully.');
      }
    }).catch((err) => {
      console.error('Error during n8n enrichment dispatch:', err);
    });

  } catch (error) {
    console.error('Failed to initiate n8n enrichment dispatch:', error);
  }
}

/**
 * Extracts plain text from an Atlassian Document Format (ADF) object.
 * @param {object} adf 
 * @returns {string} Plain text content
 */
export function extractTextFromAdf(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  
  let text = '';
  function walk(node) {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      text += ' ' + node.text;
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
      }
    }
  }
  walk(adf);
  return text.trim();
}

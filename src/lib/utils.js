import { asApp, route } from '@forge/api';
import { kvs } from '@forge/kvs';

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

/**
 * Checks a list of involved user account IDs and returns which ones are FINRA regulated.
 * @param {Array<string>} accountIds 
 * @param {string} product 'jira' or 'confluence'
 * @param {object} config 
 * @returns {Promise<Array<string>>} List of regulated user account IDs found.
 */
export async function getRegulatedUsersInvolved(accountIds, product, config) {
  if (!accountIds || accountIds.length === 0) return [];
  
  // Clean nulls and duplicates from input
  const uniqueIds = Array.from(new Set(accountIds.filter(id => !!id)));
  if (uniqueIds.length === 0) return [];

  if (config.userSource === 'list') {
    // Split comma separated list of account IDs, trim whitespace
    const regulatedList = (config.accountIds || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    return uniqueIds.filter(id => regulatedList.includes(id));
  } else {
    // Resolve group members from group name
    const groupName = config.groupName || 'FINRA-Regulated';
    if (product === 'confluence') {
      const results = [];
      for (const id of uniqueIds) {
        const inGroup = await isUserInGroupConfluence(id, groupName, config.ttl);
        if (inGroup) {
          results.push(id);
        }
      }
      return results;
    } else {
      const groupMembers = await getGroupMembersCached(groupName, product, config.ttl);
      return uniqueIds.filter(id => groupMembers.includes(id));
    }
  }
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

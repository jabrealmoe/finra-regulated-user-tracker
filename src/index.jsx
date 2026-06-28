import Resolver from '@forge/resolver';
import { asApp, route } from '@forge/api';
import { 
  getConfig, 
  getRegulatedUsersInvolved, 
  walkAdfForMentions,
  sendWebhookIfConfigured
} from './lib/utils';
import { 
  insertAuditLog, 
  isDuplicateEvent, 
  getAuditLogs 
} from './lib/db';

const resolver = new Resolver();

// Configure resolver endpoints for frontend Admin page
resolver.define('getConfig', async () => {
  return await getConfig();
});

resolver.define('setConfig', async ({ payload }) => {
  await resolver.getDefinitions(); // satisfy linting if needed
  return await getConfig().then(async (currentConfig) => {
    const updated = { ...currentConfig, ...payload };
    // Import helper dynamically or save directly
    const { setConfig } = require('./lib/utils');
    await setConfig(updated);
    return updated;
  });
});

resolver.define('getLogs', async ({ payload }) => {
  const { startTs, endTs } = payload || {};
  return await getAuditLogs(startTs, endTs);
});

export const resolve = resolver.getDefinitions();

/**
 * Extracts a stable event identifier for deduplication.
 * @param {object} event 
 * @returns {string} Unique event key
 */
function getStableEventId(event) {
  if (event.eventId) return event.eventId;
  if (event.id) return event.id;
  
  // Create a combined stable ID if none exists natively
  const parts = [
    event.eventType || '',
    event.eventCreatedDate || '',
    event.atlassianId || '',
    (event.issue && event.issue.id) || '',
    (event.comment && event.comment.id) || '',
    (event.attachment && event.attachment.id) || '',
    (event.page && event.page.id) || '',
    (event.content && event.content.id) || ''
  ];
  return parts.filter(Boolean).join(':') || `event_${Date.now()}`;
}

/**
 * Handler for Jira triggers: avi:jira:mentioned:issue, avi:jira:commented:issue, avi:jira:created:attachment.
 */
export async function handleJiraEvent(event, context) {
  console.log(`Received Jira event: ${event.eventType || 'unknown'}`);
  
  // 1. Read config
  const config = await getConfig();
  const jiraConfig = config.categories.jira;

  // Determine category and early-return if disabled
  let category = '';
  if (event.eventType === 'avi:jira:mentioned:issue') {
    category = 'mentions';
  } else if (event.eventType === 'avi:jira:commented:issue') {
    category = 'comments';
  } else if (event.eventType === 'avi:jira:created:attachment') {
    category = 'attachments';
  }

  if (category && !jiraConfig[category]) {
    console.log(`Jira category ${category} is disabled. Skipping event.`);
    return;
  }

  // 2. Dedupe on event ID
  const eventId = getStableEventId(event);
  if (await isDuplicateEvent(eventId)) {
    console.log(`Duplicate event ${eventId} ignored.`);
    return;
  }

  // 3. Re-fetch full payload via REST if needed for ADF parsing or full metadata
  let actorId = event.atlassianId;
  let involvedUserIds = [actorId];
  let objectType = '';
  let objectId = '';
  let containerId = '';
  let detail = {};

  try {
    if (event.eventType === 'avi:jira:mentioned:issue') {
      const issueId = event.issue?.id;
      if (!issueId) return;

      // Re-fetch description to parse mentions safely (avoiding payload truncation)
      const res = await asApp().requestJira(route`/rest/api/3/issue/${issueId}`);
      if (!res.ok) throw new Error(`Failed to fetch issue: ${res.status}`);
      
      const issueData = await res.json();
      const descriptionAdf = issueData.fields?.description;
      const mentions = walkAdfForMentions(descriptionAdf);
      
      involvedUserIds.push(...mentions);
      objectType = 'issue';
      objectId = issueId;
      containerId = issueData.fields?.project?.id || '';
      detail = {
        summary: issueData.fields?.summary,
        mentionsCount: mentions.length
      };

    } else if (event.eventType === 'avi:jira:commented:issue') {
      const commentId = event.comment?.id;
      const issueId = event.issue?.id;
      if (!commentId || !issueId) return;

      // Re-fetch comment to extract mentions & details
      const res = await asApp().requestJira(route`/rest/api/3/issue/${issueId}/comment/${commentId}`);
      if (!res.ok) throw new Error(`Failed to fetch comment: ${res.status}`);
      
      const commentData = await res.json();
      actorId = commentData.author?.accountId || actorId;
      involvedUserIds = [actorId];

      const bodyAdf = commentData.body;
      const mentions = walkAdfForMentions(bodyAdf);
      involvedUserIds.push(...mentions);

      objectType = 'comment';
      objectId = commentId;
      containerId = issueId; // issue serves as the parent container
      detail = {
        issueKey: event.issue?.key,
        mentionsCount: mentions.length
      };

    } else if (event.eventType === 'avi:jira:created:attachment') {
      const attachmentId = event.attachment?.id;
      if (!attachmentId) return;

      // Re-fetch attachment metadata
      const res = await asApp().requestJira(route`/rest/api/3/attachment/${attachmentId}`);
      if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.status}`);
      
      const attachmentData = await res.json();
      actorId = attachmentData.author?.accountId || actorId;
      involvedUserIds = [actorId];

      objectType = 'attachment';
      objectId = attachmentId;
      // Extract issue ID from attachment's issue metadata or fallback to event context
      containerId = attachmentData.issueId || '';
      detail = {
        filename: attachmentData.filename,
        mimeType: attachmentData.mimeType,
        size: attachmentData.size
      };
    }

    // 4. Run isRegulatedInvolved predicate
    const regulatedInvolved = await getRegulatedUsersInvolved(involvedUserIds, 'jira', config);
    
    // 5. If true, write one idempotent audit row
    if (regulatedInvolved.length > 0) {
      console.log(`FINRA Regulated users involved in Jira event: ${regulatedInvolved.join(', ')}`);
      
      // Log for each unique regulated user involved (usually 1, but handles multiple)
      for (const regUserId of regulatedInvolved) {
        const logData = {
          eventId: `${eventId}:${regUserId}`,
          ts: event.eventCreatedDate ? new Date(event.eventCreatedDate).getTime() : Date.now(),
          product: 'jira',
          eventType: event.eventType,
          regulatedUserId: regUserId,
          actorId: actorId,
          objectType: objectType,
          objectId: objectId,
          containerId: containerId,
          detail: {
            ...detail,
            involvedCount: regulatedInvolved.length
          }
        };
        await insertAuditLog(logData);
        await sendWebhookIfConfigured(logData);
      }
    } else {
      console.log(`No FINRA regulated users involved in Jira event: ${event.eventType}. Skipping database insert and webhook.`);
    }
  } catch (error) {
    console.error(`Error processing Jira trigger ${event.eventType}:`, error);
  }
}

/**
 * Handler for Confluence triggers.
 */
export async function handleConfluenceEvent(event, context) {
  console.log(`Received Confluence event: ${event.eventType || 'unknown'}`);

  // 1. Read config
  const config = await getConfig();
  const confConfig = config.categories.confluence;

  // Determine category and early-return if disabled
  let category = '';
  if (event.eventType === 'avi:confluence:created:comment' || event.eventType === 'avi:confluence:updated:comment') {
    category = 'comments';
  } else if (event.eventType === 'avi:confluence:created:page' || event.eventType === 'avi:confluence:updated:page') {
    category = 'mentions'; // Page content edits are inspected for mentions
  } else if (event.eventType === 'avi:confluence:created:attachment' || event.eventType === 'avi:confluence:updated:attachment') {
    category = 'attachments';
  }

  if (category && !confConfig[category]) {
    console.log(`Confluence category ${category} is disabled. Skipping event.`);
    return;
  }

  // 2. Dedupe on event ID
  const eventId = getStableEventId(event);
  if (await isDuplicateEvent(eventId)) {
    console.log(`Duplicate event ${eventId} ignored.`);
    return;
  }

  let actorId = event.atlassianId;
  let involvedUserIds = [actorId];
  let objectType = '';
  let objectId = '';
  let containerId = '';
  let detail = {};

  try {
    if (event.eventType.includes('comment')) {
      const commentId = event.content?.id;
      if (!commentId) {
        console.warn('Confluence comment event has no content ID:', event);
        return;
      }

      // Re-fetch comment body (v2 API) to get ADF format for mention extraction
      const res = await asApp().requestConfluence(route`/wiki/api/v2/comments/${commentId}?body-format=atlas_doc_format`);
      if (!res.ok) throw new Error(`Failed to fetch Confluence comment: ${res.status}`);
      
      const commentData = await res.json();
      actorId = commentData.authorId || actorId;
      involvedUserIds = [actorId];

      const adfStr = commentData.body?.atlasDocFormat?.value;
      if (adfStr) {
        const adf = JSON.parse(adfStr);
        const mentions = walkAdfForMentions(adf);
        involvedUserIds.push(...mentions);
        detail.mentionsCount = mentions.length;
      }

      objectType = 'comment';
      objectId = commentId;
      containerId = commentData.pageId || commentData.blogpostId || '';
      
      // Check if this is a reply (comment with parent)
      if (commentData.parentCommentId) {
        detail.parentCommentId = commentData.parentCommentId;
      }

    } else if (event.eventType.includes('page')) {
      const pageId = event.content?.id;
      if (!pageId) {
        console.warn('Confluence page event has no content ID:', event);
        return;
      }

      // Re-fetch page content (v2 API) to parse ADF format for mentions
      const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
      if (!res.ok) throw new Error(`Failed to fetch Confluence page: ${res.status}`);

      const pageData = await res.json();
      actorId = pageData.authorId || actorId;
      involvedUserIds = [actorId];

      const adfStr = pageData.body?.atlasDocFormat?.value;
      if (adfStr) {
        const adf = JSON.parse(adfStr);
        const mentions = walkAdfForMentions(adf);
        involvedUserIds.push(...mentions);
        detail.mentionsCount = mentions.length;
      }

      objectType = 'page';
      objectId = pageId;
      containerId = pageData.spaceId || '';
      detail.title = pageData.title;

    } else if (event.eventType.includes('attachment')) {
      // NOTE: Confluence attachment events provide basic payloads.
      // We implement the best available Confluence attachment event (created/updated) and fetch attachment details.
      const attachmentId = event.content?.id;
      if (!attachmentId) {
        console.warn('Confluence attachment event has no content ID:', event);
        return;
      }

      const res = await asApp().requestConfluence(route`/wiki/api/v2/attachments/${attachmentId}`);
      if (!res.ok) throw new Error(`Failed to fetch Confluence attachment: ${res.status}`);

      const attData = await res.json();
      actorId = attData.authorId || actorId;
      involvedUserIds = [actorId];

      objectType = 'attachment';
      objectId = attachmentId;
      containerId = attData.pageId || attData.blogpostId || '';
      detail = {
        title: attData.title,
        fileSize: attData.fileSize,
        mediaType: attData.mediaType
      };
    }

    // 4. Run isRegulatedInvolved predicate
    const regulatedInvolved = await getRegulatedUsersInvolved(involvedUserIds, 'confluence', config);

    // 5. If true, write one idempotent audit row
    if (regulatedInvolved.length > 0) {
      console.log(`FINRA Regulated users involved in Confluence event: ${regulatedInvolved.join(', ')}`);
      
      for (const regUserId of regulatedInvolved) {
        const logData = {
          eventId: `${eventId}:${regUserId}`,
          ts: event.eventCreatedDate ? new Date(event.eventCreatedDate).getTime() : Date.now(),
          product: 'confluence',
          eventType: event.eventType,
          regulatedUserId: regUserId,
          actorId: actorId,
          objectType: objectType,
          objectId: objectId,
          containerId: containerId,
          detail: {
            ...detail,
            involvedCount: regulatedInvolved.length
          }
        };
        await insertAuditLog(logData);
        await sendWebhookIfConfigured(logData);
      }
    } else {
      console.log(`No FINRA regulated users involved in Confluence event: ${event.eventType}. Skipping database insert and webhook.`);
    }
  } catch (error) {
    console.error(`Error processing Confluence trigger ${event.eventType}:`, error);
  }
}

/**
 * Scheduled trigger reaction-poller (runs every 5 minutes).
 * Performs a reconciliation workaround to fetch likes on recently updated Confluence pages.
 */
export async function pollReactions(event, context) {
  console.log('Running reaction poll reconciliation worker...');

  const config = await getConfig();
  if (!config.categories.confluence.reactions) {
    console.log('Confluence reactions tracking is disabled. Skipping poll.');
    return;
  }

  try {
    const { kvs } = require('@forge/kvs');

    // 1. Fetch recently modified Confluence pages (representing active content)
    const pagesRes = await asApp().requestConfluence(route`/wiki/api/v2/pages?sort=-modified-date&limit=25`);
    if (!pagesRes.ok) throw new Error(`Failed to fetch recent pages: ${pagesRes.status}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.results || [];

    // Also fetch recently modified blogposts
    const blogsRes = await asApp().requestConfluence(route`/wiki/api/v2/blogposts?sort=-modified-date&limit=15`);
    let blogposts = [];
    if (blogsRes.ok) {
      const blogsData = await blogsRes.json();
      blogposts = blogsData.results || [];
    }

    const contents = [...pages.map(p => ({ ...p, type: 'page' })), ...blogposts.map(b => ({ ...b, type: 'blogpost' }))];

    for (const item of contents) {
      const contentId = item.id;
      const type = item.type;
      const endpoint = type === 'page' ? route`/wiki/api/v2/pages/${contentId}/likes/users` : route`/wiki/api/v2/blogposts/${contentId}/likes/users`;

      // Get users who liked the content
      const likesRes = await asApp().requestConfluence(endpoint);
      if (!likesRes.ok) {
        console.warn(`Could not fetch likes for Confluence content ${contentId}: status ${likesRes.status}`);
        continue;
      }

      const likesData = await likesRes.json();
      const currentLikers = (likesData.results || []).map(user => user.accountId).filter(Boolean);

      // Retrieve last seen likes list from Forge KVS storage
      const storeKey = `likes_seen_${contentId}`;
      const lastSeenLikers = await kvs.get(storeKey) || [];

      // Diffs: users who liked since last poll
      const newLikers = currentLikers.filter(id => !lastSeenLikers.includes(id));

      if (newLikers.length > 0) {
        console.log(`Found ${newLikers.length} new likes on ${type} ${contentId}.`);
        
        // Find if either the liker OR content author is regulated
        const authorId = item.authorId;
        
        for (const likerId of newLikers) {
          const involvedUserIds = [likerId];
          if (authorId) involvedUserIds.push(authorId);

          const regulatedInvolved = await getRegulatedUsersInvolved(involvedUserIds, 'confluence', config);
          
          if (regulatedInvolved.length > 0) {
            for (const regUserId of regulatedInvolved) {
              const eventId = `reaction:${contentId}:${likerId}:${regUserId}`;
              
              // Prevent duplicate insertion
              if (!(await isDuplicateEvent(eventId))) {
                const logData = {
                  eventId,
                  ts: Date.now(),
                  product: 'confluence',
                  eventType: 'confluence:reaction:created',
                  regulatedUserId: regUserId,
                  actorId: likerId,
                  objectType: type,
                  objectId: contentId,
                  containerId: item.spaceId || '',
                  detail: {
                    title: item.title,
                    likerId,
                    authorId,
                    reconciliation: true
                  }
                };
                await insertAuditLog(logData);
                await sendWebhookIfConfigured(logData);
              }
            }
          }
        }
      }

      // Update KVS seen likes list
      await kvs.set(storeKey, currentLikers);
    }
    
    console.log('Reaction poll reconciliation completed.');
  } catch (error) {
    console.error('Error during scheduled reaction polling:', error);
  }
}
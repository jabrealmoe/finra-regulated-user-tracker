// In-browser mock of @forge/bridge for Playwright E2E runs.
//
// The real admin page only works inside an Atlassian iframe, where
// @forge/bridge proxies invoke() calls to the app's resolver over
// postMessage. For E2E we swap this module in via a Vite alias
// (E2E_MOCK_BRIDGE=1, see vite.config.js) so the UI runs standalone
// against a deterministic in-memory backend.

const config = {
  userSource: 'group',
  groupName: 'FINRA-Regulated',
  ttl: 300,
  categories: {
    jira: { mentions: true, comments: true, attachments: true },
    confluence: { mentions: true, comments: true, attachments: true, reactions: false },
  },
  webhookTarget: 'disabled',
  customWebhookUrl: '',
  n8nEnrichment: false,
  lexiconRules: [{ pattern: 'insider', score: 80, flag: 'POSSIBLE_INSIDER' }],
};

let logs = [
  {
    event_id: 'evt-jira-0001',
    ts: '1754055000000',
    product: 'jira',
    event_type: 'avi:jira:commented:issue',
    regulated_user_id: '557058:aaaa1111-2222-3333-4444-555566667777',
    regulated_user_name: 'Jordan Broker',
    regulated_user_email: 'jordan.broker@example.com',
    regulated_user_crd: '1234567',
    actor_id: '557058:bbbb1111-2222-3333-4444-555566667777',
    actor_name: 'Jordan Broker',
    actor_email: 'jordan.broker@example.com',
    object_type: 'issue',
    object_id: 'ISSUE-101-abcdef',
    container_id: 'PROJ-1',
    detail: JSON.stringify({ comment: 'Client asked about the insider window.' }),
    lexicon_score: 80,
    lexicon_flag: 'POSSIBLE_INSIDER',
    deep_score: null,
    review_status: 'captured',
    notes: '',
  },
  {
    event_id: 'evt-jira-0002',
    ts: '1754056000000',
    product: 'jira',
    event_type: 'avi:jira:created:attachment',
    regulated_user_id: '557058:cccc1111-2222-3333-4444-555566667777',
    regulated_user_name: 'Alex Trader',
    regulated_user_email: 'alex.trader@example.com',
    regulated_user_crd: '7654321',
    actor_id: '557058:dddd1111-2222-3333-4444-555566667777',
    actor_name: 'Alex Trader',
    actor_email: 'alex.trader@example.com',
    object_type: 'issue',
    object_id: 'ISSUE-102-ghijkl',
    container_id: 'PROJ-1',
    detail: JSON.stringify({ filename: 'statement.pdf' }),
    lexicon_score: 0,
    lexicon_flag: null,
    deep_score: null,
    review_status: 'captured',
    notes: '',
  },
];

const digests = [
  {
    date_str: '2026-08-01',
    hash_chain_head: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    verification_status: 'verified',
  },
];

export const view = {
  getContext: async () => ({
    moduleKey: 'finra-admin-page-jira',
    extension: { target: 'jira:adminPage' },
  }),
};

export const invoke = async (fnName, payload = {}) => {
  switch (fnName) {
    case 'getConfig':
      return { ...config };
    case 'setConfig':
      Object.assign(config, payload);
      return { ...config };
    case 'getLogs':
      return logs.map((l) => ({ ...l }));
    case 'getDailyDigests':
      return digests.map((d) => ({ ...d }));
    case 'verifyChain':
      return {
        verified: true,
        count: logs.length,
        headHash: digests[0].hash_chain_head,
      };
    case 'submitReview':
      logs = logs.map((l) =>
        l.event_id === payload.eventId
          ? { ...l, review_status: payload.status, notes: payload.notes }
          : l
      );
      return { ok: true };
    default:
      throw new Error(`E2E bridge mock: unmocked resolver "${fnName}"`);
  }
};

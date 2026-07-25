import React, { useState, useEffect, useRef } from 'react';
import { invoke, view } from '@forge/bridge';

function getFriendlyEventName(eventType) {
  if (!eventType) return 'Unknown';
  switch (eventType) {
    case 'avi:jira:commented:issue': return 'Comment Added';
    case 'avi:jira:mentioned:issue': return 'User Mentioned';
    case 'avi:jira:created:attachment': return 'Attachment Uploaded';
    case 'avi:confluence:created:comment': return 'Comment Created';
    case 'avi:confluence:updated:comment': return 'Comment Updated';
    case 'avi:confluence:created:page': return 'Page Created';
    case 'avi:confluence:updated:page': return 'Page Updated';
    case 'avi:confluence:created:attachment': return 'Attachment Added';
    case 'confluence:reaction:created': return 'Reaction Logged';
    default:
      return eventType.split(':').pop() || eventType;
  }
}

// Derives the effective risk presentation for a log row: the deep (n8n) score
// wins over the baseline lexicon score when present.
function riskInfo(log) {
  const hasDeep = log.deep_score !== null && log.deep_score !== undefined;
  const score = hasDeep ? Number(log.deep_score) : (Number(log.lexicon_score) || 0);
  return {
    score,
    tier: score >= 70 ? 'high' : score >= 40 ? 'med' : 'low',
    source: hasDeep ? 'n8n' : 'Lexicon',
    title: hasDeep ? log.deep_reasons : log.lexicon_flag
  };
}

export default function App() {
  const [config, setConfigState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { type: 'success'|'error', message: string }
  const [productContext, setProductContext] = useState('jira'); // 'jira' | 'confluence'

  // Date filters for audit log queries.
  // dateMode toggles the search shape, mirroring the MCRO "On | Range" control:
  //   'on'    -> match a single calendar day (onDate)
  //   'range' -> match an inclusive span between startDate and endDate
  const [dateMode, setDateMode] = useState('on'); // 'on' | 'range'
  const [onDate, setOnDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // The date window currently APPLIED to the table (set when Filter/Clear is pressed),
  // tracked separately from the input fields so auto-refresh re-queries the same window
  // the user is actually looking at — not whatever half-typed value is in the inputs.
  const [appliedWindow, setAppliedWindow] = useState({ startTs: null, endTs: null });

  // Auto-refresh of the audit log while the panel is in view.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const logsSignatureRef = useRef('');  // last-seen "count:latestTs" signature
  const pollingRef = useRef(false);      // guards against overlapping polls
  
  // Search query for logs (client-side filter on display)
  const [searchQuery, setSearchQuery] = useState('');

  // Verification & Digest States
  const [verificationReport, setVerificationReport] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [dailyDigests, setDailyDigests] = useState([]);

  // Review Queue States
  const [selectedLogForReview, setSelectedLogForReview] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('reviewed-no-concern');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all'); // 'all' | 'pending' | 'reviewed'
  const [sortBy, setSortBy] = useState('date_desc'); // 'date_desc' | 'risk_desc'
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedIdentity, setSelectedIdentity] = useState(null); // identity popout for a regulated user
  const [mainTab, setMainTab] = useState('audit'); // 'webhook' | 'lexicon' | 'chain' | 'audit'

  // Load configuration on mount
  useEffect(() => {
    fetchConfig();
    fetchLogs();
    fetchDigests();
    
    // Detect context
    if (typeof view !== 'undefined' && view.getContext) {
      view.getContext().then(ctx => {
        if (ctx && ctx.extension && ctx.extension.target) {
          const targetStr = ctx.extension.target.toLowerCase();
          const isConf = targetStr.includes('confluence') || targetStr.includes('wiki') || (ctx.moduleKey && ctx.moduleKey.includes('confluence'));
          setProductContext(isConf ? 'confluence' : 'jira');
        } else if (ctx && ctx.moduleKey) {
          const isConf = ctx.moduleKey.toLowerCase().includes('confluence');
          setProductContext(isConf ? 'confluence' : 'jira');
        }
      }).catch(e => {
        console.error('Error fetching context:', e);
      });
    }
  }, []);

  // Auto-refresh: while the Audit Log tab is in view (and the browser tab is visible),
  // poll the lightweight signature endpoint. Only when the signature changes — i.e. a new
  // event landed or the count moved — do we run the full reload. This is independent of any
  // page reload and effectively refreshes "on event" without a true server push (which Forge
  // custom UI does not support). The poll re-queries the currently APPLIED date window.
  useEffect(() => {
    // Gate: only run on the audit tab with the feature enabled.
    if (mainTab !== 'audit' || !autoRefresh) return undefined;

    const POLL_INTERVAL_MS = 12000; // 12s — responsive yet light on the database

    const tick = async () => {
      // Skip while another poll is in flight, while the browser tab is hidden, or while a
      // triage disposition is open (don't yank the table out from under an active reviewer).
      if (pollingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (selectedLogForReview) return;

      pollingRef.current = true;
      try {
        const sig = await invoke('getLogsSignature', {
          startTs: appliedWindow.startTs,
          endTs: appliedWindow.endTs,
          product: productContext
        });
        const sigStr = `${sig.count}:${sig.latestTs}`;
        if (sigStr !== logsSignatureRef.current) {
          logsSignatureRef.current = sigStr;
          await fetchLogs(appliedWindow.startTs, appliedWindow.endTs);
        }
      } catch (err) {
        console.error('Auto-refresh poll failed:', err);
      } finally {
        pollingRef.current = false;
      }
    };

    const intervalId = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [mainTab, autoRefresh, productContext, appliedWindow, selectedLogForReview]);

  const handleSubmitReview = async (eventId) => {
    try {
      setSubmittingReview(true);
      await invoke('submitReview', { eventId, status: reviewStatus, notes: reviewNotes });
      setSelectedLogForReview(null);
      setReviewNotes('');
      await fetchLogs();
    } catch (err) {
      console.error('Error submitting review:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const fetchConfig = async () => {
    try {
      setLoadingConfig(true);
      const data = await invoke('getConfig');
      setConfigState(data);
    } catch (err) {
      console.error('Error fetching config:', err);
      setSaveStatus({ type: 'error', message: 'Failed to load configuration.' });
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchDigests = async () => {
    try {
      const data = await invoke('getDailyDigests');
      setDailyDigests(data || []);
    } catch (e) {
      console.error('Error fetching digests:', e);
    }
  };

  const handleVerifyChain = async () => {
    try {
      setVerifying(true);
      setVerificationReport(null);
      const report = await invoke('verifyChain');
      setVerificationReport(report);
      fetchDigests();
    } catch (err) {
      console.error('Error verifying chain:', err);
      setVerificationReport({ verified: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  // Fetch logs for an explicit epoch-millisecond window. Either bound may be null
  // (meaning "unbounded" on that side). Date -> timestamp conversion is done by the
  // caller so the single-day vs range logic lives in one place (handleFilterLogs).
  const fetchLogs = async (startTs = null, endTs = null) => {
    try {
      setLoadingLogs(true);
      const data = await invoke('getLogs', { startTs, endTs });
      setLogs(data || []);
      setLastRefreshed(Date.now());
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Convert a 'YYYY-MM-DD' value into the start (00:00:00.000) of that local day.
  const dayStartTs = (dateStr) => dateStr ? new Date(`${dateStr}T00:00:00`).getTime() : null;
  // Convert a 'YYYY-MM-DD' value into the very end (23:59:59.999) of that local day,
  // so the chosen end date is included in full rather than truncated at midnight.
  const dayEndTs = (dateStr) => dateStr ? new Date(`${dateStr}T23:59:59.999`).getTime() : null;

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaveStatus(null);
    try {
      const updated = await invoke('setConfig', config);
      setConfigState(updated);
      setSaveStatus({ type: 'success', message: 'Settings saved successfully!' });
      
      // Auto-dismiss success alert
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      console.error('Error saving config:', err);
      setSaveStatus({ type: 'error', message: 'Failed to save settings.' });
    }
  };

  const handleCategoryToggle = (product, category) => {
    setConfigState(prev => ({
      ...prev,
      categories: {
        ...prev.categories,
        [product]: {
          ...prev.categories[product],
          [category]: !prev.categories[product][category]
        }
      }
    }));
  };

  const handleFilterLogs = (e) => {
    e.preventDefault();
    const win = dateMode === 'on'
      // Single day: span the full chosen calendar day [00:00:00.000 .. 23:59:59.999].
      ? { startTs: dayStartTs(onDate), endTs: dayEndTs(onDate) }
      // Range: inclusive of both endpoints' full days.
      : { startTs: dayStartTs(startDate), endTs: dayEndTs(endDate) };
    setAppliedWindow(win);
    fetchLogs(win.startTs, win.endTs);
  };

  const handleResetFilters = () => {
    setOnDate('');
    setStartDate('');
    setEndDate('');
    setAppliedWindow({ startTs: null, endTs: null });
    fetchLogs();
  };

  // CSV Export utility
  const handleExportCSV = () => {
    if (logs.length === 0) return;

    const headers = ['Event ID', 'Timestamp', 'Product', 'Event Type', 'Regulated User ID', 'Actor ID', 'Object Type', 'Object ID', 'Container ID', 'Details'];
    const rows = filteredLogs.map(log => [
      log.event_id,
      new Date(Number(log.ts)).toISOString(),
      log.product,
      log.event_type,
      log.regulated_user_id,
      log.actor_id,
      log.object_type,
      log.object_id,
      log.container_id,
      log.detail
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `finra_audit_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // JSON Export utility
  const handleExportJSON = () => {
    if (logs.length === 0) return;
    
    // Parse detail text if it's stringified JSON
    const parsedLogs = filteredLogs.map(log => {
      let detailObj = log.detail;
      try {
        if (typeof log.detail === 'string') {
          detailObj = JSON.parse(log.detail);
        }
      } catch (e) {}
      
      return {
        ...log,
        ts_formatted: new Date(Number(log.ts)).toISOString(),
        detail: detailObj
      };
    });

    const jsonStr = JSON.stringify(parsedLogs, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `finra_audit_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter logs list based on search bar and compliance review queue filters
  const filteredLogs = logs.filter(log => {
    // Filter by product context (Jira only inside Jira, Confluence only inside Confluence)
    if (log.product !== productContext) {
      return false;
    }

    // 1. Review queue lifecycle filter
    const status = log.review_status || 'captured';
    if (reviewFilter === 'pending' && status !== 'captured' && status !== 'pending-review') {
      return false;
    }
    if (reviewFilter === 'reviewed' && status === 'captured') {
      return false;
    }

    // 2. Text search query filter
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (log.event_id && log.event_id.toLowerCase().includes(query)) ||
      (log.regulated_user_id && log.regulated_user_id.toLowerCase().includes(query)) ||
      (log.regulated_user_name && log.regulated_user_name.toLowerCase().includes(query)) ||
      (log.regulated_user_email && log.regulated_user_email.toLowerCase().includes(query)) ||
      (log.regulated_user_crd && String(log.regulated_user_crd).toLowerCase().includes(query)) ||
      (log.actor_id && log.actor_id.toLowerCase().includes(query)) ||
      (log.event_type && log.event_type.toLowerCase().includes(query)) ||
      (log.detail && log.detail.toLowerCase().includes(query))
    );
  });

  // Sort logs based on selected sorting criteria (Date vs Risk Score)
  const sortedLogs = [...filteredLogs].sort((a, b) => {
    if (sortBy === 'risk_desc') {
      const scoreA = a.deep_score !== null && a.deep_score !== undefined ? Number(a.deep_score) : (Number(a.lexicon_score) || 0);
      const scoreB = b.deep_score !== null && b.deep_score !== undefined ? Number(b.deep_score) : (Number(b.lexicon_score) || 0);
      return scoreB - scoreA;
    } else {
      return Number(b.ts) - Number(a.ts);
    }
  });

  if (loadingConfig) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        Loading configuration...
      </div>
    );
  }

  return (
    <div className="container" data-product={productContext}>
      <header className="masthead">
        <div className="masthead-brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.5 4.5 5.4v6.1c0 4.6 3.2 8 7.5 9.9 4.3-1.9 7.5-5.3 7.5-9.9V5.4L12 2.5Z" stroke="#EEB111" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8.6 12.2l2.3 2.3 4.5-4.7" stroke="#EEB111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="masthead-eyebrow">Financial Industry Regulatory Authority</p>
            <h1 className="masthead-title">Compliance &amp; Supervision Hub</h1>
            <p className="masthead-sub">Regulated-user activity auditing · tamper-evident archival · supervisory review</p>
          </div>
        </div>
        <div className="masthead-actions">
          <span className={`product-chip product-${productContext}`}>
            {productContext === 'confluence' ? 'Confluence Workspace' : 'Jira Workspace'}
          </span>
          <button className="btn btn-secondary" onClick={fetchConfig}>Refresh Config</button>
        </div>
      </header>

      {saveStatus && (
        <div className={`alert alert-${saveStatus.type}`}>
          {saveStatus.message}
        </div>
      )}

      <form onSubmit={handleSaveConfig}>
        <div className="grid">
          {/* User source selection card */}
          <div className="card">
            <h2>Regulated Users Supervisor</h2>
            
            <div className="form-group">
              <label>Definition Method</label>
              <select 
                value={config.userSource} 
                onChange={(e) => setConfigState(prev => ({ ...prev, userSource: e.target.value }))}
              >
                <option value="group">Atlassian Group (Recommended)</option>
                <option value="list">Explicit Account ID List</option>
              </select>
            </div>

            {config.userSource === 'group' ? (
              <>
                <div className="form-group">
                  <label>Group Name</label>
                  <input 
                    type="text" 
                    value={config.groupName || ''} 
                    onChange={(e) => setConfigState(prev => ({ ...prev, groupName: e.target.value }))}
                    placeholder="e.g. FINRA-Regulated"
                    required
                  />
                  <small className="field-hint">
                    Users belonging to this group will have their activities tracked.
                  </small>
                </div>
                
                <div className="form-group">
                  <label>Cache TTL (seconds)</label>
                  <input 
                    type="text" 
                    value={config.ttl || ''} 
                    onChange={(e) => setConfigState(prev => ({ ...prev, ttl: parseInt(e.target.value) || 300 }))}
                    placeholder="300"
                    required
                  />
                  <small className="field-hint">
                    How long group membership will be cached to avoid excessive API requests.
                  </small>
                </div>
              </>
            ) : (
              <div className="form-group">
                <label>Account IDs (Comma-separated)</label>
                <textarea 
                  rows="4"
                  value={config.accountIds || ''} 
                  onChange={(e) => setConfigState(prev => ({ ...prev, accountIds: e.target.value }))}
                  placeholder="e.g. 557058:f39a..., 557058:e28f..."
                  style={{ resize: 'vertical' }}
                  required
                />
                <small className="field-hint">
                  Enter the specific Atlassian account IDs of regulated users, separated by commas.
                </small>
              </div>
            )}
          </div>

          {/* Event Category tracking toggles card */}
          <div className="card">
            <h2>Tracked Event Categories</h2>
            
            {productContext === 'jira' ? (
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--accent-color)', fontWeight: '600', marginBottom: '8px' }}>JIRA EVENTS</h3>
                
                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">@Mentions</span>
                    <span className="toggle-desc">Detect mentions on issues</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.jira.mentions} 
                      onChange={() => handleCategoryToggle('jira', 'mentions')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">Comments</span>
                    <span className="toggle-desc">Audit comments added/updated</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.jira.comments} 
                      onChange={() => handleCategoryToggle('jira', 'comments')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">Attachments</span>
                    <span className="toggle-desc">Log files added to issues</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.jira.attachments} 
                      onChange={() => handleCategoryToggle('jira', 'attachments')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: '14px', color: 'var(--accent-color)', fontWeight: '600', marginBottom: '8px' }}>CONFLUENCE EVENTS</h3>
                
                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">@Mentions & Pages</span>
                    <span className="toggle-desc">Audit mentions in page edits</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.confluence.mentions} 
                      onChange={() => handleCategoryToggle('confluence', 'mentions')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">Comments</span>
                    <span className="toggle-desc">Audit comment creations/replies</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.confluence.comments} 
                      onChange={() => handleCategoryToggle('confluence', 'comments')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">Attachments</span>
                    <span className="toggle-desc">Log files added to pages</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.confluence.attachments} 
                      onChange={() => handleCategoryToggle('confluence', 'attachments')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="toggle-row">
                  <div className="toggle-label">
                    <span className="toggle-title">Reactions (Reconciliation poller)</span>
                    <span className="toggle-desc">Poll page and blogpost likes</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={config.categories.confluence.reactions} 
                      onChange={() => handleCategoryToggle('confluence', 'reactions')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Main Tab Bar ─── */}
        <div className="tab-bar" role="tablist">
          {[
            { key: 'audit', label: '📋 Tracked Event Audit Log' },
            { key: 'webhook', label: '🔗 Webhook Configuration' },
            { key: 'lexicon', label: '🏷️ Lexicon Rules Engine' },
            { key: 'chain', label: '🛡️ Chain Integrity' },
          ].map(tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mainTab === tab.key}
              className={`tab ${mainTab === tab.key ? 'is-active' : ''}`}
              onClick={() => setMainTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ─── Tab: Webhook Configuration ─── */}
        {mainTab === 'webhook' && (
          <div className="card" style={{ marginTop: '20px' }}>
            <h2>Webhook Configuration</h2>
            <p className="section-note">
              Configure automatic forwarding of compliance audit logs in EML email format to an n8n webhook or custom HTTP receiver.
            </p>
            
            <div className="form-group">
              <label>Webhook Destination Target</label>
              <select 
                value={config.webhookTarget || 'disabled'} 
                onChange={(e) => setConfigState(prev => ({ ...prev, webhookTarget: e.target.value }))}
              >
                <option value="disabled">Disabled</option>
                <option value="test">n8n Test Webhook (Sandbox)</option>
                <option value="prod">n8n Production Webhook (Active)</option>
                <option value="custom">Custom Webhook URL</option>
              </select>
            </div>

            {config.webhookTarget === 'custom' && (
              <div className="form-group">
                <label>Custom Webhook URL</label>
                <input 
                  type="url" 
                  value={config.customWebhookUrl || ''} 
                  onChange={(e) => setConfigState(prev => ({ ...prev, customWebhookUrl: e.target.value }))}
                  placeholder="https://your-banking-middleware.com/webhook"
                  required
                />
                <small className="field-hint">
                  Note: The destination host domain must be whitelisted in the app manifest.yml.
                </small>
              </div>
            )}

            {config.webhookTarget !== 'disabled' && config.webhookTarget !== 'custom' && (
              <div className="info-strip">
                Target Endpoint: {config.webhookTarget === 'test'
                  ? 'https://jabreal.app.n8n.cloud/webhook-test/9fd48593-a44d-4b28-bfb5-143c1aa99af5'
                  : 'https://jabreal.app.n8n.cloud/webhook/9fd48593-a44d-4b28-bfb5-143c1aa99af5'
                }
              </div>
            )}

            <div className="toggle-row" style={{ marginTop: '20px' }}>
              <div className="toggle-label">
                <span className="toggle-title">n8n Deep Risk Enrichment</span>
                <span className="toggle-desc">Enables deep risk scoring via external n8n workflow</span>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={config.n8nEnrichment || false} 
                  onChange={(e) => setConfigState(prev => ({ ...prev, n8nEnrichment: e.target.checked }))}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-start' }}>
              <button type="submit" className="btn btn-primary" style={{ padding: '12px 24px', fontSize: '15px' }}>
                Save Configuration
              </button>
            </div>
          </div>
        )}

        {/* ─── Tab: Lexicon Rules Engine ─── */}
        {mainTab === 'lexicon' && (
          <div className="card" style={{ marginTop: '20px' }}>
            <h2>Lexicon Rules Engine</h2>
            <p className="section-note">
              Configure regular expressions to evaluate baseline risk scores deterministically in-Forge. Format: <code>pattern,score,flag</code> (one rule per line).
            </p>
            <div className="form-group">
              <label>Baseline Lexicon Rules</label>
              <textarea 
                rows="6"
                value={config.lexiconRules ? config.lexiconRules.map(r => `${r.pattern},${r.score},${r.flag}`).join('\n') : ''}
                onChange={(e) => {
                  const lines = e.target.value.split('\n');
                  const rules = lines.map(line => {
                    const parts = line.split(',');
                    if (parts.length >= 3) {
                      return { pattern: parts[0].trim(), score: parseInt(parts[1].trim()) || 0, flag: parts[2].trim() };
                    }
                    return null;
                  }).filter(Boolean);
                  setConfigState(prev => ({ ...prev, lexiconRules: rules }));
                }}
                placeholder="e.g. insider,80,POSSIBLE_INSIDER"
                style={{ resize: 'vertical', fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-start' }}>
              <button type="submit" className="btn btn-primary" style={{ padding: '12px 24px', fontSize: '15px' }}>
                Save Configuration
              </button>
            </div>
          </div>
        )}
      </form>

      {/* ─── Tab: Chain Integrity (outside form, read-only) ─── */}
      {mainTab === 'chain' && (
        <div className="logs-section" style={{ marginTop: '20px' }}>
          <div className="panel">
            <h3>Tamper-Evident Chain Integrity</h3>
            <p className="section-note" style={{ fontSize: '12px' }}>
              SEC Rule 17a-4 compliant cryptographic verification. Every audit record is linked by a SHA-256 hash chain.
              Walking the chain guarantees non-repudiation and that no records have been altered, added, or deleted.
            </p>
            
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleVerifyChain}
              disabled={verifying}
            >
              {verifying ? 'Running Verification...' : '🛡️ Run Cryptographic Verification'}
            </button>

            {verificationReport && (
              <div style={{ marginTop: '16px' }}>
                {verificationReport.verified ? (
                  <div className="alert alert-success" style={{ marginBottom: 0 }}>
                    <strong>✓ Hash Chain Integrity Verified.</strong> All {verificationReport.count} records are mathematically intact. 
                    <div style={{ fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Head Hash: {verificationReport.headHash}
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-error" style={{ marginBottom: 0 }}>
                    <strong>⚠ CRYPTOGRAPHIC VERIFICATION FAILURE:</strong> Chain integrity compromised.
                    {verificationReport.errorAt ? ` Broken link detected at event: ${verificationReport.errorAt}` : ` Reason: ${verificationReport.error || 'Unknown error'}`}
                  </div>
                )}
              </div>
            )}
          </div>

          {dailyDigests.length > 0 && (
            <div className="panel" style={{ marginTop: '20px' }}>
              <h3>Sealed Daily Digests (Anchored)</h3>
              <div className="table-container" style={{ maxHeight: '150px' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 12px', fontSize: '11px' }}>Date</th>
                      <th style={{ padding: '6px 12px', fontSize: '11px' }}>Chain Head Hash</th>
                      <th style={{ padding: '6px 12px', fontSize: '11px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyDigests.map((digest) => (
                      <tr key={digest.date_str}>
                        <td style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--text-primary)' }}>{digest.date_str}</td>
                        <td style={{ padding: '6px 12px', fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }} title={digest.hash_chain_head}>
                          {digest.hash_chain_head.slice(0, 16)}...
                        </td>
                        <td style={{ padding: '6px 12px', fontSize: '12px' }}>
                          <span className={`badge ${digest.verification_status === 'verified' ? 'badge-jira' : 'badge-confluence'}`}>
                            {digest.verification_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Tracked Event Audit Log (outside form, full width) ─── */}
      {mainTab === 'audit' && (
        <div className="logs-section" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <h2>Tracked Event Audit Log</h2>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Auto-refresh control: live polling status + on/off toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="live-timestamp">
                  {autoRefresh
                    ? (lastRefreshed ? `Updated ${new Date(lastRefreshed).toLocaleTimeString()}` : 'Live')
                    : 'Auto-refresh off'}
                </span>
                <label className="switch" title="Automatically reload the audit log when new events are recorded">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
                <span className="live-indicator">
                  <span className={`live-dot ${autoRefresh ? '' : 'is-off'}`}></span>
                  Live
                </span>
              </div>
              <button className="btn btn-secondary" onClick={handleExportCSV} disabled={filteredLogs.length === 0}>
                Export CSV
              </button>
              <button className="btn btn-secondary" onClick={handleExportJSON} disabled={filteredLogs.length === 0}>
                Export JSON
              </button>
            </div>
          </div>

          <form onSubmit={handleFilterLogs} className="logs-filter-bar" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {/* Event Date control — segmented "On | Range" toggle mirroring MCRO Hearing Search.
                Selecting a mode reveals only that mode's date field(s). */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Event Date</label>
              <div className="segmented">
                {[
                  { key: 'on', label: 'On' },
                  { key: 'range', label: 'Range' },
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`segment ${dateMode === m.key ? 'is-active' : ''}`}
                    onClick={() => setDateMode(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {dateMode === 'on' ? (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>On Date</label>
                <input
                  type="date"
                  value={onDate}
                  onChange={(e) => setOnDate(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Sort Triage By</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="date_desc">Newest First</option>
                <option value="risk_desc">⚠️ Highest Risk First</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary">Filter</button>
              <button type="button" className="btn btn-secondary" onClick={handleResetFilters}>Clear</button>
            </div>
          </form>

          <div className="form-group" style={{ marginTop: '16px' }}>
            <input 
              type="text" 
              placeholder="Search logs by Event Type, Regulated User, Actor ID, or details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sub-Tab Navigator for Review Queue */}
          <div className="subtab-bar">
            <button
              type="button"
              className={`subtab ${reviewFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setReviewFilter('all')}
            >
              📁 All Events Audit Trail
            </button>
            <button
              type="button"
              className={`subtab subtab-warn ${reviewFilter === 'pending' ? 'is-active' : ''}`}
              onClick={() => setReviewFilter('pending')}
            >
              🔥 Pending Review Queue
              <span className="subtab-count">{logs.filter(l => !l.review_status || l.review_status === 'captured' || l.review_status === 'pending-review').filter(l => l.product === productContext).length}</span>
            </button>
            <button
              type="button"
              className={`subtab subtab-ok ${reviewFilter === 'reviewed' ? 'is-active' : ''}`}
              onClick={() => setReviewFilter('reviewed')}
            >
              ✓ Dispositioned Logs
            </button>
          </div>

          {loadingLogs ? (
            <div className="loading">
              <div className="loading-spinner"></div>
              Loading audit logs...
            </div>
          ) : sortedLogs.length === 0 ? (
            <div className="empty-state">
              No audit logs found. Try adjusting filters or starting actions in Jira/Confluence.
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event Type</th>
                    <th>Regulated User</th>
                    <th>Object Type (ID)</th>
                    <th>Details</th>
                    <th>Risk Score</th>
                    <th>Status</th>
                    <th>Supervisory Triage</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLogs.map((log) => (
                    <tr key={log.event_id}>
                      <td>{new Date(Number(log.ts)).toLocaleString()}</td>
                      <td>{getFriendlyEventName(log.event_type)}</td>
                      <td>
                        <button
                          type="button"
                          className="user-pill"
                          title="View regulated user identity"
                          onClick={() => setSelectedIdentity(log)}
                        >
                          👤 <span className="pill-name">
                            {log.regulated_user_name || `${log.regulated_user_id.slice(0, 12)}…`}
                          </span>
                          {log.regulated_user_crd ? <span className="pill-crd">· CRD {log.regulated_user_crd}</span> : null}
                        </button>
                      </td>
                      <td>
                        {log.object_type} ({log.object_id.slice(0, 8)})
                      </td>
                      <td>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => setSelectedDetails({ id: log.event_id, data: log.detail })}
                        >
                          🔍 View Metadata
                        </button>
                      </td>
                      <td>
                        {(() => {
                          const risk = riskInfo(log);
                          return (
                            <span className={`risk-badge risk-${risk.tier}-tier`} title={risk.title}>
                              {risk.score} <span className="risk-source">{risk.source}</span>
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <span className={`status-badge status-${log.review_status || 'captured'}`}>
                          {log.review_status || 'captured'}
                        </span>
                      </td>
                      <td>
                        <button 
                          type="button"
                          className="btn btn-secondary" 
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => {
                            setSelectedLogForReview(log.event_id);
                            setReviewStatus(log.review_status || 'reviewed-no-concern');
                            setReviewNotes(log.notes || '');
                          }}
                        >
                          Triage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedLogForReview && (
        <div className="modal-overlay" onClick={() => setSelectedLogForReview(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Log Triage Disposition</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', wordBreak: 'break-all' }}>
              Event ID: <code>{selectedLogForReview}</code>
            </p>
            <div className="form-group">
              <label>Status</label>
              <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
                <option value="reviewed-no-concern">Reviewed (No Concern)</option>
                <option value="escalated">Escalated</option>
                <option value="remediated">Remediated</option>
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea 
                value={reviewNotes} 
                onChange={(e) => setReviewNotes(e.target.value)} 
                placeholder="Describe disposition actions..."
                rows={4}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedLogForReview(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleSubmitReview(selectedLogForReview)}
                disabled={submittingReview}
              >
                {submittingReview ? 'Submitting...' : 'Submit Disposition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDetails && (
        <div className="modal-overlay" onClick={() => setSelectedDetails(null)}>
          <div className="modal-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Compliance Event Audit Details</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Event Instance: <code>{selectedDetails.id}</code>
            </p>
            <div className="code-panel">
              <pre>
                {(() => {
                  try {
                    const parsed = typeof selectedDetails.data === 'string' ? JSON.parse(selectedDetails.data) : selectedDetails.data;
                    return JSON.stringify(parsed, null, 2);
                  } catch (e) {
                    return selectedDetails.data;
                  }
                })()}
              </pre>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedDetails(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {selectedIdentity && (
        <div className="modal-overlay" onClick={() => setSelectedIdentity(null)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title" style={{ marginBottom: '4px' }}>👤 Regulated User Identity</h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Identity snapshot captured at event time (FINRA 4511 / SEC 17a-4(j) legibility).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '13px', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Name</span>
              <span style={{ color: 'var(--text-primary)' }}>{selectedIdentity.regulated_user_name || '(unavailable)'}</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Email</span>
              <span style={{ color: 'var(--text-primary)' }}>{selectedIdentity.regulated_user_email || '(hidden / unavailable)'}</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>CRD #</span>
              <span style={{ color: 'var(--text-primary)' }}>{selectedIdentity.regulated_user_crd || '(not mapped)'}</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Account ID</span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{selectedIdentity.regulated_user_id}</span>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '12px', paddingTop: '12px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>Actor (who performed the action)</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Name</span>
                <span style={{ color: 'var(--text-primary)' }}>{selectedIdentity.actor_name || '(unavailable)'}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Email</span>
                <span style={{ color: 'var(--text-primary)' }}>{selectedIdentity.actor_email || '(hidden / unavailable)'}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Account ID</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{selectedIdentity.actor_id}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedIdentity(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

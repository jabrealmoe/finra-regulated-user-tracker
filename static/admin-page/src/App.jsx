import React, { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import PacManGame from './components/PacManGame';
import DoomyGame from './components/DoomyGame';

export default function App() {
  const [config, setConfigState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { type: 'success'|'error', message: string }
  
  // Active Game State ('pacman' | 'doomy' | null)
  const [activeGame, setActiveGame] = useState(null);
  
  // Date filters for audit log queries
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Search query for logs (client-side filter on display)
  const [searchQuery, setSearchQuery] = useState('');

  // Verification & Digest States
  const [verificationReport, setVerificationReport] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [dailyDigests, setDailyDigests] = useState([]);

  // Load configuration on mount
  useEffect(() => {
    fetchConfig();
    fetchLogs();
    fetchDigests();
  }, []);

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

  const fetchLogs = async (start, end) => {
    try {
      setLoadingLogs(true);
      const startTs = start ? new Date(start).getTime() : null;
      const endTs = end ? new Date(end).getTime() : null;
      const data = await invoke('getLogs', { startTs, endTs });
      setLogs(data || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

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
    fetchLogs(startDate, endDate);
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    fetchLogs('', '');
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

  // Filter logs list based on search bar
  const filteredLogs = logs.filter(log => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (log.event_id && log.event_id.toLowerCase().includes(query)) ||
      (log.regulated_user_id && log.regulated_user_id.toLowerCase().includes(query)) ||
      (log.actor_id && log.actor_id.toLowerCase().includes(query)) ||
      (log.event_type && log.event_type.toLowerCase().includes(query)) ||
      (log.detail && log.detail.toLowerCase().includes(query))
    );
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
    <div className="container">
      <header>
        <div>
          <h1>FINRA Regulated User Tracker</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Compliance auditing and event monitoring for regulated accounts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => setActiveGame(activeGame === 'pacman' ? null : 'pacman')}
            style={activeGame === 'pacman' ? { background: '#253858', color: '#fff' } : {}}
          >
            {activeGame === 'pacman' ? 'Hide Game' : '🎮 Play Pac-Man'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => setActiveGame(activeGame === 'doomy' ? null : 'doomy')}
            style={activeGame === 'doomy' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' } : {}}
          >
            {activeGame === 'doomy' ? 'Hide Game' : '🔥 Play Doom'}
          </button>
          <button className="btn btn-secondary" onClick={fetchConfig}>Refresh Config</button>
        </div>
      </header>

      {activeGame && (
        <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}>
          {activeGame === 'pacman' ? <PacManGame /> : <DoomyGame />}
        </div>
      )}

      {saveStatus && (
        <div className={`alert alert-${saveStatus.type}`}>
          {saveStatus.message}
        </div>
      )}

      <form onSubmit={handleSaveConfig}>
        <div className="grid">
          {/* User source selection card */}
          <div className="card">
            <h2>Regulated User Source</h2>
            
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
                  <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '6px', fontSize: '12px' }}>
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
                  <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '6px', fontSize: '12px' }}>
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
                <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '6px', fontSize: '12px' }}>
                  Enter the specific Atlassian account IDs of regulated users, separated by commas.
                </small>
              </div>
            )}
            
            <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
              Save Configuration
            </button>
          </div>

          {/* Event Category tracking toggles card */}
          <div className="card">
            <h2>Tracked Event Categories</h2>
            
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
          </div>
        </div>

        {/* Webhook Configuration Card */}
        <div className="card" style={{ marginTop: '20px' }}>
          <h2>Webhook Configuration</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
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
              <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '6px', fontSize: '12px' }}>
                Note: The destination host domain must be whitelisted in the app manifest.yml.
              </small>
            </div>
          )}

          {config.webhookTarget !== 'disabled' && config.webhookTarget !== 'custom' && (
            <div style={{ marginTop: '8px', padding: '12px', background: '#f4f5f7', borderRadius: '4px', borderLeft: '3px solid var(--accent-color)' }}>
              <small style={{ fontSize: '12px', color: '#172b4d', fontWeight: '500' }}>
                Target Endpoint: {config.webhookTarget === 'test' 
                  ? 'https://jabreal.app.n8n.cloud/webhook-test/9fd48593-a44d-4b28-bfb5-143c1aa99af5'
                  : 'https://jabreal.app.n8n.cloud/webhook/9fd48593-a44d-4b28-bfb5-143c1aa99af5'
                }
              </small>
            </div>
          )}
        </div>
      </form>

      {/* Audit Log list and Export */}
      <div className="logs-section">

        {/* Verification and Daily Digests Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', marginBottom: '24px' }}>
          {/* Verification Box */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', marginBottom: '8px' }}>Tamper-Evident Chain Integrity</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '14px', lineHeight: '1.4' }}>
              SEC Rule 17a-4 compliant cryptographic verification. Every audit record is linked by a SHA-256 hash chain.
              Walking the chain guarantees non-repudiation and that no records have been altered, added, or deleted.
            </p>
            
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleVerifyChain} 
              disabled={verifying}
              style={{ background: '#3b82f6', border: 'none' }}
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

          {/* Daily Digests Box */}
          {dailyDigests.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', marginBottom: '8px' }}>Sealed Daily Digests (Anchored)</h3>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <h2>Tracked Event Audit Log</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handleExportCSV} disabled={filteredLogs.length === 0}>
              Export CSV
            </button>
            <button className="btn btn-secondary" onClick={handleExportJSON} disabled={filteredLogs.length === 0}>
              Export JSON
            </button>
          </div>
        </div>

        <form onSubmit={handleFilterLogs} className="logs-filter-bar">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Start Date</label>
            <input 
              type="text" 
              placeholder="YYYY-MM-DD" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input 
              type="text" 
              placeholder="YYYY-MM-DD" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
            />
          </div>
          <button type="submit" className="btn btn-primary">Filter</button>
          <button type="button" className="btn btn-secondary" onClick={handleResetFilters}>Clear</button>
        </form>

        <div className="form-group" style={{ marginTop: '16px' }}>
          <input 
            type="text" 
            placeholder="Search logs by Event Type, Regulated User, Actor ID, or details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loadingLogs ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            Loading audit logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            No audit logs found. Try adjusting filters or starting actions in Jira/Confluence.
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Product</th>
                  <th>Event Type</th>
                  <th>Regulated User</th>
                  <th>Actor</th>
                  <th>Object Type (ID)</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.event_id}>
                    <td>{new Date(Number(log.ts)).toLocaleString()}</td>
                    <td>
                      <span className={`badge badge-${log.product}`}>
                        {log.product}
                      </span>
                    </td>
                    <td>{log.event_type.split(':').pop() || log.event_type}</td>
                    <td title={log.regulated_user_id}>
                      {log.regulated_user_id.slice(0, 15)}...
                    </td>
                    <td title={log.actor_id}>
                      {log.actor_id.slice(0, 15)}...
                    </td>
                    <td>
                      {log.object_type} ({log.object_id.slice(0, 8)})
                    </td>
                    <td title={log.detail}>
                      {log.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { PageHeader, Spinner, ErrorState } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import FormField from '../components/ui/FormField.jsx';

export default function SmsGatewaySettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    provider: 'jdsms',
    apiKey: '',
    senderId: 'UDGAMF',
    peId: '1701171990575365167',
    routeId: '14',
    campaign: '4',
    url: 'https://jdsms.co.in/app/smsapi/index.php',
  });

  const [testForm, setTestForm] = useState({
    mobile: '',
    templateKey: 'MOBILE_OTP',
  });
  const [testResult, setTestResult] = useState(null);

  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.superAdmin.getSmsGateway();
      if (res?.config) {
        setForm((prev) => ({
          ...prev,
          ...res.config,
          apiKey: res.config.apiKey || '',
        }));
      }
      if (res?.templates) {
        setTemplates(res.templates);
      }
    } catch (err) {
      setError(err.message || 'Failed to load SMS Gateway configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.superAdmin.saveSmsGateway(form);
      toast.success('SMS Gateway settings saved successfully!');
      loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (e) => {
    e.preventDefault();
    if (!testForm.mobile || testForm.mobile.replace(/\D/g, '').length !== 10) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const selectedTpl = templates.find((t) => t.key === testForm.templateKey);
      const res = await api.superAdmin.testSmsGateway({
        mobile: testForm.mobile,
        templateKey: testForm.templateKey,
        templateId: selectedTpl?.id,
      });
      setTestResult(res);
      if (res.success) {
        toast.success(res.message || 'Test SMS sent successfully!');
      } else {
        toast.error(res.message || 'Failed to send test SMS');
      }
    } catch (err) {
      setTestResult({ success: false, error: err.message });
      toast.error(err.message || 'Error executing test SMS');
    } finally {
      setTesting(false);
    }
  };

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.id.includes(search) ||
      t.sample.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="page-wrap">
        <PageHeader title="SMS Gateway Settings" description="Indian DLT SMS Gateway Configuration & Approved Templates" />
        <Spinner label="Loading SMS gateway configuration..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-wrap">
        <PageHeader title="SMS Gateway Settings" description="Indian DLT SMS Gateway Configuration & Approved Templates" />
        <ErrorState message={error} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <PageHeader
        title="SMS Gateway & DLT Templates"
        description="Live SMS Gateway integration with Indian TRAI/DLT approved templates for OTP, Loan Disburse, Approval, EMI & Alerts."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 24 }}>
        {/* Gateway Configuration Card */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚙️</span> Gateway Credentials
          </h3>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormField id="provider" label="Gateway Provider">
                <select
                  id="provider"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                >
                  <option value="jdsms">JDSMS (Live Indian DLT Gateway - Default)</option>
                  <option value="fast2sms">Fast2SMS</option>
                  <option value="custom_url">Custom HTTP URL</option>
                </select>
              </FormField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField id="senderId" label="Sender ID (DLT Header)">
                  <input
                    id="senderId"
                    type="text"
                    value={form.senderId}
                    onChange={(e) => setForm({ ...form, senderId: e.target.value })}
                    placeholder="UDGAMF"
                    required
                  />
                </FormField>

                <FormField id="routeId" label="Route ID">
                  <input
                    id="routeId"
                    type="text"
                    value={form.routeId}
                    onChange={(e) => setForm({ ...form, routeId: e.target.value })}
                    placeholder="14"
                    required
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField id="peId" label="Entity ID (PE ID)">
                  <input
                    id="peId"
                    type="text"
                    value={form.peId}
                    onChange={(e) => setForm({ ...form, peId: e.target.value })}
                    placeholder="1701171990575365167"
                    required
                  />
                </FormField>

                <FormField id="campaign" label="Campaign ID">
                  <input
                    id="campaign"
                    type="text"
                    value={form.campaign}
                    onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                    placeholder="4"
                    required
                  />
                </FormField>
              </div>

              <FormField id="apiKey" label="API Key">
                <input
                  id="apiKey"
                  type="text"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="2684535DF6A926"
                  required
                />
              </FormField>

              <FormField id="url" label="API Endpoint URL">
                <input
                  id="url"
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://jdsms.co.in/app/smsapi/index.php"
                />
              </FormField>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ marginTop: 8 }}
              >
                {saving ? 'Saving Settings...' : 'Save Gateway Settings'}
              </button>
            </div>
          </form>
        </div>

        {/* Live SMS Tester Card */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📲</span> Live SMS Dispatch Tester
          </h3>
          <p className="small muted" style={{ marginTop: -8, marginBottom: 16 }}>
            Send a real test SMS to verify carrier delivery and DLT template matching.
          </p>

          <form onSubmit={handleTest}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormField id="testMobile" label="Test Mobile Number (10 digits)">
                <input
                  id="testMobile"
                  type="tel"
                  maxLength={10}
                  value={testForm.mobile}
                  onChange={(e) => setTestForm({ ...testForm, mobile: e.target.value.replace(/\D/g, '') })}
                  placeholder="9876543210"
                  required
                />
              </FormField>

              <FormField id="testTemplate" label="Select DLT Template to Test">
                <select
                  id="testTemplate"
                  value={testForm.templateKey}
                  onChange={(e) => setTestForm({ ...testForm, templateKey: e.target.value })}
                >
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} (ID: {t.id})
                    </option>
                  ))}
                </select>
              </FormField>

              {/* Template Preview */}
              {(() => {
                const cur = templates.find((t) => t.key === testForm.templateKey);
                if (!cur) return null;
                return (
                  <div style={{ background: '#f8f9fa', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>
                      Message Preview (DLT Exact Match)
                    </div>
                    <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.5 }}>
                      {cur.sample}
                    </div>
                  </div>
                );
              })()}

              <button
                type="submit"
                className="btn btn-secondary"
                disabled={testing}
                style={{ marginTop: 8 }}
              >
                {testing ? 'Sending Test SMS...' : 'Send Live Test SMS'}
              </button>

              {testResult && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 6,
                    border: `1px solid ${testResult.success ? '#86efac' : '#fca5a5'}`,
                    background: testResult.success ? '#f0fdf4' : '#fef2f2',
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: testResult.success ? '#15803d' : '#b91c1c' }}>
                    {testResult.success ? '✓ Dispatch Successful' : '✕ Dispatch Failed'}
                  </div>
                  <div style={{ marginTop: 4, color: '#334155' }}>
                    {testResult.message}
                  </div>
                  {testResult.shootId && (
                    <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12, color: '#0f766e' }}>
                      Shoot ID: {testResult.shootId}
                    </div>
                  )}
                  {testResult.error && (
                    <div style={{ marginTop: 4, color: '#b91c1c', fontSize: 12 }}>
                      {testResult.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* DLT Templates Directory */}
      <div className="panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>Approved DLT Templates ({templates.length})</h3>
            <p className="small muted" style={{ margin: '4px 0 0 0' }}>
              Entity ID: <strong>1701171990575365167</strong> | Sender ID: <strong>UDGAMF</strong>
            </p>
          </div>
          <input
            type="search"
            placeholder="Search templates by name, ID or text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280, padding: '6px 12px', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {filteredTemplates.map((t) => (
            <div
              key={t.key}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 14,
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{t.name}</div>
                  <span
                    style={{
                      background: '#dcfce7',
                      color: '#15803d',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Auto Approved
                  </span>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                  ID: {t.id}
                </div>
                <div
                  style={{
                    background: '#f8fafc',
                    padding: 10,
                    borderRadius: 6,
                    fontSize: 13,
                    color: '#334155',
                    lineHeight: 1.45,
                    border: '1px solid #f1f5f9',
                  }}
                >
                  {t.sample}
                </div>
              </div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    setTestForm((prev) => ({ ...prev, templateKey: t.key }));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{ fontSize: 12, padding: '3px 8px' }}
                >
                  Test This Template
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


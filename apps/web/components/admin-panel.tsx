'use client';
import { useEffect, useState, type Dispatch, type SetStateAction, type FormEvent } from 'react';
import { ArrowUpRight, Download, Plus, Save, ShieldCheck, Upload, Users } from 'lucide-react';
import type { User } from './demo';
import { Avatar, Field, Modal, type Request } from './ui';
type Settings = {
  audioRetentionDays: number;
  transcriptRetentionDays: number;
  minutesRetentionDays: number;
  userQuotaBytes?: number;
};
type License = {
  mode?: string;
  seatBand?: number;
  activeSeats?: number;
  updatesAvailable?: boolean;
  message?: string;
  expired?: boolean;
  daysRemaining?: number;
};
type Hardware = {
  tier?: string;
  label?: string;
  cpuCores?: number;
  ramGb?: number;
  gpu?: unknown;
  meetsRecommendation?: boolean;
  [key: string]: unknown;
};
type Audit = { id: string; actorName?: string; action: string; createdAt: string; targetType?: string };
export function AdminPanel({
  demo,
  api,
  users,
  setUsers,
  onError,
}: {
  demo: boolean;
  api: Request;
  users: User[];
  setUsers: Dispatch<SetStateAction<User[]>>;
  onError: (e: unknown) => void;
}) {
  const [tab, setTab] = useState('people'),
    [invite, setInvite] = useState(false),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(''),
    [license, setLicense] = useState<License>({}),
    [hardware, setHardware] = useState<Hardware>({}),
    [retention, setRetention] = useState<Settings>({
      audioRetentionDays: 90,
      transcriptRetentionDays: 365,
      minutesRetentionDays: 0,
      userQuotaBytes: 104857600,
    }),
    [audit, setAudit] = useState<Audit[]>([]),
    [filter, setFilter] = useState('');
  useEffect(() => {
    if (demo) {
      setLicense({ mode: 'demo', seatBand: 100, activeSeats: 12, updatesAvailable: true });
      setHardware({
        tier: 'Pilot',
        label: 'Illustrative hardware profile',
        cpuCores: 8,
        ramGb: 32,
        gpu: false,
      });
      return;
    }
    let alive = true;
    Promise.all([
      api<User[]>('/admin/users'),
      api<License>('/admin/license'),
      api<Settings>('/admin/retention'),
      api<Hardware>('/admin/hardware'),
      api<Audit[]>('/admin/audit'),
    ])
      .then(([u, l, r, h, a]) => {
        if (alive) {
          setUsers(u);
          setLicense(l);
          setRetention({ ...retention, ...r });
          setHardware(h);
          setAudit(a);
        }
      })
      .catch(onError);
    return () => {
      alive = false;
    };
  }, [demo, api]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback('');
    try {
      await action();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await run(async () => {
      const u = demo
        ? {
            id: crypto.randomUUID(),
            displayName: String(values.displayName),
            email: String(values.email),
            role: String(values.role),
            isActive: true,
          }
        : await api<User>('/admin/users', 'POST', values);
      setUsers((all) => [...all, u]);
      setInvite(false);
      setFeedback(
        'Person added. Share their temporary credentials directly through your organisation’s approved channel.',
      );
    });
  }
  async function update(u: User, patch: Partial<User>) {
    await run(async () => {
      const changed = demo ? { ...u, ...patch } : await api<User>(`/admin/users/${u.id}`, 'PATCH', patch);
      setUsers((all) => all.map((x) => (x.id === u.id ? changed : x)));
      setFeedback('Account updated.');
    });
  }
  return (
    <>
      <div className="view-header">
        <div>
          <div className="eyebrow">THE WAY YOUR ORGANISATION WORKS.</div>
          <h1>Settings & people.</h1>
          <p>One workspace. Clear boundaries. You’re in control.</p>
        </div>
        {tab === 'people' && (
          <button className="button black" onClick={() => setInvite(true)}>
            <Plus size={14} />
            Add person
          </button>
        )}
      </div>
      {feedback && (
        <div className="notice" role="status">
          {feedback}
        </div>
      )}
      <div className="feed-tabs">
        {['people', 'retention', 'license', 'hardware', 'audit'].map((t) => (
          <button className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} key={t}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'people' && (
        <div className="admin-panel">
          <h2>The people who make it.</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={u.displayName} />
                      <span>
                        {u.displayName}
                        <small style={{ display: 'block', fontSize: 8, marginTop: 6, color: '#758565' }}>
                          {u.email}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${u.displayName}`}
                      value={u.role}
                      style={{
                        background: 'transparent',
                        padding: 6,
                        border: '1px solid #a7b592',
                        fontSize: 10,
                      }}
                      onChange={(e) => void update(u, { role: e.target.value })}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      onClick={() => void update(u, { isActive: u.isActive === false })}
                    >
                      {u.isActive === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="form-hint" style={{ marginTop: 20 }}>
            Only administrators can create accounts. Deactivated members lose access immediately.
          </p>
        </div>
      )}
      {tab === 'retention' && (
        <form
          className="admin-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!demo) setRetention(await api('/admin/retention', 'PATCH', retention));
              setFeedback('Retention settings saved. The scheduled purge applies these windows.');
            });
          }}
        >
          <h2>Keep what matters.</h2>
          <p style={{ marginBottom: 25 }}>
            Choose how long to retain meeting data. Set a window to 0 to keep it indefinitely. Audio is only
            removed after publication; published minutes follow their own window.
          </p>
          <div className="form-row">
            {(['audioRetentionDays', 'transcriptRetentionDays', 'minutesRetentionDays'] as const).map(
              (key) => (
                <Field
                  label={
                    key === 'audioRetentionDays'
                      ? 'Audio retention (days)'
                      : key === 'transcriptRetentionDays'
                        ? 'Transcript retention (days)'
                        : 'Minutes retention (days)'
                  }
                  key={key}
                >
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={3650}
                    required
                    value={retention[key]}
                    onChange={(e) => setRetention({ ...retention, [key]: Number(e.target.value) })}
                  />
                </Field>
              ),
            )}
            <Field label="Per-person storage quota (MB)">
              <input
                className="input"
                type="number"
                min={1}
                max={102400}
                value={Math.round((retention.userQuotaBytes || 104857600) / 1048576)}
                onChange={(e) =>
                  setRetention({ ...retention, userQuotaBytes: Number(e.target.value) * 1048576 })
                }
              />
            </Field>
          </div>
          <button className="button black" disabled={busy}>
            <Save size={14} />
            Save settings
          </button>
        </form>
      )}
      {tab === 'license' && (
        <div className="admin-grid">
          <section className="admin-panel">
            <h2>Your license.</h2>
            <p>
              Mode: <strong>{license.mode || 'Loading'}</strong>
            </p>
            <p>
              {license.activeSeats ?? users.length} active people / {license.seatBand ?? '—'} licensed seats
            </p>
            <p>
              {license.updatesAvailable === false
                ? 'Maintenance expired. Updates are unavailable; sign-in remains enabled.'
                : 'Maintenance and evaluation status are verified by this appliance.'}
            </p>
            {license.message && (
              <div className="notice" style={{ marginTop: 20 }}>
                {license.message}
              </div>
            )}
            {license.expired && (
              <div className="notice">The evaluation has ended. Install a license to add people.</div>
            )}
          </section>
          <section className="admin-panel">
            <h2>Install a signed license.</h2>
            <p>
              Choose the license file issued to your organisation. The appliance verifies its Ed25519
              signature.
            </p>
            <label className="upload-drop" style={{ marginTop: 20 }}>
              <Upload size={23} />
              <span>Choose license file</span>
              <input
                type="file"
                accept=".json,.license,.txt"
                disabled={busy}
                aria-label="License file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (demo) {
                        setFeedback('License verification is available in a connected workspace.');
                        return;
                      }
                      setLicense(await api('/admin/license', 'POST', { raw: await file.text() }));
                      setFeedback('License verified and installed.');
                    });
                }}
              />
            </label>
          </section>
        </div>
      )}
      {tab === 'hardware' && (
        <div className="admin-panel">
          <h2>The place your data lives.</h2>
          <p>
            {demo
              ? 'Illustrative demo profile. Connect a real appliance to inspect its hardware.'
              : 'Detected by the local hardware adapter. Confirm GPU support with the appliance preflight before production use.'}
          </p>
          <pre>{JSON.stringify(hardware, null, 2)}</pre>
        </div>
      )}
      {tab === 'audit' && (
        <div className="admin-panel">
          <h2>A clear record.</h2>
          <div className="form-row" style={{ alignItems: 'end' }}>
            <Field label="Filter by action">
              <input
                className="input"
                placeholder="e.g. auth.login"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
            {!demo && (
              <a
                className="button small"
                style={{ marginBottom: 18 }}
                href={`/api/admin/audit?format=csv&limit=1000${filter ? `&action=${encodeURIComponent(filter)}` : ''}`}
                download
              >
                <Download size={13} />
                Export CSV
              </a>
            )}
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {audit
                .filter((a) => !filter || a.action.includes(filter))
                .map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                    <td>{a.actorName || 'System'}</td>
                    <td>{a.action}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!audit.length && (
            <p className="form-hint" style={{ marginTop: 18 }}>
              {demo ? 'Audit records are created in the connected workspace.' : 'No audit events yet.'}
            </p>
          )}
        </div>
      )}
      {invite && (
        <Modal title="Bring someone in." onClose={() => setInvite(false)}>
          <form onSubmit={create}>
            <Field label="Name">
              <input className="input" name="displayName" required />
            </Field>
            <Field label="Email">
              <input className="input" name="email" type="email" required />
            </Field>
            <Field label="Temporary password (at least 12 characters)">
              <input
                className="input"
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Role">
              <select name="role" className="input">
                <option value="member">Member</option>
                <option value="admin">Organisation admin</option>
              </select>
            </Field>
            <p className="form-hint">
              The person can sign in with these credentials. Mane does not send invitation emails.
            </p>
            <div className="form-footer">
              <button className="button black" disabled={busy}>
                Add person <ArrowUpRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

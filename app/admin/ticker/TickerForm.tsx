'use client';

import { useEffect, useState } from 'react';
import type { CurrentTicker, TickerHistoryRow, TickerOverrideRow } from '@/lib/ticker';

const INK   = '#22201C';
const INK2  = '#5C564E';
const FAINT = '#938C81';
const LINE  = 'rgba(34,32,28,0.08)';
const AMBER = '#E8863E';

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) + ' MT';
}

function isLive(o: TickerOverrideRow): boolean {
  if (!o.enabled || !o.message.trim()) return false;
  const now = Date.now();
  if (o.starts_at && new Date(o.starts_at).getTime() > now) return false;
  if (o.ends_at && new Date(o.ends_at).getTime() < now) return false;
  return true;
}

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm c2ui focus:outline-none transition';
const inputStyle = { borderColor: 'rgba(237,220,206,0.85)', background: 'rgba(255,255,255,0.85)', color: INK };

export default function TickerForm({
  initialOverride,
  initialCurrent,
  dbConfigured,
}: {
  initialOverride: TickerOverrideRow | null;
  initialCurrent: CurrentTicker;
  dbConfigured: boolean;
}) {
  const [message, setMessage] = useState('');
  const [endsAt, setEndsAt] = useState(() =>
    isoToLocalInput(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString())
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [override, setOverride] = useState<TickerOverrideRow | null>(initialOverride);
  const [current, setCurrent] = useState<CurrentTicker>(initialCurrent);
  const [history, setHistory] = useState<TickerHistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [restored, setRestored] = useState<Record<number, string>>({});

  // editing an existing scheduled message
  const [editMsg, setEditMsg] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch('/api/ticker?history=1')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.history)) setHistory(d.history); })
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, []);

  async function refreshCurrent() {
    const cur = await fetch('/api/ticker').then(r => r.json()).catch(() => null);
    if (cur) setCurrent(cur);
    const ov = await fetch('/api/ticker?override=1').then(r => r.json()).catch(() => null);
    if (ov?.override !== undefined) setOverride(ov.override);
  }

  async function post() {
    if (!message.trim()) return;
    setSaving(true); setNotice(null);
    try {
      const res = await fetch('/api/ticker', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, message, starts_at: null, ends_at: localInputToIso(endsAt) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'err', text: data.error || `Failed (${res.status})` }); }
      else {
        setOverride(data.override);
        setMessage('');
        setEndsAt(isoToLocalInput(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()));
        setNotice({ kind: 'ok', text: 'Posted ✓' });
        await refreshCurrent();
      }
    } catch { setNotice({ kind: 'err', text: 'Network error.' }); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    setSaving(true); setNotice(null);
    try {
      const res = await fetch('/api/ticker', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, message: editMsg, starts_at: null, ends_at: localInputToIso(editEndsAt) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'err', text: data.error || `Failed (${res.status})` }); }
      else { setOverride(data.override); setEditing(false); setNotice({ kind: 'ok', text: 'Updated ✓' }); await refreshCurrent(); }
    } catch { setNotice({ kind: 'err', text: 'Network error.' }); }
    finally { setSaving(false); }
  }

  async function deleteOverride() {
    setSaving(true);
    try {
      await fetch('/api/ticker', { method: 'DELETE' });
      setOverride(null);
      setEditing(false);
      await refreshCurrent();
    } catch {}
    finally { setSaving(false); }
  }

  async function deleteHistory(id: number) {
    await fetch(`/api/ticker?id=${id}`, { method: 'DELETE' });
    setHistory(h => h.filter(r => r.id !== id));
  }

  async function restoreHistory(row: { id: number; text: string }) {
    const endsAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const res = await fetch('/api/ticker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, message: row.text, starts_at: null, ends_at: endsAt }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setOverride(data.override);
      setRestored(r => ({ ...r, [row.id]: fmt(endsAt) }));
      await refreshCurrent();
    }
  }

  const liveOverride = override && isLive(override) ? override : null;
  const futureOverride = override && !isLive(override) && override.enabled && override.message.trim()
    && override.starts_at && new Date(override.starts_at).getTime() > Date.now() ? override : null;

  return (
    <div className="flex flex-col gap-5">

      {/* Live now */}
      <section className="rounded-[26px] border overflow-hidden" style={{ borderColor: 'rgba(237,220,206,0.85)', background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24)' }}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Showing on intranet right now</div>
        </div>
        <div className="px-6 py-4">
          {current.text ? (
            <div className="rounded-xl px-4 py-2.5 overflow-hidden" style={{ background: 'linear-gradient(90deg, rgba(232,134,62,0.12), rgba(232,134,62,0.06))', border: '1px solid rgba(232,134,62,0.25)' }}>
              <p className="c2ui text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: INK }}>{current.text}</p>
            </div>
          ) : (
            <p className="c2ui text-sm italic" style={{ color: FAINT }}>No ticker message yet</p>
          )}
          {current.source === 'override' && liveOverride?.ends_at && (
            <p className="c2ui text-[11px] mt-2" style={{ color: FAINT }}>Override active · expires {fmt(liveOverride.ends_at)}</p>
          )}
        </div>
      </section>

      {/* Compose new message */}
      <section className="rounded-[26px] border" style={{ borderColor: 'rgba(237,220,206,0.85)', background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24)' }}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Post a message</div>
          <p className="c2ui text-[12.5px] mt-0.5" style={{ color: INK2 }}>Replaces the automatic ticker until the end time.</p>
        </div>
        <div className="px-6 py-5 flex flex-col gap-3">
          <label className="block">
            <span className="c2ui text-xs font-semibold" style={{ color: INK }}>Message</span>
            <input
              type="text"
              value={message}
              maxLength={280}
              onChange={e => setMessage(e.target.value.replace(/[\r\n]+/g, ' '))}
              placeholder="e.g. All-hands meeting Friday 8am at Cottonwood — breakfast provided"
              className={inputCls}
              style={inputStyle}
            />
            <span className="c2ui text-[11px]" style={{ color: FAINT }}>{message.length}/280</span>
          </label>
          <label className="block">
            <span className="c2ui text-xs font-semibold" style={{ color: INK }}>Expires <span className="font-normal" style={{ color: FAINT }}>(defaults to 12 hrs from now)</span></span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={e => setEndsAt(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </label>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={post}
              disabled={saving || !dbConfigured || !message.trim()}
              className="c2ui px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ background: AMBER }}
            >
              {saving ? 'Posting…' : 'Post now'}
            </button>
            {notice && (
              <span className="c2ui text-xs font-semibold" style={{ color: notice.kind === 'ok' ? '#3E8E5E' : '#C05A2E' }}>{notice.text}</span>
            )}
          </div>
        </div>
      </section>

      {/* Scheduled / active override */}
      {(liveOverride || futureOverride) && (
        <section className="rounded-[26px] border" style={{ borderColor: 'rgba(232,134,62,0.30)', background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24)' }}>
          <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${LINE}` }}>
            <div>
              <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: liveOverride ? '#B5631F' : FAINT }}>
                {liveOverride ? 'Active override' : 'Scheduled'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!editing && (
                <button onClick={() => { setEditMsg(override!.message); setEditEndsAt(isoToLocalInput(override!.ends_at)); setEditing(true); }}
                  className="c2ui text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                  style={{ color: INK2, background: 'rgba(34,32,28,0.06)' }}>Edit</button>
              )}
              <button onClick={deleteOverride} disabled={saving}
                className="c2ui text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                style={{ color: '#C05A2E', background: 'rgba(192,90,46,0.08)' }}>Delete</button>
            </div>
          </div>
          <div className="px-6 py-4">
            {editing ? (
              <div className="flex flex-col gap-3">
                <input type="text" value={editMsg} maxLength={280}
                  onChange={e => setEditMsg(e.target.value.replace(/[\r\n]+/g, ' '))}
                  className={inputCls} style={inputStyle} />
                <input type="datetime-local" value={editEndsAt}
                  onChange={e => setEditEndsAt(e.target.value)}
                  className={inputCls} style={inputStyle} />
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="c2ui px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
                    style={{ background: AMBER }}>{saving ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setEditing(false)}
                    className="c2ui px-4 py-2 rounded-xl text-sm font-semibold transition"
                    style={{ color: INK2, background: 'rgba(34,32,28,0.06)' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <p className="c2ui text-sm" style={{ color: INK }}>{override!.message}</p>
                {override!.ends_at && (
                  <p className="c2ui text-[11px] mt-1.5" style={{ color: FAINT }}>Expires {fmt(override!.ends_at)}</p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* History */}
      <section className="rounded-[26px] border" style={{ borderColor: 'rgba(237,220,206,0.85)', background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24)' }}>
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Recent messages</div>
        </div>
        <div className="divide-y" style={{ borderColor: LINE }}>
          {histLoading && (
            <div className="px-6 py-4 c2ui text-sm italic" style={{ color: FAINT }}>Loading…</div>
          )}
          {!histLoading && history.length === 0 && (
            <div className="px-6 py-4 c2ui text-sm italic" style={{ color: FAINT }}>No messages yet</div>
          )}
          {history.map(row => (
            <div key={row.id} className="px-6 py-3.5 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="c2ui text-sm truncate" style={{ color: INK }}>{row.text}</p>
                {restored[row.id] ? (
                  <p className="c2ui text-[11px] mt-0.5 font-semibold" style={{ color: '#3E8E5E' }}>Live now · expires {restored[row.id]}</p>
                ) : (
                  <p className="c2ui text-[11px] mt-0.5" style={{ color: FAINT }}>{fmt(row.created_at)} · {row.source}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!restored[row.id] && (
                  <button onClick={() => restoreHistory(row)}
                    className="c2ui text-xs font-semibold px-2.5 py-1 rounded-lg transition"
                    style={{ color: INK2, background: 'rgba(34,32,28,0.06)' }}>Restore</button>
                )}
                <button onClick={() => deleteHistory(row.id)}
                  className="c2ui text-xs font-semibold px-2.5 py-1 rounded-lg transition"
                  style={{ color: FAINT, background: 'rgba(34,32,28,0.05)' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Headphones,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { minutesSchema, type Minutes } from '@mane/shared';
import { demoMinutes, demoTranscript, type Meeting, type MeetingDetail, type User } from './demo';
import { Badge, Empty, Field, clock, type Request } from './ui';
export function MeetingReview({
  id,
  demo,
  meetings,
  api,
  user,
  onBack,
  onError,
  onPublished,
}: {
  id: string;
  demo: boolean;
  meetings: Meeting[];
  api: Request;
  user: User;
  onBack: () => void;
  onError: (e: unknown) => void;
  onPublished: (id: string, content: Minutes) => void;
}) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null),
    [content, setContent] = useState<Minutes | null>(null),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [feedback, setFeedback] = useState('');
  const player = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<{ start_s: number; end_s: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setEditing(false);
    setFeedback('');
    if (demo) {
      const meeting = meetings.find((m) => m.id === id);
      if (meeting) {
        let c = { ...demoMinutes, title: meeting.title };
        try {
          const saved = JSON.parse(localStorage.getItem(`mane-demo-minutes-${id}`) || 'null');
          if (saved) c = saved;
        } catch {}
        setDetail({
          meeting,
          minutes: { content: c, version: 1 },
          transcript: { segments: demoTranscript },
          audio: null,
        });
        setContent(c);
      }
      return;
    }
    api<MeetingDetail>(`/meetings/${id}`)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setContent(d.minutes?.content || null);
        }
      })
      .catch(onError);
    return () => {
      alive = false;
    };
  }, [id, demo, api]);
  useEffect(() => {
    if (demo || !detail || ['review', 'published', 'failed'].includes(detail.meeting.status)) return;
    let alive = true;
    const interval = setInterval(() => {
      api<MeetingDetail>(`/meetings/${id}`)
        .then((d) => {
          if (alive) {
            setDetail(d);
            if (d.minutes) setContent(d.minutes.content);
          }
        })
        .catch(onError);
    }, 2500);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [id, demo, api, detail?.meeting.status]);
  async function save(approve = false) {
    if (!content || !detail) return;
    setBusy(true);
    setFeedback('');
    try {
      const valid = minutesSchema.parse(content);
      if (demo) {
        localStorage.setItem(`mane-demo-minutes-${id}`, JSON.stringify(valid));
        setDetail({
          ...detail,
          meeting: { ...detail.meeting, status: approve ? 'published' : detail.meeting.status },
          minutes: { ...detail.minutes, content: valid, version: (detail.minutes?.version || 1) + 1 },
        });
      } else {
        if (editing) {
          const minutes = await api<NonNullable<MeetingDetail['minutes']>>(
            `/meetings/${id}/minutes`,
            'PATCH',
            { content: valid, version: detail.minutes?.version },
          );
          setDetail({ ...detail, minutes });
        }
        if (approve) {
          const meeting = await api<Meeting>(`/meetings/${id}/approve`, 'POST', {});
          setDetail((d) => (d ? { ...d, meeting } : d));
        }
      }
      setEditing(false);
      setFeedback(approve ? 'Approved.' : 'Draft saved.');
      if (approve) onPublished(id, valid);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  function evidence(span: { start_s: number; end_s: number }) {
    setSelectedEvidence(span);
    if (player.current) {
      stopAt.current = span.end_s;
      player.current.currentTime = span.start_s;
      player.current.play().catch(onError);
    } else
      setFeedback(
        demo
          ? 'This is illustrative evidence. The demo has no audio recording.'
          : 'The audio is no longer available under your organisation’s retention policy.',
      );
  }
  const canReview =
    detail &&
    (user.role === 'admin' || detail.meeting.reviewerId === user.id) &&
    detail.meeting.status === 'review';
  function strings(key: 'agenda' | 'open_questions' | 'risks' | 'confidence_notes', label: string) {
    if (!content) return null;
    return (
      <section className="review-section">
        <h3>{label}</h3>
        {editing ? (
          <textarea
            className="input"
            aria-label={label}
            value={content[key].join('\n')}
            onChange={(e) => setContent({ ...content, [key]: e.target.value.split('\n') })}
          />
        ) : content[key].length ? (
          content[key].map((s, i) => (
            <p className="review-item" style={{ fontSize: 11, lineHeight: 1.8 }} key={i}>
              {s}
            </p>
          ))
        ) : (
          <p className="form-hint">None recorded.</p>
        )}
      </section>
    );
  }
  if (!detail)
    return (
      <>
        <button className="button small" onClick={onBack}>
          <ArrowLeft size={14} />
          All meetings
        </button>
        <div className="loading-page" style={{ minHeight: 350 }}>
          <LoaderCircle className="spin" size={20} />
          Loading meeting…
        </div>
      </>
    );
  return (
    <>
      <button className="button small" onClick={onBack} style={{ marginBottom: 25 }}>
        <ArrowLeft size={13} />
        All meetings
      </button>
      <div className="view-header">
        <div>
          <div className="eyebrow">A RECORD WORTH KEEPING.</div>
          <h1>{detail.meeting.title}</h1>
          <p>Check the evidence. Refine the draft. Move the work forward.</p>
        </div>
        <Badge status={detail.meeting.status} />
      </div>
      {feedback && (
        <div role="status" className="notice">
          {feedback}
        </div>
      )}
      {!content ? (
        <>
          <Empty
            title={
              detail.meeting.status === 'failed' ? 'This meeting needs attention.' : 'Clarity is on its way.'
            }
          >
            {detail.meeting.status === 'failed'
              ? 'The local worker could not finish this recording. Review the details below, then retry.'
              : 'Your recording is being processed locally. This page updates as transcription and drafting finish.'}
          </Empty>
          <div className="review-sheet" style={{ marginTop: 20 }}>
            {detail.jobs?.map((j, i) => (
              <div key={i} className="action-row">
                <div style={{ flex: 1 }}>
                  <p>{j.kind}</p>
                  {j.error && <small style={{ whiteSpace: 'pre-wrap' }}>{j.error}</small>}
                </div>
                <Badge status={j.status} />
              </div>
            ))}
            {detail.meeting.status === 'failed' && (
              <button
                className="button black"
                style={{ marginTop: 20 }}
                onClick={() =>
                  void api(`/meetings/${id}/retry`, 'POST', {})
                    .then(() => api<MeetingDetail>(`/meetings/${id}`))
                    .then(setDetail)
                    .catch(onError)
                }
              >
                <RefreshCw size={14} />
                Retry processing
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="review-layout">
          <article className="review-sheet">
            {editing ? (
              <>
                <Field label="Minutes title">
                  <input
                    className="input"
                    value={content.title}
                    onChange={(e) => setContent({ ...content, title: e.target.value })}
                  />
                </Field>
                <Field label="Held at (ISO date and time)">
                  <input
                    className="input"
                    value={content.held_at || ''}
                    onChange={(e) => setContent({ ...content, held_at: e.target.value || null })}
                  />
                </Field>
              </>
            ) : (
              <h2>{content.title}</h2>
            )}
            <div className="eyebrow" style={{ color: '#6b765e', fontSize: 8 }}>
              MEETING MINUTES / {detail.minutes?.version || 1}.0
            </div>
            <section className="review-section">
              <h3>In the room</h3>
              {editing ? (
                <textarea
                  className="input"
                  aria-label="Attendees, one per line"
                  value={content.attendees.map((a) => a.name).join('\n')}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      attendees: e.target.value
                        .split('\n')
                        .map(
                          (name) =>
                            content.attendees.find((a) => a.name === name) || { name, matched_user_id: null },
                        ),
                    })
                  }
                />
              ) : (
                <p style={{ fontSize: 11, lineHeight: 1.9 }}>
                  {content.attendees.map((a) => a.name).join(' · ') || 'No attendees identified.'}
                </p>
              )}
            </section>
            <section className="review-section">
              <h3>The summary</h3>
              {editing ? (
                <textarea
                  className="input"
                  aria-label="Summary"
                  value={content.summary}
                  onChange={(e) => setContent({ ...content, summary: e.target.value })}
                />
              ) : (
                <p style={{ fontSize: 12, lineHeight: 1.95 }}>{content.summary}</p>
              )}
            </section>
            {strings('agenda', 'Agenda')}
            <section className="review-section">
              <h3>What we decided</h3>
              {content.decisions.map((item, i) => (
                <div className="review-item" key={i}>
                  {editing ? (
                    <textarea
                      className="input"
                      aria-label={`Decision ${i + 1}`}
                      value={item.text}
                      onChange={(e) =>
                        setContent({
                          ...content,
                          decisions: content.decisions.map((d, j) =>
                            j === i ? { ...d, text: e.target.value } : d,
                          ),
                        })
                      }
                    />
                  ) : (
                    <p>
                      <strong>{String(i + 1).padStart(2, '0')} / </strong>
                      {item.text}
                    </p>
                  )}
                  {item.evidence.map((span, j) =>
                    editing ? (
                      <EvidenceEditor
                        key={j}
                        span={span}
                        onChange={(value) =>
                          setContent({
                            ...content,
                            decisions: content.decisions.map((d, k) =>
                              k === i
                                ? { ...d, evidence: d.evidence.map((s, l) => (l === j ? value : s)) }
                                : d,
                            ),
                          })
                        }
                      />
                    ) : (
                      <button key={j} className="evidence" onClick={() => evidence(span)}>
                        <Play size={9} />
                        {clock(span.start_s)}–{clock(span.end_s)}
                      </button>
                    ),
                  )}
                  {editing && (
                    <button
                      className="icon-button"
                      aria-label={`Remove decision ${i + 1}`}
                      onClick={() =>
                        setContent({ ...content, decisions: content.decisions.filter((_, j) => j !== i) })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!content.decisions.length && <p className="form-hint">No decisions recorded.</p>}
              {editing && (
                <button
                  className="button small"
                  onClick={() =>
                    setContent({
                      ...content,
                      decisions: [...content.decisions, { text: '', evidence: [{ start_s: 0, end_s: 1 }] }],
                    })
                  }
                >
                  <Plus size={12} />
                  Add decision
                </button>
              )}
            </section>
            <section className="review-section">
              <h3>What happens next</h3>
              {content.action_items.map((item, i) => (
                <div className="review-item" key={i}>
                  {editing ? (
                    <>
                      <Field label={`Action ${i + 1}`}>
                        <textarea
                          className="input"
                          value={item.text}
                          onChange={(e) =>
                            setContent({
                              ...content,
                              action_items: content.action_items.map((a, j) =>
                                j === i ? { ...a, text: e.target.value } : a,
                              ),
                            })
                          }
                        />
                      </Field>
                      <div className="form-row">
                        <Field label="Owner">
                          <input
                            className="input"
                            value={item.owner || ''}
                            onChange={(e) =>
                              setContent({
                                ...content,
                                action_items: content.action_items.map((a, j) =>
                                  j === i ? { ...a, owner: e.target.value || null } : a,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label="Due date">
                          <input
                            type="date"
                            className="input"
                            value={item.due_date || ''}
                            onChange={(e) =>
                              setContent({
                                ...content,
                                action_items: content.action_items.map((a, j) =>
                                  j === i ? { ...a, due_date: e.target.value || null } : a,
                                ),
                              })
                            }
                          />
                        </Field>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>{String(i + 1).padStart(2, '0')} / </strong>
                        {item.text}
                      </p>
                      <span className="inline-label">
                        {item.owner || 'Unassigned'} · {item.due_date || 'No due date'}
                      </span>
                    </>
                  )}
                  {item.evidence.map((span, j) =>
                    editing ? (
                      <EvidenceEditor
                        key={j}
                        span={span}
                        onChange={(value) =>
                          setContent({
                            ...content,
                            action_items: content.action_items.map((a, k) =>
                              k === i
                                ? { ...a, evidence: a.evidence.map((s, l) => (l === j ? value : s)) }
                                : a,
                            ),
                          })
                        }
                      />
                    ) : (
                      <button key={j} className="evidence" onClick={() => evidence(span)}>
                        <Play size={9} />
                        {clock(span.start_s)}–{clock(span.end_s)}
                      </button>
                    ),
                  )}
                  {editing && (
                    <button
                      className="icon-button"
                      aria-label={`Remove action ${i + 1}`}
                      onClick={() =>
                        setContent({
                          ...content,
                          action_items: content.action_items.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!content.action_items.length && <p className="form-hint">No action items recorded.</p>}
              {editing && (
                <button
                  className="button small"
                  onClick={() =>
                    setContent({
                      ...content,
                      action_items: [
                        ...content.action_items,
                        { text: '', owner: null, due_date: null, evidence: [{ start_s: 0, end_s: 1 }] },
                      ],
                    })
                  }
                >
                  <Plus size={12} />
                  Add action item
                </button>
              )}
            </section>
            {strings('open_questions', 'Still to answer')}
            {strings('risks', 'Risks & dependencies')}
            <section className="review-section">
              <h3>Next meeting</h3>
              {editing ? (
                <input
                  className="input"
                  aria-label="Next meeting"
                  value={content.next_meeting || ''}
                  onChange={(e) => setContent({ ...content, next_meeting: e.target.value || null })}
                />
              ) : (
                <p style={{ fontSize: 11, lineHeight: 1.8 }}>{content.next_meeting || 'Not scheduled.'}</p>
              )}
            </section>
            {strings('confidence_notes', 'Notes & uncertainties')}
          </article>
          <aside className="review-aside">
            <div className="side-card">
              <h2>
                <Headphones size={15} />
                THE SOURCE OF TRUTH
              </h2>
              <div className="side-card-content">
                {detail.audio ? (
                  <audio
                    className="audio-player"
                    ref={player}
                    src={`/api/media/${detail.audio.id}`}
                    controls
                    preload="metadata"
                    onTimeUpdate={() => {
                      if (
                        stopAt.current !== null &&
                        player.current &&
                        player.current.currentTime >= stopAt.current
                      ) {
                        player.current.pause();
                        stopAt.current = null;
                      }
                    }}
                  />
                ) : (
                  <p>
                    {demo
                      ? 'Illustrative transcript. No demo audio is provided.'
                      : 'Audio is unavailable or has been removed by retention.'}
                  </p>
                )}
                {selectedEvidence && (
                  <p style={{ marginTop: 12 }}>
                    Selected: {clock(selectedEvidence.start_s)}–{clock(selectedEvidence.end_s)}
                  </p>
                )}
                <p style={{ marginTop: 12 }}>
                  Every decision and action links back to a moment in the conversation.
                </p>
              </div>
            </div>
            {canReview && (
              <div className="side-card">
                <h2>
                  <FileText size={15} />
                  YOUR REVIEW
                </h2>
                <div className="side-card-content">
                  <p>AI writes the first draft. You have the final say.</p>
                  <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                    {editing ? (
                      <>
                        <button className="button" disabled={busy} onClick={() => void save()}>
                          <Save size={13} />
                          Save draft
                        </button>
                        <button
                          className="button small"
                          onClick={() => {
                            setContent(detail.minutes!.content);
                            setEditing(false);
                          }}
                        >
                          Cancel edits
                        </button>
                      </>
                    ) : (
                      <button className="button" onClick={() => setEditing(true)}>
                        Edit minutes
                      </button>
                    )}
                    <button className="button black" disabled={busy} onClick={() => void save(true)}>
                      {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}Approve &
                      publish
                    </button>
                  </div>
                </div>
              </div>
            )}
            {detail.meeting.status === 'published' && (
              <div className="side-card">
                <h2>
                  <Download size={15} />
                  KEEP A COPY
                </h2>
                <div className="side-card-content">
                  {demo ? (
                    <p>Document downloads are generated by the worker in a connected workspace.</p>
                  ) : (
                    <>
                      {(detail.minutes as { docxMediaId?: string })?.docxMediaId && (
                        <a
                          className="button small"
                          href={`/api/media/${(detail.minutes as { docxMediaId?: string }).docxMediaId}`}
                          download
                        >
                          Word document <Download size={12} />
                        </a>
                      )}
                      {(detail.minutes as { mdMediaId?: string })?.mdMediaId && (
                        <a
                          className="button small"
                          style={{ marginTop: 10 }}
                          href={`/api/media/${(detail.minutes as { mdMediaId?: string }).mdMediaId}`}
                          download
                        >
                          Markdown <Download size={12} />
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="side-card">
              <h2>TRANSCRIPT</h2>
              <div className="side-card-content" style={{ maxHeight: 410, overflow: 'auto' }}>
                {detail.transcript?.segments.map((s, i) => (
                  <div className="transcript-segment" key={i}>
                    <button onClick={() => evidence(s)}>{clock(s.start_s)}</button>
                    <strong>{s.speaker || 'Speaker'}</strong>
                    <p>{s.text}</p>
                  </div>
                )) || <p>No transcript available.</p>}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
function EvidenceEditor({
  span,
  onChange,
}: {
  span: { start_s: number; end_s: number };
  onChange: (s: { start_s: number; end_s: number }) => void;
}) {
  return (
    <div className="form-row">
      <Field label="Evidence start (seconds)">
        <input
          className="input"
          type="number"
          min={0}
          step="0.01"
          value={span.start_s}
          onChange={(e) => onChange({ ...span, start_s: Number(e.target.value) })}
        />
      </Field>
      <Field label="Evidence end (seconds)">
        <input
          className="input"
          type="number"
          min={0}
          step="0.01"
          value={span.end_s}
          onChange={(e) => onChange({ ...span, end_s: Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}

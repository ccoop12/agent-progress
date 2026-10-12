import { useEffect, useState, type FormEvent } from 'react';
import { draftCriteria, progress, type Criterion, type Session } from '../shared/model';
let token = '';
async function api<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined && !token) token = (await (await fetch('/api/bootstrap')).json()).token;
  const r = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Progress-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error);
  return result;
}
const date = (s: string) =>
  new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const symbols: Record<string, string> = {
  verified: '✓',
  failed: '×',
  stale: '↺',
  pending: '○',
  manual: '◇',
  blocked: '!',
};
function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status === 'idle' ? 'Turn ended' : status}</span>;
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [selected, setSelected] = useState(localStorage.getItem('agent-progress-selection') || ''),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(''),
    [creating, setCreating] = useState(false),
    [tab, setTab] = useState('Requirements'),
    [filter, setFilter] = useState('All'),
    [verifying, setVerifying] = useState(false);
  async function refresh() {
    try {
      setSessions(await api<Session[]>('/sessions'));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void refresh();
    const live = new EventSource('/api/live');
    let timer: ReturnType<typeof setTimeout>;
    live.onopen = () => setConnected(true);
    live.onerror = () => setConnected(false);
    live.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    };
    const poll = setInterval(() => void refresh(), 10000);
    return () => {
      clearInterval(poll);
      clearTimeout(timer);
      live.close();
    };
  }, []);
  const session = sessions.find((s) => s.id === selected) || sessions[0];
  function select(id: string) {
    setSelected(id);
    localStorage.setItem('agent-progress-selection', id);
    setFilter('All');
  }
  async function verify() {
    if (!session) return;
    setVerifying(true);
    setError('');
    try {
      await api(`/sessions/${session.id}/verify`, {});
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  }
  const p = session ? progress(session) : { percent: 0, count: 0, total: 0, verified: 0 };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Agent Progress home">
          <span className="brand-icon">▥</span>
          <span>
            Agent<span className="brand-light">Progress</span>
            <small>THE LOCAL OBSERVER</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="tiny-dot" /> Personal workspace <span className="keycap">LOCAL</span>
        </div>
        <button className="new-session" onClick={() => setCreating(true)}>
          <span>＋</span> New tracking session
        </button>
        <div className="sidebar-heading">
          SESSIONS <span>{sessions.length.toString().padStart(2, '0')}</span>
        </div>
        <nav aria-label="Tracking sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-link ${s.id === session?.id ? 'selected' : ''}`}
              onClick={() => select(s.id)}
            >
              <span className={`status-dot ${s.status}`} />
              <span className="session-name">
                {s.title}
                <small>
                  Codex CLI · {progress(s).count}/{s.criteria.length} verified
                </small>
              </span>
              <span className="session-percent">{progress(s).percent}%</span>
            </button>
          ))}
        </nav>
        {!sessions.length && (
          <p className="sidebar-empty">Your tracked prompts will appear here.</p>
        )}
        <div className="sidebar-bottom">
          <div className="privacy-mark">
            ⌂{' '}
            <span>
              Private by default<small>Stored on this computer</small>
            </span>
          </div>
          <div className="version">
            Agent Progress <span>v0.1.0 / MIT</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            Workspace <span>/</span> <strong>Session overview</strong>
          </div>
          <span className={`connection ${connected ? 'online' : ''}`}>
            <i /> {connected ? 'Observer connected' : 'Reconnecting to observer'}
          </span>
        </header>
        <main>
          {error && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {!session ? (
            <section className="empty-state">
              <span className="eyebrow">PROGRESS, WITH PROOF</span>
              <h1>See what’s actually done.</h1>
              <p>
                Turn a coding prompt into a fixed acceptance scope. Watch evidence arrive,
                requirements pass, and real progress take shape.
              </p>
              <button className="primary" onClick={() => setCreating(true)}>
                Create your first session ↗
              </button>
              <div className="empty-steps">
                <span>
                  <b>01</b> Define the scope
                </span>
                <span>
                  <b>02</b> Connect Codex
                </span>
                <span>
                  <b>03</b> Verify the work
                </span>
              </div>
              <p className="muted">
                No account. No telemetry. No model API needed.
                <br />
                For an offline example, run <code>npm run demo</code> in the project terminal.
              </p>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    CODEX CLI <span> / </span> TRACKING SESSION
                  </div>
                  <h1>{session.title}</h1>
                  <p className="repo-path" title={session.repoPath}>
                    ⌁ {session.repoPath}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={verifying || session.checking}
                  onClick={() => void verify()}
                >
                  {verifying || session.checking ? '◌ Checking evidence…' : '↻ Run verification'}
                </button>
              </div>
              <section className="progress-card" aria-label="Verified progress">
                <div className="card-top">
                  <span className="eyebrow">VERIFIED COMPLETION</span>
                  <span className="scope-lock">
                    ▣ Scope locked · {session.scopeHash.slice(0, 8)}
                  </span>
                </div>
                <div className="progress-head">
                  <div className="big-percent" data-testid="progress">
                    {p.percent}
                    <span>%</span>
                  </div>
                  <div className="progress-description">
                    <strong>
                      {p.count} of {session.criteria.length} requirements verified
                    </strong>
                    <p>
                      {p.verified} / {p.total} acceptance weight earned
                    </p>
                  </div>
                  <div className="time-estimate">
                    <span>TIME REMAINING</span>
                    <strong>
                      Unknown <span>—</span>
                    </strong>
                    <small>No speculative estimate</small>
                  </div>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Verified acceptance scope"
                  aria-valuenow={p.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  {session.criteria.map((c) => (
                    <div
                      key={c.id}
                      className={c.status === 'verified' ? 'segment complete' : 'segment'}
                      style={{ flex: c.weight }}
                      title={`${c.title}: ${c.status}, weight ${c.weight}`}
                    />
                  ))}
                </div>
                <div className="progress-foot">
                  <span>
                    <i className="legend-dot" /> Independent checks only
                  </span>
                  <span>Progress can decrease when evidence changes.</span>
                </div>
              </section>
              <div className="summary-grid">
                <section className="summary-card activity-card">
                  <span className="eyebrow">CURRENT ACTIVITY</span>
                  <div>
                    <span className={`status-dot ${session.status}`} />
                    <strong>{session.activity}</strong>
                  </div>
                  <span className="subtle">
                    <Badge status={session.status} /> Last update {date(session.updatedAt)}
                  </span>
                </section>
                <section className="summary-card">
                  <span className="eyebrow">OUTSTANDING</span>
                  <strong className="metric">
                    {session.criteria.length - p.count}
                    <small> requirements</small>
                  </strong>
                  <span className="subtle">
                    {
                      session.criteria.filter(
                        (c) => c.status === 'blocked' || c.status === 'failed',
                      ).length
                    }{' '}
                    blocked or failing checks
                  </span>
                </section>
              </div>
              {(session.error || session.sourceError) && (
                <div className="alert" role="alert">
                  {session.error || session.sourceError}
                </div>
              )}
              {session.status === 'interrupted' && (
                <div className="notice">
                  Observation interrupted. Your locked scope and evidence are saved. Reconnect the
                  stream from the Connection tab.
                </div>
              )}
              <div className="content-grid">
                <section className="details-panel">
                  <div className="tabs" role="tablist">
                    {['Requirements', 'Original prompt', 'Connection'].map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={t === tab}
                        onClick={() => setTab(t)}
                      >
                        {t}
                        {t === 'Requirements' && <span>{session.criteria.length}</span>}
                      </button>
                    ))}
                  </div>
                  {tab === 'Requirements' && (
                    <div role="tabpanel">
                      <div className="requirements-heading">
                        <div>
                          <h2>Acceptance criteria</h2>
                          <p>Evidence against your reviewed scope.</p>
                        </div>
                        <select
                          aria-label="Filter requirements"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option>All</option>
                          <option>Verified</option>
                          <option>Outstanding</option>
                        </select>
                      </div>
                      <div className="requirements">
                        {session.criteria
                          .filter(
                            (c) =>
                              filter === 'All' ||
                              (filter === 'Verified'
                                ? c.status === 'verified'
                                : c.status !== 'verified'),
                          )
                          .map((c, index) => (
                            <details className={`requirement ${c.status}`} key={c.id}>
                              <summary>
                                <span className="requirement-icon">{symbols[c.status]}</span>
                                <span className="requirement-title">
                                  <strong>{c.title}</strong>
                                  <small>
                                    {c.check.kind === 'command'
                                      ? 'Independent command'
                                      : c.check.kind === 'file'
                                        ? 'Static file assertion'
                                        : 'Human review needed'}{' '}
                                    · Weight {c.weight}
                                  </small>
                                </span>
                                <Badge status={c.status} />
                                <span className="chevron">⌄</span>
                              </summary>
                              <div className="evidence">
                                <p>
                                  <b>Prompt excerpt</b>
                                  <br />
                                  {c.promptQuote}
                                </p>
                                <p>
                                  {c.evidence?.summary ||
                                    'No independent evidence has been recorded.'}
                                </p>
                                {c.evidence && (
                                  <small>
                                    Checked {date(c.evidence.at)} · Snapshot{' '}
                                    {c.evidence.fingerprint?.slice(0, 12) || 'unavailable'}
                                  </small>
                                )}
                                <pre>{JSON.stringify(c.check, null, 2)}</pre>
                              </div>
                            </details>
                          ))}
                      </div>
                      <div className="scope-note">
                        ◇ 100% means every agreed check passed. Coverage of the original request
                        depends on your scope review.
                      </div>
                    </div>
                  )}
                  {tab === 'Original prompt' && (
                    <div role="tabpanel" className="prompt-panel">
                      <h2>The original request</h2>
                      <p className="prompt-text">{session.prompt}</p>
                      <div className="notice">
                        This prompt and its acceptance criteria are immutable. For changed
                        requirements, create a new tracking session to keep the denominator honest.
                      </div>
                      <small>
                        Session {session.id}
                        <br />
                        Created {new Date(session.createdAt).toLocaleString()}
                      </small>
                    </div>
                  )}
                  {tab === 'Connection' && (
                    <Connection key={session.id} session={session} onRefresh={refresh} />
                  )}
                </section>
                <aside className="timeline">
                  <div className="timeline-title">
                    <h2>Activity feed</h2>
                    <span className="live-label">
                      <i /> LIVE
                    </span>
                  </div>
                  <p className="timeline-description">Observed events, not completion claims.</p>
                  <div className="feed">
                    {[...session.events]
                      .reverse()
                      .slice(0, 16)
                      .map((event, i) => (
                        <div className={`feed-event ${event.kind}`} key={`${event.at}-${i}`}>
                          <span className="feed-dot" />
                          <div>
                            <time>{date(event.at)}</time>
                            <p>{event.text}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="feed-footer">
                    {session.eventCount} records received · {session.ignoredEvents} unsupported
                    <br />
                    Raw messages and outputs are not retained.
                  </div>
                </aside>
              </div>
              <footer className="main-footer">
                <span>⌂ Local state · No telemetry · No cloud sync</span>
                <span>Evidence over estimates.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {creating && (
        <CreateSession
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            select(s.id);
            setCreating(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Connection({ session, onRefresh }: { session: Session; onRefresh: () => Promise<void> }) {
  const [path, setPath] = useState(''),
    [message, setMessage] = useState('');
  async function attach(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/sessions/${session.id}/source`, { path });
      setMessage('File attached. Complete JSONL records will appear as they arrive.');
      await onRefresh();
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  return (
    <div role="tabpanel" className="prompt-panel">
      <h2>Connect your Codex stream</h2>
      <p>
        Run Codex yourself with this session’s original prompt. Pipe its supported JSON events to
        the observer:
      </p>
      <pre>
        codex exec --json -C "YOUR_REPOSITORY_PATH" "YOUR ORIGINAL PROMPT" | npm run cli -- ingest{' '}
        {session.id}
      </pre>
      <p className="muted">
        Use your normal Codex permissions. Codex may contact its configured provider; Agent Progress
        never launches it or uploads your prompt.
      </p>
      <h3>Or follow a local event file</h3>
      <form onSubmit={attach}>
        <label>
          Absolute JSONL file path
          <input
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\runs\codex-events.jsonl"
          />
        </label>
        <button className="secondary">Attach file</button>
      </form>
      <p role="status">{message}</p>
      {session.source && (
        <p className="muted">
          Following {session.source.path}
          <br />
          Durable cursor: byte {session.source.offset}
        </p>
      )}
      <p className="muted">
        Codex thread: {session.threadId || 'Awaiting thread.started'}
        <br />
        Adapter: {session.adapter}
      </p>
      <div className="notice">
        Use a new tracking session for each new prompt. Reuse this session only when continuing the
        same scope. Claude Code is a future adapter.
      </div>
    </div>
  );
}

function CreateSession({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: Session) => void;
}) {
  const [prompt, setPrompt] = useState(''),
    [title, setTitle] = useState(''),
    [repo, setRepo] = useState(''),
    [criteria, setCriteria] = useState<Criterion[]>([]),
    [reviewed, setReviewed] = useState(false),
    [commands, setCommands] = useState(false),
    [auto, setAuto] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function update(index: number, c: Criterion) {
    setCriteria((cs) => cs.map((v, i) => (i === index ? c : v)));
    setReviewed(false);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(
        await api<Session>('/sessions', {
          title,
          prompt,
          repoPath: repo,
          criteria,
          scopeReviewed: reviewed,
          allowCommands: commands,
          autoVerify: auto,
        }),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">START WITH A CLEAR FINISH LINE</span>
            <h2 id="create-title">New tracking session</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close new session">
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>
              Session name
              <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Build a health check endpoint"
              />
            </label>
            <label>
              Repository path
              <input
                required
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="Absolute path to your project"
              />
            </label>
          </div>
          <label>
            Original coding prompt
            <textarea
              required
              rows={4}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setReviewed(false);
              }}
              placeholder="Put each requirement on its own line for a useful starting draft."
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!prompt.trim()}
            onClick={() => {
              setCriteria(draftCriteria(prompt));
              setReviewed(false);
            }}
          >
            Break prompt into draft criteria
          </button>
          <p className="muted">
            Local line splitting only. Review coverage, write objective checks, and set weights. No
            AI service is called.
          </p>
          <div className="criteria-editor">
            {criteria.map((c, i) => (
              <div className="criterion-editor" key={c.id}>
                <div className="form-row">
                  <label>
                    Criterion {i + 1}
                    <input
                      required
                      value={c.title}
                      onChange={(e) => update(i, { ...c, title: e.target.value })}
                    />
                  </label>
                  <label className="weight-input">
                    Weight
                    <input
                      required
                      type="number"
                      min={1}
                      max={1000}
                      value={c.weight}
                      onChange={(e) => update(i, { ...c, weight: Number(e.target.value) })}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove criterion ${i + 1}`}
                    onClick={() => {
                      setCriteria((cs) => cs.filter((_, n) => n !== i));
                      setReviewed(false);
                    }}
                  >
                    ×
                  </button>
                </div>
                <label>
                  Exact prompt excerpt
                  <input
                    required
                    value={c.promptQuote}
                    onChange={(e) => update(i, { ...c, promptQuote: e.target.value })}
                  />
                </label>
                <label>
                  Verification method
                  <select
                    value={c.check.kind}
                    onChange={(e) =>
                      update(i, {
                        ...c,
                        check:
                          e.target.value === 'file'
                            ? { kind: 'file', path: '' }
                            : e.target.value === 'command'
                              ? {
                                  kind: 'command',
                                  executable: 'node',
                                  args: [],
                                  trustedFiles: [],
                                  timeoutMs: 30000,
                                }
                              : { kind: 'manual', instructions: 'Needs human review.' },
                      })
                    }
                  >
                    <option value="manual">Human review (no automatic credit)</option>
                    <option value="file">File assertion</option>
                    <option value="command">Trusted test or build command</option>
                  </select>
                </label>
                {c.check.kind === 'file' && (
                  <div className="form-row">
                    <label>
                      Relative file path
                      <input
                        required
                        value={c.check.path}
                        onChange={(e) =>
                          update(i, {
                            ...c,
                            check: {
                              ...(c.check as Extract<Criterion['check'], { kind: 'file' }>),
                              path: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Required literal text (optional)
                      <input
                        value={c.check.contains || ''}
                        onChange={(e) =>
                          update(i, {
                            ...c,
                            check: {
                              ...(c.check as Extract<Criterion['check'], { kind: 'file' }>),
                              contains: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                {c.check.kind === 'command' && (
                  <CommandEditor criterion={c} onChange={(next) => update(i, next)} />
                )}
              </div>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              required
            />{' '}
            I reviewed the criteria, weights, checks, and coverage of the original prompt.
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={commands}
              onChange={(e) => setCommands(e.target.checked)}
            />{' '}
            Authorize these commands to run locally. Tests and builds execute project code with my
            user permissions.
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{' '}
            Reverify automatically when repository files change.
          </label>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <span>Scope becomes immutable after creation.</span>
            <button className="primary" disabled={busy || !criteria.length || !reviewed}>
              {busy ? 'Creating…' : 'Lock scope & create session'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function CommandEditor({
  criterion,
  onChange,
}: {
  criterion: Criterion;
  onChange: (c: Criterion) => void;
}) {
  const c = criterion.check;
  if (c.kind !== 'command') return null;
  return (
    <>
      <div className="form-row">
        <label>
          Executable
          <input
            required
            value={c.executable}
            onChange={(e) =>
              onChange({ ...criterion, check: { ...c, executable: e.target.value } })
            }
          />
        </label>
        <label>
          Timeout (milliseconds)
          <input
            type="number"
            min={100}
            max={120000}
            required
            value={c.timeoutMs}
            onChange={(e) =>
              onChange({ ...criterion, check: { ...c, timeoutMs: Number(e.target.value) } })
            }
          />
        </label>
      </div>
      <label>
        Arguments (one per line)
        <textarea
          rows={2}
          value={c.args.join('\n')}
          onChange={(e) =>
            onChange({ ...criterion, check: { ...c, args: e.target.value.split('\n') } })
          }
        />
      </label>
      <label>
        Trusted verifier files (relative paths, one per line)
        <textarea
          required
          rows={2}
          value={c.trustedFiles.join('\n')}
          onChange={(e) =>
            onChange({ ...criterion, check: { ...c, trustedFiles: e.target.value.split('\n') } })
          }
        />
      </label>
      <p className="muted">
        List the test scripts and fixtures you reviewed. Their contents are pinned at creation. Use
        a native executable such as node; shell scripts need an explicitly chosen interpreter.
      </p>
    </>
  );
}

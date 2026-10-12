# Agent Progress

**Watch coding work become verified progress.** A local-first React + TypeScript dashboard and lightweight Node.js observer for Codex CLI. MIT licensed. No account, telemetry, hosted backend, model SDK, or paid API required.

The progress bar measures independently verified acceptance weight. It does **not** measure elapsed time, token consumption, agent confidence, or an agent's claim that it is finished. ETA is explicitly **unknown**.

## Quick start

Requirements: **Node.js 24+**, npm, and a modern browser. Codex is optional for the offline example; live observation requires an installed Codex CLI with `exec --json` (smoke-tested with **0.162.0**).

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. In another terminal, from this project:

```sh
npm run demo
```

This creates a clearly labeled offline example in your local data directory. Its agent events are synthetic, but its HTTP endpoint tests and file assertions are **actually executed by the observer**. It starts at 80% because endpoint documentation is missing. The command prints the example repository path. Add `API.md` containing `GET /health` there, then click **Run verification**: progress reaches 100%. Modify a source file again: credit becomes stale until reverified.

For development, `npm run dev` runs the backend on 4317 and Vite on **http://127.0.0.1:5173**. Production serves the built UI from the same local backend. Neither mode binds to the LAN.

## Track a real coding prompt

1. In **New tracking session**, enter the original prompt and repository path. Split it into draft criteria, then review and edit each criterion, exact prompt excerpt, weight, and check. The draft is deterministic line splitting, not semantic AI analysis.
2. Review the coverage and lock scope. Automatic verification and local command execution are separate, explicit opt-ins. Test commands run with your user's permissions; review their code before authorizing them.
3. Copy the tracking session UUID from the **Connection** tab. In a terminal at the Agent Progress project root, start Codex in your target repository and pipe its JSONL output:

```sh
codex exec --json -C "/absolute/path/to/target-repo" "YOUR ORIGINAL PROMPT" | npm run cli -- ingest SESSION_ID
```

On PowerShell the same pipeline works; use a Windows repository path such as `C:\Dev\my-project`. Use your usual Codex sandbox and permission flags. Agent Progress does not change Codex permissions or launch the coding agent.

4. Run verification in the dashboard. If you opted into automatic verification, it also runs after observed repository changes. Agent activity and verified progress are deliberately independent.

**Codex itself may send your prompt and source to its configured model provider.** You launch and configure that separately. Agent Progress performs no such upload and never starts a model request. Existing CLI authentication, subscription, or local model requirements remain Codex's responsibility.

### Persistent event-file observation

Redirect Codex's **stdout only** to a UTF-8 JSONL file **outside the target repository**, then attach it from the UI or CLI:

```sh
npm run cli -- attach SESSION_ID --file /absolute/path/to/events.jsonl
```

The observer reads complete records, persists byte offsets transactionally with deduplicated event delivery, and reconnects to attached files on restart. Keep stderr separate; it isn't JSON. Do not commit raw event files: Codex output may contain sensitive content. Windows PowerShell 5.1 redirection can produce UTF-16; prefer PowerShell 7 UTF-8 output or the direct ingestion pipeline.

A file reader cannot reliably know whether its producer is alive. The displayed activity is the last observed Codex state, not proof the writer is still running. Direct `ingest` sends a lease heartbeat every five seconds; loss for twenty seconds is shown as interrupted. Quiet work is never guessed to be blocked.

### Resume without losing progress

Restart `npm start` with the same data directory. Sessions, checks, thread associations, and attached-file cursors survive. Previous active runs become interrupted, and repository fingerprints are checked before saved credit is served.

Continue **the same original scope** with the explicit recorded Codex thread ID:

```sh
# Run Codex from the target repository. Point npm at this observer checkout.
codex exec resume --json CODEX_THREAD_ID "Continue the existing scope" | npm --prefix "/path/to/agent-progress" run cli -- ingest TRACKING_SESSION_ID
```

Every **new coding objective** gets a new tracking session. Follow-up prompts that change scope also get a new session, even within an existing Codex thread. `exec --json` does not supply a reliable original-prompt event, so the MVP requires explicit session creation and association. It does not automatically discover arbitrary interactive CLI or desktop chats.

### File-based scope workflow

```sh
npm --silent run cli -- plan --prompt-file prompt.txt --repo /absolute/repo > scope.json
# Review/edit the generated checks and weights; set scopeReviewed to true.
npm run cli -- create scope.json
npm run cli -- list
npm run cli -- verify SESSION_ID
```

Use absolute repository paths in reusable manifests. `examples/scope.json` is a working contract for the included fixture, relative to this checkout. `manual` criteria intentionally earn no automatic credit. The UI has no “mark verified” override.

## What the percentage means

```text
verified completion = floor(1000 × verified weight / total locked weight) / 10
```

Only criteria whose independent checks pass against a stable observed repository snapshot earn their full weight. There is no partial credit. Rounding never turns an incomplete scope into 100%. The denominator is immutable for the tracking session.

| Check     | Evidence                                                                                            | What it does not prove                        |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `file`    | Regular file exists; optionally contains literal text                                               | Correct runtime behavior or semantic adequacy |
| `command` | Observer ran the authorized executable and arguments, trusted verifier hashes match, exit code zero | Anything the chosen test/build fails to cover |
| `manual`  | Instructions preserved for human review                                                             | Automatic completion; these remain unverified |

Repo edits invalidate **all** previously verified criteria conservatively. Verification hashes the repository before and after execution; any difference invalidates the entire batch. Trusted verifier files are pinned at scope creation; modifying them blocks that command until the user reviews a **new scope**.

100% means “all agreed checks passed at the recorded snapshot.” It cannot prove that a human-authored contract completely expresses arbitrary natural-language intent. Review the criteria and test quality. This is an honest limitation, not an AI confidence score. See [architecture and boundaries](docs/architecture.md).

## Local data and security

- State lives in `~/.agent-progress/progress.sqlite`, outside your repositories by default. Set `AGENT_PROGRESS_HOME` to another local directory. Set `AGENT_PROGRESS_PORT` to change port 4317. Apply both variables to server and CLI processes.
- Normalized event categories are retained; raw prompts from agent events, message bodies, reasoning, command strings, stdout, stderr, and raw JSONL are **not** stored. The original user-supplied scope is persisted locally.
- Recognized secrets in scope definitions are rejected, and defensive redaction covers common credentials. Redaction is best effort; don't paste secrets into prompts or check definitions. State is not encrypted at rest.
- HTTP binds to `127.0.0.1`, checks Host and Origin, and requires a local token for writes. There is no CORS, relay, telemetry, remote font, external asset, export, or upload integration.
- Authorized test/build commands execute local code. They are **not sandboxed** and could perform network operations. No command is copied from agent events or executed automatically without scope authorization. See [SECURITY.md](SECURITY.md).

## Tests

```sh
npm run check                 # TypeScript, production build, core + HTTP tests
npx playwright install chromium
npm run test:ui               # Desktop + mobile browser integration tests
npm run test:codex            # Optional: real installed Codex binary, loopback fixture provider
npm audit
```

The Codex smoke test has no real model or hosted call: it runs the actual CLI against a scripted localhost Responses fixture, ingests its real JSON events, asserts that turn completion grants zero credit, and then runs an independent file check. It writes a local report under ignored `artifacts/`. Set `CODEX_BIN` to a native binary path if your installation isn't found. It does not use your Codex account or configuration.

Browser tests cover session creation, actual endpoint checks, SSE updates, 80→0→100% transitions, interruption, reload persistence, mobile overflow, and runtime errors. Core tests cover durability, duplicate delivery, future events, split JSONL records, tampered verifiers, timeouts, concurrent edits, scope validation, and secret handling. CI is configured for Windows and Linux; see [validation record](docs/validation.md) for what was actually run locally.

## Project map

```text
src/                 React dashboard and responsive styling
shared/model.ts      Scope schema, statuses, weighted progress
server/adapters/     Provider-specific event normalization
server/engine.ts     Scope, lifecycle, verification orchestration
server/verifier.ts   Independently authorized local checks
server/repository.ts Repository and verifier fingerprints
server/store.ts      SQLite durability and delivery deduplication
server/tailer.ts     Resumable JSONL file observation
server/http.ts       Loopback API, SSE, static UI
server/cli.ts        Plan, create, attach, ingest, verify
examples/            Executable fixture and sample session
tests/               Core, HTTP, and browser tests
docs/                Research, architecture, validation
```

## Extending to Claude Code

`AgentAdapter.parse(unknown)` returns a small normalized activity event. Adapters have no completion/evidence write API. A future Claude Code hook transport can map `SessionStart`, `UserPromptSubmit`, tool lifecycle, stop/failure, and session-end events without changing the verifier or progress model. Claude Code is **not implemented** in this MVP. See the [integration research](docs/research.md).

Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md). Released under [MIT](LICENSE).

# Feasibility and integration research

Researched October 12, 2026. Names such as “AgentHUD” and “Claude Monitor” refer to several unrelated repositories; these are the specific projects inspected. No third-party project source was copied or vendored.

## Supported Codex contract

The [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode) specifies JSONL stdout from `codex exec --json`: `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`. Documented item categories cover messages, reasoning, command executions, file changes, tool calls, web searches, and plans. Agent Progress normalizes these categories and tolerates unknown future items without granting credit.

The installed `codex-cli 0.162.0` independently confirmed `exec --json`, stdin prompts, explicit working directory, and `exec resume --json SESSION_ID`. The live binary smoke test used an isolated `CODEX_HOME` and loopback provider. No internal `~/.codex/sessions` rollout schema is treated as a supported contract.

`exec` has no sufficiently reliable original-user-prompt event for automatic scope capture. Explicit reviewed scope creation plus a tracking UUID solves association for this MVP. A `thread.started` ID binds the stream; a mismatching thread is rejected. A new objective within the same Codex thread must be assigned a new tracking UUID by the user. Blindly treating every `turn.started` as a new objective would incorrectly reset resumed work.

`turn.completed` means the agent turn ended. It is not acceptance evidence. `error` can accompany transient retries, so it is recorded as activity rather than automatically declaring a terminal blocker. `turn.failed` is terminal blocked state. No undocumented approval-request event is invented for this adapter. Interactivity and permission round trips belong in a future separately researched app-server adapter.

## Existing open-source projects

| Project                                                                 | Relevant architecture                                                                                                                        | Decision                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [neochoon/agenthud](https://github.com/neochoon/agenthud)               | Node terminal interface; provider-aware session observation, live activity, and separate report/summary surfaces. Reads agent session tails. | Reuse the architectural separation between observation and rendering. Don't couple a supported exec integration to private transcript layouts or a TUI.                                         |
| [IAMMARBIT/AgentHUD](https://github.com/IAMMARBIT/AgentHUD)             | Instrumented SDK adapters send local WebSocket events to a PyQt overlay with per-agent cards.                                                | Borrow the small normalized-event boundary. A Python overlay and agent-authored task completion do not satisfy browser-based evidence accounting.                                               |
| [bjornjee/agent-dashboard](https://github.com/bjornjee/agent-dashboard) | Go TUI, tmux orchestration, harness interface, agent adapters, optional PWA and SSE.                                                         | Use the adapter boundary and SSE pattern. Its documented tmux requirement and lack of native Windows support make it a poor base for this Windows-first MVP. Remote orchestration isn't needed. |
| [pigorv/claude-monitor](https://github.com/pigorv/claude-monitor)       | Local transcript ingestion into SQLite, background imports, browser session inspection and cost/context analytics.                           | SQLite-backed read models and persistent import cursors are directly useful patterns. Keep raw transcripts and cost-based metrics out of acceptance completion.                                 |

These projects provide meaningful observability, but their inspected descriptions do not establish independently verified, prompt-linked weighted completion. That missing layer is Agent Progress's focus. Existing infrastructure is reused through React, Vite, Zod, Node's HTTP/process/filesystem APIs, and built-in SQLite rather than another orchestration framework. A future interop adapter could accept their activity reports, but those reports would still not be verification evidence.

## Claude Code feasibility

The [official hooks reference](https://code.claude.com/docs/en/hooks) exposes prompt/session and tool lifecycle hooks, including `UserPromptSubmit`, `SessionStart`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, and `SessionEnd`. This is a plausible independent transport with better explicit prompt boundaries. It needs its own consent, session-mapping, schema fixtures, and interruption tests. Hook success still cannot grant progress; the shared verifier must independently check the agreed requirements.

## What can be verified without paid AI

File assertions, pinned test programs, builds, repository snapshots, and explicit human-reviewed prompt-to-criterion links are entirely local. Converting arbitrary natural language into a complete test suite is not reliably solved by a deterministic parser. The MVP offers line-based drafting and human review instead of disguising a heuristic as a verified scope. Model-assisted drafting can be added later behind an explicit opt-in, without changing the evidence rules.

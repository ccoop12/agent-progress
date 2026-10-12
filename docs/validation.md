# Validation record

Validated locally on October 12, 2026, on Windows with Node.js 24.18.0 and Codex CLI 0.162.0.

| Check                                         | Result                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run build`                               | Passed: strict TypeScript check and Vite production bundle                                            |
| `npm test`                                    | 32 core and HTTP tests passed                                                                         |
| `npm run test:ui`                             | Four Chromium flows passed: desktop and mobile integration plus session creation                      |
| Installed Codex CLI / loopback provider smoke | Passed: real `thread.started`, `item.completed`, `turn.started`, and `turn.completed` events ingested |
| CLI stdin ingestion                           | Passed through a separate CLI process into the actual HTTP server and SQLite store                    |
| `npm audit`                                   | Zero known vulnerabilities at validation time                                                         |
| Local production startup and example          | Served on loopback; real fixture checks produced 80% verified completion                              |

The Codex smoke used a **scripted localhost provider**, an isolated Codex home, and a synthetic prompt. No real model coding run or hosted provider was tested. Five real CLI events were received; progress stayed at zero after turn completion and became 100 only after independent file verification. The ignored local report is `artifacts/codex-smoke.json`.

Browser tests exercised real fixture HTTP tests, file assertions, SSE refresh, 80→0→100% transitions, current activity, interrupted state, original prompt and connection views, scope creation, reload persistence, mobile overflow, and browser runtime errors. Desktop and mobile screenshots were inspected. The test server uses a unique state directory per run so old persistent sessions cannot contaminate repeated runs.

Core tests include duplicate delivery across a database reopen, revalidation on restart, partial UTF-8 JSONL and durable cursors, file truncation, stream lease expiry, source-error recovery, authorization gates, verifier tampering, hanging-process termination, repository edits during checks, event/verification concurrency, prompt linkage, invalid weights, secret minimization, and HTTP Host/Origin/token boundaries.

Vite emits upstream Zod pure-annotation warnings; these do not fail compilation or tests. Cross-platform CI is configured for Windows and Linux but **has not been run on GitHub**. No Linux runtime, hostile-process isolation, real Claude Code adapter, or semantic completeness of arbitrary prompts is claimed.

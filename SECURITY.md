# Security policy

Agent Progress is a local development observer, not a sandbox. Report vulnerabilities privately to the maintainer using the repository's security reporting channel when one is configured. Do not post tokens, prompts, source, or raw logs in a public issue.

## Data boundary

No observer feature uploads user data. Runtime resources are local. The default data path is `~/.agent-progress`, outside the code repository. If your home directory or a custom data path is cloud-synced, that external sync software can still copy files; choose a non-synced path for sensitive work.

SQLite and its WAL contain your reviewed prompt, paths, acceptance criteria, verifier arguments/hashes, event categories, and evidence summaries. There is no encryption at rest. Restrictive POSIX modes are requested for the directory, token, and database; Windows access follows your user profile ACLs. Keep this directory private. Raw event payloads and verifier output are discarded. Source event files are controlled by you and may contain secrets; the observer does not sanitize the original files.

Redaction catches common keys, bearer credentials, passwords, private keys, and credential-bearing URLs. It cannot reliably identify every secret, PII, or proprietary text. Don't embed secrets in scope definitions. There is no export or publish endpoint. Git ignores generated state, logs, `.env` files, and test artifacts.

## Code execution boundary

File checks only read evidence. Commands require an explicit `allowCommands` choice for the fixed scope. Automatic reruns require a separate opt-in. Verifiers are spawned with no implicit shell, bounded time, ignored output, and a small inherited environment. On timeout, the observer attempts to terminate the process tree. These precautions do **not** prevent trusted commands or their dependencies from reading other files, spawning detached children, or accessing a network.

Review commands and all their inputs. Pin test programs and fixtures in `trustedFiles`. Do not authorize untrusted projects or use unreviewed package scripts. Same-user malicious agents can modify your local state or race checks; cryptographic hashes are evidence freshness checks, not a security boundary against such attackers.

## HTTP boundary

The backend listens only on `127.0.0.1`. Host and Origin checks, no CORS, write tokens, JSON-only mutations, size limits, and a restrictive content security policy reduce browser attack surface. Never proxy this server to a public/LAN address. Local processes and compromised same-origin code remain trusted. The Vite development origin on port 5173 is permitted for local development.

The observer doesn't launch Codex. A Codex process you start can contact its configured provider under your existing Codex settings. That transport is separate from Agent Progress.

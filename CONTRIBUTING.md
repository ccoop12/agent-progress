# Contributing

Use Node.js 24+, run `npm ci`, then `npm run dev`. Keep changes focused, add regression tests for progress-accounting changes, and run `npm run check`. For dashboard behavior, install Chromium with `npx playwright install chromium` and run `npm run test:ui`.

Never let agent-authored messages, tool success claims, elapsed time, or token counts grant completion. Preserve fixed scope, independent verification, explicit command authorization, secret minimization, and conservative invalidation. Adapters only normalize activity.

Include a clear problem, resulting behavior, and checks run in pull requests. Don't attach real prompts, private repository paths, raw transcripts, tokens, or local database files. Use the supplied synthetic fixtures. New provider adapters must include source-contract links and malformed/future-event handling tests.

No generated state or build output belongs in Git. The lockfile does. The optional real-Codex smoke uses a loopback fixture, never a paid provider or user credentials.

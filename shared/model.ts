import { z } from 'zod';
const text = z.string().trim().min(1).max(12000);
export const checkSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('file'),
      path: text,
      contains: z.string().min(1).max(8000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('command'),
      executable: text,
      args: z.array(z.string().max(4000)).max(64),
      trustedFiles: z.array(text).min(1).max(30),
      timeoutMs: z.number().int().min(100).max(120000).default(30000),
    })
    .strict(),
  z.object({ kind: z.literal('manual'), instructions: text }).strict(),
]);
export const criterionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    title: text,
    promptQuote: text,
    weight: z.number().int().min(1).max(1000),
    check: checkSchema,
  })
  .strict();
export const manifestSchema = z
  .object({
    title: text,
    prompt: text,
    repoPath: text,
    criteria: z.array(criterionSchema).min(1).max(50),
    scopeReviewed: z.literal(true),
    allowCommands: z.boolean().default(false),
    autoVerify: z.boolean().default(false),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (new Set(m.criteria.map((c) => c.id)).size !== m.criteria.length)
      ctx.addIssue({ code: 'custom', message: 'Criterion IDs must be unique' });
    for (const c of m.criteria)
      if (!m.prompt.includes(c.promptQuote))
        ctx.addIssue({
          code: 'custom',
          message: `${c.id}: promptQuote must be an exact excerpt of the original prompt`,
        });
  });
export type Check = z.infer<typeof checkSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type RequirementStatus = 'pending' | 'verified' | 'failed' | 'stale' | 'blocked' | 'manual';
export interface Evidence {
  at: string;
  status: RequirementStatus;
  summary: string;
  fingerprint?: string;
  exitCode?: number | null;
}
export interface Requirement extends Criterion {
  status: RequirementStatus;
  evidence?: Evidence;
  trustedHashes?: Record<string, string>;
}
export interface Activity {
  at: string;
  kind: string;
  text: string;
}
export interface Session {
  id: string;
  title: string;
  prompt: string;
  repoPath: string;
  adapter: string;
  createdAt: string;
  updatedAt: string;
  scopeHash: string;
  criteria: Requirement[];
  allowCommands: boolean;
  autoVerify: boolean;
  status: 'waiting' | 'running' | 'idle' | 'blocked' | 'interrupted';
  activity: string;
  threadId?: string;
  fingerprint?: string;
  checking: boolean;
  events: Activity[];
  eventCount: number;
  ignoredEvents: number;
  streamLeaseAt?: number;
  source?: {
    path: string;
    offset: number;
    generation: number;
    prefix: string;
    prefixBytes: number;
  };
  error?: string;
  sourceError?: string;
}
export function progress(session: Pick<Session, 'criteria'>) {
  const total = session.criteria.reduce((n, c) => n + c.weight, 0);
  const verified = session.criteria.reduce(
    (n, c) => n + (c.status === 'verified' ? c.weight : 0),
    0,
  );
  // Never round an incomplete contract up to 100%.
  return {
    percent: total ? Math.floor((verified / total) * 1000) / 10 : 0,
    verified,
    total,
    count: session.criteria.filter((c) => c.status === 'verified').length,
  };
}
export function draftCriteria(prompt: string): Criterion[] {
  const parts = prompt
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);
  return (parts.length ? parts : [prompt]).map((quote, i) => ({
    id: `r${i + 1}`,
    title: quote.replace(/^\s*(?:\d+[.)]|[-*])\s*/, ''),
    promptQuote: quote,
    weight: 1,
    check: {
      kind: 'manual',
      instructions:
        'Define an objective file assertion or a trusted test command before locking scope.',
    },
  }));
}

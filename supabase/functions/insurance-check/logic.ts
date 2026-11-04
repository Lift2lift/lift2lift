// Pure decision logic for insurance-check, kept apart so it can be tested without AWS.
import { parseDate } from '../license-check/logic.ts';

export const QUERIES = [
  { Alias: 'INSURER', Text: 'What is the name of the insurance company?' },
  { Alias: 'NAMED_INSURED', Text: 'What is the name of the insured person or policyholder?' },
  { Alias: 'POLICY', Text: 'What is the policy number?' },
  { Alias: 'EXPIRES', Text: 'What is the policy expiration date?' },
];

type Block = { Id?: string; BlockType?: string; Text?: string; Query?: { Alias?: string }; Relationships?: { Type?: string; Ids?: string[] }[] };

/** Pulls the answer for each query alias out of Textract's blocks. */
export function answers(blocks: Block[]) {
  const byId = new Map(blocks.map((b) => [b.Id, b]));
  const out: Record<string, string> = {};
  for (const b of blocks) {
    if (b.BlockType !== 'QUERY' || !b.Query?.Alias) continue;
    const id = b.Relationships?.find((r) => r.Type === 'ANSWER')?.Ids?.[0];
    const text = byId.get(id)?.Text?.trim();
    if (text) out[b.Query.Alias] = text;
  }
  return out;
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Family policies count: the license last name just has to appear on the card. */
export function nameMatches(namedInsured: string, lastName: string | null) {
  const last = words(lastName ?? '');
  if (!last.length) return false;
  const card = words(namedInsured);
  return last.every((w) => card.includes(w));
}

export type Decision = {
  status: 'verified' | 'review' | 'requires_input';
  error: string | null;
  expires: string | null;
};

export function decide(a: Record<string, string>, lastName: string | null, today: string): Decision {
  const expires = parseDate(a.EXPIRES ?? '');
  if (!expires || !a.NAMED_INSURED) return { status: 'requires_input', error: 'insurance_unreadable', expires: null };
  if (expires < today) return { status: 'requires_input', error: 'insurance_expired', expires: null };
  return { status: nameMatches(a.NAMED_INSURED, lastName) ? 'verified' : 'review', error: null, expires };
}

export const lastFour = (policy: string | undefined) => {
  const clean = (policy ?? '').replace(/[^a-z0-9]/gi, '');
  return clean ? clean.slice(-4) : null;
};

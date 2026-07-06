import { describe, it, expect } from 'vitest';
import { matchMerchantKnowledge } from '@/lib/merchant-knowledge';

// A realistic subset of the user's categories.
const CATS = ['Subscriptions', 'Travel', 'Dining', 'Groceries', 'Utilities', 'Shopping', 'Vendor Payment', 'Marketing'];

const match = (key: string, raw = key) =>
  matchMerchantKnowledge(key, raw, key, CATS);

describe('built-in merchant knowledge', () => {
  it('categorizes Anthropic/Claude as a subscription (auto confidence)', () => {
    const r = match('ANTHROPIC', 'ANTHROPIC PBC');
    expect(r?.category).toBe('Subscriptions');
    expect(r?.confidence).toBeGreaterThanOrEqual(90);
    expect(match('CLAUDE', 'CLAUDE.AI SUBSCRIPTION')?.category).toBe('Subscriptions');
  });

  it('recognizes common SaaS and streaming', () => {
    for (const m of ['OPENAI', 'GITHUB', 'FIGMA', 'NETFLIX', 'SPOTIFY', 'ADOBE']) {
      expect(match(m)?.category, m).toBe('Subscriptions');
    }
  });

  it('separates Uber rides (Travel) from Uber Eats (Dining)', () => {
    expect(match('UBER', 'UBER TRIP 8005928996 CA')?.category).toBe('Travel');
    expect(match('UBER EATS', 'UBER EATS SF')?.category).toBe('Dining');
  });

  it('routes delivery, groceries, telecom, and ads correctly', () => {
    expect(match('DOORDASH')?.category).toBe('Dining');
    expect(match('WHOLE FOODS', 'WHOLEFDS MARKET')?.category).toBe('Groceries');
    expect(match('VERIZON')?.category).toBe('Utilities');
    expect(match('FACEBK', 'FACEBK ADS *AB12')?.category).toBe('Marketing');
  });

  it('falls back through category alternatives to what the user actually has', () => {
    // User has no "Software" category, so Anthropic resolves to the next
    // preference the user does have ("Vendor Payment").
    const narrow = ['Vendor Payment', 'Travel'];
    expect(matchMerchantKnowledge('ANTHROPIC', 'ANTHROPIC', 'ANTHROPIC', narrow)?.category)
      .toBe('Vendor Payment');
  });

  it('returns null for unknown merchants and when no candidate category exists', () => {
    expect(match('SOME LOCAL BODEGA XYZ')).toBeNull();
    expect(matchMerchantKnowledge('NETFLIX', 'NETFLIX', 'NETFLIX', ['Travel', 'Groceries'])).toBeNull();
  });

  it('never invents a category outside the allowed list', () => {
    const r = match('SPOTIFY');
    expect(r).not.toBeNull();
    expect(CATS).toContain(r!.category);
  });
});

import { describe, it, expect } from 'vitest';
import { detectMethodFromFilename } from '@/lib/method-detector';

const methods = [
  { name: 'Karat', match_pattern: null },
  { name: 'Amex Platinum', match_pattern: 'amex[\\s_-]*plat' },
  { name: 'Chase Checking/Debit', match_pattern: null },
  { name: 'BoA 5563', match_pattern: null },
];

describe('detectMethodFromFilename', () => {
  it('detects a card by NAME even with no match_pattern (the Karat bug)', () => {
    expect(detectMethodFromFilename('karat-2026-01.csv', methods)).toBe('Karat');
    expect(detectMethodFromFilename('Karat_Business_Statement.CSV', methods)).toBe('Karat');
    expect(detectMethodFromFilename('2026 KARAT export.csv', methods)).toBe('Karat');
  });

  it('still honors an explicit match_pattern', () => {
    expect(detectMethodFromFilename('amex_plat_jan.csv', methods)).toBe('Amex Platinum');
  });

  it('matches names with spaces/punctuation by normalizing both sides', () => {
    expect(detectMethodFromFilename('chase-checking-debit-dec.csv', methods)).toBe('Chase Checking/Debit');
    expect(detectMethodFromFilename('boa5563-statement.csv', methods)).toBe('BoA 5563');
  });

  it('prefers the most specific (longest) matching name', () => {
    const ms = [
      { name: 'Chase', match_pattern: null },
      { name: 'Chase Sapphire Reserve', match_pattern: null },
    ];
    expect(detectMethodFromFilename('chase-sapphire-reserve.csv', ms)).toBe('Chase Sapphire Reserve');
  });

  it('returns null when nothing matches', () => {
    expect(detectMethodFromFilename('random-bank-export.csv', methods)).toBeNull();
  });

  it('falls back to built-in patterns when no saved methods are given', () => {
    expect(detectMethodFromFilename('amex-platinum.csv')).toBe('Amex Platinum');
  });
});

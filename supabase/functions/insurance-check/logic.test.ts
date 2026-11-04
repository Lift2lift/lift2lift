// Run with: node --test supabase/functions/insurance-check/logic.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answers, decide, lastFour, nameMatches } from './logic.ts';

const today = '2026-11-04';
const card = (name: string, expires: string) => ({ NAMED_INSURED: name, EXPIRES: expires });

test('own card passes', () => assert.equal(decide(card('Casey Driver', '12/01/2026'), 'Driver', today).status, 'verified'));
test('parent policy with same last name passes', () => assert.equal(decide(card('DRIVER, PAT Q', 'Dec 1, 2026'), 'Driver', today).status, 'verified'));
test('different name goes to review', () => assert.equal(decide(card('Pat Smith', '12/01/26'), 'Driver', today).status, 'review'));
test('expired fails', () => assert.equal(decide(card('Casey Driver', '11/03/2026'), 'Driver', today).error, 'insurance_expired'));
test('unreadable fails closed', () => assert.equal(decide({}, 'Driver', today).error, 'insurance_unreadable'));
test('no license name never matches', () => assert.equal(nameMatches('Casey Driver', null), false));
test('partial word does not match', () => assert.equal(nameMatches('Andrew Long', 'Lon'), false));
test('keeps only last 4', () => assert.equal(lastFour('AB-123 4567'), '4567'));
test('reads query answers', () => assert.deepEqual(
  answers([{ Id: '1', BlockType: 'QUERY', Query: { Alias: 'POLICY' }, Relationships: [{ Type: 'ANSWER', Ids: ['2'] }] }, { Id: '2', BlockType: 'QUERY_RESULT', Text: ' 99 ' }]),
  { POLICY: '99' },
));

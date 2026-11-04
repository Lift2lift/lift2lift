// Run with: node --test supabase/functions/license-check/logic.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageType, licenseProblem, parseDate } from './logic.ts';

const doc = (type: string, expires: string) => [
  { Type: { Text: 'ID_TYPE' }, ValueDetection: { Text: type } },
  { Type: { Text: 'EXPIRATION_DATE' }, ValueDetection: { Text: expires } },
];

test('valid license passes', () => assert.equal(licenseProblem(doc('DRIVER LICENSE FRONT', '12/31/2030'), '2026-11-04'), null));
test('expiry day still counts', () => assert.equal(licenseProblem(doc('DRIVER LICENSE FRONT', '11/04/2026'), '2026-11-04'), null));
test('expired fails', () => assert.equal(licenseProblem(doc('DRIVER LICENSE FRONT', '11/03/2026'), '2026-11-04'), 'document_expired'));
test('passport fails', () => assert.equal(licenseProblem(doc('PASSPORT', '12/31/2030'), '2026-11-04'), 'document_type_not_supported'));
test('unreadable date fails closed', () => assert.equal(licenseProblem(doc('DRIVER LICENSE FRONT', ''), '2026-11-04'), 'document_unverified_other'));
test('parses ISO', () => assert.equal(parseDate('2027-08-14T00:00:00'), '2027-08-14'));
test('rejects HEIC bytes', () => assert.equal(imageType(new Uint8Array([0, 0, 0, 24])), null));

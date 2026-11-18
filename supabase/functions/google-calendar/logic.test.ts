// Run with: node --test supabase/functions/google-calendar/logic.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_RETURN, returnToOk, withResult } from './logic.ts';

const origins = ['http://localhost:3000', 'https://lift2lift.app'];

test('return addresses that are allowed', () => {
  for (const ok of [
    APP_RETURN,
    'https://lift2lift.app/community?id=abc&view=members',
    'http://localhost:3000/community?id=abc',
    'exp://192.168.1.20:8081/--/google-calendar',
  ]) assert.equal(returnToOk(ok, origins), true, ok);
});

test('return addresses that are refused', () => {
  for (const bad of [
    'https://evil.test/community',
    'https://lift2lift.app.evil.test/x',
    'https://user@lift2lift.app/x',
    'http://lift2lift.app/x',
    'javascript:alert(1)',
    'lift2lift://elsewhere',
    'exp://192.168.1.20:8081/--/other',
    'exp://192.168.1.20:8081/--/google-calendar?x=1',
    'https://lift2lift.app/a b',
    '/community',
    '',
    null,
    'https://lift2lift.app/' + 'x'.repeat(2000),
  ]) assert.equal(returnToOk(bad, origins), false, String(bad));
});

test('withResult sets the result and drops the hash', () => {
  assert.equal(withResult(APP_RETURN, 'connected'), 'lift2lift://google-calendar?google_calendar=connected');
  assert.equal(
    withResult('https://lift2lift.app/community?id=abc&google_calendar=error#top', 'denied'),
    'https://lift2lift.app/community?id=abc&google_calendar=denied',
  );
  assert.equal(withResult('exp://192.168.1.20:8081/--/google-calendar', 'error'), 'exp://192.168.1.20:8081/--/google-calendar?google_calendar=error');
});

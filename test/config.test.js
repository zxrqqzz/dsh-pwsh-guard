/**
 * Config normalization: a typo in `cordis.patch.yml` must degrade to the
 * default with one warning, never break the profile.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, normalizeConfig } from '../lib/config.js';

test('defaults are the documented ones', () => {
  const { config, warnings } = normalizeConfig({});
  assert.deepEqual(warnings, []);
  assert.equal(config.mode, 'learn', 'first install must not deny anything');
  assert.deepEqual(config.tools, ['pwsh']);
  assert.equal(config.slowMs, 5000);
  assert.equal(config.denyOncePerSession, true);
  assert.equal(config.appendTiming, true);
  assert.equal(config.slowNotice, true);
  assert.equal(config.rulesFile, null);
  assert.deepEqual(config.silentFamilies, []);
  assert.ok(config.maxSectionChars >= 200);
  assert.equal(config.predictiveAfter, 3);
  assert.equal(config.predictiveMinMs, 10000);
  assert.equal(config.liftDenyOnceAfter, 0, 'M3 re-arming is opt-in');
  assert.equal(DEFAULTS.mode, 'learn');
});

test('non-object config is ignored', () => {
  for (const value of [undefined, null, 42, 'nope', []]) {
    const { config, warnings } = normalizeConfig(value);
    assert.equal(config.mode, 'learn');
    assert.deepEqual(warnings, []);
  }
});

test('valid overrides pass through', () => {
  const { config, warnings } = normalizeConfig({
    mode: 'guard',
    tools: ['pwsh', 'bash'],
    slowMs: 1500,
    denyOncePerSession: false,
    maxSectionChars: 900,
    rulesFile: 'D:\\rules.json',
    silentFamilies: ['output'],
  });
  assert.deepEqual(warnings, []);
  assert.equal(config.mode, 'guard');
  assert.deepEqual(config.tools, ['pwsh', 'bash']);
  assert.equal(config.slowMs, 1500);
  assert.equal(config.denyOncePerSession, false);
  assert.equal(config.maxSectionChars, 900);
  assert.equal(config.rulesFile, 'D:\\rules.json');
  assert.deepEqual(config.silentFamilies, ['output']);
});

test('bad values fall back with one warning each', () => {
  const { config, warnings } = normalizeConfig({
    mode: 'yolo',
    tools: [],
    slowMs: '5',
    denyOncePerSession: 'yes',
    maxSectionChars: 10,
    rulesFile: 7,
    silentFamilies: 'output',
    predictiveAfter: -1,
    predictiveMinMs: 'x',
    liftDenyOnceAfter: 1.5,
  });
  assert.equal(config.mode, 'learn');
  assert.deepEqual(config.tools, ['pwsh']);
  assert.equal(config.slowMs, 5000);
  assert.equal(config.denyOncePerSession, true);
  assert.equal(config.maxSectionChars, 1200);
  assert.equal(config.rulesFile, null);
  assert.deepEqual(config.silentFamilies, []);
  assert.equal(config.predictiveAfter, 3);
  assert.equal(config.predictiveMinMs, 10000);
  assert.equal(config.liftDenyOnceAfter, 0);
  assert.equal(warnings.length, 10, warnings.join('\n'));
});

test('unknown keys are ignored without noise', () => {
  const { warnings } = normalizeConfig({ slowMS: 5, dennyOncePerSession: true });
  assert.deepEqual(warnings, []);
});

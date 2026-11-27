/**
 * Rule-table regression. The rules document ships its own test cases
 * (`samples.hit` / `samples.miss`); this file is what makes that contract real.
 *
 * Editing a rule without editing its samples fails here — which is the point.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileRules, isAllowlisted, matchRules, meetsThreshold } from '../lib/rules.js';

const RULES_PATH = fileURLToPath(new URL('../rules/rules.json', import.meta.url));
const doc = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
const compiled = compileRules(doc);

test('rules document compiles cleanly', () => {
  assert.deepEqual(compiled.warnings, []);
  assert.equal(compiled.rules.length, doc.rules.length);
  assert.equal(compiled.allowlist.length, doc.allowlist.length);
  assert.ok(doc.rules.length > 0, 'rules must not be empty');
});

test('every rule matches its own hit samples', () => {
  for (const rule of doc.rules) {
    const compiledRule = compiled.rules.find((r) => r.id === rule.id);
    assert.ok(compiledRule, `rule ${rule.id} compiled`);
    for (const sample of rule.samples.hit) {
      assert.ok(compiledRule.regex.test(sample), `${rule.id} should match: ${sample}`);
    }
  }
});

test('no hit sample is caught by the allowlist', () => {
  for (const rule of doc.rules) {
    for (const sample of rule.samples.hit) {
      const allowed = isAllowlisted(compiled, sample);
      assert.equal(allowed, null, `${rule.id} sample must not be allowlisted (${allowed?.id}): ${sample}`);
    }
  }
});

test('no miss sample matches any rule', () => {
  for (const rule of doc.rules) {
    for (const sample of rule.samples.miss) {
      const hit = matchRules(compiled, sample);
      assert.equal(hit, null, `${rule.id} miss sample matched ${hit?.rule.id}: ${sample}`);
    }
  }
});

test('allowlist wins over a matching rule', () => {
  const command = 'Get-ChildItem . -Recurse -Filter *.js';
  assert.equal(matchRules(compiled, command), null);
  assert.notEqual(isAllowlisted(compiled, command), null);
});

test('highest severity wins, then family rank', () => {
  // Matches both `selectstring-recurse` (search) and `gci-recurse-nofilter` (search).
  const hit = matchRules(compiled, 'Get-ChildItem -Recurse | Select-String "TODO"');
  assert.ok(hit);
  assert.equal(hit.severity, 'high');
  assert.ok(['selectstring-recurse', 'gci-recurse-nofilter'].includes(hit.rule.id));
});

test('bumpWhen marks a danger zone', () => {
  const plain = matchRules(compiled, 'Get-ChildItem . -Recurse');
  const dangerous = matchRules(compiled, 'Get-ChildItem C:\\repo\\node_modules -Recurse');
  assert.equal(plain.bumped, false);
  assert.equal(dangerous.bumped, true);
});

test('bumpWhen escalates medium to high', () => {
  const synthetic = compileRules({
    version: 99,
    allowlist: [],
    rules: [
      {
        id: 'synthetic-raw',
        family: 'read',
        severity: 'medium',
        regex: '-Raw\\b',
        bumpWhen: ['node_modules'],
        why: 'test',
        measured: '',
        fast: '',
      },
    ],
  });
  assert.equal(matchRules(synthetic, 'Get-Content a.log -Raw').severity, 'medium');
  assert.equal(matchRules(synthetic, 'Get-Content node_modules\\a.log -Raw').severity, 'high');
});

test('invalid regex is skipped, the rest keep working', () => {
  const broken = compileRules({
    version: 1,
    allowlist: [{ id: 'bad', regex: '(', why: '' }],
    rules: [
      { id: 'bad', family: 'block', severity: 'high', regex: '([', why: '', measured: '', fast: '' },
      { id: 'good', family: 'block', severity: 'high', regex: 'Read-Host', why: '', measured: '', fast: '' },
    ],
  });
  assert.equal(broken.rules.length, 1);
  assert.equal(broken.rules[0].id, 'good');
  assert.equal(broken.allowlist.length, 0);
  assert.equal(broken.warnings.length, 2);
});

test('deny thresholds', () => {
  assert.equal(meetsThreshold('high', 'high'), true);
  assert.equal(meetsThreshold('medium', 'high'), false);
  assert.equal(meetsThreshold('medium', 'medium'), true);
  assert.equal(meetsThreshold('low', 'medium'), false);
});

// Guards the workflow files themselves: pinned actions, least privilege, deliberate release triggers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';

const dir = new URL('../.github/workflows/', import.meta.url);
const names = (await fs.readdir(dir)).filter(name => /\.ya?ml$/.test(name));
const load = async name => fs.readFile(new URL(name, dir), 'utf8');

test('workflows exist', () => {
  assert.ok(names.includes('ci.yml') && names.includes('release.yml'), `found ${names.join(', ')}`);
});

for (const name of names) {
  test(`${name}: actions are pinned to a commit hash with a version comment`, async () => {
    const uses = [...(await load(name)).matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length > 0);
    for (const [, action, rest] of uses) {
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${action} must be pinned to a full commit hash`);
      assert.match(rest, /#\s*v\d+\.\d+\.\d+/, `${action} needs its release tag as a comment`);
    }
  });

  test(`${name}: token is read-only by default and checkouts keep no credentials`, async () => {
    const text = await load(name);
    assert.match(text, /^permissions:\s*\{\}\s*$|^permissions:\s*\n\s+contents:\s*read\s*$/m, 'top-level permissions must be empty or contents: read');
    const checkouts = text.split('actions/checkout@').length - 1, safe = text.split('persist-credentials: false').length - 1;
    assert.equal(safe, checkouts, 'every checkout sets persist-credentials: false');
  });
}

test('release.yml publishes only deliberately and only from a write-scoped job', async () => {
  const text = await load('release.yml');
  assert.doesNotMatch(text, /^\s+(?:pull_request|pull_request_target|branches|schedule)\b/m, 'no PR, branch or schedule trigger');
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /tags:\s*\n\s*-\s*'v\*'/);
  assert.equal(text.split('contents: write').length - 1, 1, 'exactly one job may write contents');
  assert.match(text, /environment:\s*release/);
  assert.match(text, /gh release create/);
});

test('ci.yml runs on pull requests and main, and never publishes', async () => {
  const text = await load('ci.yml');
  assert.match(text, /pull_request:/);
  assert.match(text, /branches:\s*\[main\]/);
  assert.doesNotMatch(text, /contents:\s*write|gh release/);
});

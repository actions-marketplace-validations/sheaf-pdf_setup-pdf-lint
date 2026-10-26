'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const { archive, requested, released, checksum, verified } = require('../index.js');

test('each runner platform has its release archive, and others none', () => {
  assert.deepEqual(archive('linux', 'x64'), { platform: 'linux-x86_64', ext: 'tar.gz' });
  assert.deepEqual(archive('linux', 'arm64'), { platform: 'linux-aarch64', ext: 'tar.gz' });
  assert.deepEqual(archive('darwin', 'arm64'), { platform: 'macos-arm64', ext: 'tar.gz' });
  assert.deepEqual(archive('darwin', 'x64'), { platform: 'macos-x86_64', ext: 'tar.gz' });
  assert.deepEqual(archive('win32', 'x64'), { platform: 'windows-x86_64', ext: 'zip' });
  for (const [platform, arch] of [['win32', 'arm64'], ['linux', 'ia32'], ['freebsd', 'x64']]) {
    assert.equal(archive(platform, arch), null, `${platform} ${arch}`);
  }
});

test('a version is asked for as itself, with a v, or as its tag; latest is the newest', () => {
  for (const input of [undefined, '', ' ', 'latest']) {
    assert.equal(requested(input), null, JSON.stringify(input));
  }
  for (const input of ['0.1.0', 'v0.1.0', 'pdf-lint-v0.1.0', ' 0.1.0 ']) {
    assert.equal(requested(input), '0.1.0', input);
  }
  assert.equal(requested('1.2.3-rc.1'), '1.2.3-rc.1');
  for (const input of ['0.1', '1', 'newest', 'pdf-tokenizer-v0.1.0', '0.1.0; rm -rf /']) {
    assert.throws(() => requested(input), /give one such as 0\.1\.0, or latest/, input);
  }
});

test("the newest release's version is read from its page's URL", () => {
  assert.equal(released('https://github.com/sheaf-pdf/pdf-lint/releases/tag/pdf-lint-v0.1.0'), '0.1.0');
  assert.equal(released('https://github.com/sheaf-pdf/pdf-lint/releases/tag/pdf-tokenizer-v0.1.0'), null);
  assert.equal(released('https://github.com/sheaf-pdf/pdf-lint/releases'), null);
  assert.equal(released(null), null);
});

test('an archive is taken only with the SHA-256 its .sha256 gives', () => {
  const data = Buffer.from('an archive');
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const name = 'pdf-lint-0.1.0-linux-x86_64.tar.gz';
  assert.equal(checksum(`${sha}  ${name}\n`), sha);
  assert.equal(checksum(sha.toUpperCase()), sha);
  assert.equal(verified(data, `${sha}  ${name}\n`, name), data);
  assert.throws(() => verified(Buffer.from('another'), `${sha}  ${name}\n`, name), /not the release's/);
  for (const text of ['', 'not a checksum', `${sha.slice(1)}  ${name}`, `${sha}x  ${name}`]) {
    assert.throws(() => checksum(text), /gives no SHA-256/, text);
  }
});

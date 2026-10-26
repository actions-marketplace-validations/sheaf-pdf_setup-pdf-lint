// Installs pdf-lint from its GitHub release: the archive for this runner's
// platform, checked against the release's SHA-256, unpacked into the
// runner's tool cache with the qpdf it bundles, and put on the PATH.
//
// No dependencies: Node's fetch and crypto, and the system's tar, which on
// Windows reads zip archives too.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPOSITORY = 'https://github.com/sheaf-pdf/pdf-lint';

/** Each release archive, by Node's platform and architecture. */
const ARCHIVES = {
  'linux-x64': { platform: 'linux-x86_64', ext: 'tar.gz' },
  'linux-arm64': { platform: 'linux-aarch64', ext: 'tar.gz' },
  'darwin-arm64': { platform: 'macos-arm64', ext: 'tar.gz' },
  'darwin-x64': { platform: 'macos-x86_64', ext: 'tar.gz' },
  'win32-x64': { platform: 'windows-x86_64', ext: 'zip' },
};

/** The release archive for `platform` and `arch`, as Node names them, or null. */
function archive(platform, arch) {
  return ARCHIVES[`${platform}-${arch}`] ?? null;
}

/**
 * The version the input asks for, null for the newest: 0.1.0, or written
 * as v0.1.0 or the tag, pdf-lint-v0.1.0.
 */
function requested(input) {
  const version = (input ?? '').trim();
  if (version === '' || version === 'latest') {
    return null;
  }
  const match = /^(?:pdf-lint-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(version);
  if (!match) {
    throw new Error(`version ${JSON.stringify(input)}: give one such as 0.1.0, or latest`);
  }
  return match[1];
}

/** The version of a release, from the URL of its page, or null. */
function released(url) {
  const match = /\/releases\/tag\/pdf-lint-v([^/?#]+)$/.exec(url ?? '');
  return match ? match[1] : null;
}

/** The SHA-256 a .sha256 file gives, written as sha256sum writes it. */
function checksum(text) {
  const match = /^([0-9a-fA-F]{64})(\s|$)/.exec(text.trim());
  if (!match) {
    throw new Error(`a .sha256 file that gives no SHA-256: ${JSON.stringify(text.slice(0, 80))}`);
  }
  return match[1].toLowerCase();
}

/** `data`, when its SHA-256 is the one `sums` gives; else why not. */
function verified(data, sums, name) {
  const want = checksum(sums);
  const got = crypto.createHash('sha256').update(data).digest('hex');
  if (got !== want) {
    throw new Error(`${name} has SHA-256 ${got}, not the release's ${want}`);
  }
  return data;
}

/** Why a fetch failed: Node's own message is only "fetch failed". */
function why(error) {
  return error.cause?.message ?? error.message;
}

/** The newest release's version, from where its releases/latest redirects. */
async function latest() {
  let response;
  try {
    response = await fetch(`${REPOSITORY}/releases/latest`, { redirect: 'manual' });
  } catch (error) {
    throw new Error(`${REPOSITORY}/releases/latest: ${why(error)}`);
  }
  const version = released(response.headers.get('location'));
  if (!version) {
    throw new Error(`${REPOSITORY}/releases/latest doesn't lead to a release of pdf-lint (HTTP ${response.status})`);
  }
  return version;
}

/** `url`'s body, tried three times but for a 404, which is final. */
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`${url}: ${why(error)}`);
      }
    }
    if (response?.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
    if (response?.status === 404 || (response && attempt === 3)) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

/** The system's tar: on Windows its own, bsdtar, which reads zip archives. */
function tar() {
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  }
  return 'tar';
}

/** `message` as a workflow command's data, its line breaks escaped. */
function escaped(message) {
  return String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** `line` appended to the file the runner names in `variable`. */
function append(variable, line) {
  const file = process.env[variable];
  if (file) {
    fs.appendFileSync(file, line + os.EOL);
  }
}

/**
 * Release `version`'s archive `name` for `wanted`, downloaded, verified
 * and unpacked into `root`, where it holds `binary`.
 */
async function install(version, wanted, name, root, binary) {
  const file = `${name}.${wanted.ext}`;
  const url = `${REPOSITORY}/releases/download/pdf-lint-v${version}/${file}`;
  console.log(url);
  let data;
  let sums;
  try {
    [data, sums] = await Promise.all([download(url), download(`${url}.sha256`)]);
  } catch (error) {
    if (/HTTP 404$/.test(error.message)) {
      throw new Error(`pdf-lint ${version} has no release with ${file}: is ${version} a version of pdf-lint's? (${error.message})`);
    }
    throw error;
  }
  verified(data, sums.toString('utf8'), file);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, file), data);
  const unpacked = spawnSync(tar(), ['-xf', file], { cwd: root, encoding: 'utf8' });
  if (unpacked.error || unpacked.status !== 0) {
    throw new Error(`${file} doesn't unpack: ${unpacked.error?.message ?? unpacked.stderr.trim()}`);
  }
  fs.rmSync(path.join(root, file));
  if (!fs.existsSync(binary)) {
    throw new Error(`${file} has no ${path.relative(root, binary)}`);
  }
  fs.writeFileSync(path.join(root, '.complete'), '');
}

async function main() {
  const wanted = archive(process.platform, process.arch);
  if (!wanted) {
    const platforms = Object.values(ARCHIVES).map((a) => a.platform).join(', ');
    throw new Error(`pdf-lint has no release archive for ${process.platform} ${process.arch}, only for ${platforms}`);
  }
  const version = requested(process.env.INPUT_VERSION) ?? (await latest());
  const name = `pdf-lint-${version}-${wanted.platform}`;
  // pdf-lint/<version>/<arch> in the tool cache, as @actions/tool-cache
  // lays out tools; done once it holds .complete, written last.
  const root = path.join(process.env.RUNNER_TOOL_CACHE ?? os.tmpdir(), 'pdf-lint', version, process.arch);
  const dir = path.join(root, name);
  const binary = path.join(dir, process.platform === 'win32' ? 'pdf-lint.exe' : 'pdf-lint');

  if (fs.existsSync(path.join(root, '.complete')) && fs.existsSync(binary)) {
    console.log(`pdf-lint ${version} is in the tool cache: ${dir}`);
  } else {
    console.log(`::group::Installing pdf-lint ${version} for ${wanted.platform}`);
    try {
      await install(version, wanted, name, root, binary);
    } finally {
      console.log('::endgroup::');
    }
  }

  // What it decodes with: the qpdf beside it, unless PDF_LINT_QPDF names
  // another.
  const ran = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (ran.error || ran.status !== 0) {
    throw new Error(`pdf-lint ${version} doesn't run: ${ran.error?.message ?? ran.stderr.trim()}`);
  }
  console.log(ran.stdout.trim());
  const qpdf = /^no qpdf to decode with: (.*)$/m.exec(ran.stdout);
  if (qpdf) {
    console.log(
      `::warning::${escaped(`pdf-lint can't decode with qpdf here (${qpdf[1]}): it checks files in plain view, but leaves unread those with anything compressed or encrypted`)}`,
    );
  }

  append('GITHUB_PATH', dir);
  append('GITHUB_OUTPUT', `version=${version}`);
  append('GITHUB_OUTPUT', `path=${dir}`);
}

module.exports = { archive, requested, released, checksum, verified };

if (require.main === module) {
  main().catch((error) => {
    console.log(`::error::${escaped(error.message)}`);
    process.exitCode = 1;
  });
}

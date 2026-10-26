# Setup pdf-lint

Installs [pdf-lint](https://github.com/sheaf-pdf/pdf-lint), which checks
PDF files against the Arlington PDF Model, on a GitHub Actions runner. It
takes the release archive for the runner's platform, checks it against the
release's SHA-256, and puts `pdf-lint` on the `PATH`, with the qpdf it
decodes with beside it: there's nothing else to install.

```yaml
steps:
  - uses: sheaf-pdf/setup-pdf-lint@v1
    with:
      version: 0.1.0
  - run: pdf-lint --last-update out.pdf
```

## Inputs

| Input | |
|---|---|
| `version` | The pdf-lint version to install, such as `0.1.0` (`v0.1.0` and `pdf-lint-v0.1.0` work too), or `latest`, the default. Pin one, so that a new release doesn't change what a workflow finds. |

## Outputs

| Output | |
|---|---|
| `version` | The version installed. |
| `path` | The folder it was unpacked into, which is put on the `PATH`. The qpdf it decodes with is in its `qpdf/`. |

## Runners

Each platform pdf-lint has a release archive for: Linux on x86_64 and
aarch64, macOS on Apple silicon and Intel, and Windows on x64. Another
fails the step, saying so. On Apple silicon it takes the arm64 archive,
as the runner's Node is arm64; the Intel one is for Intel Macs.

The bundled qpdf needs glibc 2.34 or later on Linux, which every
GitHub-hosted Ubuntu runner has. In a job that runs in a container
without it, such as Alpine's, pdf-lint still runs and checks files in
plain view, but leaves unread those with anything compressed or
encrypted; the step warns of it. Naming another qpdf, 11.9 or later, in
`PDF_LINT_QPDF` mends that.

It installs into the runner's tool cache, so a self-hosted runner reuses
an install from one job to the next. Behind a proxy, Node's `fetch` uses
`HTTPS_PROXY` only when `NODE_USE_ENV_PROXY=1` is set too.

## How it works

A JavaScript action with no dependencies: Node's `fetch` and `crypto`, and
the system's `tar`, which on Windows reads zip archives too. The newest
version is read from where the release page's `latest` link leads, not
from GitHub's API, so it needs no token and meets no rate limit.

`node --test` runs the unit tests.

## License

Apache-2.0, as pdf-lint is.

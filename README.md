# Free PDF to Text for n8n

[![npm version](https://img.shields.io/npm/v/n8n-nodes-free-pdf-to-text)](https://www.npmjs.com/package/n8n-nodes-free-pdf-to-text)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-free-pdf-to-text)](https://www.npmjs.com/package/n8n-nodes-free-pdf-to-text)
[![CI](https://github.com/LeonardSEO/n8n-nodes-pdf-page-extract/actions/workflows/ci.yml/badge.svg)](https://github.com/LeonardSEO/n8n-nodes-pdf-page-extract/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE.md)

Extract text from PDF files inside your self-hosted n8n instance. No API key, no per-page fees, and your documents never leave your server.

## Features

- **Local processing:** PDFs are parsed in memory by [PDF.js](https://mozilla.github.io/pdf.js/). The parser receives no URL and makes no network requests for your document.
- **Readable output:** line breaks and table columns are preserved, which helps regular expressions and AI nodes.
- **Flexible output:** one item per PDF or one item per page, with an optional page range.
- **Password support:** open protected PDFs, with clear errors for a missing or incorrect password.
- **Scan detection:** a `needsOcr` flag tells a workflow when a PDF contains no text layer.
- **Keeps n8n responsive:** parsing runs in a worker thread, with enforced limits on time and memory.
- **Tolerant of damaged files:** malformed cross-reference tables are recovered where possible, and one unreadable page does not stop the others.

## Installation

1. In n8n, go to **Settings > Community Nodes**.
2. Select **Install a community node**.
3. Enter `n8n-nodes-free-pdf-to-text` and confirm.
4. Search the node picker for **Free PDF to Text**.

This is an unverified community node for self-hosted n8n, because it needs PDF.js as a runtime dependency.

## Quick start

1. Add a node that outputs a PDF as binary data, such as **HTTP Request**, **Webhook**, or **Read/Write Files from Disk**.
2. Connect **Free PDF to Text** and set **Binary Property** to the field that holds the PDF (`data` by default).
3. Run the workflow and use `pages`, `text`, or `needsOcr` in the next node.

## Output

### One item per PDF (default)

```json
{
	"filename": "invoice.pdf",
	"totalPages": 3,
	"pages": ["Invoice 2026-041\nDate: 4 November", "Total\t100,00\nVAT\t21,00", ""],
	"pageNumbers": [1, 2, 3],
	"characterCount": 54,
	"needsOcr": false,
	"pagesWithoutText": [3],
	"warnings": [{ "page": 3, "message": "Recovered malformed content stream" }],
	"text": "All pages as one value, when Include Raw Text is on",
	"metadata": {},
	"info": {}
}
```

### One item per page

```json
{
	"filename": "invoice.pdf",
	"page": 2,
	"totalPages": 3,
	"text": "Total\t100,00\nVAT\t21,00",
	"characterCount": 22,
	"hasText": true
}
```

### Field reference

| Field              | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `totalPages`       | Pages in the whole document, also when a page range is set                      |
| `pages`            | Text of the selected pages, in page order                                       |
| `pageNumbers`      | PDF page number of each entry in `pages`                                        |
| `characterCount`   | Number of extracted characters                                                  |
| `needsOcr`         | `true` when no selected page contains text                                      |
| `pagesWithoutText` | Selected pages that were read successfully but contain no text                  |
| `warnings`         | Pages that could not be read. Those pages are empty and the others still return |
| `text`             | All pages joined by a blank line, when **Include Raw Text** is on               |
| `metadata`, `info` | Document metadata, when **Include Metadata** is on                              |

Within a page, a newline separates lines and a tab separates widely spaced columns.

## Options

| Option                       |     Default | Purpose                                                 |
| ---------------------------- | ----------: | ------------------------------------------------------- |
| Binary Property              |      `data` | Binary field containing the PDF                         |
| Include Raw Text             |         Off | Add all text as one value in `text`                     |
| Include Metadata             |          On | Add PDF metadata and document information               |
| Output Mode                  | One per PDF | Return one item per PDF or one item per page            |
| Page Range                   |   All pages | Pages to extract, such as `1-3, 5, 8-`                  |
| Password                     |       Empty | Password for a protected PDF                            |
| Keep Input Binary            |          On | Pass the PDF on to the next node                        |
| Maximum File Size            |       50 MB | Reject larger PDFs before parsing (up to 100 MB)        |
| Maximum Pages                |         500 | Reject when more pages would be extracted (up to 2,000) |
| Maximum Extracted Characters |   5,000,000 | Stop on excessive text output (up to 10,000,000)        |
| Maximum Memory               |    1,024 MB | Stop parsing above this memory use (128 to 8,192 MB)    |
| Timeout                      | 120 seconds | Stop processing of one PDF (up to 300 seconds)          |
| Strict Parsing               |         Off | Fail on malformed PDFs instead of attempting recovery   |

## Scanned PDFs

The node reads existing text and does not perform OCR. A scan with a hidden OCR layer works as usual. A scan without one returns empty pages and `needsOcr: true`, so you can route it with an **If** node:

```text
Free PDF to Text → If {{ $json.needsOcr }} → true:  your OCR step
                                           → false: continue with the text
```

`needsOcr` only looks at whether text exists. Use `pagesWithoutText` to find individual scanned pages in a mixed document, keeping in mind that a page in that list can also be intentionally blank.

## Node versions

Version 2 is used for every new node. It keeps line breaks and table columns.

Version 1 nodes in existing workflows keep their space-separated text, so an update does not break expressions that depend on it. To switch, replace the node with a new one and check any expressions or regular expressions that read its text.

## Security

- PDF JavaScript, XFA, worker fetching, WASM, image decoding, and font rendering are disabled.
- Parsing runs in a worker thread that is terminated at the timeout or memory limit, and when the execution is cancelled.
- File, page, and character limits reduce the impact of malformed or hostile documents.
- The **Password** option is stored in the workflow like any other node parameter. To avoid that, set it with an expression that reads the password from an earlier node or an environment variable.

Run any document parser that handles untrusted files in an isolated and up-to-date environment.

## Compatibility

- Self-hosted n8n 2.x. Every change is tested in the current stable n8n release.
- Node.js 22.22 or newer.
- No credentials or external accounts.

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
```

`pnpm test` builds the package and also runs the worker-thread tests against the compiled output. `pnpm test:n8n` installs the packed package in a real n8n container and runs a workflow through it, which requires Docker.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, and [CHANGELOG.md](./CHANGELOG.md) for release history.

### Automatic updates

On the first of every month, [a GitHub Actions workflow](./.github/workflows/auto-update.yml) checks `pdfjs-dist`, `@n8n/node-cli`, and `prettier`. It only considers stable versions within the current major version that have been public for at least seven days.

- **New `pdfjs-dist`:** after all tests pass, it is released to npm automatically as a patch version.
- **Tooling only:** the update is committed without a release, because users would install nothing new.
- **Failure:** nothing is pushed or released, and an issue is opened.

## Support

Report bugs and request features in [GitHub Issues](https://github.com/LeonardSEO/n8n-nodes-pdf-page-extract/issues). Please include your n8n version, the node version, relevant options, and a non-sensitive sample PDF if possible.

## Credits and license

Maintained by [LeonardSEO](https://github.com/LeonardSEO). Based on the MIT-licensed [n8n PDF Page Extract](https://github.com/OscarWeijman/n8n-nodes-pdf-page-extract) node by [Oscar Weijman](https://github.com/OscarWeijman), who created the original page-by-page extraction. This fork adds a modern parser and the features above.

Released under the [MIT License](./LICENSE.md).

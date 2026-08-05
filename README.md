# Free PDF to Text for n8n

Free, local PDF-to-text extraction for self-hosted n8n. Convert every PDF page to text without a paid API, API key, subscription, per-page fee, or document upload to a third-party service.

Install: `n8n-nodes-free-pdf-to-text`

## Why use Free PDF to Text?

- **Free and open source:** no paid PDF service or usage-based API bill.
- **Private by design:** PDF files are processed locally inside your n8n instance.
- **No API key:** install the community node and use it immediately.
- **Page-by-page output:** receive an ordered text array that is easy to split, search, classify, or send to an AI node.
- **Resilient parsing:** recover malformed cross-reference tables when possible and continue past individual unreadable pages.
- **Safety limits:** configurable limits for file size, page count, extracted characters, and processing time.
- **Current parser:** uses PDF.js 6.2.108 instead of the legacy PDF.js 1.10.100 bundle.

The node is free to use, but your own n8n hosting and infrastructure may still have costs.

## Supported PDFs

Free PDF to Text works with:

- PDFs containing selectable text.
- Scanned PDFs that already contain a hidden OCR text layer.
- PDFs received as n8n binary data.
- Multi-page PDFs where page order matters.
- Recoverable PDFs with malformed `XRef` data.

The node does **not** perform OCR itself. An image-only scan without a text layer needs an OCR step before or after this node. Images inside a PDF are not converted into text automatically.

## Installation

This is an unverified community node for self-hosted n8n.

1. Open **Settings > Community Nodes** in n8n.
2. Select **Install a community node**.
3. Enter `n8n-nodes-free-pdf-to-text`.
4. Confirm the installation.
5. Search the node picker for **Free PDF to Text**.

The internal node name is `freePdfToText`, so it does not collide with the original `pdfPageExtract` community node. Both packages can be installed at the same time.

## Quick start

1. Add an **HTTP Request**, **Webhook**, cloud storage, email, or file node that outputs a PDF as binary data.
2. Add **Free PDF to Text** after it.
3. Set **Binary Property** to the binary field containing the PDF. The default is `data`.
4. Run the workflow.
5. Use `pages`, `text`, `metadata`, or `warnings` in the next node.

## Output

The node returns one item for every input PDF:

```json
{
	"filename": "invoice.pdf",
	"totalPages": 3,
	"pages": ["Text from page 1...", "Text from page 2...", "Text from page 3..."],
	"warnings": [
		{
			"page": 2,
			"message": "Recovered malformed content stream"
		}
	],
	"text": "Complete PDF text when Include Raw Text is enabled",
	"metadata": {},
	"info": {}
}
```

`pages` is always ordered by PDF page number. `text`, `metadata`, and `info` are included only when their corresponding options are enabled or data is available.

## Node options

| Option                       |     Default | Purpose                                              |
| ---------------------------- | ----------: | ---------------------------------------------------- |
| Binary Property              |      `data` | Binary field containing the PDF file                 |
| Include Raw Text             |         Off | Add all extracted text as one value in `text`        |
| Include Metadata             |          On | Add available PDF metadata and document information  |
| Maximum File Size            |       50 MB | Reject oversized PDFs before parsing                 |
| Maximum Pages                |         500 | Reject documents with too many pages                 |
| Maximum Extracted Characters |   5,000,000 | Stop excessively large text output                   |
| Timeout                      | 120 seconds | Stop PDF processing that takes too long              |
| Strict Parsing               |         Off | Reject malformed PDFs instead of attempting recovery |

Leave **Strict Parsing** disabled for PDFs from scanners, printers, and older document systems. Recoverable `bad XRef entry` problems are handled automatically. If one page still fails, that page can be returned as an empty string with its error in `warnings`, while the remaining pages continue.

## Common n8n use cases

- Extract text from invoices, orders, contracts, reports, and attachments.
- Split a PDF into page-level text items with the **Split Out** node.
- Search documents for references, amounts, names, or keywords.
- Send extracted text to an n8n AI Agent or language model.
- Classify incoming email attachments without uploading the PDF to a separate conversion API.
- Store PDF text in a database, vector store, search index, or document archive.

## Privacy and security

PDF bytes are passed directly to PDF.js as an in-memory array. The parser is not given a URL and does not send the document to an external service.

PDF JavaScript evaluation, XFA, worker fetching, WASM, image decoding, offscreen canvas, and font rendering are disabled for this text-only extraction path. File, page, character, image, and time limits reduce the impact of malformed or hostile documents. Parser resources are released after both successful and failed executions.

As with every document parser, process untrusted files in an appropriately isolated and updated n8n environment.

## Compatibility

- Self-hosted n8n 2.x.
- Node.js 22.22 or newer for package development.
- No credentials or external API account required.
- No built-in OCR for image-only PDFs.

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

The automated tests cover PDF parsing, page ordering, malformed pages, safety limits, cleanup, timeout behavior, n8n item pairing, and error handling.

## Support and contributing

For bugs and feature requests, open an issue in the linked GitHub repository. Reproducible reports should include the n8n version, node version, relevant options, and a non-sensitive sample PDF when possible.

Contributions are welcome. See `CONTRIBUTING.md` in the repository for the local development workflow.

## Credits and license

Free PDF to Text is maintained by [LeonardSEO](https://github.com/LeonardSEO) and builds on the original MIT-licensed [n8n PDF Page Extract](https://github.com/OscarWeijman/n8n-nodes-pdf-page-extract) community node created by [Oscar Weijman](https://github.com/OscarWeijman).

Oscar's original work provided the foundation for extracting page-by-page text inside n8n. This fork preserves that idea while modernizing the PDF parser, adding resilience and security controls, and keeping local PDF-to-text extraction free to use. Thank you, Oscar, for publishing the original project as open source.

This project is released under the [MIT License](./LICENSE.md). The original copyright and license terms remain acknowledged in the repository history and license.

# PDF Page Extract - n8n Custom Node

This n8n community node allows you to extract text from each page of a PDF file. It's ideal for structured document processing in your workflows.

## ✨ Features

- Extracts text from every page in a PDF
- Optionally includes the full raw text
- Optionally includes PDF metadata (title, author, etc.)
- Works with binary files in n8n
- Uses maintained PDF.js 6.2.108 directly instead of the legacy PDF.js 1.10.100 bundle
- Rejects non-PDF input and applies configurable file, page, text, and time limits
- Attempts to recover malformed cross-reference tables by default; strict parsing is optional
- Keeps the workflow running when one malformed page cannot be read and reports that page in `warnings`

## 🛠 Usage

1. Install the node via the **n8n Community Nodes** interface.
2. Use a node like HTTP Request or Webhook to provide a PDF file.
3. Attach the PDF to the binary property (default is `data`).
4. Configure the following options:
   - `Include Raw Text`: adds the full unstructured text output
   - `Include Metadata`: adds document metadata (e.g., title, author)
   - `Options`: optionally adjusts the safety limits or enables strict parsing

Existing workflows keep the same output contract. The default limits are 50 MB, 500 pages,
5,000,000 extracted characters, and 120 seconds per PDF.

Leave **Strict Parsing** disabled for PDFs produced by scanners or older document systems. The
parser will then attempt to repair recoverable cross-reference (`XRef`) problems. Enable it when
you prefer the node to reject any structurally damaged PDF. If a content stream still cannot be
read in the default mode, that page is returned as an empty string and its page number and parser
message are included in `warnings`; the remaining pages continue normally.

## 🖼 Example Workflow

The following example shows how to download a PDF from a URL and extract its pages:

![Example Workflow](./assets/workflow-example.png)

1. **Webhook** – Triggers the workflow (e.g. via browser or automation).
2. **HTTP Request** – Downloads the PDF file.
3. **PDF Page Extract** – Extracts page-by-page text.
4. **Split Out** – Splits the array of pages into individual items for further handling (e.g. AI, validation, extraction).

## 🔁 Output

Each item returned looks like this:

```json
{
  "filename": "example.pdf",
  "totalPages": 5,
  "pages": [
    "Page 1 text...",
    "Page 2 text..."
  ],
  "warnings": [
    { "page": 3, "message": "Command token too long: 128" }
  ],
  "text": "Full document text (optional)",
  "metadata": {...},
  "info": {...}
}
```

## 🧩 Tips

Use this node in combination with:

- The `Set` node to isolate values
- The `If` node for conditionals based on page content
- The `HTTP Request` node to send data to another API

---

For issues or feedback, please open an issue on GitHub.

## Security

PDF data is passed to PDF.js as an in-memory byte array; this node does not accept a URL for the
parser to fetch. JavaScript evaluation, XFA, worker fetching, WASM, image decoding, offscreen
canvas, and font rendering are disabled because they are unnecessary for text extraction. File,
page, extracted-text, image, and execution-time limits reduce the impact of malformed or hostile
documents.

PDF.js publishes an optional native canvas package for rendering support. This node neither calls
the rendering APIs nor requires canvas for text extraction. PDF.js and the node itself do not run
install scripts. Report suspected vulnerabilities through a private GitHub security advisory when
that option is available, or open an issue without including sensitive exploit details.

## Development

This package is developed and tested against current n8n 2.x releases. Development requires
Node.js 22.22 or newer and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

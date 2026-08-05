# Changelog

## 1.0.1

- Publish the maintained `Free PDF to Text` fork from its canonical GitHub repository.
- Add a tag-gated npm Trusted Publishing workflow with provenance and release validation.
- Update vulnerable transitive `brace-expansion` versions to `1.1.18` and `2.1.4`.
- Expand upstream credits for Oscar Weijman and the original PDF Page Extract project.

## 1.0.0

- Launch as `n8n-nodes-free-pdf-to-text`, focused on free and local PDF text extraction without an external API.
- Register the node as `freePdfToText` and display it as **Free PDF to Text** in n8n.
- Document supported PDFs, privacy benefits, limits, failure handling, and the absence of built-in OCR.

## 0.2.1

- Register the node as `pdfPageExtractPlus` to prevent an `installed_nodes.name` collision with the original package.
- Show the node as **PDF Page Extract Plus** in n8n so both variants are distinguishable.

## 0.2.0

- Publish the maintained fork as `n8n-nodes-pdf-page-extract-plus`.

- Replace the legacy `pdf-parse` 1.x / PDF.js 1.10.100 parser with direct PDF.js 6.2.108 integration.
- Preserve page-by-page output while adding configurable file, page, text, and timeout limits.
- Continue past an unreadable page in the default mode and report it in `warnings`; strict mode still fails fast.
- Disable PDF JavaScript evaluation, XFA, worker fetching, WASM, and image decoding for text-only extraction.
- Cancel the underlying PDF.js loading task on timeout and bound parser cleanup separately.
- Validate the PDF signature and always release parser resources.
- Preserve n8n item linking on success and `Continue On Fail` output.
- Add automated parser, limit, cleanup, and timeout tests.
- Replace the unpinned install-time `npx` hook and legacy build dependencies with the maintained n8n node CLI.
- Document the current n8n verification limitation for local PDF parsing.

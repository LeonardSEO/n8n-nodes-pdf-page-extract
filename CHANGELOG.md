# Changelog

## 1.1.1

- Document that n8n 3 requires `N8N_UNVERIFIED_PACKAGES_ENABLED=true`.
- Test in n8n 3 and through n8n's own package installation in CI, also on a weekly schedule.

## 1.1.0

### Added

- **Node version 2** with line-aware text: line breaks and wide table columns are preserved. Existing version 1 nodes keep their space-separated text.
- **Password** option for protected PDFs, with clear errors for a missing or incorrect password.
- **Page Range** option, such as `1-3, 5, 8-`, and a `pageNumbers` output field.
- **Output Mode** option to return one item per page.
- `needsOcr`, `pagesWithoutText`, and `characterCount` output fields to detect scans without a text layer.
- **Keep Input Binary** and **Maximum Memory** options.
- Category and documentation link in the n8n node picker.
- Test that runs the packed package in a real n8n container.
- Monthly GitHub Actions workflow that updates key dependencies and releases new `pdfjs-dist` versions after verification.
- GitHub releases for every published version.

### Fixed

- Parsing now runs in a worker thread. Previously a large PDF could block the n8n event loop, which also kept **Timeout** from firing.
- **Timeout** is now enforced at any moment, and stopping an execution stops the parser.
- Fragments of one word are no longer separated by a space in version 2.

### Changed

- Update `pdfjs-dist` to 6.5.438, `@n8n/node-cli` to 0.55.4, and `prettier` to 3.9.10.
- Only advisories in dependencies that ship to users now block a release. Development tooling advisories are still reported.
- Publishing runs in separate jobs, so tests and dependency code never hold npm publish or repository write rights.
- Rewrite the README.

### Removed

- Unused legacy files: `gulpfile.js`, old ESLint configuration, `index.ts`, `index.js`, `.npmignore`, `package-lock.json`, and an outdated screenshot.

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

# Changelog

## 0.2.0

- Replace the legacy `pdf-parse` 1.x / PDF.js 1.10.100 parser with direct PDF.js 6.2.108 integration.
- Preserve page-by-page output while adding configurable file, page, text, and timeout limits.
- Continue past an unreadable page in the default mode and report it in `warnings`; strict mode still fails fast.
- Disable PDF JavaScript evaluation, XFA, worker fetching, WASM, and image decoding for text-only extraction.
- Cancel the underlying PDF.js loading task on timeout and bound parser cleanup separately.
- Validate the PDF signature and always release parser resources.
- Preserve n8n item linking on success and `Continue On Fail` output.
- Add automated parser, limit, cleanup, and timeout tests.
- Replace the unpinned install-time `npx` hook and legacy build dependencies with the maintained n8n node CLI.

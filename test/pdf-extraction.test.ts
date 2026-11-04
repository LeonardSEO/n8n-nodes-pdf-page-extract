import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_LIMITS,
	createPdfJsParser,
	extractPdf,
	parsePageRange,
	type PdfJsModule,
	type PdfLoadingTask,
	type PdfParser,
	type PdfParserFactory,
	withTimeout,
} from '../nodes/FreePdfToText/pdf-extraction';
import { createEncryptedPdf, createPdf, createPdfFromStreams } from './helpers/pdf-fixtures';

function createMockParser(overrides: Partial<PdfParser> = {}): PdfParser {
	return {
		getInfo: vi.fn(async () => ({ total: 1 })),
		getPageText: vi.fn(async () => 'Page text'),
		destroy: vi.fn(async () => undefined),
		...overrides,
	};
}

const minimalPdf = Buffer.from('%PDF-1.4\n%%EOF', 'ascii');

describe('extractPdf', () => {
	it('extracts text in page order with the current parser', async () => {
		const result = await extractPdf(createPdf(['First page', 'Second page']), DEFAULT_LIMITS);

		expect(result.totalPages).toBe(2);
		expect(result.pages).toEqual(['First page', 'Second page']);
		expect(result.text).toBe('First page\n\nSecond page');
	});

	it('preserves the original space-separated text-item contract', async () => {
		const pdf = createPdfFromStreams([
			'BT /F1 12 Tf 72 720 Td (First) Tj 35 0 Td (row) Tj 0 -20 Td (Second line) Tj ET',
		]);

		const result = await extractPdf(pdf, DEFAULT_LIMITS, { textLayout: 'legacy' });

		// The explicit spacer item receives separators on both sides, matching the old item + ' ' loop.
		expect(result.pages).toEqual(['First   row Second line']);
	});

	it('joins known PDF text items exactly like the original item loop', async () => {
		const cleanup = vi.fn();
		const loadingTask: PdfLoadingTask = {
			promise: Promise.resolve({
				numPages: 1,
				getMetadata: vi.fn(async () => ({ info: {} })),
				getPage: vi.fn(async () => ({
					cleanup,
					getTextContent: vi.fn(async () => ({
						items: [{ str: 'First' }, { str: 'row' }, {}, { str: 'Second line' }],
					})),
				})),
			}),
			destroy: vi.fn(async () => undefined),
		};
		const pdfJsModule: PdfJsModule = { getDocument: () => loadingTask };
		const parserFactory: PdfParserFactory = (options) =>
			createPdfJsParser(options, async () => pdfJsModule);

		const result = await extractPdf(minimalPdf, DEFAULT_LIMITS, {
			parserFactory,
			textLayout: 'legacy',
		});

		expect(result.pages).toEqual(['First row Second line']);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('recovers a PDF with a broken cross-reference pointer by default', async () => {
		const validPdf = createPdf(['Recovered page']).toString('ascii');
		const damagedPdf = Buffer.from(validPdf.replace(/startxref\n\d+/, 'startxref\n0'), 'ascii');

		const result = await extractPdf(damagedPdf, DEFAULT_LIMITS);

		expect(result.pages).toEqual(['Recovered page']);
	});

	it('recovers a malformed cross-reference entry by default', async () => {
		const validPdf = createPdf(['Recovered XRef entry']).toString('ascii');
		const damagedPdf = Buffer.from(
			validPdf.replace(/\d{10} 00000 n \n/, 'malformed-xref-entry\n'),
			'ascii',
		);

		const result = await extractPdf(damagedPdf, DEFAULT_LIMITS);

		expect(result.pages).toEqual(['Recovered XRef entry']);
	});

	it('does not fail on an overlong unknown content-stream command', async () => {
		const overlongCommand = 'A'.repeat(256);
		const pdf = createPdfFromStreams([
			`${overlongCommand}\nBT /F1 12 Tf 72 720 Td (Readable after command) Tj ET`,
		]);

		const result = await extractPdf(pdf, DEFAULT_LIMITS);

		expect(result.pages).toEqual(['']);
		expect(result.warnings).toEqual([
			{ page: 1, message: expect.stringContaining('Command token too long') },
		]);
	});

	it('rejects a malformed page when strict parsing is enabled', async () => {
		const overlongCommand = 'A'.repeat(256);
		const pdf = createPdfFromStreams([
			`${overlongCommand}\nBT /F1 12 Tf 72 720 Td (Readable after command) Tj ET`,
		]);

		await expect(extractPdf(pdf, { ...DEFAULT_LIMITS, strictParsing: true })).rejects.toThrow(
			'Command token too long',
		);
	});

	it('rejects input without a PDF signature before constructing a parser', async () => {
		const parserFactory = vi.fn<PdfParserFactory>();

		await expect(
			extractPdf(Buffer.from('not a PDF'), DEFAULT_LIMITS, { parserFactory }),
		).rejects.toThrow('missing %PDF- header');
		expect(parserFactory).not.toHaveBeenCalled();
	});

	it('rejects files over the configured size before constructing a parser', async () => {
		const parserFactory = vi.fn<PdfParserFactory>();
		const oversizedPdf = Buffer.alloc(1_024 * 1_024 + 1);
		oversizedPdf.write('%PDF-');

		await expect(
			extractPdf(oversizedPdf, { ...DEFAULT_LIMITS, maxFileSizeMb: 1 }, { parserFactory }),
		).rejects.toThrow('exceeding the configured limit of 1 MB');
		expect(parserFactory).not.toHaveBeenCalled();
	});

	it('stops before page extraction when the page limit is exceeded and cleans up', async () => {
		const parser = createMockParser({ getInfo: vi.fn(async () => ({ total: 2 })) });

		await expect(
			extractPdf(minimalPdf, { ...DEFAULT_LIMITS, maxPages: 1 }, { parserFactory: () => parser }),
		).rejects.toThrow('exceeding the configured limit of 1');
		expect(parser.getPageText).not.toHaveBeenCalled();
		expect(parser.destroy).toHaveBeenCalledOnce();
	});

	it('stops when extracted text exceeds the character limit and cleans up', async () => {
		const parser = createMockParser({
			getPageText: vi.fn(async () => 'too much text'),
		});

		await expect(
			extractPdf(
				minimalPdf,
				{ ...DEFAULT_LIMITS, maxExtractedCharacters: 5 },
				{
					parserFactory: () => parser,
				},
			),
		).rejects.toThrow('configured limit of 5 characters');
		expect(parser.destroy).toHaveBeenCalledOnce();
	});

	it('cancels the underlying PDF.js loading task at the deadline', async () => {
		const destroyLoadingTask = vi.fn(async () => undefined);
		const loadingTask: PdfLoadingTask = {
			promise: new Promise<never>(() => undefined),
			destroy: destroyLoadingTask,
		};
		const pdfJsModule: PdfJsModule = { getDocument: () => loadingTask };
		const parserFactory: PdfParserFactory = (options) =>
			createPdfJsParser(options, async () => pdfJsModule);

		await expect(
			extractPdf(minimalPdf, { ...DEFAULT_LIMITS, timeoutSeconds: 0.005 }, { parserFactory }),
		).rejects.toThrow('exceeded the 0.005 second timeout');
		expect(destroyLoadingTask).toHaveBeenCalledOnce();
	});

	it('reports cancellation when a loading task resolves after parser cleanup', async () => {
		let resolveDocument: ((document: Awaited<PdfLoadingTask['promise']>) => void) | undefined;
		const loadingTask: PdfLoadingTask = {
			promise: new Promise((resolve) => {
				resolveDocument = resolve;
			}),
			destroy: vi.fn(async () => undefined),
		};
		const pdfJsModule: PdfJsModule = { getDocument: () => loadingTask };
		const parser = createPdfJsParser(
			{
				data: new Uint8Array(minimalPdf),
				disableFontFace: true,
				enableXfa: false,
				isEvalSupported: false,
				isImageDecoderSupported: false,
				isOffscreenCanvasSupported: false,
				maxImageSize: 4_000_000,
				stopAtErrors: false,
				useWasm: false,
				useWorkerFetch: false,
				verbosity: 0,
			},
			async () => pdfJsModule,
		);
		const infoPromise = parser.getInfo(false);
		await vi.waitFor(() => expect(resolveDocument).toBeTypeOf('function'));

		await parser.destroy();
		resolveDocument?.({
			numPages: 1,
			getMetadata: vi.fn(async () => ({ info: {} })),
			getPage: vi.fn(),
		});

		await expect(infoPromise).rejects.toThrow('PDF processing was cancelled');
		expect(loadingTask.destroy).toHaveBeenCalledOnce();
	});

	it('skips metadata loading when metadata output is disabled', async () => {
		const parser = createMockParser();

		await extractPdf(minimalPdf, DEFAULT_LIMITS, {
			includeMetadata: false,
			parserFactory: () => parser,
		});

		expect(parser.getInfo).toHaveBeenCalledWith(false);
	});

	it('converts the iterable PDF.js metadata object to plain output data', async () => {
		const loadingTask: PdfLoadingTask = {
			promise: Promise.resolve({
				numPages: 1,
				getMetadata: vi.fn(async () => ({
					info: { Title: 'Example PDF' },
					metadata: new Map([['dc:title', 'Example PDF']]),
				})),
				getPage: vi.fn(async () => ({
					cleanup: vi.fn(),
					getTextContent: vi.fn(async () => ({ items: [] })),
				})),
			}),
			destroy: vi.fn(async () => undefined),
		};
		const pdfJsModule: PdfJsModule = { getDocument: () => loadingTask };
		const parserFactory: PdfParserFactory = (options) =>
			createPdfJsParser(options, async () => pdfJsModule);

		const result = await extractPdf(minimalPdf, DEFAULT_LIMITS, { parserFactory });

		expect(result.info).toEqual({ Title: 'Example PDF' });
		expect(result.metadata).toEqual({ 'dc:title': 'Example PDF' });
	});

	it('disables risky parser capabilities', async () => {
		const parser = createMockParser();
		const parserFactory = vi.fn<PdfParserFactory>(() => parser);

		await extractPdf(minimalPdf, DEFAULT_LIMITS, { parserFactory });

		expect(parserFactory).toHaveBeenCalledWith(
			expect.objectContaining({
				disableFontFace: true,
				enableXfa: false,
				isEvalSupported: false,
				stopAtErrors: false,
				useWasm: false,
				useWorkerFetch: false,
				verbosity: 0,
			}),
		);
	});
});

describe('text layout', () => {
	it('keeps separate lines on separate lines', async () => {
		const pdf = createPdfFromStreams([
			'BT /F1 12 Tf 72 720 Td (Line one) Tj 0 -16 Td (Line two) Tj 0 -16 Td (Line three) Tj ET',
		]);

		const result = await extractPdf(pdf, DEFAULT_LIMITS);

		expect(result.pages).toEqual(['Line one\nLine two\nLine three']);
	});

	it('separates widely spaced table columns with a tab', async () => {
		const pdf = createPdfFromStreams([
			'BT /F1 12 Tf 72 720 Td (Totaal) Tj 300 0 Td (100,00) Tj -300 -16 Td (BTW) Tj 300 0 Td (21,00) Tj ET',
		]);

		const result = await extractPdf(pdf, DEFAULT_LIMITS);

		expect(result.pages).toEqual(['Totaal\t100,00\nBTW\t21,00']);
	});

	it('does not add a space between fragments of one word', async () => {
		const loadingTask: PdfLoadingTask = {
			promise: Promise.resolve({
				numPages: 1,
				getMetadata: vi.fn(async () => ({ info: {} })),
				getPage: vi.fn(async () => ({
					cleanup: vi.fn(),
					getTextContent: vi.fn(async () => ({
						items: [
							{ str: 'Fact', width: 20, height: 12 },
							{ str: 'uur', width: 15, height: 12 },
						],
					})),
				})),
			}),
			destroy: vi.fn(async () => undefined),
		};
		const parserFactory: PdfParserFactory = (options) =>
			createPdfJsParser(options, async () => ({ getDocument: () => loadingTask }));

		const result = await extractPdf(minimalPdf, DEFAULT_LIMITS, { parserFactory });

		expect(result.pages).toEqual(['Factuur']);
	});
});

describe('pages without text', () => {
	it('flags a document with no text on any page as needing OCR', async () => {
		const result = await extractPdf(createPdfFromStreams(['q Q', 'q Q']), DEFAULT_LIMITS);

		expect(result.needsOcr).toBe(true);
		expect(result.pagesWithoutText).toEqual([1, 2]);
		expect(result.characterCount).toBe(0);
	});

	it('lists a blank page without flagging the document as needing OCR', async () => {
		const result = await extractPdf(
			createPdfFromStreams(['BT /F1 12 Tf 72 720 Td (Text) Tj ET', 'q Q']),
			DEFAULT_LIMITS,
		);

		expect(result.needsOcr).toBe(false);
		expect(result.pagesWithoutText).toEqual([2]);
		expect(result.characterCount).toBe(4);
	});

	it('does not report an unreadable page as a page without text', async () => {
		const parser = createMockParser({
			getPageText: vi.fn(async () => {
				throw new Error('broken page');
			}),
		});

		const result = await extractPdf(minimalPdf, DEFAULT_LIMITS, { parserFactory: () => parser });

		expect(result.pagesWithoutText).toEqual([]);
		expect(result.needsOcr).toBe(false);
	});
});

describe('page selection', () => {
	it('extracts only the selected pages and reports their numbers', async () => {
		const result = await extractPdf(createPdf(['One', 'Two', 'Three', 'Four']), DEFAULT_LIMITS, {
			pageRange: '2, 4',
		});

		expect(result.totalPages).toBe(4);
		expect(result.pages).toEqual(['Two', 'Four']);
		expect(result.pageNumbers).toEqual([2, 4]);
	});

	it('applies the page limit to the selection instead of the whole document', async () => {
		const result = await extractPdf(
			createPdf(['One', 'Two', 'Three']),
			{ ...DEFAULT_LIMITS, maxPages: 1 },
			{ pageRange: '2' },
		);

		expect(result.pages).toEqual(['Two']);
	});

	it.each([
		['', 5, [1, 2, 3, 4, 5]],
		['  ', 2, [1, 2]],
		['3', 5, [3]],
		['1-3', 5, [1, 2, 3]],
		['4-', 5, [4, 5]],
		['5, 1-2, 2', 5, [1, 2, 5]],
		['2-99999999', 3, [2, 3]],
	])('parses %j on a %i page document', (range, total, expected) => {
		expect(parsePageRange(range, total)).toEqual(expected);
	});

	it.each(['abc', '0', '3-1', '1-2-3', '1,,2', '-2'])('rejects the invalid range %j', (range) => {
		expect(() => parsePageRange(range, 5)).toThrow('Invalid page range');
	});

	it('rejects a range that selects no existing page', () => {
		expect(() => parsePageRange('9-12', 5)).toThrow('selects no pages');
	});
});

describe('password protected PDFs', () => {
	const encrypted = createEncryptedPdf('Secret text', 'open-sesame');

	it('explains that a password is required', async () => {
		await expect(extractPdf(encrypted, DEFAULT_LIMITS)).rejects.toThrow(
			'This PDF is password protected',
		);
	});

	it('reports an incorrect password without repeating it', async () => {
		const attempt = extractPdf(encrypted, DEFAULT_LIMITS, { password: 'wrong-guess' });

		await expect(attempt).rejects.toThrow('The PDF password is incorrect');
		await expect(attempt).rejects.not.toThrow('wrong-guess');
	});

	it('opens the PDF with the correct password', async () => {
		const result = await extractPdf(encrypted, DEFAULT_LIMITS, { password: 'open-sesame' });

		expect(result.pages).toEqual(['Secret text']);
	});
});

describe('withTimeout', () => {
	it('rejects operations that run beyond the deadline', async () => {
		await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toThrow(
			'exceeded the 0.005 second timeout',
		);
	});
});

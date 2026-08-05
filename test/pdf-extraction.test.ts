import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_LIMITS,
	createPdfJsParser,
	extractPdf,
	type PdfJsModule,
	type PdfLoadingTask,
	type PdfParser,
	type PdfParserFactory,
	withTimeout,
} from '../nodes/FreePdfToText/pdf-extraction';

function createPdfFromStreams(streams: string[]): Buffer {
	const objects: string[] = [];
	const pageObjectNumbers = streams.map((_stream, index) => 3 + index * 2);
	const contentObjectNumbers = streams.map((_stream, index) => 4 + index * 2);
	const fontObjectNumber = 3 + streams.length * 2;

	objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
	objects[2] =
		`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] ` +
		`/Count ${streams.length} >>`;

	streams.forEach((stream, index) => {
		const pageObjectNumber = pageObjectNumbers[index];
		const contentObjectNumber = contentObjectNumbers[index];

		objects[pageObjectNumber] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
			`/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> ` +
			`/Contents ${contentObjectNumber} 0 R >>`;
		objects[contentObjectNumber] =
			`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
	});

	objects[fontObjectNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [0];
	for (let objectNumber = 1; objectNumber < objects.length; objectNumber++) {
		offsets[objectNumber] = Buffer.byteLength(pdf);
		pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
	}

	const xrefOffset = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${objects.length}\n`;
	pdf += '0000000000 65535 f \n';
	for (let objectNumber = 1; objectNumber < objects.length; objectNumber++) {
		pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

	return Buffer.from(pdf, 'ascii');
}

function createPdf(pageTexts: string[]): Buffer {
	return createPdfFromStreams(pageTexts.map((text) => `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`));
}

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

		const result = await extractPdf(pdf, DEFAULT_LIMITS);

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

		const result = await extractPdf(minimalPdf, DEFAULT_LIMITS, { parserFactory });

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

describe('withTimeout', () => {
	it('rejects operations that run beyond the deadline', async () => {
		await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toThrow(
			'exceeded the 0.005 second timeout',
		);
	});
});

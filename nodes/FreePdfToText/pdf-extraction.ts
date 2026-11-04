export const DEFAULT_LIMITS: PdfExtractionLimits = {
	maxFileSizeMb: 50,
	maxPages: 500,
	maxExtractedCharacters: 5_000_000,
	timeoutSeconds: 120,
	strictParsing: false,
};

const HARD_LIMITS = {
	maxFileSizeMb: 100,
	maxPages: 2_000,
	maxExtractedCharacters: 10_000_000,
	timeoutSeconds: 300,
} as const;

export interface PdfExtractionLimits {
	maxFileSizeMb: number;
	maxPages: number;
	maxExtractedCharacters: number;
	timeoutSeconds: number;
	strictParsing: boolean;
}

export type PdfTextLayout = 'lines' | 'legacy';

export interface PdfExtractionResult {
	/** Number of pages in the whole document, also when a page range is used. */
	totalPages: number;
	pages: string[];
	/** PDF page number of each entry in `pages`. */
	pageNumbers: number[];
	text: string;
	characterCount: number;
	/** Selected pages that were read successfully but contain no text. */
	pagesWithoutText: number[];
	/** True when no selected page contains text, as with a scan without a text layer. */
	needsOcr: boolean;
	warnings?: PdfPageWarning[];
	metadata?: object;
	info?: object;
}

export interface PdfPageWarning {
	page: number;
	message: string;
}

export interface PdfExtractionOptions {
	includeMetadata?: boolean;
	pageRange?: string;
	parserFactory?: PdfParserFactory;
	password?: string;
	textLayout?: PdfTextLayout;
}

interface PdfInfoResult {
	total: number;
	info?: unknown;
	metadata?: unknown;
}

export interface PdfLoadOptions {
	data: Uint8Array;
	disableFontFace: boolean;
	enableXfa: boolean;
	isEvalSupported: boolean;
	isImageDecoderSupported: boolean;
	isOffscreenCanvasSupported: boolean;
	maxImageSize: number;
	password?: string;
	stopAtErrors: boolean;
	useWasm: boolean;
	useWorkerFetch: boolean;
	verbosity: number;
}

interface PdfTextContent {
	items: unknown[];
}

interface PdfPage {
	cleanup(): void;
	getTextContent(options: { disableNormalization: boolean }): Promise<PdfTextContent>;
}

interface PdfDocument {
	numPages: number;
	getMetadata(): Promise<{
		info: unknown;
		metadata?: Iterable<readonly [PropertyKey, unknown]>;
	}>;
	getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfLoadingTask {
	promise: Promise<PdfDocument>;
	destroy(): Promise<void>;
}

export interface PdfJsModule {
	getDocument(options: PdfLoadOptions): PdfLoadingTask;
}

export interface PdfParser {
	getInfo(includeMetadata: boolean): Promise<PdfInfoResult>;
	getPageText(pageNumber: number, layout: PdfTextLayout): Promise<string>;
	destroy(): Promise<void>;
}

export type PdfParserFactory = (options: PdfLoadOptions) => PdfParser;
export type PdfJsModuleLoader = () => Promise<PdfJsModule>;

let pdfJsModulePromise: Promise<PdfJsModule> | undefined;

const loadPdfJsModule: PdfJsModuleLoader = async () => {
	pdfJsModulePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
	return pdfJsModulePromise;
};

interface PdfTextItem {
	str: string;
	hasEOL?: boolean;
	height?: number;
	width?: number;
}

function isTextItem(value: unknown): value is PdfTextItem {
	return (
		typeof value === 'object' && value !== null && 'str' in value && typeof value.str === 'string'
	);
}

/** A gap wider than this many font heights separates columns rather than words. */
const COLUMN_GAP_FONT_HEIGHTS = 2;

function layoutLines(items: PdfTextItem[]): string {
	let text = '';
	let fontHeight = 0;

	for (const item of items) {
		const isSpacer = item.str.trim() === '';
		if (!isSpacer && item.height) fontHeight = item.height;

		const isColumnGap =
			isSpacer && fontHeight > 0 && (item.width ?? 0) > fontHeight * COLUMN_GAP_FONT_HEIGHTS;
		text += isColumnGap ? '\t' : item.str;
		if (item.hasEOL) text += '\n';
	}

	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function layoutLegacy(items: PdfTextItem[]): string {
	return items
		.map((item) => `${item.str} `)
		.join('')
		.trim();
}

class PdfJsParser implements PdfParser {
	private cancelled = false;
	private document: PdfDocument | undefined;
	private loadingTask: PdfLoadingTask | undefined;

	constructor(
		private readonly options: PdfLoadOptions,
		private readonly moduleLoader: PdfJsModuleLoader,
	) {}

	private async load(): Promise<PdfDocument> {
		if (this.cancelled) throw new Error('PDF processing was cancelled.');
		if (this.document) return this.document;

		const pdfJs = await this.moduleLoader();
		if (this.cancelled) throw new Error('PDF processing was cancelled.');

		const loadingTask = (this.loadingTask ??= pdfJs.getDocument(this.options));
		const document = await loadingTask.promise;

		if (this.cancelled) {
			throw new Error('PDF processing was cancelled.');
		}

		this.document = document;
		return document;
	}

	async getInfo(includeMetadata: boolean): Promise<PdfInfoResult> {
		const document = await this.load();
		if (!includeMetadata) return { total: document.numPages };

		const { info, metadata } = await document.getMetadata();
		return {
			total: document.numPages,
			info,
			metadata: metadata ? Object.fromEntries(metadata) : undefined,
		};
	}

	async getPageText(pageNumber: number, layout: PdfTextLayout): Promise<string> {
		const document = await this.load();
		const page = await document.getPage(pageNumber);

		try {
			const textContent = await page.getTextContent({ disableNormalization: true });
			const items = textContent.items.filter(isTextItem);
			return layout === 'legacy' ? layoutLegacy(items) : layoutLines(items);
		} finally {
			page.cleanup();
		}
	}

	async destroy(): Promise<void> {
		this.cancelled = true;
		const loadingTask = this.loadingTask;
		this.loadingTask = undefined;
		this.document = undefined;
		if (loadingTask) await loadingTask.destroy();
	}
}

export function createPdfJsParser(
	options: PdfLoadOptions,
	moduleLoader: PdfJsModuleLoader = loadPdfJsModule,
): PdfParser {
	return new PdfJsParser(options, moduleLoader);
}

const createParser: PdfParserFactory = (options) => createPdfJsParser(options);

function assertPositiveNumber(name: string, value: number, hardLimit: number): void {
	if (!Number.isFinite(value) || value <= 0 || value > hardLimit) {
		throw new Error(`${name} must be greater than 0 and no more than ${hardLimit}.`);
	}
}

export function validateLimits(limits: PdfExtractionLimits): void {
	assertPositiveNumber('Maximum file size', limits.maxFileSizeMb, HARD_LIMITS.maxFileSizeMb);
	assertPositiveNumber('Maximum pages', limits.maxPages, HARD_LIMITS.maxPages);
	assertPositiveNumber(
		'Maximum extracted characters',
		limits.maxExtractedCharacters,
		HARD_LIMITS.maxExtractedCharacters,
	);
	assertPositiveNumber('Timeout', limits.timeoutSeconds, HARD_LIMITS.timeoutSeconds);

	if (!Number.isInteger(limits.maxPages) || !Number.isInteger(limits.maxExtractedCharacters)) {
		throw new Error('Maximum pages and maximum extracted characters must be whole numbers.');
	}
}

function hasPdfSignature(data: Uint8Array): boolean {
	const header = Buffer.from(data.buffer, data.byteOffset, Math.min(data.length, 1_024));
	return header.indexOf(Buffer.from('%PDF-', 'ascii')) >= 0;
}

/** Rejects input that can never be parsed, so no parser or worker has to be started for it. */
export function validatePdfInput(data: Uint8Array, limits: PdfExtractionLimits): void {
	validateLimits(limits);

	if (data.length === 0) {
		throw new Error('PDF binary data is empty.');
	}

	const maximumBytes = limits.maxFileSizeMb * 1_024 * 1_024;
	if (data.length > maximumBytes) {
		throw new Error(
			`PDF file is ${Math.ceil(data.length / 1_024 / 1_024)} MB, exceeding the configured limit of ${limits.maxFileSizeMb} MB.`,
		);
	}

	if (!hasPdfSignature(data)) {
		throw new Error('The binary input is not a valid PDF file (missing %PDF- header).');
	}
}

/**
 * Converts a range such as `1-3, 5, 8-` to sorted page numbers within the document.
 * An empty range selects every page.
 */
export function parsePageRange(range: string, totalPages: number): number[] {
	if (range.trim() === '') {
		return Array.from({ length: totalPages }, (_value, index) => index + 1);
	}

	const selected = new Set<number>();
	for (const part of range.split(',')) {
		const match = /^\s*(\d+)\s*(?:(-)\s*(\d+)?)?\s*$/.exec(part);
		const start = match ? Number(match[1]) : 0;
		const end = match?.[3] ? Number(match[3]) : match?.[2] ? totalPages : start;

		// An open range starting past the last page selects nothing, it is not reversed.
		const isOpenRange = Boolean(match?.[2]) && !match?.[3];
		if (start < 1 || (!isOpenRange && end < start)) {
			throw new Error(`Invalid page range "${range}". Use a format such as 1-3, 5, 8-.`);
		}

		for (let page = start; page <= Math.min(end, totalPages); page++) selected.add(page);
	}

	if (selected.size === 0) {
		throw new Error(`Page range "${range}" selects no pages. The PDF has ${totalPages} pages.`);
	}

	return [...selected].sort((a, b) => a - b);
}

function toObject(value: unknown): object | undefined {
	return typeof value === 'object' && value !== null ? value : undefined;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error('PDF processing failed with an unknown error.');
}

function throwPdfError(error: unknown): never {
	throw toError(error);
}

const PDF_JS_INCORRECT_PASSWORD_CODE = 2;

function toFriendlyError(error: unknown): Error {
	const pdfError = toError(error);
	if (pdfError.name !== 'PasswordException') return pdfError;

	const isIncorrect =
		(pdfError as Error & { code?: number }).code === PDF_JS_INCORRECT_PASSWORD_CODE;
	return new Error(
		isIncorrect
			? 'The PDF password is incorrect.'
			: 'This PDF is password protected. Set the password under Options > Password.',
		{ cause: pdfError },
	);
}

export async function withTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number,
	operationName = 'PDF-to-text processing',
): Promise<T> {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const timeoutMessage = `${operationName} exceeded the ${timeoutMs / 1_000} second timeout.`;
	let rejectTimeout: (() => void) | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		rejectTimeout = () => reject(new Error(timeoutMessage));
		timeoutSignal.addEventListener('abort', rejectTimeout, { once: true });
	});

	try {
		return await Promise.race([operation, timeout]);
	} finally {
		if (rejectTimeout) timeoutSignal.removeEventListener('abort', rejectTimeout);
	}
}

async function extractWithParser(
	parser: PdfParser,
	limits: PdfExtractionLimits,
	includeMetadata: boolean,
	pageRange: string,
	layout: PdfTextLayout,
): Promise<PdfExtractionResult> {
	const documentInfo = await parser.getInfo(includeMetadata);

	if (!Number.isInteger(documentInfo.total) || documentInfo.total <= 0) {
		throw new Error('The PDF does not contain any readable pages.');
	}

	const pageNumbers = parsePageRange(pageRange, documentInfo.total);

	if (pageNumbers.length > limits.maxPages) {
		throw new Error(
			`PDF contains ${pageNumbers.length} pages, exceeding the configured limit of ${limits.maxPages}.`,
		);
	}

	const pages: string[] = [];
	const warnings: PdfPageWarning[] = [];
	const pagesWithoutText: number[] = [];
	let characterCount = 0;

	for (const pageNumber of pageNumbers) {
		let pageText = '';
		let readable = true;
		try {
			pageText = await parser.getPageText(pageNumber, layout);
		} catch (error) {
			if (limits.strictParsing) throwPdfError(error);
			readable = false;
			warnings.push({ page: pageNumber, message: toError(error).message });
		}
		if (readable && pageText.trim() === '') pagesWithoutText.push(pageNumber);
		characterCount += pageText.length;

		if (characterCount > limits.maxExtractedCharacters) {
			throw new Error(
				`Extracted PDF text exceeds the configured limit of ${limits.maxExtractedCharacters} characters.`,
			);
		}

		pages.push(pageText);
	}

	return {
		totalPages: documentInfo.total,
		pages,
		pageNumbers,
		text: pages.join('\n\n'),
		characterCount,
		pagesWithoutText,
		needsOcr: pagesWithoutText.length === pageNumbers.length,
		warnings: warnings.length > 0 ? warnings : undefined,
		metadata: toObject(documentInfo.metadata),
		info: toObject(documentInfo.info),
	};
}

export async function extractPdf(
	input: Uint8Array,
	limits: PdfExtractionLimits,
	options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
	validatePdfInput(input, limits);

	const parser = (options.parserFactory ?? createParser)({
		// PDF.js takes ownership of its input, so a shared Buffer is copied. The worker passes its own.
		data: Buffer.isBuffer(input) ? new Uint8Array(input) : input,
		disableFontFace: true,
		enableXfa: false,
		isEvalSupported: false,
		isImageDecoderSupported: false,
		isOffscreenCanvasSupported: false,
		maxImageSize: 4_000_000,
		...(options.password ? { password: options.password } : {}),
		stopAtErrors: limits.strictParsing,
		useWasm: false,
		useWorkerFetch: false,
		verbosity: 0,
	});

	let result: PdfExtractionResult | undefined;
	let extractionError: Error | undefined;
	let cleanupError: Error | undefined;

	try {
		result = await withTimeout(
			extractWithParser(
				parser,
				limits,
				options.includeMetadata ?? true,
				options.pageRange ?? '',
				options.textLayout ?? 'lines',
			),
			limits.timeoutSeconds * 1_000,
		);
	} catch (error) {
		extractionError = toFriendlyError(error);
	}

	try {
		await withTimeout(parser.destroy(), 5_000, 'PDF parser cleanup');
	} catch (error) {
		cleanupError = toError(error);
	}

	if (cleanupError) {
		if (extractionError) {
			throw new Error(
				`${extractionError.message} PDF parser cleanup also failed: ${cleanupError.message}`,
				{ cause: extractionError },
			);
		}
		throw cleanupError;
	}

	if (extractionError) throw extractionError;
	if (!result) throw new Error('PDF processing finished without a result.');

	return result;
}

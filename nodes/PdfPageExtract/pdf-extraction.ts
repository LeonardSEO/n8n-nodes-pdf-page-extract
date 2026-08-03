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

export interface PdfExtractionResult {
	totalPages: number;
	pages: string[];
	text: string;
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
	parserFactory?: PdfParserFactory;
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
	getPageText(pageNumber: number): Promise<string>;
	destroy(): Promise<void>;
}

export type PdfParserFactory = (options: PdfLoadOptions) => PdfParser;
export type PdfJsModuleLoader = () => Promise<PdfJsModule>;

let pdfJsModulePromise: Promise<PdfJsModule> | undefined;

const loadPdfJsModule: PdfJsModuleLoader = async () => {
	pdfJsModulePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
	return pdfJsModulePromise;
};

function isTextItem(value: unknown): value is { str: string } {
	return (
		typeof value === 'object' && value !== null && 'str' in value && typeof value.str === 'string'
	);
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

	async getPageText(pageNumber: number): Promise<string> {
		const document = await this.load();
		const page = await document.getPage(pageNumber);

		try {
			const textContent = await page.getTextContent({ disableNormalization: true });
			let text = '';
			for (const item of textContent.items) {
				if (isTextItem(item)) text += `${item.str} `;
			}
			return text.trim();
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

function validateLimits(limits: PdfExtractionLimits): void {
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

function hasPdfSignature(buffer: Buffer): boolean {
	const header = buffer.subarray(0, Math.min(buffer.length, 1_024));
	return header.indexOf(Buffer.from('%PDF-', 'ascii')) >= 0;
}

function toObject(value: unknown): object | undefined {
	return typeof value === 'object' && value !== null ? value : undefined;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error('PDF processing failed with an unknown error.');
}

export async function withTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number,
	operationName = 'PDF processing',
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`${operationName} exceeded the ${timeoutMs / 1_000} second timeout.`));
		}, timeoutMs);
	});

	try {
		return await Promise.race([operation, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function extractWithParser(
	parser: PdfParser,
	limits: PdfExtractionLimits,
	includeMetadata: boolean,
): Promise<PdfExtractionResult> {
	const documentInfo = await parser.getInfo(includeMetadata);

	if (!Number.isInteger(documentInfo.total) || documentInfo.total <= 0) {
		throw new Error('The PDF does not contain any readable pages.');
	}

	if (documentInfo.total > limits.maxPages) {
		throw new Error(
			`PDF contains ${documentInfo.total} pages, exceeding the configured limit of ${limits.maxPages}.`,
		);
	}

	const pages: string[] = [];
	const warnings: PdfPageWarning[] = [];
	let characterCount = 0;

	for (let pageNumber = 1; pageNumber <= documentInfo.total; pageNumber++) {
		let pageText = '';
		try {
			pageText = await parser.getPageText(pageNumber);
		} catch (error) {
			if (limits.strictParsing) throw error;
			warnings.push({ page: pageNumber, message: toError(error).message });
		}
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
		text: pages.join('\n\n'),
		warnings: warnings.length > 0 ? warnings : undefined,
		metadata: toObject(documentInfo.metadata),
		info: toObject(documentInfo.info),
	};
}

export async function extractPdf(
	buffer: Buffer,
	limits: PdfExtractionLimits,
	options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
	validateLimits(limits);

	if (buffer.length === 0) {
		throw new Error('PDF binary data is empty.');
	}

	const maximumBytes = limits.maxFileSizeMb * 1_024 * 1_024;
	if (buffer.length > maximumBytes) {
		throw new Error(
			`PDF file is ${Math.ceil(buffer.length / 1_024 / 1_024)} MB, exceeding the configured limit of ${limits.maxFileSizeMb} MB.`,
		);
	}

	if (!hasPdfSignature(buffer)) {
		throw new Error('The binary input is not a valid PDF file (missing %PDF- header).');
	}

	const parser = (options.parserFactory ?? createParser)({
		data: new Uint8Array(buffer),
		disableFontFace: true,
		enableXfa: false,
		isEvalSupported: false,
		isImageDecoderSupported: false,
		isOffscreenCanvasSupported: false,
		maxImageSize: 4_000_000,
		stopAtErrors: limits.strictParsing,
		useWasm: false,
		useWorkerFetch: false,
		verbosity: 0,
	});

	let result: PdfExtractionResult | undefined;
	let extractionError: Error | undefined;

	try {
		result = await withTimeout(
			extractWithParser(parser, limits, options.includeMetadata ?? true),
			limits.timeoutSeconds * 1_000,
		);
	} catch (error) {
		extractionError = toError(error);
	}

	try {
		await withTimeout(parser.destroy(), 5_000, 'PDF parser cleanup');
	} catch (error) {
		const cleanupError = toError(error);
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

import {
	NodeOperationError,
	type IExecuteFunctions,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type NodeConnectionType,
} from 'n8n-workflow';

import {
	DEFAULT_LIMITS,
	type PdfExtractionLimits,
	type PdfExtractionResult,
} from './pdf-extraction';
import { DEFAULT_MAX_MEMORY_MB, PdfWorkerClient } from './pdf-worker-client';

function getNumberOption(options: IDataObject, name: string, fallback: number): number {
	const value = options[name];
	return typeof value === 'number' ? value : fallback;
}

function getStringOption(options: IDataObject, name: string): string | undefined {
	const value = options[name];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function toDocumentJson(
	filename: string,
	data: PdfExtractionResult,
	includeRawText: boolean,
	includeMetadata: boolean,
): IDataObject {
	const json: IDataObject = {
		filename,
		totalPages: data.totalPages,
		pages: data.pages,
		pageNumbers: data.pageNumbers,
		characterCount: data.characterCount,
		needsOcr: data.needsOcr,
		pagesWithoutText: data.pagesWithoutText,
	};

	if (data.warnings) json.warnings = data.warnings as unknown as IDataObject[];
	if (includeRawText) json.text = data.text;
	if (includeMetadata) {
		json.metadata = (data.metadata ?? null) as IDataObject | null;
		json.info = (data.info ?? null) as IDataObject | null;
	}

	return json;
}

function toPageJson(
	filename: string,
	data: PdfExtractionResult,
	includeMetadata: boolean,
): IDataObject[] {
	return data.pages.map((text, index) => {
		const page = data.pageNumbers[index];
		const warning = data.warnings?.find((entry) => entry.page === page);
		const json: IDataObject = {
			filename,
			page,
			totalPages: data.totalPages,
			text,
			characterCount: text.length,
			hasText: text.trim() !== '',
		};

		if (warning) json.warning = warning.message;
		if (includeMetadata) {
			json.metadata = (data.metadata ?? null) as IDataObject | null;
			json.info = (data.info ?? null) as IDataObject | null;
		}

		return json;
	});
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error('PDF processing failed with an unknown error.');
}

export class FreePdfToText implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Free PDF to Text',
		name: 'freePdfToText',
		icon: { light: 'file:pdf.svg', dark: 'file:pdf.dark.svg' },
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		usableAsTool: true,
		subtitle: 'Extract text',
		description: 'Convert PDF files to text locally without a paid API or external upload',
		defaults: {
			name: 'Free PDF to Text',
		},
		inputs: ['main' as NodeConnectionType],
		outputs: ['main' as NodeConnectionType],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Extract Pages',
						value: 'extractPages',
						description: 'Extract text from PDF as an array of pages',
						action: 'Extract text from PDF as an array of pages',
					},
				],
				default: 'extractPages',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						operation: ['extractPages'],
					},
				},
				description: 'Name of the binary property which contains the PDF data',
			},
			{
				displayName: 'Include Raw Text',
				name: 'includeRawText',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['extractPages'],
					},
				},
				description:
					'Whether to include the complete raw text in addition to the pages array. Has no effect when Output Mode is One Item per Page.',
			},
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['extractPages'],
					},
				},
				description: 'Whether to include PDF metadata in the output',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['extractPages'],
					},
				},
				options: [
					{
						displayName: 'Keep Input Binary',
						name: 'keepBinary',
						type: 'boolean',
						default: true,
						description: 'Whether to pass the PDF on to the next node',
					},
					{
						displayName: 'Maximum Extracted Characters',
						name: 'maxExtractedCharacters',
						type: 'number',
						default: 5_000_000,
						typeOptions: { minValue: 1_000, maxValue: 10_000_000 },
						description: 'Stop when extracted text exceeds this number of characters',
					},
					{
						displayName: 'Maximum File Size (MB)',
						name: 'maxFileSizeMb',
						type: 'number',
						default: 50,
						typeOptions: { minValue: 1, maxValue: 100 },
						description: 'Reject larger PDFs before parsing them',
					},
					{
						displayName: 'Maximum Memory (MB)',
						name: 'maxMemoryMb',
						type: 'number',
						default: DEFAULT_MAX_MEMORY_MB,
						typeOptions: { minValue: 128, maxValue: 8_192 },
						description: 'Stop parsing when it needs more memory than this limit',
					},
					{
						displayName: 'Maximum Pages',
						name: 'maxPages',
						type: 'number',
						default: 500,
						typeOptions: { minValue: 1, maxValue: 2_000 },
						description: 'Reject PDFs when more pages than this limit would be extracted',
					},
					{
						displayName: 'Output Mode',
						name: 'outputMode',
						type: 'options',
						default: 'document',
						options: [
							{
								name: 'One Item per PDF',
								value: 'document',
								description: 'Return one item with all pages in a pages array',
							},
							{
								name: 'One Item per Page',
								value: 'pages',
								description: 'Return a separate item for every page',
							},
						],
						description: 'How to split the output into items',
					},
					{
						displayName: 'Page Range',
						name: 'pageRange',
						type: 'string',
						default: '',
						placeholder: '1-3, 5, 8-',
						description: 'Pages to extract, such as 1-3, 5, 8-. Leave empty for all pages.',
					},
					{
						displayName: 'Password',
						name: 'password',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description: 'Password to open a protected PDF',
					},
					{
						displayName: 'Strict Parsing',
						name: 'strictParsing',
						type: 'boolean',
						default: false,
						description:
							'Whether to stop on recoverable PDF structure errors instead of attempting repair',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeoutSeconds',
						type: 'number',
						default: 120,
						typeOptions: { minValue: 1, maxValue: 300 },
						description: 'Maximum time allowed for one PDF',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		if (items.length === 0) return [returnData];

		const operation = this.getNodeParameter('operation', 0) as string;
		if (operation !== 'extractPages') {
			throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`);
		}

		const typeVersion = this.getNode().typeVersion;
		const client = new PdfWorkerClient();

		try {
			for (let i = 0; i < items.length; i++) {
				try {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const includeRawText = this.getNodeParameter('includeRawText', i) as boolean;
					const includeMetadata = this.getNodeParameter('includeMetadata', i) as boolean;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const binaryData = items[i].binary;

					if (!binaryData) {
						throw new NodeOperationError(this.getNode(), 'No binary data exists on this item.', {
							itemIndex: i,
						});
					}

					const inputBinary = binaryData[binaryPropertyName];
					if (!inputBinary) {
						throw new NodeOperationError(
							this.getNode(),
							`Binary data property "${binaryPropertyName}" does not exist on this item.`,
							{ itemIndex: i },
						);
					}

					const limits: PdfExtractionLimits = {
						maxExtractedCharacters: getNumberOption(
							options,
							'maxExtractedCharacters',
							DEFAULT_LIMITS.maxExtractedCharacters,
						),
						maxFileSizeMb: getNumberOption(options, 'maxFileSizeMb', DEFAULT_LIMITS.maxFileSizeMb),
						maxPages: getNumberOption(options, 'maxPages', DEFAULT_LIMITS.maxPages),
						strictParsing: options.strictParsing === true,
						timeoutSeconds: getNumberOption(
							options,
							'timeoutSeconds',
							DEFAULT_LIMITS.timeoutSeconds,
						),
					};

					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					const data = await client.extract(buffer, limits, {
						includeMetadata,
						maxMemoryMb: getNumberOption(options, 'maxMemoryMb', DEFAULT_MAX_MEMORY_MB),
						pageRange: getStringOption(options, 'pageRange'),
						password: getStringOption(options, 'password'),
						signal: this.getExecutionCancelSignal?.(),
						textLayout: typeVersion >= 2 ? 'lines' : 'legacy',
					});

					const filename = inputBinary.fileName || 'document.pdf';
					const jsonItems =
						options.outputMode === 'pages'
							? toPageJson(filename, data, includeMetadata)
							: [toDocumentJson(filename, data, includeRawText, includeMetadata)];
					const keepBinary = options.keepBinary !== false;

					for (const json of jsonItems) {
						returnData.push({
							json,
							...(keepBinary ? { binary: binaryData } : {}),
							pairedItem: { item: i },
						});
					}
				} catch (error) {
					const nodeError =
						error instanceof NodeOperationError
							? error
							: new NodeOperationError(this.getNode(), toError(error), { itemIndex: i });

					if (this.continueOnFail()) {
						returnData.push({
							json: { error: nodeError.message },
							binary: items[i].binary,
							pairedItem: { item: i },
						});
						continue;
					}

					throw nodeError;
				}
			}
		} finally {
			await client.close();
		}

		return [returnData];
	}
}

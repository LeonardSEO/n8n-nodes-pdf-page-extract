import {
	NodeOperationError,
	type IExecuteFunctions,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type NodeConnectionType,
} from 'n8n-workflow';

import { DEFAULT_LIMITS, extractPdf, type PdfExtractionLimits } from './pdf-extraction';

function getNumberOption(options: IDataObject, name: string, fallback: number): number {
	const value = options[name];
	return typeof value === 'number' ? value : fallback;
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
		version: 1,
		usableAsTool: true,
		subtitle: '={{$parameter["operation"]}}',
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
				description: 'Whether to include the complete raw text in addition to the pages array',
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
						displayName: 'Maximum Pages',
						name: 'maxPages',
						type: 'number',
						default: 500,
						typeOptions: { minValue: 1, maxValue: 2_000 },
						description: 'Reject PDFs with more pages than this limit',
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
					timeoutSeconds: getNumberOption(options, 'timeoutSeconds', DEFAULT_LIMITS.timeoutSeconds),
				};

				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const data = await extractPdf(buffer, limits, { includeMetadata });
				const json: IDataObject = {
					filename: inputBinary.fileName || 'document.pdf',
					totalPages: data.totalPages,
					pages: data.pages,
				};

				if (data.warnings) json.warnings = data.warnings;
				if (includeRawText) json.text = data.text;
				if (includeMetadata) {
					json.metadata = data.metadata ?? null;
					json.info = data.info ?? null;
				}

				returnData.push({
					json,
					binary: binaryData,
					pairedItem: { item: i },
				});
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

		return [returnData];
	}
}

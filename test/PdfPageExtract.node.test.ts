import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractPdf } from '../nodes/FreePdfToText/pdf-extraction';
import { FreePdfToText } from '../nodes/FreePdfToText/FreePdfToText.node';

vi.mock('../nodes/FreePdfToText/pdf-extraction', async (importOriginal) => {
	const original = await importOriginal<typeof import('../nodes/FreePdfToText/pdf-extraction')>();
	return { ...original, extractPdf: vi.fn() };
});

const extractPdfMock = vi.mocked(extractPdf);

function createInput(fileName: string): INodeExecutionData {
	return {
		json: {},
		binary: {
			data: {
				data: 'JVBERi0=',
				fileName,
				mimeType: 'application/pdf',
			},
		},
	};
}

function createContext(items: INodeExecutionData[], continueOnFail: boolean): IExecuteFunctions {
	const context = {
		continueOnFail: vi.fn(() => continueOnFail),
		getInputData: vi.fn(() => items),
		getNode: vi.fn(() => ({
			id: 'pdf-page-extract',
			name: 'Free PDF to Text',
			type: 'freePdfToText',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		})),
		getNodeParameter: vi.fn((name: string, _itemIndex: number, fallback?: unknown) => {
			const values: Record<string, unknown> = {
				binaryPropertyName: 'data',
				includeMetadata: false,
				includeRawText: false,
				operation: 'extractPages',
				options: {},
			};
			return values[name] ?? fallback;
		}),
		helpers: {
			getBinaryDataBuffer: vi.fn(async (itemIndex: number) =>
				Buffer.from(`%PDF-1.4\n${itemIndex}`, 'ascii'),
			),
		},
	};

	return context as unknown as IExecuteFunctions;
}

describe('PdfPageExtract.execute', () => {
	beforeEach(() => {
		extractPdfMock.mockReset();
	});

	it('preserves paired items for successes and Continue On Fail errors', async () => {
		const items = [createInput('one.pdf'), createInput('two.pdf')];
		extractPdfMock
			.mockResolvedValueOnce({
				totalPages: 1,
				pages: ['Page one'],
				text: 'Page one',
				warnings: [{ page: 1, message: 'Recovered malformed content stream' }],
			})
			.mockRejectedValueOnce(new Error('damaged PDF'));

		const result = await new FreePdfToText().execute.call(createContext(items, true));

		expect(result[0][0]).toMatchObject({
			json: {
				filename: 'one.pdf',
				pages: ['Page one'],
				totalPages: 1,
				warnings: [{ page: 1, message: 'Recovered malformed content stream' }],
			},
			pairedItem: { item: 0 },
		});
		expect(result[0][1]).toMatchObject({
			json: { error: expect.stringContaining('damaged PDF') },
			pairedItem: { item: 1 },
		});
		expect(extractPdfMock).toHaveBeenNthCalledWith(1, expect.any(Buffer), expect.any(Object), {
			includeMetadata: false,
		});
	});

	it('throws an item-indexed NodeOperationError when Continue On Fail is disabled', async () => {
		extractPdfMock.mockRejectedValueOnce(new Error('unreadable PDF'));

		await expect(
			new FreePdfToText().execute.call(createContext([createInput('bad.pdf')], false)),
		).rejects.toMatchObject({
			context: { itemIndex: 0 },
			message: expect.stringContaining('unreadable PDF'),
		});
	});
});

describe('FreePdfToText.description', () => {
	it('uses a package-unique node name', () => {
		const description = new FreePdfToText().description;

		expect(description.name).toBe('freePdfToText');
		expect(description.displayName).toBe('Free PDF to Text');
	});
});

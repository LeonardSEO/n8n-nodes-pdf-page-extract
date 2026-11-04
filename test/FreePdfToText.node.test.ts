import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfExtractionResult } from '../nodes/FreePdfToText/pdf-extraction';
import { FreePdfToText } from '../nodes/FreePdfToText/FreePdfToText.node';

const workerMocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined), extract: vi.fn() }));

vi.mock('../nodes/FreePdfToText/pdf-worker-client', () => ({
	DEFAULT_MAX_MEMORY_MB: 1_024,
	PdfWorkerClient: vi.fn(function () {
		return workerMocks;
	}),
}));

const extractMock = workerMocks.extract;

function extraction(overrides: Partial<PdfExtractionResult> = {}): PdfExtractionResult {
	return {
		characterCount: 8,
		needsOcr: false,
		pageNumbers: [1],
		pages: ['Page one'],
		pagesWithoutText: [],
		text: 'Page one',
		totalPages: 1,
		...overrides,
	};
}

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

function createContext(
	items: INodeExecutionData[],
	continueOnFail: boolean,
	{ options = {}, typeVersion = 2 }: { options?: object; typeVersion?: number } = {},
): IExecuteFunctions {
	const context = {
		continueOnFail: vi.fn(() => continueOnFail),
		getInputData: vi.fn(() => items),
		getNode: vi.fn(() => ({
			id: 'free-pdf-to-text',
			name: 'Free PDF to Text',
			type: 'freePdfToText',
			typeVersion,
			position: [0, 0] as [number, number],
			parameters: {},
		})),
		getNodeParameter: vi.fn((name: string, _itemIndex: number, fallback?: unknown) => {
			const values: Record<string, unknown> = {
				binaryPropertyName: 'data',
				includeMetadata: false,
				includeRawText: false,
				operation: 'extractPages',
				options,
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

describe('FreePdfToText.execute', () => {
	beforeEach(() => {
		extractMock.mockReset();
		workerMocks.close.mockClear();
	});

	it('preserves paired items for successes and Continue On Fail errors', async () => {
		const items = [createInput('one.pdf'), createInput('two.pdf')];
		extractMock
			.mockResolvedValueOnce(
				extraction({ warnings: [{ page: 1, message: 'Recovered malformed content stream' }] }),
			)
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
		expect(extractMock).toHaveBeenNthCalledWith(
			1,
			expect.any(Buffer),
			expect.any(Object),
			expect.objectContaining({ includeMetadata: false }),
		);
	});

	it('throws an item-indexed NodeOperationError when Continue On Fail is disabled', async () => {
		extractMock.mockRejectedValueOnce(new Error('unreadable PDF'));

		await expect(
			new FreePdfToText().execute.call(createContext([createInput('bad.pdf')], false)),
		).rejects.toMatchObject({
			context: { itemIndex: 0 },
			message: expect.stringContaining('unreadable PDF'),
		});
	});
});

describe('FreePdfToText options', () => {
	beforeEach(() => {
		extractMock.mockReset();
		workerMocks.close.mockClear();
	});

	it('uses the legacy text layout for existing version 1 nodes', async () => {
		extractMock.mockResolvedValueOnce(extraction());

		await new FreePdfToText().execute.call(
			createContext([createInput('one.pdf')], false, { typeVersion: 1 }),
		);

		expect(extractMock.mock.calls[0][2]).toMatchObject({ textLayout: 'legacy' });
	});

	it('uses the line-aware text layout for version 2 nodes', async () => {
		extractMock.mockResolvedValueOnce(extraction());

		await new FreePdfToText().execute.call(createContext([createInput('one.pdf')], false));

		expect(extractMock.mock.calls[0][2]).toMatchObject({ textLayout: 'lines' });
	});

	it('passes password, page range and memory limit to the worker', async () => {
		extractMock.mockResolvedValueOnce(extraction());

		await new FreePdfToText().execute.call(
			createContext([createInput('one.pdf')], false, {
				options: { maxMemoryMb: 512, pageRange: '1-2', password: 'secret' },
			}),
		);

		expect(extractMock.mock.calls[0][2]).toMatchObject({
			maxMemoryMb: 512,
			pageRange: '1-2',
			password: 'secret',
		});
	});

	it('reports the OCR signal in document output', async () => {
		extractMock.mockResolvedValueOnce(
			extraction({
				characterCount: 0,
				needsOcr: true,
				pages: [''],
				pagesWithoutText: [1],
				text: '',
			}),
		);

		const result = await new FreePdfToText().execute.call(
			createContext([createInput('scan.pdf')], false),
		);

		expect(result[0][0].json).toMatchObject({
			characterCount: 0,
			needsOcr: true,
			pageNumbers: [1],
			pagesWithoutText: [1],
		});
	});

	it('returns one item per page in page output mode', async () => {
		extractMock.mockResolvedValueOnce(
			extraction({
				pageNumbers: [2, 3],
				pages: ['Page two', ''],
				pagesWithoutText: [3],
				totalPages: 5,
				warnings: [{ page: 3, message: 'broken' }],
			}),
		);

		const result = await new FreePdfToText().execute.call(
			createContext([createInput('one.pdf')], false, { options: { outputMode: 'pages' } }),
		);

		expect(result[0]).toHaveLength(2);
		expect(result[0][0]).toMatchObject({
			json: {
				characterCount: 8,
				filename: 'one.pdf',
				hasText: true,
				page: 2,
				text: 'Page two',
				totalPages: 5,
			},
			pairedItem: { item: 0 },
		});
		expect(result[0][1].json).toMatchObject({
			hasText: false,
			page: 3,
			warning: 'broken',
		});
	});

	it('drops the input binary when Keep Binary is disabled', async () => {
		extractMock.mockResolvedValueOnce(extraction());

		const result = await new FreePdfToText().execute.call(
			createContext([createInput('one.pdf')], false, { options: { keepBinary: false } }),
		);

		expect(result[0][0].binary).toBeUndefined();
	});

	it('keeps the input binary by default', async () => {
		extractMock.mockResolvedValueOnce(extraction());

		const result = await new FreePdfToText().execute.call(
			createContext([createInput('one.pdf')], false),
		);

		expect(result[0][0].binary?.data.fileName).toBe('one.pdf');
	});

	it('closes the worker after a failed execution', async () => {
		extractMock.mockRejectedValueOnce(new Error('unreadable PDF'));

		await expect(
			new FreePdfToText().execute.call(createContext([createInput('bad.pdf')], false)),
		).rejects.toThrow('unreadable PDF');

		expect(workerMocks.close).toHaveBeenCalledOnce();
	});
});

describe('FreePdfToText.description', () => {
	it('uses a package-unique node name', () => {
		const description = new FreePdfToText().description;

		expect(description.name).toBe('freePdfToText');
		expect(description.displayName).toBe('Free PDF to Text');
		expect(description.version).toEqual([1, 2]);
		expect(description.defaultVersion).toBe(2);
	});
});

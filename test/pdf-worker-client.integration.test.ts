import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PdfWorkerClient as Client } from '../nodes/FreePdfToText/pdf-worker-client';
import { DEFAULT_LIMITS } from '../nodes/FreePdfToText/pdf-extraction';
import { createEncryptedPdf, createPdf, createPdfFromStreams } from './helpers/pdf-fixtures';

// Runs the compiled output, because a worker thread loads the built JavaScript file.
const require = createRequire(import.meta.url);
const { PdfWorkerClient } = require(
	join(process.cwd(), 'dist/nodes/FreePdfToText/pdf-worker-client.js'),
) as { PdfWorkerClient: typeof Client };

function createHugePagePdf(rows = 400_000): Buffer {
	const stream = Array.from(
		{ length: rows },
		(_value, index) =>
			`BT /F1 8 Tf 20 ${780 - (index % 95) * 8} Td (Row ${index} lorem ipsum dolor sit amet) Tj ET`,
	).join('\n');
	return createPdfFromStreams([stream]);
}

const generousLimits = {
	...DEFAULT_LIMITS,
	maxExtractedCharacters: 10_000_000,
	maxFileSizeMb: 100,
};

describe('PdfWorkerClient', () => {
	let client: Client | undefined;

	afterEach(async () => {
		await client?.close();
		client = undefined;
	});

	it('extracts text in a worker thread', async () => {
		client = new PdfWorkerClient();

		const result = await client.extract(createPdf(['First', 'Second']), DEFAULT_LIMITS, {});

		expect(result.pages).toEqual(['First', 'Second']);
	});

	it('reuses one worker for several PDFs', async () => {
		client = new PdfWorkerClient();

		const first = await client.extract(createPdf(['One']), DEFAULT_LIMITS, {});
		const second = await client.extract(createPdf(['Two']), DEFAULT_LIMITS, {});

		expect([first.pages, second.pages]).toEqual([['One'], ['Two']]);
	});

	it('does not detach the caller buffer', async () => {
		client = new PdfWorkerClient();
		const pdf = createPdf(['Keep me']);

		await client.extract(pdf, DEFAULT_LIMITS, {});

		expect(pdf.length).toBeGreaterThan(0);
		expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	});

	it('returns parser errors with the original message', async () => {
		client = new PdfWorkerClient();

		await expect(
			client.extract(createEncryptedPdf('Secret', 'pw'), DEFAULT_LIMITS, {}),
		).rejects.toThrow('This PDF is password protected');
	});

	it('rejects invalid input without starting a worker', async () => {
		client = new PdfWorkerClient('/does/not/exist.js');

		await expect(client.extract(Buffer.from('nope'), DEFAULT_LIMITS, {})).rejects.toThrow(
			'missing %PDF- header',
		);
	});

	it('enforces the timeout while the parser is busy and keeps the event loop free', async () => {
		client = new PdfWorkerClient();
		const pdf = createHugePagePdf();
		let ticks = 0;
		const timer = setInterval(() => ticks++, 10);
		const startedAt = Date.now();

		await expect(client.extract(pdf, { ...generousLimits, timeoutSeconds: 1 }, {})).rejects.toThrow(
			'exceeded the 1 second timeout',
		);
		clearInterval(timer);

		expect(Date.now() - startedAt).toBeLessThan(2_000);
		expect(ticks).toBeGreaterThan(20);
	}, 30_000);

	it('works again after a timeout', async () => {
		client = new PdfWorkerClient();
		const pdf = createHugePagePdf();

		await expect(
			client.extract(pdf, { ...generousLimits, timeoutSeconds: 0.2 }, {}),
		).rejects.toThrow('timeout');
		const result = await client.extract(createPdf(['Recovered']), DEFAULT_LIMITS, {});

		expect(result.pages).toEqual(['Recovered']);
	}, 30_000);

	it('stops when the worker exceeds the memory limit', async () => {
		client = new PdfWorkerClient();
		const pdf = createHugePagePdf();

		await expect(client.extract(pdf, generousLimits, { maxMemoryMb: 48 })).rejects.toThrow(
			'exceeded the 48 MB memory limit',
		);
		const result = await client.extract(createPdf(['Still works']), DEFAULT_LIMITS, {});

		expect(result.pages).toEqual(['Still works']);
	}, 60_000);

	it('stops when the execution is cancelled', async () => {
		client = new PdfWorkerClient();
		const controller = new AbortController();
		const pdf = createHugePagePdf();
		setTimeout(() => controller.abort(), 50);

		await expect(
			client.extract(pdf, generousLimits, { signal: controller.signal }),
		).rejects.toThrow('PDF processing was cancelled');
	}, 30_000);
});

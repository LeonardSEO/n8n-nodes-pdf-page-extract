import { parentPort } from 'node:worker_threads';

import { extractPdf } from './pdf-extraction';
import type { PdfWorkerRequest, PdfWorkerResponse } from './pdf-worker-client';

if (!parentPort) throw new Error('pdf-worker must run in a worker thread.');
const port = parentPort;

port.on('message', async ({ data, limits, options }: PdfWorkerRequest) => {
	let response: PdfWorkerResponse;
	try {
		response = { ok: true, result: await extractPdf(data, limits, options) };
	} catch (error) {
		response = {
			ok: false,
			message: error instanceof Error ? error.message : 'PDF processing failed.',
		};
	}
	port.postMessage(response);
});

import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
	validatePdfInput,
	type PdfExtractionLimits,
	type PdfExtractionOptions,
	type PdfExtractionResult,
} from './pdf-extraction';

export const DEFAULT_MAX_MEMORY_MB = 1_024;

type WorkerExtractionOptions = Omit<PdfExtractionOptions, 'parserFactory'>;

export interface PdfWorkerRequest {
	data: Uint8Array;
	limits: PdfExtractionLimits;
	options: WorkerExtractionOptions;
}

export type PdfWorkerResponse =
	{ ok: true; result: PdfExtractionResult } | { ok: false; message: string };

export interface PdfWorkerExtractOptions extends WorkerExtractionOptions {
	maxMemoryMb?: number;
	signal?: AbortSignal;
}

/**
 * Parses PDFs in a worker thread. PDF.js does its CPU-heavy work on the thread it runs on, which
 * would otherwise freeze n8n and keep timers from firing. A worker keeps n8n responsive and can be
 * stopped at any moment, which makes the timeout, memory limit and cancellation enforceable.
 *
 * The worker is reused between PDFs and replaced after it has been stopped.
 */
export class PdfWorkerClient {
	private worker: Worker | undefined;
	private workerMemoryMb: number | undefined;

	constructor(private readonly workerPath: string = join(__dirname, 'pdf-worker.js')) {}

	async extract(
		input: Uint8Array,
		limits: PdfExtractionLimits,
		{ maxMemoryMb = DEFAULT_MAX_MEMORY_MB, signal, ...options }: PdfWorkerExtractOptions,
	): Promise<PdfExtractionResult> {
		validatePdfInput(input, limits);
		if (signal?.aborted) throw new Error('PDF processing was cancelled.');

		const worker = await this.getWorker(maxMemoryMb);
		// The copy is transferred, so the caller's buffer stays intact and memory is not held twice.
		const data = new Uint8Array(input);
		const request: PdfWorkerRequest = { data, limits, options };

		return await new Promise<PdfExtractionResult>((resolve, reject) => {
			const stop = (message: string) => {
				cleanup();
				void this.close();
				reject(new Error(message));
			};
			const onMessage = (response: PdfWorkerResponse) => {
				cleanup();
				if (response.ok) resolve(response.result);
				else reject(new Error(response.message));
			};
			const onError = (error: Error & { code?: string }) => {
				stop(
					error.code === 'ERR_WORKER_OUT_OF_MEMORY'
						? `PDF processing exceeded the ${maxMemoryMb} MB memory limit.`
						: error.message,
				);
			};
			const onExit = () => stop('PDF processing stopped unexpectedly.');
			const onAbort = () => stop('PDF processing was cancelled.');
			const timer = setTimeout(
				() => stop(`PDF-to-text processing exceeded the ${limits.timeoutSeconds} second timeout.`),
				limits.timeoutSeconds * 1_000,
			);
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				worker.off('message', onMessage);
				worker.off('error', onError);
				worker.off('exit', onExit);
			};

			signal?.addEventListener('abort', onAbort, { once: true });
			worker.on('message', onMessage);
			worker.on('error', onError);
			worker.on('exit', onExit);
			worker.postMessage(request, [data.buffer as ArrayBuffer]);
		});
	}

	async close(): Promise<void> {
		const worker = this.worker;
		this.worker = undefined;
		this.workerMemoryMb = undefined;
		if (worker) await worker.terminate();
	}

	private async getWorker(maxMemoryMb: number): Promise<Worker> {
		if (this.worker && this.workerMemoryMb !== maxMemoryMb) await this.close();

		this.worker ??= new Worker(this.workerPath, {
			resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
		});
		this.workerMemoryMb = maxMemoryMb;
		return this.worker;
	}
}

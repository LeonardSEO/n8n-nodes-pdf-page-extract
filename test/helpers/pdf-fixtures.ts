import { createHash } from 'node:crypto';

export function createPdfFromStreams(streams: string[]): Buffer {
	return assemble(streams.map((stream) => Buffer.from(stream, 'latin1')));
}

export function createPdf(pageTexts: string[]): Buffer {
	return createPdfFromStreams(pageTexts.map((text) => `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`));
}

const PASSWORD_PADDING = Buffer.from(
	'28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
	'hex',
);

function rc4(key: Buffer, data: Buffer): Buffer {
	const state = Array.from({ length: 256 }, (_value, index) => index);
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = (j + state[i] + key[i % key.length]) & 255;
		[state[i], state[j]] = [state[j], state[i]];
	}
	const output = Buffer.alloc(data.length);
	let a = 0;
	let b = 0;
	for (let index = 0; index < data.length; index++) {
		a = (a + 1) & 255;
		b = (b + state[a]) & 255;
		[state[a], state[b]] = [state[b], state[a]];
		output[index] = data[index] ^ state[(state[a] + state[b]) & 255];
	}
	return output;
}

function md5(...parts: Buffer[]): Buffer {
	const hash = createHash('md5');
	parts.forEach((part) => hash.update(part));
	return hash.digest();
}

function padPassword(password: string): Buffer {
	return Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32);
}

/** Builds a real PDF using the standard security handler (40-bit RC4, revision 2). */
export function createEncryptedPdf(pageText: string, password: string): Buffer {
	const fileId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
	const permissions = Buffer.alloc(4);
	permissions.writeInt32LE(-4);

	const ownerValue = rc4(md5(padPassword('owner')).subarray(0, 5), padPassword(password));
	const key = md5(padPassword(password), ownerValue, permissions, fileId).subarray(0, 5);
	const userValue = rc4(key, PASSWORD_PADDING);

	return assemble([Buffer.from(`BT /F1 12 Tf 72 720 Td (${pageText}) Tj ET`, 'latin1')], {
		encryptDictionary:
			`<< /Filter /Standard /V 1 /R 2 /O <${ownerValue.toString('hex')}> ` +
			`/U <${userValue.toString('hex')}> /P -4 >>`,
		fileId: fileId.toString('hex'),
		encryptStream: (objectNumber, stream) => {
			const objectKey = Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, 0, 0, 0]);
			return rc4(md5(key, objectKey).subarray(0, 10), stream);
		},
	});
}

interface EncryptionParts {
	encryptDictionary: string;
	fileId: string;
	encryptStream(objectNumber: number, stream: Buffer): Buffer;
}

function assemble(streams: Buffer[], encryption?: EncryptionParts): Buffer {
	const fontObject = 3 + streams.length * 2;
	const encryptObject = fontObject + 1;
	const lastObject = encryption ? encryptObject : fontObject;
	const kids = streams.map((_stream, index) => `${3 + index * 2} 0 R`).join(' ');

	const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
	const offsets: number[] = [0];
	let size = parts[0].length;
	const write = (objectNumber: number, body: Buffer) => {
		offsets[objectNumber] = size;
		const object = Buffer.concat([
			Buffer.from(`${objectNumber} 0 obj\n`, 'latin1'),
			body,
			Buffer.from('\nendobj\n', 'latin1'),
		]);
		parts.push(object);
		size += object.length;
	};
	const writeText = (objectNumber: number, body: string) =>
		write(objectNumber, Buffer.from(body, 'latin1'));

	writeText(1, '<< /Type /Catalog /Pages 2 0 R >>');
	writeText(2, `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`);
	streams.forEach((stream, index) => {
		const contentObject = 4 + index * 2;
		writeText(
			3 + index * 2,
			'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
				`/Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
		);
		const content = encryption ? encryption.encryptStream(contentObject, stream) : stream;
		write(
			contentObject,
			Buffer.concat([
				Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
				content,
				Buffer.from('\nendstream', 'latin1'),
			]),
		);
	});
	writeText(fontObject, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	if (encryption) writeText(encryptObject, encryption.encryptDictionary);

	let xref = `xref\n0 ${lastObject + 1}\n0000000000 65535 f \n`;
	for (let objectNumber = 1; objectNumber <= lastObject; objectNumber++) {
		xref += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
	}
	const encryptEntries = encryption
		? `/Encrypt ${encryptObject} 0 R /ID [<${encryption.fileId}> <${encryption.fileId}>] `
		: '';
	xref +=
		`trailer\n<< /Size ${lastObject + 1} /Root 1 0 R ${encryptEntries}>>\n` +
		`startxref\n${size}\n%%EOF\n`;
	parts.push(Buffer.from(xref, 'latin1'));

	return Buffer.concat(parts);
}

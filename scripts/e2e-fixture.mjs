// Writes a two-page PDF: page 1 is ignored by the workflow's page range, page 2 has two lines.
import { writeFileSync } from 'node:fs';

const pages = [
	'BT /F1 12 Tf 72 720 Td (Skipped page) Tj ET',
	'BT /F1 12 Tf 72 720 Td (Line one) Tj 0 -16 Td (Line two) Tj ET',
];
const objects = [
	null,
	'<< /Type /Catalog /Pages 2 0 R >>',
	`<< /Type /Pages /Kids [3 0 R 5 0 R] /Count ${pages.length} >>`,
];
pages.forEach((stream, index) => {
	objects[3 + index * 2] =
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
		`/Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`;
	objects[4 + index * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
});
objects[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let number = 1; number < objects.length; number++) {
	offsets[number] = pdf.length;
	pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
for (let number = 1; number < objects.length; number++) {
	pdf += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync(process.argv[2], pdf, 'latin1');

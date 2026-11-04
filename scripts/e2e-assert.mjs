// Checks the raw `n8n execute` output of the end-to-end workflow.
import assert from 'node:assert/strict';

const output = process.argv[2];
const start = output.indexOf('{');
assert.ok(start >= 0, `No JSON in n8n output:\n${output}`);

const run = JSON.parse(output.slice(start));
const runData = (run.data ?? run).resultData.runData['PDF to Text'];
assert.ok(runData, 'The PDF to Text node did not run.');

const json = runData[0].data.main[0][0].json;
assert.deepEqual(json.pages, ['Line one\nLine two']);
assert.deepEqual(json.pageNumbers, [2]);
assert.equal(json.totalPages, 2);
assert.equal(json.needsOcr, false);

console.log('n8n end-to-end test passed.');

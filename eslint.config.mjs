import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['nodes/FreePdfToText/pdf-*.ts'],
		rules: {
			// Helper errors are converted to NodeOperationError at the node boundary.
			'@n8n/community-nodes/require-node-api-error': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			// PDF extraction requires the parser at runtime for self-hosted n8n installations.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
];

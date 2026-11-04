# Contributing to n8n-nodes-free-pdf-to-text

Thank you for considering contributing to this n8n community node! Here are some guidelines to help you get started.

## Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the package:
   ```bash
   pnpm build
   ```

## Testing Your Changes

```bash
pnpm test      # unit tests, and worker tests against the compiled output
pnpm test:n8n  # runs the packed package in a real n8n container (requires Docker)
pnpm test:n8n-install  # installs the published package through n8n (requires Docker)
```

To try the node by hand, run `pnpm dev`, which starts a local n8n with the node installed.

## Code Style

This project uses ESLint and Prettier for code formatting. Before submitting a pull request, please make sure your code follows the style guidelines:

```bash
pnpm lint
pnpm format
```

## Pull Request Process

1. Fork the repository
2. Create a new branch for your feature or bugfix
3. Make your changes
4. Run tests and ensure code style compliance
5. Submit a pull request

## Release Process

Pushing a `v*.*.*` tag that matches the version in `package.json` runs all checks, publishes to npm with provenance, and creates a GitHub release.

A monthly workflow also updates `pdfjs-dist`, `@n8n/node-cli`, and `prettier`, and releases new `pdfjs-dist` versions automatically. See the README for details.

## License

By contributing to this project, you agree that your contributions will be licensed under the project's [MIT License](LICENSE.md).

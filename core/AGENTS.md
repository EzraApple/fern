# AGENTS.md

Guidance for AI agents working with this repository.

## About Jarvis

Jarvis is a local-first AI assistant for software development. It uses OpenCode as the agentic harness with GitHub integration for self-improvement capabilities.

## Building and Testing

```bash
pnpm install         # Install dependencies
pnpm build           # TypeScript compilation
pnpm lint            # ESLint
pnpm typecheck       # Type checking only
```

## Development

```bash
pnpm dev ask "your question"   # Run CLI
pnpm dev serve                 # Start local API server
pnpm dev config                # Check configuration
pnpm dev health                # Check service connectivity
```

## Tool Development

Custom OpenCode tools live in `src/.opencode/tool/`. After modifying:

```bash
node scripts/bundle-tools.mjs
```

This compiles TypeScript tools to `src/.opencode-runtime/tool/` where OpenCode discovers them.

## Code Quality

- Use `T[]` for arrays, not `Array<T>`
- Use object parameters for functions with more than one argument
- Use `??` for null coalescing, never `||` for null/undefined fallbacks
- Use descriptive variable names
- Wrap third-party code in try/catch

## Comment Standards

Prefix TODOs with name, date, and ticket number:

```typescript
// TODO (Kevin, 2024-01-15, REPL-1234): Refactor this
// Note (Kevin, 2024-02-10): Workaround for API inconsistency
```

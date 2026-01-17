# CLAUDE.md

Guidance for Claude Code when working with this repository.

## About Replee

Replee is an AI assistant for software teams that integrates with Linear, Slack, Sentry, and GitHub.

## Building and Testing

```bash
pnpm test            # Run all tests
pnpm tsc             # TypeScript compilation
pnpm lint            # ESLint linting
```

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

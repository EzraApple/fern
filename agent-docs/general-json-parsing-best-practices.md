---
name: JSON Parsing Best Practices
description: |
  Guidelines for safely parsing JSON with proper validation.
  Reference when: parsing JSON strings, handling WebSocket messages, parsing API responses, validating unknown data.
---

# JSON Parsing Best Practices

## Use parseJsonOrNull Instead of Try-Catch

When parsing JSON that might be invalid, use a utility function instead of wrapping `JSON.parse` in try-catch:

```typescript
// Bad
try {
  const parsed = JSON.parse(jsonString) as MyType;
  // use parsed
} catch {
  // handle error
}

// Good
function parseJsonOrNull(jsonString: string): unknown | null {
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

const parsed = parseJsonOrNull(jsonString);
if (parsed === null) {
  // handle invalid JSON
}
```

## Always Validate with Zod After Parsing

Never use type assertions (`as MyType`) on parsed JSON. Always validate with a Zod schema to ensure runtime type safety:

```typescript
// Bad - type assertion provides no runtime safety
const data = parseJsonOrNull(jsonString) as MyType;

// Also bad - casting unknown to a type
const data = JSON.parse(jsonString) as MyType;

// Good - validate with Zod
import { z } from "zod";

const mySchema = z.object({
  type: z.literal("chat"),
  chatId: z.string(),
});

const parsed = parseJsonOrNull(jsonString);
const result = mySchema.safeParse(parsed);
if (!result.success) {
  // handle validation error
  return null;
}
const data = result.data; // properly typed as { type: "chat", chatId: string }
```

## Why This Matters

Type assertions (`as MyType`) only affect compile-time types - they provide zero runtime safety. If the JSON doesn't match your expected shape, you'll get runtime errors when accessing properties that don't exist.

Zod validation ensures:

1. The data actually matches your expected shape at runtime
2. TypeScript types are derived from the schema, so they're always accurate
3. You get clear error messages when validation fails
4. You can handle malformed data gracefully instead of crashing

## JSONL Parsing

For JSONL (JSON Lines) files like session data, parse line by line:

```typescript
const lines = fileContent.split('\n').filter(line => line.trim());
const events = lines.map(line => {
  const parsed = parseJsonOrNull(line);
  return eventSchema.safeParse(parsed);
}).filter(result => result.success).map(result => result.data);
```

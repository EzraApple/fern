---
name: TypeScript Best Practices
description: |
  TypeScript type conventions and patterns.
  Reference when: writing type definitions, using discriminated unions, handling null/undefined in types, using Record types, avoiding non-null assertions.
---

# TypeScript Best Practices

## No unnecessary type annotations

In general, don't use type annotations where they're not needed. If TypeScript can infer a type, don't type-annotate it unless it's extremely confusing what the type is.

In particular, avoid unnecessarily annotating function components.

## Use Record for exhaustive mappings

Use TypeScript-enforced mappings for enums when possible. Model it as one `Record<EnumType, AssociatedData>`. This way, we keep all the associated data about the enum cases in one place, and TypeScript will fail if we add a new enum case and forget to define the values.

## Discriminated unions are discriminated based on type

For discriminated unions (object types which have a property in common, usually `type`), use singular naming conventions (`Type`) instead of plural (`Types`).

## Naming

### Casing

Use `CapitalCamelCase` for type definitions.

### Unions

Use singular (as opposed to plural) naming for discriminated unions. Discriminated unions represent the type of one thing, not multiple things.

## Don't include null or undefined in typedefs

Avoid `| null` or `| undefined` in type definitions - instead, provide `| null` in the place where the type is used. Null doesn't make sense for a type definition - you're not defining a type that can always be null.

Note: `| null` as a nested object property is fine, because it indicates optionality of a property, not of an entire type.

## Don't include arrays in typedefs

Avoid defining the fact that a type is an array as part of the type definition.

```typescript
// Bad
type Users = User[];

// Good
type User = { id: string; name: string };
// Use User[] where needed
```

## Non-null assertions

Throw errors instead of using non-null assertions (`!`). If you think something should be defined, there is no harm in checking and throwing an error so that TypeScript agrees with you instead of telling TypeScript you know better.

```typescript
// Bad
const user = users.find(u => u.id === id)!;

// Good
const user = users.find(u => u.id === id);
if (!user) {
  throw new Error(`User not found: ${id}`);
}
```

There are exceptions to this, but should be considered more carefully.

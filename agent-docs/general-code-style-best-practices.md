---
name: Code Style Best Practices
description: |
  General code style conventions for naming, comments, and formatting.
  Reference when: naming variables/functions/types, writing comments, choosing between coding patterns, handling nullish values, working with 3rd party dependencies.
---

# Code Style Best Practices

## Naming

### Avoid non-descriptive naming conventions

Avoid "bag of data" non-descriptive variable naming conventions.

```typescript
// Bad
const context = {};
const responseInfo = {};

// Good
const userSessionContext = {};
const apiResponseData = {};
```

### Document complex conditionals with self-documenting variables

Rather than having complex conditionals with a bunch of different conditions, map the conditional to a self-documenting variable.

```typescript
// Bad
if (
  (thing.hasFourWheels || !thing.hasMoreThanThreeWheels) &&
  !thing.hasNoEngine &&
  thing.hasEngine
) {
  console.log("This is a car.");
}

// Good
const wheelsLookLikeCar = thing.hasFourWheels || !thing.hasMoreThanThreeWheels;
const engineLooksLikeCar = !thing.hasNoEngine && thing.hasEngine;
const isCar = wheelsLookLikeCar && engineLooksLikeCar;

if (isCar) {
  console.log("This is a car.");
}
```

### Capitalization and Casing

- Types, classes, and components should use `CapitalCamelCase`
- Variables should use `camelCase` in JS/TS, `snake_case` in Python
- TypeScript enum definitions should use `CapitalCamelCase`
- TypeScript enum cases should use `camelCase`, e.g. `ActionType.scrollToPoint`

### No Unnecessary Abbreviation

Avoid using truncations or contractions in variable names.

```typescript
// Bad
const numOfUsers = ...
const primaryBtn = ...
let pos = ...

// Good
const userCount = ...
const primaryButton = ...
let mousePosition = ...
```

- Well understood truncations are usually ok (e.g. max, min)
- Initialisms are OK as long as they are well understood

### Standard Naming

- For numbers, use `count` instead of `num`
- Boolean variables/functions should start with `is` or `has`. Do not name Boolean variables `checkIf`

### Name things what they are

If a variable is a setTimeout interval identifier, don't call it `timer`, call it `intervalId`.

## Comments

- Comments are an important part of code. Prefer to write comments for code which is not trivial.
- Don't write comments that don't provide any value. For example, `// Gets user` on a function called `getUser` doesn't add anything.
- Don't add JSDoc comments to self-explanatory interface/type properties. Only add comments when they provide non-obvious context.

### JSDoc Format for Functions

```typescript
/**
 * What the function does (this is the description)
 *
 * @param xyz - Parameter description
 * @returns foo - Return description
 */
function myFunction(xyz: string): string {
  // ...
}
```

- For comments on functions, use docblocks instead of `// single line comments`
- For TODOs and Notes, prefix the comment with your name and the date
- Don't write comments in the first person, e.g. "I had to..." - write "we" instead

## Code style

### Use Boolean() instead of !!

```typescript
// Good
const myBoolean = Boolean(someValueThatCouldBeUndefined);

// Bad
const myBoolean = !!someValueThatCouldBeUndefined;
```

### Use aliased imports instead of relative imports

Instead of `import { Thing } from "../../../utils/Thing"`, use `import { Thing } from "@utils/Thing"`.

### Avoid unnecessary template literals

```tsx
// Not preferred
let myString = "a"
<MyComponent title={`${myString}`} />

// Preferred
let myString = "a"
<MyComponent title={myString} />
```

### No unused code

Never commit unused code, and if you need to, comment the fact that it's unused and why.

### Prefer optional chaining instead of if checks

```typescript
// Not preferred
if (myFunction) {
  myFunction();
}

// Preferred
myFunction?.();
```

### Null coalescing

Don't use `||` for null coalescing, almost always you want `??`:

```typescript
// Good
const length = myOptionalArray?.length ?? 0;

// Bad
const length = myOptionalArray?.length || 0;
```

### Use Objects, not Tuples

```typescript
// Bad
type IdAndType = [string, SomeType];

// Good
type ComponentData = { id: string; type: SomeType };
```

### Use regular types instead of index access types

We should not use index-accessed types (eg: `Query["ranges"]["mainRange"]`) but instead should use regular types (eg `QueryRange`).

The exception is when a third-party library does not expose an inner type.

## 3rd Party Dependencies

In general, dependencies on 3rd party code (analytics, external services, etc) should not break core flows. Wrap 3rd party code in try/catch (or for promises, void instead of await if it's just a side effect).

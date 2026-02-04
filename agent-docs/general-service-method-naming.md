---
name: Service Method Naming
description: |
  Conventions for naming and structuring service methods (get, find, create, update).
  Reference when: creating new service methods, refactoring existing services, deciding between get vs find, structuring query parameters.
---

# Service Method Naming

## TLDR

Return a model and error if not found? Call the method `get()`

## Service Method Names

### get(id) or getByX(uniqueProperty)

The get method is designed to retrieve a single record based on the provided query. This method will throw an error if the query does not match any records. You should use this if you are EXPECTING a result and want to raise alarm bells if that data is not present.

```typescript
// good
const session = await sessionService.get(id);

// If there are other UNIQUE columns or foreign keys
const session = await sessionService.getByUserId(userId);
```

### find(query, options)

Returns N results based on query. Use this convention if you are expecting between 0 to N results OR if you need one result, but you just need the first one.

```typescript
// good
const sessions = await sessionService.find({ channelId });

// good
const sessions = await sessionService.find(
  { channelId },
  { limit: 10, orderBy: { 'createdAt': "desc" } }
);

// good - get most recent
const sessions = await sessionService.find(
  { channelId },
  { limit: 1, orderBy: { 'createdAt': "desc" } }
);

// bad - use get() for id lookups
const sessions = await sessionService.find({ id });
```

### create(...)

Creates a model and returns it. If a model already exists for unique keys, will throw an error.

```typescript
// good
const session = await sessionService.create({
  id: ...,
  channelId: ...,
  userId: ...
})

// bad, session is implied
const session = await sessionService.createSession(...)
```

### createOrUpdate(...)

Creates a model and returns it, unless the model with the given unique keys already exists, in which case it updates and returns it.

```typescript
// good
const memory = await memoryService.createOrUpdate({
  id: ...,
  key: "user_preference",
  value: "dark_mode"
})
```

### getOrCreate(...)

Given a model object, returns a model which matches the query, creating one with values provided by the query if it doesn't exist.

```typescript
// good
const { session, created } = await sessionService.getOrCreate({
  channelId: ...,
  userId: ...
})

// bad, session is implied
const { session, created } = await sessionService.getOrCreateSession({
  channelId: ...
})
```

### update(...)

Given a model data, updates it in the database, throwing an error if the arguments specify a model which can't be found.

```typescript
// good
const session = await sessionService.update({ id: ..., status: "completed" })
```

### Naming conventions to avoid

- `getOrNull` - use `find(limit: 1)` for this
- `safeGet` - use `find`
- `list` - should be `find`
- `listSessions` - is redundant, just call `.find()`
- `insert` - use `create`
- `upsert` - use `createOrUpdate`
- `findAll` - use `find`
- `getAll` - use `find`
- `query` - use `find`

## Structuring Access Methods

Generally for CRUD operations on services, you want one method per operation - e.g. one find, update, etc.

### General find(), update(), get() methods

Usually, if you need a find/update/get method in your service, you should have one method that takes a partial:

```typescript
async find(query: Partial<{
  id: string,
  channelId: string,
  userId: string,
}>, options?: { limit?: number, offset?: number }) {
  ...
}
```

The method should take all the things you want to support finding by, and construct database queries internally to return the result you want.

### Limits and offsets

```typescript
async find(query: Partial<...>, options?: {
  limit?: number,
  offset?: number
}) { ... }
```

### Include / Entities / Formats

Use TypeScript overloads to define exactly what type is returned:

```typescript
async find(
  query: SessionFindQuery, options: ..., format: "id",
): Promise<string[]>;
async find(
  query: SessionFindQuery, options: ..., format?: "default",
): Promise<Session[]>;
async find(
  query: SessionFindQuery, options: ..., format: "id" | "default" = "default",
): Promise<Session[] | string[]> {
  ...
}
```

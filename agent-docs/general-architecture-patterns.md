---
name: Architecture Patterns
description: |
  Guidelines for backend architecture following layered service patterns.
  Reference when: building new API endpoints, creating services/gateways, organizing backend code structure, implementing error handling, adding retries to API calls.
---

# Architecture Patterns

We follow a layered architecture for backend codebases. This architecture covers common request/response information flow, as well as things like sockets and background jobs.

## Overview

This is an overview of different modules in the information flow:

- **Routes/Handlers** - Declaration of APIs/endpoints. Entry points for requests.
- **Entities** - Objects and types known to the application, free from database limitations.
- **Services** - Where all business logic lives. Input/output should be entities. A service can call other services.
- **Mappers** - Map from external data structures to internal entities. Handle things like casing conventions.
- **Gateways** - Handle retries, rate-limits, error handling, and schema validation for external calls.

## Why

The reason we follow this architecture is:

- **Ease of Migrations** - This abstraction allows switching out components like APIs, databases, and frameworks.
- **Consistency** - Language-agnostic architecture that works across teams.
- **Ease of Testing** - Native entities in services make mocking straightforward.

## Do's and Don'ts

### General

- Use standardized names for each layer: Services, Gateways (not "clients"/"repositories").

### Routes

- Version your APIs. Prefix with `/api/v1` - if you need a breaking change, use `/api/v2`
- Never directly call the database from the routes layer
- Routes should basically just be wrappers for one service call
- Routes define their own schemas (using Zod). Don't import schemas from the service layer
- Routes are responsible for: parsing, authentication, error handling, formatting responses, calling services

## Services

- Generally, for models with CRUD interfaces, there is one service per model
- Service calls which have arguments should be either regular function arguments or an object with a TypeScript type
- Services might not be related to models - for example, a `SessionService` that encapsulates session management logic
- Services are usually NOT where you implement retries for errors. Retries should be at the gateway level
- Services should be regular classes with a `getXService()` function exported

### Service Methods

- Do not name your methods with the name of the service itself (e.g. `find` instead of `findSession`)
- You should NOT write different service methods that query by different parameters - use a single `find()` with flexible query params

## Gateways

Gateways should be regular classes with a `getXGateway()` function.

- Gateways shouldn't have business logic. They're responsible for making calls to external systems.
- Gateways should only know about concepts related to what they're a gateway to. E.g. `ProviderGateway` shouldn't know about session management.
- If a gateway needs to chain multiple calls to an API to return data, it can.
- Gateways are where you add retries. Use a `@retry` decorator or `asyncRetry` function.

## Entities

Entities are usually just database models. If you have a domain object not in the database, define it as a TypeScript type via Zod.

## Retries

Use a standardized retry pattern:

```typescript
@retry({ retries: 5, initialTimeout: 1000, factor: 2 })
async callExternalApi(...) { ... }

// Or use asyncRetry function
const result = await asyncRetry(() => externalCall(), {
  retries: 3,
  initialTimeout: 1000,
});
```

## Request Lifecycle Example

### 1. Route

```typescript
// HTTP endpoint
app.post("/api/v1/sessions", async (req, res) => {
  const body = sessionCreateSchema.parse(req.body);
  const session = await getSessionService().create(body);
  res.json(session);
});
```

### 2. Service

```typescript
import { getProviderGateway } from "./gateways/provider";

class SessionService {
  async create(input: SessionCreateInput) {
    const session = await db.session.create({ data: input });

    // Business logic that involves external calls
    const response = await getProviderGateway().sendWelcome(session.id);

    return session;
  }
}

export const getSessionService = () => {
  return new SessionService();
};
```

### 3. Gateway

```typescript
class ProviderGateway {
  constructor(private apiKey: string) {}

  @retry({ retries: 3, initialTimeout: 1000 })
  async sendWelcome(sessionId: string) {
    const response = await fetch(...);
    return providerResponseSchema.parse(await response.json());
  }
}

export const getProviderGateway = () => {
  return new ProviderGateway(process.env.PROVIDER_API_KEY);
};
```

## Error Handling

### Error Hierarchy

Create a base error class that all errors inherit from:

```typescript
class AppError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
  }
}

class ServiceError extends AppError {}
class GatewayError extends AppError {}
class ValidationError extends AppError {}
```

### Scoped Errors for Gateways and Services

Every gateway and service should have a base error class:

```typescript
class ProviderGatewayError extends GatewayError {}
class ProviderRateLimitError extends ProviderGatewayError {}
class ProviderAuthError extends ProviderGatewayError {}
```

### Error Mapping in Routes

Routes catch service-level errors and convert to HTTP responses:

```typescript
app.post("/api/v1/sessions", async (req, res) => {
  try {
    const session = await getSessionService().create(body);
    res.json(session);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof ProviderRateLimitError) {
      res.status(429).json({ error: "Rate limited" });
    } else {
      res.status(500).json({ error: "Internal error" });
    }
  }
});
```

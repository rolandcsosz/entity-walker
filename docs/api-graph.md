# API-Bound Graph & Async Backend Integration (`ValidApi` & `GraphDef`)

`entity-walker` provides seamless, type-safe integration with remote REST APIs and generated OpenAPI SDK clients via `ValidApi` and `GraphDef`.

Binding an API configuration to `createGraph` enables optimistic updates, lazy loading (`.load()`), custom actions, offline delta queueing, HTTP status error classification, and explicit `ApiError` passing without throwing exceptions.

---

## Quick Example

```typescript
import { createGraph, type ValidSchema, type GraphEdges, type GraphDef, type ValidApi, type Entities } from "entity-walker";
import { getTransactions, getTransaction, createTransaction, updateTransaction, deleteTransaction } from "./api/client";

// 1. Define Entity Schema
type Schema = ValidSchema<{
  transaction: { id: string; item: string; amount: number; subcategoryId: string };
  subcategory: { id: string; name: string };
}>;

// 2. Define Edges
const edges = {
  transaction: {
    subcategory: { bidirectional: true, resolve: (t) => t.subcategoryId },
  },
} as const satisfies GraphEdges<Schema>;

// 3. Define Type-Safe Graph Definition
export type AppGraphDef = GraphDef<Schema, typeof edges>;

// 4. Define API Configuration with ValidApi<AppGraphDef>
const api: ValidApi<AppGraphDef> = {
  isTransientError: (err) => err.status === 503 || err.code === "OFFLINE",
  transaction: {
    list: async () => {
      return (await getTransactions()).data;
    },
    read: async (id: string) => {
      return (await getTransaction({ path: { id } })).data;
    },
    create: async (data) => {
      return (await createTransaction({ body: data })).data;
    },
    update: async (data) => {
      return (await updateTransaction({ path: { id: data.id }, body: data })).data;
    },
    delete: async (id: string) => {
      await deleteTransaction({ path: { id } });
    },
  },
};

// 5. Instantiate API-Bound Graph
const graph = createGraph<AppGraphDef>({
  entities: { transaction: [], subcategory: [] },
  edges,
  api,
});
```

---

## API Handlers Reference

When defining handlers with `ValidApi<AppGraphDef>`, all parameters and return types are strictly typed according to your `GraphDef`. Operations use explicit error passing (returning `ApiError`) rather than throwing exceptions:

| Handler | Signature | Description |
|---|---|---|
| `list` | `() => Promise<E[] \| ApiError> \| E[] \| ApiError` | Fetches all entities of a type. Called by `list.load()`. |
| `read` | `(id: E["id"]) => Promise<E \| ApiError> \| E \| ApiError` | Fetches a single entity by ID. Called by `node.load()`. |
| `create` | `(data: Omit<E, "id">) => Promise<E \| ApiError> \| E \| ApiError` | Creates a new entity. Called by `graph.createEntity(data)`. |
| `update` | `(data: E) => Promise<E \| void \| undefined \| ApiError> \| E \| void \| undefined \| ApiError` | Updates an entity. Called by `node.update(fn)` and `graph.updateEntity(data)`. |
| `delete` | `(id: E["id"]) => Promise<void \| ApiError> \| void \| ApiError` | Deletes an entity by ID. Called by `node.delete()`. |

---

## Error Classification & HTTP Status Codes

`ApiError` objects extract status codes (`status`), error codes (`code`), and automatically classify whether an error is transient (`isTransient`):

- **Transient Errors (`isTransient: true`)**: HTTP `500`, `502`, `503`, `504`, `429`, `408`, `0` (network failure), or network error messages. Optimistic graph updates are **retained** and queued into `pendingDeltas`.
- **Non-Transient Errors (`isTransient: false`)**: HTTP `400`, `401`, `403`, `404`, `409`, `422` (client/validation error). Optimistic graph updates are **rolled back** and the `ApiError` is returned.
- **Custom Predicate (`isTransientError`)**: Pass a custom function in `ValidApi` options to customize transient classification.

```typescript
export type ApiError = {
    message: string;
    code?: string | number;
    status?: number;
    isTransient?: boolean;
    raw?: any;
};
```

---

## Node & List Methods

### Lazy Loading Single Nodes with Chaining (`.load()`)
If a node is missing from local graph state, calling `.load()` fetches it using the configured `read` handler and returns the loaded `ApiEntityNode` for chaining:

```typescript
const txNode = await graph.transaction("tx123").load();
console.log(txNode.value()?.item);
```

### Loading & Caching Lists with Chaining (`.load()`)
Calling `.load()` on a node list populates local graph state using the configured `list` handler, caches query results, and returns the loaded `ApiEntityNodeList`:

```typescript
// Fetch transactions from backend and sync into graph
const txList = await graph.transactionNodes().load();

// Force re-fetch from backend (bypasses cache)
const freshList = await graph.transactionNodes().load({ force: true });
```

---

## Offline Delta Queue & Explicit `ApiError` Passing

```typescript
// Explicit error passing without throwing exceptions
const res = await graph.transaction("tx123").update((tx) => ({ ...tx, amount: 999 }));

if (res && "message" in res) {
  console.log("Error status:", res.status, "Transient:", res.isTransient);
}

// Check pending deltas
console.log(graph.pendingChanges()); 

// Flush queued deltas once backend connectivity is restored
const { synced, failed } = await graph.flushPending();

// Clear queue manually if needed
graph.clearPending();
```

---

## Root-Level Factory & Update Helpers

`ApiGraph` exposes auto-generated root helpers for each entity type:

```typescript
// Create new entity via backend create handler
const newTxNode = await graph.createTransaction({
  item: "Coffee",
  amount: 4.5,
  subcategoryId: "sub1",
});

// Update entity via root update helper
await graph.updateTransaction({
  id: "tx123",
  item: "Espresso",
  amount: 5.0,
  subcategoryId: "sub1",
});
```

---

## Custom Actions

You can register custom actions for individual entity nodes or root-level operations:

```typescript
const api: ValidApi<AppGraphDef> = {
  transaction: {
    actions: {
      archive: async (node) => {
        await node.update((tx) => ({ ...tx, archived: true }));
        return { ok: true };
      },
    },
  },
  actions: {
    batchImport: async (graph, items: Transaction[]) => {
      graph.sync({ transaction: items }, { mode: "merge" });
      return { count: items.length };
    },
  },
};

// Execute node action
await graph.transaction("tx123").api.archive();

// Execute root action
await graph.api.batchImport([...]);
```

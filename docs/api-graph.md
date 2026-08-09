# API-Bound Graph & Async Backend Integration (`ValidApi` & `GraphDef`)

`entity-walker` provides seamless, type-safe integration with remote REST APIs and generated OpenAPI SDK clients via `ValidApi` and `GraphDef`.

Binding an API configuration to `createGraph` enables optimistic updates, lazy loading (`.load()`), custom actions, and automatic transaction rollback on network or backend failure.

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

When defining handlers with `ValidApi<AppGraphDef>`, all parameters and return types are strictly typed according to your `GraphDef`:

| Handler | Signature | Description |
|---|---|---|
| `list` | `() => Promise<E[]> \| E[]` | Fetches all entities of a type. Called by `list.load()`. |
| `read` | `(id: E["id"]) => Promise<E> \| E` | Fetches a single entity by ID. Called by `node.load()`. |
| `create` | `(data: Omit<E, "id">) => Promise<E> \| E` | Creates a new entity. Called by `graph.createEntity(data)`. |
| `update` | `(data: E) => Promise<E \| void \| undefined> \| E \| void \| undefined` | Updates an entity. Called by `node.update(fn)` and `graph.updateEntity(data)`. |
| `delete` | `(id: E["id"]) => Promise<void> \| void` | Deletes an entity by ID. Called by `node.delete()`. Must return `void`. |

---

## Node & List Methods

### Lazy Loading Single Nodes (`.load()`)
If a node is missing from local graph state, calling `.load()` fetches it using the configured `read` handler:

```typescript
const txNode = await graph.transaction("tx123").load();
console.log(txNode.value()?.item);
```

### Loading & Caching Lists (`.load()`)
Calling `.load()` on a node list populates local graph state using the configured `list` handler and caches query results:

```typescript
// Fetch transactions from backend and sync into graph
const txList = await graph.transactionNodes().load();

// Force re-fetch from backend (bypasses cache)
const freshList = await graph.transactionNodes().load({ force: true });
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
});

// Execute node action
await graph.transaction("tx123").api.archive();

// Execute root action
await graph.api.batchImport([...]);
```

---

## Error Handling & Transaction Safety

All async mutations perform **optimistic local graph updates** within an internal transaction. If a remote API call fails or throws an exception, all local changes are **automatically rolled back**:

```typescript
try {
  await graph.transaction("tx123").update((tx) => ({ ...tx, amount: 999 }));
} catch (err) {
  // If backend call fails, the graph node is ALREADY rolled back to pre-update state!
  console.error("Failed to update transaction on server:", err);
}
```

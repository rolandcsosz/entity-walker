# Entity Walker

![CI](https://github.com/rolandcsosz/entity-walker/actions/workflows/ci.yml/badge.svg)

**Entity Walker** is a zero-dependency, type-safe TypeScript graph library for navigating relational data through intuitive traversal chains.

Model your data as a graph of entities connected by foreign keys, then traverse relationships with full TypeScript autocomplete — forward and reverse — as if you were walking through your data.

---

## Core Idea

Instead of writing nested loops or manual joins:

```ts
transactions.map(t =>
  subcategories.find(s =>
    mainCategories.find(m => ...)
  )
)
```
You simply walk the graph:

```ts
graph.transaction("tx1")
  .subcategory()
  .mainCategory()
  .value()?.name
```

## What You Can Use It For
* Read-heavy data models (dashboards, analytics, finance apps)
* Normalized API data (client-side joins without nesting)
* Deep entity navigation (multi-hop relationships)
* Reverse lookups (find all entities pointing to another)
* Data integrity validation
* In-memory graph exploration

* **Rich node-list API** — `.where()`, `.whereNode()`, `.ids()`, `.entities()`, `.select()`, `.unique()`, `.intersect()`, `.findEntity()`, `.findNode()`, `.isEmpty()` and more work directly on related entity collections.
* **Scoped Traversal** — Use `.scoped()` to snapshot the current state of a traversal, ensuring filters from earlier steps persist across deep path jumps.
* **Functional Encapsulation** — Use `.with()` to return values or encapsulated intersections seamlessly from within a traversal chain.
* **Consistent defaults** — every node exposes `.value()` (safe, returns `undefined` when missing) and `.valueOrThrow()` (throws when missing). No split between optional and required at the type level.
* **Performance-friendly** — indexed O(1) lookups; even rebuilding the graph per query beats nested loops at scale.
* **Proxy-free alternative** — `createNonProxyGraph` produces an equivalent graph for environments without `Proxy` support.
* **Safe Initialization** — Optional `emptyNode` and `emptyNodeList` factories for robust proxy-based initialization.
* **Data integrity checks** — `graph.info()` detects missing FK targets and orphan entities at runtime.

## Installation

```bash
npm install entity-walker
```

## Quick Example

```typescript
import { createGraph, ValidSchema, GraphEdges, GraphDef, Entities, EntityGraph } from "entity-walker";

type Transaction  = { id: string; subcategoryId: string };
type Subcategory  = { id: string; name: string; mainCategoryId: string };
type MainCategory = { id: string; name: string; expenseTypeId?: string };

type Schema = ValidSchema<{
  transaction:  Transaction;
  subcategory:  Subcategory;
  mainCategory: MainCategory;
}>;

const edges = {
  transaction: {
    subcategory: { bidirectional: true, resolve: t => t.subcategoryId },
  },
  subcategory: {
    mainCategory: { bidirectional: true, resolve: s => s.mainCategoryId },
  },
} as const satisfies GraphEdges<Schema>;

type CustomGraph = GraphDef<Schema, typeof edges>;

const entities: Entities<Schema> = {
  transaction:  [{ id: "tx1", subcategoryId: "sub1" }],
  subcategory:  [{ id: "sub1", name: "Groceries", mainCategoryId: "cat1" }],
  mainCategory: [{ id: "cat1", name: "Food" }],
};

const graph: EntityGraph<CustomGraph> = createGraph({ entities, edges });

// Forward traversal
const categoryName = graph
  .transaction("tx1")
  .subcategory()
  .mainCategory()
  .value()?.name; // "Food"

// Reverse traversal
const txIds = graph
  .mainCategory("cat1")
  .subcategoryNodes()
  .transactionNodes()
  .ids(); // ["tx1"]
```

## API-Bound Graph Example (`ValidApi` & `GraphDef`)

Bind remote REST APIs or generated OpenAPI SDK clients to `entity-walker` for automatic optimistic updates, lazy loading (`.load()`), and transaction safety:

```typescript
import { createGraph, type ValidSchema, type GraphEdges, type GraphDef, type ValidApi } from "entity-walker";
import { getTransactions, createTransaction, updateTransaction, deleteTransaction } from "./api/client";

type AppGraphDef = GraphDef<Schema, typeof edges>;

const api: ValidApi<AppGraphDef> = {
  transaction: {
    list: async () => (await getTransactions()).data,
    create: async (data) => (await createTransaction({ body: data })).data,
    update: async (data) => (await updateTransaction({ path: { id: data.id }, body: data })).data,
    delete: async (id: string) => { await deleteTransaction({ path: { id } }); },
  },
};

const apiGraph = createGraph<AppGraphDef>({ entities, edges, api });

// Fetch transactions from backend and sync into graph
await apiGraph.transactionNodes().load();

// Update entity with optimistic local update + backend sync + automatic rollback on failure
await apiGraph.transaction("tx1").update((tx) => ({ ...tx, amount: 42 }));
```

## Detailed Guides

| Guide | Description |
|---|---|
| [Graph](docs/graph.md) | Full reference for `createGraph` — the standard API with clean `graph.entity("id")` / `node.relation()` syntax powered by `Proxy`. |
| [API-Bound Graph](docs/api-graph.md) | Bind backend REST APIs / OpenAPI clients via `ValidApi` & `GraphDef` for optimistic updates, lazy loading (`.load()`), and automatic rollback. |
| [Non-Proxy Graph](docs/non-proxy-graph.md) | Full reference for `createNonProxyGraph` — identical behaviour using a `.to()` calling convention, compatible with environments that do not support `Proxy`. |
| [Graph Modification](docs/modification.md) | Update (upsert), node-level field update, delete, and cascade-delete entities at runtime with automatic index maintenance. |
| [Debugging](docs/debugging.md) | Use `graph.info()` to inspect entity counts, missing FK targets, and orphan entities. |

## Performance & Benchmarks

Entity Walker builds an in-memory index at construction time so every lookup is **O(1)**. Even with several rebuilding the graph out-performs hand-written nested loops at scale:

![image](docs/benchmark.png)

The benchmark compares pure indexed `for` loops against Entity Walker (with Proxy and without Proxy) across increasing dataset sizes with random id access patterns on multi-hop (4 relations). Entity Walker's indexed lookups dominate as dataset size grows. Proxy vs non-Proxy performance differs by a small constant factor, but both are much faster than nested loops at scale. The non-Proxy version is faster than Proxy (average ~1ms faster), but the difference is negligible compared to the gap with nested loops.
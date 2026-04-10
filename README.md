# Entity Walker

![CI](https://github.com/rolandcsosz/entity-walker/actions/workflows/ci.yml/badge.svg)

Entity Walker is a small, zero-dependency TypeScript library for working with normalised relational data as an immutable, type-safe graph.

Define your entities and their relationships via foreign keys, then traverse the graph with fully typed, autocompleted accessors. Every entity type and relation is known at compile time, so your IDE guides you with autocomplete and catches mistakes before they reach runtime.

## What You Can Use It For

* **Normalized API data** — fetch, normalize, and query relational data without nested loops.
* **Read-heavy applications** — dashboards, reporting tools, analytics, finance trackers.
* **Complex relationships** — navigate deeply nested relations in a single readable chain.
* **Reverse lookups** — find every entity that points to a given entity.
* **Safe queries** — missing entities and broken foreign keys are always handled gracefully.

## Features

* **Immutable & safe** — returned entities are frozen objects.
* **Type-safe & autocompleted** — TypeScript knows every entity type and every relation.
* **Bidirectional relations** — traverse forwards (1-to-1) or backwards (1-to-many) safely.
* **Rich node-list API** — `.filter()`, `.map()`, `.flatMap()`, `.where()`, `.ids()`, `.entities()`, `.select()`, `.unique()`, and more work directly on related entity collections.
* **Consistent defaults** — every node exposes `.value()` (safe, returns `undefined` when missing) and `.valueOrThrow()` (throws when missing). No split between optional and required at the type level.
* **Performance-friendly** — indexed O(1) lookups; even rebuilding the graph per query beats nested loops at scale.
* **Proxy-free alternative** — `createNonProxyGraph` produces an equivalent graph for environments without `Proxy` support.
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

## Detailed Guides

| Guide | Description |
|---|---|
| [Graph](docs/proxy-graph.md) | Full reference for `createGraph` — the standard API with clean `graph.entity("id")` / `node.relation()` syntax powered by `Proxy`. |
| [Non-Proxy Graph](docs/non-proxy-graph.md) | Full reference for `createNonProxyGraph` — identical behaviour using a `.to()` calling convention, compatible with environments that do not support `Proxy`. |

## Debugging

Call `graph.info()` at any time to inspect the state of the graph:

```typescript
const info = graph.info();
```

| Field | Type | Description |
|---|---|---|
| `entityCounts` | `Record<string, number>` | Number of entities stored per type. |
| `cache.nodeCount` | `number` | Number of nodes currently held in the internal node cache. |
| `missingEntities` | `{ type: string; id: string }[]` | FK values that resolve to an id that does not exist in the graph. For example, a transaction whose `subcategoryId` points to a subcategory that was never loaded. |
| `orphanEntities` | `Record<string, string[]>` | Entities that are never referenced by any edge. Only types that appear as a target in at least one edge are checked. A type absent from this record is either fully referenced or not a relation target. |

**Example — a graph with bad data:**

```typescript
// sub2 has mainCategoryId: "cat99" which does not exist
// cat3 is loaded but no subcategory points to it

const info = graph.info();

info.missingEntities;
// [{ type: "mainCategory", id: "cat99" }]

info.orphanEntities;
// { mainCategory: ["cat3"] }
```

`missingEntities` and `orphanEntities` make it easy to spot data quality problems — broken foreign keys, incomplete data loads, or stale ids — without traversing the graph manually.

---

## Performance & Benchmarks

Entity Walker builds an in-memory index at construction time so every lookup is O(1). Even rebuilding the graph fresh for every query out-performs hand-written nested loops at scale:

![image](docs/benchmark.png)

The benchmark compares pure indexed `for` loops against Entity Walker (with a full graph rebuild per query) across increasing dataset sizes with random id access patterns on multi-hop relations. Entity Walker's indexed lookups dominate as dataset size grows.

# Debugging

Call `graph.info()` at any time to inspect the state of the graph:

```typescript
const info = graph.info();
```

| Field | Type | Description |
|---|---|---|
| `entityCounts` | `Record<string, number>` | Number of entities stored per type. |
| `cache.nodeCount` | `number` | Number of nodes currently held in the internal node cache. |
| `missingEntities` | `{ type: string; id: string | number }[]` | FK values that resolve to an id that does not exist in the graph. For example, a transaction whose `subcategoryId` points to a subcategory that was never loaded. |
| `orphanEntities` | `Record<string, (string | number)[]>` | Entities that are never referenced by any edge. Only types that appear as a target in at least one edge are checked. A type absent from this record is either fully referenced or not a relation target. |

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

## graph.schema()

Call `graph.schema()` to get a structural overview of the graph — which entity types are registered and how they are connected.

```typescript
const schema = graph.schema();
```

| Field | Type | Description |
|---|---|---|
| `entities` | `string[]` | Names of all registered entity types. |
| `edges` | `{ from: string; to: string; bidirectional: boolean }[]` | All defined edges, including whether each is bidirectional. |

**Example:**

```typescript
const schema = graph.schema();

schema.entities;
// ["transaction", "subcategory", "mainCategory"]

schema.edges;
// [
//   { from: "transaction", to: "subcategory",  bidirectional: true },
//   { from: "subcategory", to: "mainCategory", bidirectional: true },
// ]
```

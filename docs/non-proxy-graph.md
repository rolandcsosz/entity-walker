# Non-Proxy Graph (`createNonProxyGraph`)

`createNonProxyGraph` is a drop-in alternative to `createGraph` with an identical feature set and runtime behaviour. The only difference is the call syntax: instead of dynamic proxy properties, everything goes through the explicit `.to()` method.

---

## Compatibility & Polyfill

Use `createNonProxyGraph` when your environment does not support the ES2015 `Proxy` global:

- **Older JS engines** — JavaScriptCore on older iOS/macOS, Hkvermes (React Native), Rhino, QuickJS-based runtimes.
- **Transpilation targets below ES2015** — Babel or tsc cannot transpile `Proxy`; if you target IE 11 or CommonJS ES5 output you must avoid it.
- **Strict CSP environments** — some Content-Security-Policy headers forbid dynamic property interception.
- **No polyfill path** — `Proxy` has no faithful runtime polyfill (the spec requires native hooks). `createNonProxyGraph` is the polyfill-compatible path: it uses only plain objects and arrays, works in any ES5+ environment, and has zero extra dependencies.

If `typeof Proxy !== "undefined"` in your target runtime, prefer `createGraph` for the cleaner syntax and better TypeScript autocomplete.

---

## API Mapping

The graph, node, and list APIs are identical to `createGraph`. The only difference is that every proxy property call maps to an explicit `.to()` call:

| Proxy (`createGraph`) | Non-Proxy (`createNonProxyGraph`) |
|---|---|
| `graph.entity(id)` | `graph.to("entity", id)` |
| `graph.entityNodes()` | `graph.to("entityNodes")` |
| `node.relation()` | `node.to("relation")` |
| `node.relationNodes()` | `node.to("relationNodes")` |
| `list.relationNodes()` | `list.to("relationNodes")` |

All other methods — `.value()`, `.valueOrThrow()`, `.exists()`, `.path()`, `.info()`, `.update(fn)`, `.delete()`, `.deleteCascade()`, `.entities()`, `.ids()`, `.select()`, `.first()`, `.findEntity()`, `.findNode()`, `.where()`, `.whereNode()`, `.unique()`, `.intersect()`, `.scoped()`, `.resetScope()`, `.with(fn)`, `.isEmpty()`, `.isNotEmpty()`, `graph.schema()`, `graph.info()` — are identical.

---

## Quick Start

```typescript
import { createNonProxyGraph, Entities, EntityGraphNoProxy } from "entity-walker";
import { edges, Schema, CustomGraph } from "./your-schema";

const entities: Entities<Schema> = {
  transaction: [
    { id: "tx1", subcategoryId: "sub1" },
    { id: "tx2", subcategoryId: "sub2" },
    { id: "tx3", subcategoryId: "sub1" },
  ],
  subcategory: [
    { id: "sub1", name: "Groceries", mainCategoryId: "cat1" },
    { id: "sub2", name: "Transport", mainCategoryId: "cat1" },
  ],
  mainCategory: [
    { id: "cat1", name: "Food",    expenseTypeId: "et1", incomeTypeId: "it1" },
    { id: "cat2", name: "Broken",  expenseTypeId: "bad", incomeTypeId: "bad" },
    { id: "cat3", name: "NoLinks"                                             },
  ],
  expenseType: [{ id: "et1", description: "Groceries" }],
  incomeType:  [{ id: "it1", description: "Salary"    }],
};

const graph: EntityGraphNoProxy<CustomGraph> = createNonProxyGraph({ entities, edges });

// Single entity (proxy: graph.transaction("tx1"))
graph.to("transaction", "tx1").value();
graph.to("transaction", "tx1").valueOrThrow();
graph.to("transaction", "tx1").exists();

// Forward traversal (proxy: node.subcategory().mainCategory())
graph.to("transaction", "tx1").to("subcategory").to("mainCategory").value();

// Reverse traversal (proxy: node.subcategoryNodes())
graph.to("mainCategory", "cat1").to("subcategoryNodes");

// Filtering with .where()
graph.to("mainCategory", "cat1").to("subcategoryNodes").where(sc => sc.name === "Groceries");

// Root-level list (proxy: graph.transactionNodes())
graph.to("transactionNodes").ids();
graph.to("transactionNodes").where(t => t.subcategoryId === "sub1").ids();
// Chained list traversal (proxy: list.subcategoryNodes().transactionNodes())
graph
  .to("mainCategoryNodes")
  .where(c => !!c.expenseTypeId)
  .to("subcategoryNodes")
  .to("transactionNodes")
  .ids();
```

---

## Safe Initialization

Non-proxy versions of the empty factories are also available:

```typescript
import { emptyNodeNoProxy, emptyNodeListNoProxy } from "entity-walker";

const node = emptyNodeNoProxy<CustomGraph, Transaction>();
node.to("subcategory").to("mainCategory").exists(); // false

const list = emptyNodeListNoProxy<CustomGraph, Transaction>();
list.to("subcategoryNodes").isEmpty(); // true
```

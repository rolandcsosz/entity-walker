# Graph Modification

The graph is mutated in-place via typed methods on the graph object and on individual nodes. All graph-level methods accept a single entity or an array of entities.

## Update (upsert)

`graph.update<Type>(entity | entity[])` replaces an existing entity by id. If the id is not found the entity is inserted (upsert). Foreign-key indexes are rebuilt so reverse lookups remain correct after an FK change.

```typescript
// Rename a subcategory
graph.updateSubcategory({ id: "sub1", name: "Groceries & Food", mainCategoryId: "cat1" });
graph.subcategory("sub1").value()?.name; // "Groceries & Food"

// Insert a new entity (id not yet in the graph → upsert)
graph.updateSubcategory({ id: "sub2", name: "Transport", mainCategoryId: "cat1" });
graph.subcategory("sub2").exists(); // true

// Move tx1 to a different subcategory — reverse index is updated automatically
graph.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
graph.subcategory("sub1").transactionNodes().ids(); // no longer contains "tx1"
graph.subcategory("sub2").transactionNodes().ids(); // now contains "tx1"

// Batch update
graph.updateSubcategory([
  { id: "sub1", name: "A", mainCategoryId: "cat1" },
  { id: "sub2", name: "B", mainCategoryId: "cat1" },
]);
```

## Node-Level Update

Call `.update(fn)` on any node to update individual fields via a callback. The callback receives the full entity and returns the updated entity. The `id` is always preserved — any `id` field in the return value is silently ignored.

```typescript
// Update a single field
graph.subcategory("sub1").update(e => ({ ...e, name: "Renamed" }));
graph.subcategory("sub1").value()?.name; // "Renamed"

// Change a foreign key — reverse index is updated automatically
graph.transaction("tx1").update(e => ({ ...e, subcategoryId: "sub2" }));
graph.subcategory("sub1").transactionNodes().ids(); // no longer contains "tx1"
graph.subcategory("sub2").transactionNodes().ids(); // now contains "tx1"

// The id cannot be changed — it is always preserved
graph.subcategory("sub1").update(e => ({ ...e, id: "hacked" }));
graph.subcategory("sub1").exists(); // still true
graph.subcategory("hacked").exists(); // false
```

Calling `.update()` on a non-existing node is a safe no-op.

## Delete

Call `.delete()` on any node to remove that entity from the graph. Only the single entity is removed; entities that point to it are kept but their forward edge will resolve to a null node.

```typescript
const node = graph.subcategory("sub1");

node.delete();

graph.subcategory("sub1").exists(); // false
graph.subcategoryNodes().ids();     // "sub1" is gone

// Transactions that had subcategoryId: "sub1" still exist,
// but traversal to the deleted subcategory returns an empty node.
graph.transaction("tx1").subcategory().exists(); // false
```

Call `.deleteCascade()` to remove an entity **and** every entity that references it (recursively).

```typescript
// Deleting a mainCategory also removes all subcategories that point to it,
// and all transactions that point to those subcategories.
graph.mainCategory("cat1").deleteCascade();

graph.mainCategory("cat1").exists();   // false
graph.subcategory("sub1").exists();    // false
graph.transaction("tx1").exists();     // false

// Entities that pointed to a different mainCategory are untouched.
graph.transaction("tx99").exists();    // true (was under cat2)
```

Calling `.delete()` or `.deleteCascade()` on a non-existing node is always a safe no-op.

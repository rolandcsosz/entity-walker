# Graph Modification

The graph is mutated in-place via typed methods on the graph object. All methods accept a single entity or an array of entities.

## Insert

`graph.insert<Type>(entity | entity[])` adds new entities to the graph. Forward and reverse indexes are updated immediately.

```typescript
// Insert a single entity
graph.insertSubcategory({ id: "sub2", name: "Transport", mainCategoryId: "cat1" });

// Insert multiple entities at once
graph.insertTransaction([
  { id: "tx2", subcategoryId: "sub1" },
  { id: "tx3", subcategoryId: "sub2" },
]);

// The new entity is immediately traversable
const name = graph.transaction("tx2").subcategory().value()?.name; // "Groceries"

// And reachable via reverse edges
const ids = graph.subcategory("sub1").transactionNodes().ids(); // includes "tx2"
```

## Update (upsert)

`graph.update<Type>(entity | entity[])` replaces an existing entity. If the id is not found the entity is inserted (upsert). Foreign-key indexes are rebuilt so reverse lookups remain correct after an FK change.

```typescript
// Rename a subcategory
graph.updateSubcategory({ id: "sub1", name: "Groceries & Food", mainCategoryId: "cat1" });
graph.subcategory("sub1").value()?.name; // "Groceries & Food"

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

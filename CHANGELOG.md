# Changelog

## 2.2.0

### Added
- **`emptyNode` and `emptyNodeList` init options** — Safe proxy-based initialization for traversing without throwing initial errors.
- **`scoped()`** — Snapshots current entities during a traversal chain so filters from earlier steps stick through complex path jumps.
- **`whereNode()`** — Filter node lists by examining node properties natively.
- **`intersect()`** — Combine node lists, arrays of IDs, or entities by calculating the intersecting graph state.
- **`with(fn)`** — Wrapper method seamlessly closing scopes to return scalar values or encapsulated intersections from traversal chains.

### Changed
- **Removed `where` argument on relation getters** — Replaced cleanly with chainable `.where(...)` API.

## 2.1.0

- **`node.update(fn)`** — update entity fields via a callback on any node. The callback receives the full entity and returns the updated version. The `id` is always preserved (any `id` in the return value is silently ignored). A no-op on non-existing nodes.
- **`list.findNode(predicate)`** — like `findEntity()` but returns the node instead of the entity value, allowing further traversal from the result.

### Changed

- **`insert` removed from public API** — `graph.insertX()` methods have been removed. Use `graph.updateX()` instead, which upserts (inserts if the id is not found, updates if it is).

### Fixed

- `ForbiddenKeys` type no longer includes `insert${string}`, matching the removed API surface.

## 2.0.0

Updated the API to be more consistent, ergonomic, and performant, with better support for non-`Proxy` environments.

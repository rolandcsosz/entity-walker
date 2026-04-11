# Changelog

## 2.1.0

### Added

- **`node.update(fn)`** — update entity fields via a callback on any node. The callback receives the full entity and returns the updated version. The `id` is always preserved (any `id` in the return value is silently ignored). A no-op on non-existing nodes.
- **`list.findNode(predicate)`** — like `findEntity()` but returns the node instead of the entity value, allowing further traversal from the result.

### Changed

- **`insert` removed from public API** — `graph.insertX()` methods have been removed. Use `graph.updateX()` instead, which upserts (inserts if the id is not found, updates if it is).

### Fixed

- `ForbiddenKeys` type no longer includes `insert${string}`, matching the removed API surface.

## 2.0.0

Updated the API to be more consistent, ergonomic, and performant, with better support for non-`Proxy` environments.

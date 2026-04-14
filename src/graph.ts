import { buildCore } from "./core";
import { EntityGraph, EntityMap, GraphDef, GraphEdges, NodeDebugInfo } from "./types";

export function buildGraphCore<EM extends EntityMap, E extends GraphEdges<EM>>(
    entities: { [K in keyof EM]: EM[K][] },
    edges: E,
) {
    let _createNode: (key: keyof EM, id: string | number | null, path?: string[]) => any;

    const core = buildCore<EM, E>(entities, edges, () => _createNode);
    const { byId, reverseIndex, nodeCache, toNodeList, graphSchema, graphInfo } = core;

    function createNode(key: keyof EM, id: string | number | null, path: string[] = []): any {
        const cacheKey = id !== null ? `${String(key)}:${id}` : null;
        if (cacheKey) {
            const cached = nodeCache.get(cacheKey);
            if (cached) return cached;
        }

        const nodePath = [...path, id !== null ? `${String(key)}(${id})` : `${String(key)}(null)`];
        const availableRelations = () => {
            const forward = Object.keys((edges as any)[key] ?? {});
            const reverse = Object.keys(reverseIndex[key as string] ?? {}).map(k => `${k}Nodes`);
            return [...forward, ...reverse];
        };

        let valueFetched = false;
        let cachedValue: any;
        function getValue() {
            if (valueFetched) return cachedValue;
            valueFetched = true;
            if (id === null) return (cachedValue = undefined);
            const entity = byId[key as string]?.[id];
            cachedValue = entity ? Object.freeze(entity) as Readonly<EM[typeof key]> : undefined;
            return cachedValue;
        }

        const valueOrThrowMethod = () => {
            const e = getValue();
            if (e === undefined) {
                if (id === null) throw new Error(
                    `[entity-walker] Cannot call valueOrThrow() on '${String(key)}': traversal led to a missing entity (null id).`
                );
                throw new Error(
                    `[entity-walker] Entity '${String(key)}' with id '${id}' does not exist in the graph.`
                );
            }
            return e;
        };
        const existsMethod = () => getValue() !== undefined;
        const pathMethod = () => nodePath;
        const deleteMethod = () => {
            if (id === null || !byId[key as string]?.[id]) return;
            const entity = byId[key as string][id];
            const ents = entities as Record<string, any[]>;
            const entityEdges = (edges as any)[key as string];
            // remove forward bidirectional reverse index entries
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const targetId = edge.resolve(entity);
                    if (!targetId) continue;
                    const bucket = reverseIndex[targetType]?.[key as string]?.[targetId];
                    if (bucket) {
                        const idx = bucket.indexOf(String(id));
                        if (idx !== -1) bucket.splice(idx, 1);
                    }
                }
            }
            // remove this entity from reverse index buckets pointing at it
            for (const sourceType in reverseIndex[key as string] ?? {}) {
                for (const targetId in reverseIndex[key as string][sourceType]) {
                    const bucket = reverseIndex[key as string][sourceType][targetId];
                    const idx = bucket.indexOf(String(id));
                    if (idx !== -1) bucket.splice(idx, 1);
                }
            }
            // remove from byId and entities array
            delete byId[key as string][id];
            const arrIdx = ents[key as string]?.findIndex((e: any) => e.id.toString() === id.toString());
            if (arrIdx !== undefined && arrIdx !== -1) ents[key as string].splice(arrIdx, 1);
            nodeCache.delete(`${String(key)}:${id}`);
        };
        const deleteCascadeMethod = () => {
            if (id === null || !byId[key as string]?.[id]) return;
            // find all entities pointing to this one via any edge and cascade-delete them first
            for (const sourceType in edges) {
                const sourceEdges = (edges as any)[sourceType];
                if (!sourceEdges) continue;
                for (const targetType in sourceEdges) {
                    if (targetType !== String(key)) continue;
                    const edge = sourceEdges[targetType];
                    const sourceArr = (entities as Record<string, any[]>)[sourceType] ?? [];
                    // snapshot ids before mutating
                    const pointingIds = sourceArr.filter(e => edge.resolve(e) === id).map(e => e.id.toString());
                    for (const pid of pointingIds) {
                        createNode(sourceType as keyof EM, pid).deleteCascade();
                    }
                }
            }
            deleteMethod();
        };
        const updateNodeMethod = (fn: (entity: any) => any) => {
            const entity = getValue();
            if (entity === undefined) return;
            const result = fn(entity);
            const { id: _ignoreId, ...resultFields } = result;
            const updated = { ...resultFields, id: entity.id };
            const ents = entities as Record<string, any[]>;
            const entityEdges = (edges as any)[key as string];
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const oldTargetId = edge.resolve(entity);
                    if (!oldTargetId) continue;
                    const bucket = reverseIndex[targetType]?.[key as string]?.[oldTargetId];
                    if (bucket) {
                        const idx = bucket.indexOf(String(id));
                        if (idx !== -1) bucket.splice(idx, 1);
                    }
                }
            }
            byId[key as string][id!.toString()] = updated;
            const arrIdx = ents[key as string].findIndex((e: any) => e.id.toString() === id!.toString());
            if (arrIdx !== -1) ents[key as string][arrIdx] = updated;
            valueFetched = false;
            nodeCache.delete(`${String(key)}:${id}`);
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const newTargetId = edge.resolve(updated);
                    if (!newTargetId) continue;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][key as string]) reverseIndex[targetType][key as string] = {};
                    if (!reverseIndex[targetType][key as string][newTargetId]) reverseIndex[targetType][key as string][newTargetId] = [];
                    reverseIndex[targetType][key as string][newTargetId].push(id!.toString());
                }
            }
        };
        const infoMethod = (): NodeDebugInfo => ({
            type: String(key),
            id,
            exists: existsMethod(),
            path: nodePath,
            value: getValue(),
        });

        const node = new Proxy({}, {
            get(_, prop: string | symbol) {
                if (typeof prop === 'symbol') return undefined;
                if (prop === "value") return getValue;
                if (prop === "valueOrThrow") return valueOrThrowMethod;
                if (prop === "exists") return existsMethod;
                if (prop === "path") return pathMethod;
                if (prop === "info") return infoMethod;
                if (prop === "delete") return deleteMethod;
                if (prop === "deleteCascade") return deleteCascadeMethod;
                if (prop === "update") return updateNodeMethod;

                return (...args: any[]) => {
                    const edge = (edges as any)[key]?.[prop];

                    if (id === null) {
                        if (edge) return createNode(prop as keyof EM, null, nodePath);
                        if (prop.endsWith("Nodes")) return toNodeList([], prop.slice(0, -"Nodes".length));
                        throw new Error(
                            `[entity-walker] Relation '${prop}' called on a null '${String(key)}' node (traversal led to a missing entity).`
                        );
                    }

                    if (edge) {
                        const entity = getValue();
                        const targetType = prop as keyof EM;
                        if (!entity) return createNode(targetType, null, nodePath);
                        const nextId = edge.resolve(entity);
                        if (!nextId) return createNode(targetType, null, nodePath);
                        const targetExists = !!byId[targetType as string]?.[nextId];
                        if (!targetExists) return createNode(targetType, null, nodePath);
                        return createNode(targetType, nextId, nodePath);
                    }

                    if (prop.endsWith("Nodes")) {
                        const sourceKey = prop.slice(0, -"Nodes".length);
                        if (sourceKey) {
                            if (getValue() === undefined) return toNodeList([], sourceKey);
                            const pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                            return toNodeList(pointingIds.map(pid => createNode(sourceKey as keyof EM, pid, nodePath)), sourceKey);
                        }
                    }

                    throw new Error(
                        `[entity-walker] No relation '${prop}' on entity type '${String(key)}'. Available: ${availableRelations().join(', ') || 'none'}`
                    );
                };
            },
        });

        if (cacheKey) nodeCache.set(cacheKey, node);
        return node;
    }

    _createNode = createNode;

    return { createNode, toNodeList, graphSchema, graphInfo, entities: core.entities, byId: core.byId, reverseIndex: core.reverseIndex, nodeCache: core.nodeCache };
}

export const createGraph = <EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraph<GraphDef<EM, E>> => {
    const { createNode, toNodeList, graphSchema, graphInfo, entities, byId, reverseIndex, nodeCache } = buildGraphCore<EM, E>(config.entities, config.edges);

    function insert<K extends keyof EM>(type: K, entityOrEntities: EM[K] | EM[K][]): void {
        const items = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
        const key = String(type);
        const ents = entities as Record<string, any[]>;
        for (const entity of items) {
            ents[key] = ents[key] ?? [];
            ents[key].push(entity);
            byId[key] = byId[key] ?? {};
            byId[key][entity.id.toString()] = entity;
            nodeCache.delete(`${key}:${entity.id.toString()}`);
            const entityEdges = (config.edges as any)[key];
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const targetId = edge.resolve(entity);
                    if (!targetId) continue;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][key]) reverseIndex[targetType][key] = {};
                    if (!reverseIndex[targetType][key][targetId]) reverseIndex[targetType][key][targetId] = [];
                    reverseIndex[targetType][key][targetId].push(entity.id.toString());
                }
            }
        }
    }

    function update<K extends keyof EM>(type: K, entityOrEntities: EM[K] | EM[K][]): void {
        const items = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
        const key = String(type);
        const ents = entities as Record<string, any[]>;
        const entityEdges = (config.edges as any)[key];
        for (const entity of items) {
            const existing = byId[key]?.[entity.id.toString()];
            if (!existing) {
                insert(type, entity);
                continue;
            }
            // remove old bidirectional reverse index entries
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const oldTargetId = edge.resolve(existing);
                    if (!oldTargetId) continue;
                    const bucket = reverseIndex[targetType]?.[key]?.[oldTargetId];
                    if (bucket) {
                        const idx = bucket.indexOf(entity.id.toString());
                        if (idx !== -1) bucket.splice(idx, 1);
                    }
                }
            }
            // replace in byId and entities array
            byId[key][entity.id.toString()] = entity;
            const arrIdx = ents[key].findIndex((e: any) => e.id.toString() === entity.id.toString());
            if (arrIdx !== -1) ents[key][arrIdx] = entity;
            nodeCache.delete(`${key}:${entity.id.toString()}`);
            // add new bidirectional reverse index entries
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const newTargetId = edge.resolve(entity);
                    if (!newTargetId) continue;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][key]) reverseIndex[targetType][key] = {};
                    if (!reverseIndex[targetType][key][newTargetId]) reverseIndex[targetType][key][newTargetId] = [];
                    reverseIndex[targetType][key][newTargetId].push(entity.id.toString());
                }
            }
        }
    }

    return new Proxy({}, {
        get(_, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined;
            if (prop === "info") return graphInfo;
            if (prop === "schema") return graphSchema;
            if (prop.startsWith("update") && prop.length > 6) {
                const rawKey = prop[6].toLowerCase() + prop.slice(7);
                return (entityOrEntities: any) => update(rawKey as keyof EM, entityOrEntities);
            }
            if (prop.endsWith("Nodes")) {
                const entityKey = prop.slice(0, -"Nodes".length);
                return () => {
                    const all = entities[entityKey] || [];
                    return toNodeList(all.map((item: any) => createNode(entityKey as keyof EM, item.id.toString())), entityKey);
                };
            }
            return (id: string | number) => createNode(prop as keyof EM, id.toString());
        },
    }) as any;
};

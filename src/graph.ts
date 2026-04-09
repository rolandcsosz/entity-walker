import { EntityGraph, EntityMap, GraphDef, GraphDebugInfo, GraphEdges, GraphSchema, MissingEntityRef, NodeDebugInfo } from "./types";

export const createEntityGraph = <EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraph<GraphDef<EM, E>> => {
    const { entities, edges } = config;
    const byId: Record<string, Record<string, any>> = {};

    const reverseIndex: Record<
        string,
        Record<string, Record<string, string[]>>
    > = {};

    for (const key in entities) {
        byId[key] = {};
        if (!reverseIndex[key]) reverseIndex[key] = {};

        for (const item of entities[key]!) {
            byId[key][item.id] = item;
        }
    }

    for (const sourceType in edges) {
        const entityEdges = (edges as any)[sourceType];
        if (!entityEdges) continue;

        for (const targetType in entityEdges) {
            const edge = entityEdges[targetType];
            if (!edge.bidirectional) continue;

            if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
            if (!reverseIndex[targetType][sourceType]) reverseIndex[targetType][sourceType] = {};

            for (const sourceEntity of entities[sourceType]!) {
                const targetId = edge.resolve(sourceEntity);
                if (!targetId) continue;

                if (!reverseIndex[targetType][sourceType][targetId]) {
                    reverseIndex[targetType][sourceType][targetId] = [];
                }
                reverseIndex[targetType][sourceType][targetId].push(sourceEntity.id);
            }
        }
    }

    const resolveEntities = (nodes: any[]): any[] => {
        const result: any[] = [];
        for (const n of nodes) {
            const e = n.value();
            if (e !== undefined) result.push(e);
        }
        return result;
    }

    const toNodeList = (nodes: any[], nodeKey: string): any => {
        const list = [...nodes] as any;
        Object.defineProperty(list, 'entities', {
            value: () => resolveEntities(nodes),
            enumerable: false,
        });

        Object.defineProperty(list, 'select', {
            value: (fn: (entity: any) => any) => {
                const result: any[] = [];
                for (const n of nodes) {
                    const e = n.value();
                    if (e !== undefined) result.push(fn(e));
                }
                return result;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'ids', {
            value: () => {
                const result: string[] = [];
                for (const n of nodes) {
                    const e = n.value();
                    if (e !== undefined) result.push(e.id);
                }
                return result;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'first', {
            value: () => {
                for (const n of nodes) {
                    const e = n.value();
                    if (e !== undefined) return e;
                }
                return undefined;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'findEntity', {
            value: (predicate: (entity: any) => boolean) => {
                for (const n of nodes) {
                    const e = n.value();
                    if (e !== undefined && predicate(e)) return e;
                }
                return undefined;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'isEmpty', {
            value: () => {
                for (const n of nodes) {
                    if (n.value() !== undefined) return false;
                }
                return true;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'isNotEmpty', {
            value: () => {
                for (const n of nodes) {
                    if (n.value() !== undefined) return true;
                }
                return false;
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'unique', {
            value: () => {
                const seen = new Set<string>();
                const uniqueNodes: any[] = [];
                for (const n of nodes) {
                    const e = n.value();
                    if (e !== undefined && !seen.has(e.id)) {
                        seen.add(e.id);
                        uniqueNodes.push(createNode(nodeKey as keyof EM, e.id));
                    }
                }
                return toNodeList(uniqueNodes, nodeKey);
            },
            enumerable: false,
        });

        Object.defineProperty(list, 'where', {
            value: (where?: (entity: any) => boolean) => {
                if (!where) return list;
                const filtered = nodes.filter((n: any) => {
                    const e = n.value();
                    return e !== undefined && where(e);
                });
                return toNodeList(filtered, nodeKey);
            },
            enumerable: false,
        });

        const reverseEntries = reverseIndex[nodeKey] || {};
        for (const sourceKey in reverseEntries) {
            const refName = `${sourceKey}Nodes`;
            Object.defineProperty(list, refName, {
                value: (where?: (entity: any) => boolean) => {
                    const result: any[] = [];
                    for (const node of nodes) {
                        const refs = node[refName]();
                        for (const r of refs) result.push(r);
                    }
                    const filtered = where
                        ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                        : result;
                    return toNodeList(filtered, sourceKey);
                },
                enumerable: false,
            });
        }

        const forwardEdges = (edges as any)[nodeKey] || {};
        for (const rel in forwardEdges) {
            const refName = `${rel}Nodes`;
            if (list[refName] !== undefined) continue;
            Object.defineProperty(list, refName, {
                value: (where?: (entity: any) => boolean) => {
                    const result: any[] = [];
                    for (const node of nodes) {
                        result.push(node[rel]());
                    }
                    const filtered = where
                        ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                        : result;
                    return toNodeList(filtered, rel);
                },
                enumerable: false,
            });
        }

        return list;
    }

    const nodeCache = new Map<string, any>();

    const buildEdgeSummary = (): GraphSchema['edges'] => {
        const result: GraphSchema['edges'] = [];
        for (const sourceType in edges) {
            const entityEdges = (edges as any)[sourceType];
            if (!entityEdges) continue;
            for (const targetType in entityEdges) {
                result.push({ from: sourceType, to: targetType, bidirectional: !!entityEdges[targetType].bidirectional });
            }
        }
        return result;
    };

    const graphSchema = (): GraphSchema => ({
        entities: Object.keys(byId),
        edges: buildEdgeSummary(),
    });

    const graphInfo = (): GraphDebugInfo => {
        const missingEntities: { type: string; id: string }[] = [];
        for (const sourceType in edges) {
            const entityEdges = (edges as any)[sourceType];
            if (!entityEdges) continue;
            for (const targetType in entityEdges) {
                const edge = entityEdges[targetType];
                for (const sourceEntity of entities[sourceType] ?? []) {
                    const targetId = edge.resolve(sourceEntity);
                    if (targetId && !byId[targetType]?.[targetId]) {
                        missingEntities.push({ type: targetType, id: targetId });
                    }
                }
            }
        }

        const referencedIds: Record<string, Set<string>> = {};
        for (const sourceType in edges) {
            const entityEdges = (edges as any)[sourceType];
            if (!entityEdges) continue;
            for (const targetType in entityEdges) {
                const edge = entityEdges[targetType];
                if (!referencedIds[targetType]) referencedIds[targetType] = new Set();
                for (const sourceEntity of entities[sourceType] ?? []) {
                    const targetId = edge.resolve(sourceEntity);
                    if (targetId) referencedIds[targetType].add(targetId);
                }
            }
        }
        const orphanEntities: Record<string, string[]> = {};
        for (const type in referencedIds) {
            const refs = referencedIds[type];
            const orphans = Object.keys(byId[type] ?? {}).filter(id => !refs.has(id));
            if (orphans.length > 0) orphanEntities[type] = orphans;
        }

        return {
            entityCounts: Object.fromEntries(Object.keys(byId).map(k => [k, Object.keys(byId[k]).length])),
            cache: { nodeCount: nodeCache.size },
            missingEntities,
            orphanEntities,
        };
    };

    function createNode(key: keyof EM, id: string | null, path: string[] = []): any {
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
        const infoMethod = (): NodeDebugInfo => ({
            type: String(key),
            id,
            exists: existsMethod(),
            path: nodePath,
            value: getValue(),
        });

        const node = new Proxy({}, {
            get(_, prop: string) {
                if (prop === "value") return getValue;
                if (prop === "valueOrThrow") return valueOrThrowMethod;
                if (prop === "exists") return existsMethod;
                if (prop === "path") return pathMethod;
                if (prop === "info") return infoMethod;

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
                            let pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                            const where = args[0] as ((entity: any) => boolean) | undefined;
                            if (where) {
                                pointingIds = pointingIds.filter(pid => {
                                    const e = byId[sourceKey]?.[pid];
                                    return e !== undefined && where(e);
                                });
                            }
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

    return new Proxy({}, {
        get(_, prop: string) {
            if (prop === "info") return graphInfo
            if (prop === "schema") return graphSchema;
            if (prop.endsWith("Nodes")) {
                const entityKey = prop.slice(0, -"Nodes".length);
                return (where?: (entity: any) => boolean) => {
                    const all = entities[entityKey] || [];
                    const filtered = where ? all.filter(where) : all;
                    return toNodeList(filtered.map(item => createNode(entityKey as keyof EM, item.id)), entityKey);
                };
            }
            return (id: string) => createNode(prop as keyof EM, id);
        },
    }) as any;
}

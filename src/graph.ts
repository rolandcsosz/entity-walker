import { buildCore } from "./core";
import { EntityGraph, EntityMap, GraphDef, GraphEdges, NodeDebugInfo } from "./types";

export function buildGraphCore<EM extends EntityMap, E extends GraphEdges<EM>>(
    entities: { [K in keyof EM]: EM[K][] },
    edges: E,
) {
    let _createNode: (key: keyof EM, id: string | null, path?: string[]) => any;

    const core = buildCore<EM, E>(entities, edges, () => _createNode);
    const { byId, reverseIndex, nodeCache, toNodeList, graphSchema, graphInfo } = core;

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
            get(_, prop: string | symbol) {
                if (typeof prop === 'symbol') return undefined;
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

    _createNode = createNode;

    return { createNode, toNodeList, graphSchema, graphInfo, entities: core.entities };
}

export const createGraph = <EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraph<GraphDef<EM, E>> => {
    const { createNode, toNodeList, graphSchema, graphInfo, entities } = buildGraphCore<EM, E>(config.entities, config.edges);

    return new Proxy({}, {
        get(_, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined;
            if (prop === "info") return graphInfo;
            if (prop === "schema") return graphSchema;
            if (prop.endsWith("Nodes")) {
                const entityKey = prop.slice(0, -"Nodes".length);
                return (where?: (entity: any) => boolean) => {
                    const all = entities[entityKey] || [];
                    const filtered = where ? all.filter(where) : all;
                    return toNodeList(filtered.map((item: any) => createNode(entityKey as keyof EM, item.id)), entityKey);
                };
            }
            return (id: string) => createNode(prop as keyof EM, id);
        },
    }) as any;
};

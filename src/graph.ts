import { EntityGraph, EntityMap, GraphDef, GraphEdges } from "./types";

function toNodeList(nodes: any[]): any {
    const list = [...nodes] as any;
    Object.defineProperty(list, 'getAll', {
        value: () => nodes.map(n => n.get()).filter((v: any) => v !== undefined),
        enumerable: false,
    });
    return list;
}

export function createEntityGraph<EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraph<GraphDef<EM, E>> {
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

    function createNode(key: keyof EM, id: string | null): any {
        return new Proxy({}, {
            get(_, prop: string) {
                if (prop === "get") {
                    return () => {
                        if (id === null) return undefined;
                        const entity = byId[key as string]?.[id];
                        if (!entity) return undefined;
                        return Object.freeze(entity) as Readonly<EM[typeof key]>;
                    };
                }
                if (prop === "getOrThrow") {
                    return () => {
                        if (id === null) throw new Error(`Entity ${String(key)} not found`);
                        const entity = byId[key as string]?.[id];
                        if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                        return Object.freeze(entity) as Readonly<EM[typeof key]>;
                    };
                }

                return () => {
                    const edge = (edges as any)[key]?.[prop];

                    if (id === null) {
                        if (edge) return createNode(prop as keyof EM, null);
                        if (prop.endsWith("References")) return toNodeList([]);
                        throw new Error(`No relation '${prop}'`);
                    }

                    if (edge) {
                        const entity = byId[key as string]?.[id];
                        const targetType = prop as keyof EM;

                        if (!entity) return createNode(targetType, null);

                        const nextId = edge.resolve(entity);
                        if (!nextId) return createNode(targetType, null);

                        const targetExists = !!byId[targetType as string]?.[nextId];
                        if (!targetExists) return createNode(targetType, null);

                        return createNode(targetType, nextId);
                    }

                    if (prop.endsWith("References")) {
                        const sourceKey = prop.slice(0, -"References".length);
                        if (sourceKey) {
                            if (!byId[key as string]?.[id]) return toNodeList([]);
                            const pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                            return toNodeList(pointingIds.map(pid => createNode(sourceKey as keyof EM, pid)));
                        }
                    }

                    throw new Error(`No relation '${prop}'`);
                };
            },
        });
    }

    return new Proxy({}, {
        get(_, prop: string) {
            if (prop.endsWith("References")) {
                const entityKey = prop.slice(0, -"References".length);
                return (where?: (entity: any) => boolean) => {
                    const all = entities[entityKey] || [];
                    const filtered = where ? all.filter(where) : all;
                    return toNodeList(filtered.map(item => createNode(entityKey as keyof EM, item.id)));
                };
            }
            return (id: string) => createNode(prop as keyof EM, id);
        },
    }) as any;
}

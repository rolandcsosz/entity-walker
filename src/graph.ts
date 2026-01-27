import { EntityGraph, EntityMap, GraphDef, GraphEdges } from "./types";

export function createEntityGraph<EM extends EntityMap>() {
    return {
        create: <E extends GraphEdges<EM>>(config: {
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

            for (const sourceKey in edges) {
                const entityEdges = (edges as any)[sourceKey];
                if (!entityEdges) continue;

                for (const relName in entityEdges) {
                    const edge = entityEdges[relName];
                    if (!edge.bidirectional) continue;

                    const targetType = edge.to as string;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][sourceKey]) {
                        reverseIndex[targetType][sourceKey] = {};
                    }

                    for (const sourceItem of entities[sourceKey]!) {
                        const targetId = edge.resolve(sourceItem);
                        if (targetId) {
                            if (!reverseIndex[targetType][sourceKey][targetId]) {
                                reverseIndex[targetType][sourceKey][targetId] = [];
                            }
                            reverseIndex[targetType][sourceKey][targetId].push(sourceItem.id);
                        }
                    }
                }
            }

            function getEntity(key: keyof EM, id: string) {
                const entity = byId[key as string]?.[id];
                if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                return entity;
            }

            function createNode(key: keyof EM, id: string | null): any {
                return new Proxy(
                    {},
                    {
                        get(_, prop: string) {

                            if (prop === "exists") {
                                return () => {
                                    if (id === null) return false;
                                    return !!byId[key as string]?.[id];
                                };
                            }

                            if (prop === "get") {
                                return () => {
                                    if (id === null) return undefined;
                                    return getEntity(key, id);
                                };
                            }

                            return () => {
                                if (id === null) {
                                    const edge = (edges as any)[key]?.[prop];
                                    if (edge) return createNode(edge.to, null);
                                    if (prop.endsWith("References")) return [];
                                    throw new Error(`No relation '${prop}'`);
                                }

                                const edge = (edges as any)[key]?.[prop];
                                if (edge) {
                                    const entity = getEntity(key, id);
                                    const nextId = edge.resolve(entity);

                                    if (!nextId) {
                                        if (edge.optional) return createNode(edge.to, null);
                                        throw new Error(`FK resolution failed for '${prop}'`);
                                    }

                                    const targetExists = !!byId[edge.to as string]?.[nextId];
                                    if (!targetExists) {
                                        if (edge.optional) return createNode(edge.to, null);
                                    }

                                    return createNode(edge.to, nextId);
                                }

                                if (prop.endsWith("References")) {
                                    const sourceKey = prop.slice(0, -"References".length);

                                    if (sourceKey) {
                                        const pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                                        return pointingIds.map(pid => createNode(sourceKey as keyof EM, pid));
                                    }
                                }

                                throw new Error(`No relation '${prop}'`);
                            };
                        },
                    }
                );
            }

            return new Proxy(
                {},
                {
                    get(_, prop: string) {
                        return (id: string) => createNode(prop as keyof EM, id);
                    },
                }
            ) as any;
        },
    };
}

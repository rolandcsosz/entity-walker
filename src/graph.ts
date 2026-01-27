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

            for (const sourceType in edges) {
                const entityEdges = (edges as any)[sourceType];
                if (!entityEdges) continue;

                for (const relName in entityEdges) {
                    const edge = entityEdges[relName];
                    if (!edge.bidirectional) continue;

                    const targetType = edge.to as string;
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

            function getEntity(key: keyof EM, id: string) {
                const entity = byId[key as string]?.[id];
                if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                return Object.freeze(entity) as Readonly<EM[typeof key]>;
            }

            function createNode(key: keyof EM, id: string | null, isOptional: boolean = false): any {
                return new Proxy(
                    {},
                    {
                        get(_, prop: string) {
                            if (prop === "get") {
                                return () => {
                                    if (id === null) {
                                        if (isOptional) return undefined;
                                        throw new Error(`Entity ${String(key)} not found`);
                                    }
                                    return getEntity(key, id);
                                };
                            }

                            if (prop === "tryGet") {
                                return () => {
                                    if (id === null) return undefined;
                                    return byId[key as string]?.[id];
                                };
                            }

                            if (prop === "exists") {
                                return () => {
                                    if (id === null) return false;
                                    return !!byId[key as string]?.[id];
                                };
                            }

                            return () => {
                                if (id === null) {
                                    const edge = (edges as any)[key]?.[prop];
                                    if (edge) return createNode(edge.to, null, false);
                                    if (prop.endsWith("References")) return [];
                                    throw new Error(`No relation '${prop}'`);
                                }

                                const edge = (edges as any)[key]?.[prop];
                                if (edge) {
                                    const entity = byId[key as string]?.[id];

                                    if (!entity) {
                                        return createNode(edge.to, null, false);
                                    }

                                    const nextId = edge.resolve(entity);

                                    if (!nextId) {
                                        if (edge.optional) return createNode(edge.to, null, true);
                                        throw new Error(`FK resolution failed for '${prop}'`);
                                    }

                                    const targetExists = !!byId[edge.to as string]?.[nextId];
                                    if (!targetExists) {
                                        if (edge.optional) return createNode(edge.to, null, true);
                                        return createNode(edge.to, nextId, false);
                                    }

                                    return createNode(edge.to, nextId, false);
                                }

                                if (prop.endsWith("References")) {
                                    const sourceKey = prop.slice(0, -"References".length);
                                    if (sourceKey) {
                                        if (!byId[key as string]?.[id]) return [];
                                        const pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                                        return pointingIds.map(pid => createNode(sourceKey as keyof EM, pid, false));
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

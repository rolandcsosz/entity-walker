import { EntityGraph, EntityMap, GraphDef, GraphEdges } from "./types";

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

    function toNodeList(nodes: any[], nodeKey: string): any {
        const list = [...nodes] as any;
        Object.defineProperty(list, 'entities', {
            value: () => nodes.map(n => n.value()).filter((v: any) => v !== undefined),
            enumerable: false,
        });

        Object.defineProperty(list, 'select', {
            value: (fn: (entity: any) => any) =>
                nodes.map(n => n.value()).filter((v: any) => v !== undefined).map(fn),
            enumerable: false,
        });

        Object.defineProperty(list, 'ids', {
            value: () =>
                nodes.map(n => n.value()).filter((v: any) => v !== undefined).map((v: any) => v.id),
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
            value: () => nodes.every((n: any) => n.value() === undefined),
            enumerable: false,
        });

        Object.defineProperty(list, 'isNotEmpty', {
            value: () => nodes.some((n: any) => n.value() !== undefined),
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
            if (list[refName] !== undefined) continue; // reverse already registered
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

    function createNode(key: keyof EM, id: string | null): any {
        return new Proxy({}, {
            get(_, prop: string) {
                if (prop === "value") {
                    return () => {
                        if (id === null) return undefined;
                        const entity = byId[key as string]?.[id];
                        if (!entity) return undefined;
                        return Object.freeze(entity) as Readonly<EM[typeof key]>;
                    };
                }
                if (prop === "valueOrThrow") {
                    return () => {
                        if (id === null) throw new Error(`Entity ${String(key)} not found`);
                        const entity = byId[key as string]?.[id];
                        if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                        return Object.freeze(entity) as Readonly<EM[typeof key]>;
                    };
                }
                if (prop === "exists") {
                    return () => {
                        if (id === null) return false;
                        return !!byId[key as string]?.[id];
                    };
                }

                return (...args: any[]) => {
                    const edge = (edges as any)[key]?.[prop];

                    if (id === null) {
                        if (edge) return createNode(prop as keyof EM, null);
                        if (prop.endsWith("Nodes")) return toNodeList([], prop.slice(0, -"Nodes".length));
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

                    if (prop.endsWith("Nodes")) {
                        const sourceKey = prop.slice(0, -"Nodes".length);
                        if (sourceKey) {
                            if (!byId[key as string]?.[id]) return toNodeList([], sourceKey);
                            let pointingIds = reverseIndex[key as string]?.[sourceKey]?.[id] || [];
                            const where = args[0] as ((entity: any) => boolean) | undefined;
                            if (where) {
                                pointingIds = pointingIds.filter(pid => {
                                    const e = byId[sourceKey]?.[pid];
                                    return e !== undefined && where(e);
                                });
                            }
                            return toNodeList(pointingIds.map(pid => createNode(sourceKey as keyof EM, pid)), sourceKey);
                        }
                    }

                    throw new Error(`No relation '${prop}'`);
                };
            },
        });
    }

    return new Proxy({}, {
        get(_, prop: string) {
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

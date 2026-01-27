import { EntityGraph, EntityMap, GraphDef, GraphEdges } from "./types";

export function createEntityGraph<EM extends EntityMap>() {
    return {
        create: <E extends GraphEdges<EM>>(config: {
            entities: { [K in keyof EM]: EM[K][] };
            edges: E;
        }): EntityGraph<GraphDef<EM, E>> => {
            const { entities, edges } = config;

            const byId: Record<string, Record<string, any>> = {};
            for (const key in entities) {
                byId[key] = {};
                for (const item of entities[key]!) {
                    byId[key][item.id] = item;
                }
            }

            function getEntity(key: keyof EM, id: string) {
                const entity = byId[key as string]?.[id];
                if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                return entity;
            }

            function createNode(key: keyof EM, id: string): any {
                return new Proxy(
                    {},
                    {
                        get(_, prop: string) {
                            if (prop === "get") return () => getEntity(key, id);
                            return () => {
                                const entity = getEntity(key, id);
                                const edge = (edges as any)[key]?.[prop];
                                if (!edge) throw new Error(`No relation '${prop}'`);
                                const nextId = edge.resolve(entity);
                                if (!nextId) throw new Error(`FK resolution failed`);
                                return createNode(edge.to, nextId);
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

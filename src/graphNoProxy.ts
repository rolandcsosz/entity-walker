import { buildCore, NODE_PROP } from "./core";
import { EntityGraphNoProxy, EntityMap, GraphDef, GraphEdges, NodeDebugInfo } from "./types";

export const createNonProxyGraph = <EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraphNoProxy<GraphDef<EM, E>> => {
    let _createNode: (key: keyof EM, id: string | null, path?: string[]) => any;

    function addToList(list: any, _nodeKey: string): void {
        Object.defineProperty(list, 'to', {
            value: (rel: string, where?: any) => {
                if (!rel.endsWith("Nodes")) throw new Error(
                    `[entity-walker] EntityNodeListNoProxy.to() requires a 'Nodes' suffix (e.g. '${rel}Nodes')`
                );
                if (typeof list[rel] !== 'function') throw new Error(
                    `[entity-walker] No relation '${rel}' on this node list.`
                );
                return list[rel](where);
            },
            enumerable: false,
        });
    }

    const core = buildCore<EM, E>(config.entities, config.edges, () => _createNode, addToList);
    const { byId, reverseIndex, nodeCache, toNodeList, graphSchema, graphInfo, entities } = core;

    function createNode(key: keyof EM, id: string | null, path: string[] = []): any {
        const cacheKey = id !== null ? `${String(key)}:${id}` : null;
        if (cacheKey) {
            const cached = nodeCache.get(cacheKey);
            if (cached) return cached;
        }

        const nodePath = [...path, id !== null ? `${String(key)}(${id})` : `${String(key)}(null)`];

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

        // Internal traversal methods — hidden from users under NODE_PROP.
        const internal: Record<string, (...args: any[]) => any> = {};

        // Forward edge methods (e.g. subcategory())
        const entityEdges = (config.edges as any)[key] ?? {};
        for (const rel in entityEdges) {
            internal[rel] = () => {
                if (id === null) return createNode(rel as keyof EM, null, nodePath);
                const entity = getValue();
                if (!entity) return createNode(rel as keyof EM, null, nodePath);
                const nextId = entityEdges[rel].resolve(entity);
                if (!nextId) return createNode(rel as keyof EM, null, nodePath);
                if (!byId[rel as string]?.[nextId]) return createNode(rel as keyof EM, null, nodePath);
                return createNode(rel as keyof EM, nextId, nodePath);
            };
        }

        // Reverse edge methods (e.g. transactionNodes())
        const reverseEntries = reverseIndex[key as string] ?? {};
        for (const sourceKey in reverseEntries) {
            const refName = `${sourceKey}Nodes`;
            internal[refName] = (where?: (entity: any) => boolean) => {
                if (getValue() === undefined) return toNodeList([], sourceKey);
                let pointingIds: string[] = reverseIndex[key as string]?.[sourceKey]?.[id!] || [];
                if (where) {
                    pointingIds = pointingIds.filter((pid: string) => {
                        const e = byId[sourceKey]?.[pid];
                        return e !== undefined && where(e);
                    });
                }
                return toNodeList(
                    pointingIds.map((pid: string) => createNode(sourceKey as keyof EM, pid, nodePath)),
                    sourceKey,
                );
            };
        }

        const node: any = {
            value: getValue,
            valueOrThrow: () => {
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
            },
            exists: () => getValue() !== undefined,
            path: () => nodePath,
            info: (): NodeDebugInfo => ({
                type: String(key),
                id,
                exists: node.exists(),
                path: nodePath,
                value: getValue(),
            }),
            to: (rel: string, idOrWhere?: any) => {
                const fn = internal[rel];
                if (!fn) throw new Error(
                    `[entity-walker] No relation '${rel}' on entity type '${String(key)}'. Available: ${Object.keys(internal).join(', ') || 'none'}`
                );
                return rel.endsWith("Nodes") ? fn(idOrWhere) : fn();
            },
            [NODE_PROP]: internal,
        };

        if (cacheKey) nodeCache.set(cacheKey, node);
        return node;
    }

    _createNode = createNode;

    const to = (type: string, idOrWhere?: any): any => {
        if (type.endsWith("Nodes")) {
            const entityKey = type.slice(0, -"Nodes".length);
            const all = entities[entityKey] || [];
            const filtered = typeof idOrWhere === "function" ? all.filter(idOrWhere) : all;
            return toNodeList(
                filtered.map((item: any) => createNode(entityKey as keyof EM, item.id)),
                entityKey,
            );
        }
        return createNode(type as keyof EM, idOrWhere as string);
    };

    return { to, info: graphInfo, schema: graphSchema } as any;
};

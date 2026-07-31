import { buildCore, NODE_PROP } from "./core";
import { EntityGraphNoProxy, EntityMap, GraphDef, GraphEdges, NodeDebugInfo } from "./types";

export const createNonProxyGraph = <EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities: { [K in keyof EM]: EM[K][] };
    edges: E;
}): EntityGraphNoProxy<GraphDef<EM, E>> => {
    let _createNode: (key: keyof EM, id: string | number | null, path?: string[]) => any;

    function addToList(list: any, _nodeKey: string): void {
        Object.defineProperty(list, 'to', {
            value: (rel: string) => {
                if (!rel.endsWith("Nodes")) throw new Error(
                    `[entity-walker] EntityNodeListNoProxy.to() requires a 'Nodes' suffix (e.g. '${rel}Nodes')`
                );
                if (typeof list[rel] !== 'function') throw new Error(
                    `[entity-walker] No relation '${rel}' on this node list.`
                );
                return list[rel]();
            },
            enumerable: false,
        });
    }

    const core = buildCore<EM, E>(config.entities, config.edges, () => _createNode, addToList);
    const { byId, reverseIndex, nodeCache, toNodeList, graphSchema, graphInfo, ensureIndexes, markIndexesDirty, entities } = core;

    function warnMissingReferences(sourceTypes?: string[]): void {
        ensureIndexes();
        const ents = entities as Record<string, any[]>;
        const keys = sourceTypes ?? Object.keys(ents);
        const warned = new Set<string>();

        for (const sourceType of keys) {
            const sourceEdges = (config.edges as any)[sourceType];
            if (!sourceEdges) continue;
            const sourceEntities = ents[sourceType] ?? [];

            for (const sourceEntity of sourceEntities) {
                for (const targetType in sourceEdges) {
                    const targetId = sourceEdges[targetType].resolve(sourceEntity);
                    if (targetId == null) continue;
                    if (byId[targetType]?.[String(targetId)] !== undefined) continue;

                    const warningKey = `${sourceType}:${String(sourceEntity.id)}:${targetType}:${String(targetId)}`;
                    if (warned.has(warningKey)) continue;
                    warned.add(warningKey);

                    console.warn(
                        `[entity-walker] Missing reference '${sourceType}.${targetType}': entity '${sourceType}' with id '${sourceEntity.id}' points to missing '${targetType}' id '${targetId}'.`
                    );
                }
            }
        }
    }

    function insert<K extends keyof EM>(type: K, entityOrEntities: EM[K] | EM[K][], opts?: { suppressReferenceWarnings?: boolean }): void {
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
                    if (targetId == null) continue;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][key]) reverseIndex[targetType][key] = {};
                    if (!reverseIndex[targetType][key][targetId]) reverseIndex[targetType][key][targetId] = [];
                    reverseIndex[targetType][key][targetId].push(entity.id.toString());
                }
            }
        }

        if (!opts?.suppressReferenceWarnings) warnMissingReferences([key]);
    }

    function update<K extends keyof EM>(type: K, entityOrEntities: EM[K] | EM[K][], opts?: { suppressReferenceWarnings?: boolean }): void {
        ensureIndexes();
        const items = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
        const key = String(type);
        const ents = entities as Record<string, any[]>;
        const entityEdges = (config.edges as any)[key];
        for (const entity of items) {
            const existing = byId[key]?.[entity.id.toString()];
            if (!existing) {
                insert(type, entity, { suppressReferenceWarnings: true });
                continue;
            }
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const oldTargetId = edge.resolve(existing);
                    if (oldTargetId == null) continue;
                    const bucket = reverseIndex[targetType]?.[key]?.[oldTargetId];
                    if (bucket) {
                        const idx = bucket.indexOf(entity.id.toString());
                        if (idx !== -1) bucket.splice(idx, 1);
                    }
                }
            }
            byId[key][entity.id.toString()] = entity;
            const arrIdx = ents[key].findIndex((e: any) => e.id.toString() === entity.id.toString());
            if (arrIdx !== -1) ents[key][arrIdx] = entity;
            nodeCache.delete(`${key}:${entity.id.toString()}`);
            if (entityEdges) {
                for (const targetType in entityEdges) {
                    const edge = entityEdges[targetType];
                    if (!edge.bidirectional) continue;
                    const newTargetId = edge.resolve(entity);
                    if (newTargetId == null) continue;
                    if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                    if (!reverseIndex[targetType][key]) reverseIndex[targetType][key] = {};
                    if (!reverseIndex[targetType][key][newTargetId]) reverseIndex[targetType][key][newTargetId] = [];
                    reverseIndex[targetType][key][newTargetId].push(entity.id.toString());
                }
            }
        }

        if (!opts?.suppressReferenceWarnings) warnMissingReferences([key]);
    }

    function createNode(key: keyof EM, id: string | number | null, path: string[] = []): any {
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
            ensureIndexes();
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
                if (nextId == null) return createNode(rel as keyof EM, null, nodePath);
                if (!byId[rel as string]?.[nextId]) return createNode(rel as keyof EM, null, nodePath);
                return createNode(rel as keyof EM, nextId, nodePath);
            };
        }

        // Reverse edge methods (e.g. transactionNodes())
        const reverseSourceKeys: string[] = [];
        for (const sourceKey in config.edges) {
            const edge = (config.edges as any)[sourceKey]?.[key as string];
            if (edge?.bidirectional) reverseSourceKeys.push(sourceKey);
        }
        for (const sourceKey of reverseSourceKeys) {
            const refName = `${sourceKey}Nodes`;
            internal[refName] = () => {
                if (getValue() === undefined) return toNodeList([], sourceKey);
                const pointingIds: string[] = reverseIndex[key as string]?.[sourceKey]?.[id!] || [];
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
            delete: () => {
                ensureIndexes();
                if (id === null || !byId[key as string]?.[id]) return;
                const entity = byId[key as string][id];
                const ents = entities as Record<string, any[]>;
                const entityEdges = (config.edges as any)[key as string];
                if (entityEdges) {
                    for (const targetType in entityEdges) {
                        const edge = entityEdges[targetType];
                        if (!edge.bidirectional) continue;
                        const targetId = edge.resolve(entity);
                        if (targetId == null) continue;
                        const bucket = reverseIndex[targetType]?.[key as string]?.[targetId];
                        if (bucket) {
                            const idx = bucket.indexOf(String(id));
                            if (idx !== -1) bucket.splice(idx, 1);
                        }
                    }
                }
                for (const sourceType in reverseIndex[key as string] ?? {}) {
                    for (const targetId in reverseIndex[key as string][sourceType]) {
                        const bucket = reverseIndex[key as string][sourceType][targetId];
                        const idx = bucket.indexOf(String(id));
                        if (idx !== -1) bucket.splice(idx, 1);
                    }
                }
                delete byId[key as string][id.toString()];
                const arrIdx = ents[key as string]?.findIndex((e: any) => e.id.toString() === id.toString());
                if (arrIdx !== undefined && arrIdx !== -1) ents[key as string].splice(arrIdx, 1);
                nodeCache.delete(`${String(key)}:${id.toString()}`);
            },
            deleteCascade: () => {
                ensureIndexes();
                if (id === null || !byId[key as string]?.[id.toString()]) return;
                for (const sourceType in config.edges) {
                    const sourceEdges = (config.edges as any)[sourceType];
                    if (!sourceEdges) continue;
                    for (const targetType in sourceEdges) {
                        if (targetType !== String(key)) continue;
                        const edge = sourceEdges[targetType];
                        const sourceArr = (entities as Record<string, any[]>)[sourceType] ?? [];
                        const pointingIds = sourceArr.filter((e: any) => edge.resolve(e) === id).map((e: any) => e.id.toString());
                        for (const pid of pointingIds) {
                            createNode(sourceType as keyof EM, pid).deleteCascade();
                        }
                    }
                }
                node.delete();
            },
            update: (fn: (entity: any) => any) => {
                const entity = getValue();
                if (entity === undefined) return;
                const result = fn(entity);
                const { id: _ignoreId, ...resultFields } = result;
                const updated = { ...resultFields, id: entity.id };
                const ents = entities as Record<string, any[]>;
                const entityEdges = (config.edges as any)[key as string];
                if (entityEdges) {
                    for (const targetType in entityEdges) {
                        const edge = entityEdges[targetType];
                        if (!edge.bidirectional) continue;
                        const oldTargetId = edge.resolve(entity);
                        if (oldTargetId == null) continue;
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
                nodeCache.delete(`${String(key)}:${id!.toString()}`);
                if (entityEdges) {
                    for (const targetType in entityEdges) {
                        const edge = entityEdges[targetType];
                        if (!edge.bidirectional) continue;
                        const newTargetId = edge.resolve(updated);
                        if (newTargetId == null) continue;
                        if (!reverseIndex[targetType]) reverseIndex[targetType] = {};
                        if (!reverseIndex[targetType][key as string]) reverseIndex[targetType][key as string] = {};
                        if (!reverseIndex[targetType][key as string][newTargetId]) reverseIndex[targetType][key as string][newTargetId] = [];
                        reverseIndex[targetType][key as string][newTargetId].push(id!.toString());
                    }
                }
            },
            to: (rel: string) => {
                const fn = internal[rel];
                if (!fn) throw new Error(
                    `[entity-walker] No relation '${rel}' on entity type '${String(key)}'. Available: ${Object.keys(internal).join(', ') || 'none'}`
                );
                return fn();
            },
            [NODE_PROP]: internal,
        };

        if (cacheKey) nodeCache.set(cacheKey, node);
        return node;
    }

    _createNode = createNode;

    const to = (type: string, id?: any): any => {
        if (type.endsWith("Nodes")) {
            const entityKey = type.slice(0, -"Nodes".length);
            const all = entities[entityKey] || [];
            return toNodeList(
                all.map((item: any) => createNode(entityKey as keyof EM, item.id.toString())),
                entityKey,
            );
        }
        return createNode(type as keyof EM, id as string);
    };

    function snapshot(): Record<string, any[]> {
        const snap: Record<string, any[]> = {};
        for (const key in entities) snap[key] = (entities as Record<string, any[]>)[key].map((e: any) => ({ ...e }));
        return snap;
    }

    function restore(snap: Record<string, any[]>): void {
        const ents = entities as Record<string, any[]>;
        for (const key in ents) {
            ents[key] = (snap[key] ?? []).map((e: any) => ({ ...e }));
        }
        markIndexesDirty();
    }

    function sync(fresh: Record<string, any[]>, options?: { mode?: "merge" | "replace" }): void {
        ensureIndexes();
        const ents = entities as Record<string, any[]>;
        const mode = options?.mode ?? "replace";

        for (const key in fresh) {
            const freshList = fresh[key];
            if (!Array.isArray(freshList)) {
                throw new Error(`[entity-walker] sync('${key}') expects an array of entities.`);
            }
            for (let i = 0; i < freshList.length; i++) {
                const entity = freshList[i];
                if (!entity || typeof entity !== "object" || entity.id === undefined || entity.id === null) {
                    throw new Error(`[entity-walker] sync('${key}') entity at index ${i} is missing a valid 'id'.`);
                }
            }
        }

        for (const key in fresh) {
            const freshList: any[] = fresh[key] ?? [];
            ents[key] = ents[key] ?? [];

            if (mode === "replace") {
                const freshIds = new Set(freshList.map((e: any) => String(e.id)));
                for (const existing of [...ents[key]]) {
                    if (!freshIds.has(String(existing.id))) createNode(key as keyof EM, existing.id).delete();
                }
            }

            if (freshList.length > 0) {
                update(key as keyof EM, freshList, { suppressReferenceWarnings: true });
            }

            if (mode === "replace") {
                ents[key] = freshList
                    .map((entity: any) => byId[key]?.[String(entity.id)])
                    .filter((entity: any) => entity !== undefined);
            }
        }

        warnMissingReferences(Object.keys(fresh));
    }

    const graph: any = { to, info: graphInfo, schema: graphSchema, snapshot, restore, sync };
    for (const key in config.entities) {
        const capKey = key[0].toUpperCase() + key.slice(1);
        graph[`update${capKey}`] = (entityOrEntities: any) => update(key as keyof EM, entityOrEntities);
    }
    return graph as any;
};

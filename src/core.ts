import { EntityMap, EntityNodeList, GraphDebugInfo, GraphEdges, GraphSchema, GraphDef, EntityNode, EntityBase, EntityNodeNoProxy, EntityNodeListNoProxy, ListDebugInfo } from "./types";
export const NODE_PROP = Symbol('entity-walker:internal');

export interface CoreData<EM extends EntityMap> {
    toNodeList(nodes: any[], nodeKey: string): any;
    graphSchema(): GraphSchema;
    graphInfo(): GraphDebugInfo;
    ensureIndexes(): void;
    markIndexesDirty(): void;
    entities: { [K in keyof EM]: EM[K][] };
    nodeCache: Map<string, any>;
    byId: Record<string, Record<string, any>>;
    reverseIndex: Record<string, Record<string, Record<string, string[]>>>;
}

export function buildCore<EM extends EntityMap, E extends GraphEdges<EM>>(
    entities: { [K in keyof EM]: EM[K][] },
    edges: E,
    getCreateNode: () => (key: keyof EM, id: string | number | null, path?: string[]) => any,
    transformList?: (list: any, nodeKey: string) => void,
): CoreData<EM> {
    const byId: Record<string, Record<string, any>> = {};
    const reverseIndex: Record<string, Record<string, Record<string, string[]>>> = {};
    let indexesBuilt = false;

    function ensureIndexes() {
        if (indexesBuilt) return;

        for (const key in byId) delete byId[key];
        for (const key in reverseIndex) delete reverseIndex[key];

        for (const key in entities) {
            byId[key] = {};
            reverseIndex[key] = {};
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
                for (const sourceEntity of (entities[sourceType] ?? [])) {
                    const targetId = edge.resolve(sourceEntity);
                    if (targetId == null) continue;
                    if (!reverseIndex[targetType][sourceType][targetId]) {
                        reverseIndex[targetType][sourceType][targetId] = [];
                    }
                    reverseIndex[targetType][sourceType][targetId].push(String(sourceEntity.id));
                }
            }
        }

        indexesBuilt = true;
    }

    function markIndexesDirty() {
        indexesBuilt = false;
        nodeCache.clear();
    }

    const nodeCache = new Map<string, any>();

    function toNodeList(nodes: any[], nodeKey: string, scope?: Record<string, Set<string | number>> | null): any {
        const list = [...nodes] as any;
        const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });
        const traverse = (node: any, method: string, args: any[]) => {
            const obj = (node[NODE_PROP] as any) ?? node;
            return obj[method]?.(...args);
        };
        const listScope: Record<string, Set<string | number>> | null = scope
            ? Object.fromEntries(Object.entries(scope).map(([k, s]) => [k, new Set(s)]))
            : null;
        const inScope = (e: any) => !listScope || !listScope.hasOwnProperty(nodeKey) || listScope[nodeKey].has(e.id);

        def('entities', () => {
            const result: any[] = [];
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) result.push(e); }
            return result;
        });
        def('select', (fn: (entity: any) => any) => {
            const result: any[] = [];
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) result.push(fn(e)); }
            return result;
        });
        def('ids', () => {
            const result: (string | number)[] = [];
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) result.push(e.id); }
            return result;
        });
        def('first', () => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) return e; }
            return undefined;
        });
        def('findEntity', (predicate: (entity: any) => boolean) => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e) && predicate(e)) return e; }
            return undefined;
        });
        def('findNode', (predicate: (entity: any) => boolean) => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e) && predicate(e)) return n; }
            return undefined;
        });
        def('isEmpty', () => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) return false; }
            return true;
        });
        def('isNotEmpty', () => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && inScope(e)) return true; }
            return false;
        });
        def('unique', () => {
            const seen = new Set<string | number>();
            const uniqueNodes: any[] = [];
            for (const n of nodes) {
                const e = n.value();
                if (e !== undefined && !seen.has(e.id)) {
                    seen.add(e.id);
                    uniqueNodes.push(getCreateNode()(nodeKey as keyof EM, e.id));
                }
            }
            return toNodeList(uniqueNodes, nodeKey, listScope);
        });
        def('where', (where?: (entity: any) => boolean) => {
            if (!where) return list;
            const filtered = nodes.filter((n: any) => { const e = n.value(); return e !== undefined && where(e); });
            return toNodeList(filtered, nodeKey, listScope);
        });
        def('whereNode', (where?: (node: any) => boolean) => {
            if (!where) return list;
            const filtered = nodes.filter((n: any) => n.value() !== undefined && where(n));
            return toNodeList(filtered, nodeKey, listScope);
        });
        def('intersect', (other: any[]) => {
            const ids = new Set<string | number>();
            for (const item of other) {
                if (typeof item === 'string' || typeof item === 'number') {
                    ids.add(item);
                } else if (typeof item?.value === 'function') {
                    const e = item.value();
                    if (e !== undefined) ids.add(e.id);
                } else if (item?.id !== undefined) {
                    ids.add(item.id);
                }
            }
            const filtered = nodes.filter((n: any) => { const e = n.value(); return e !== undefined && ids.has(e.id); });
            return toNodeList(filtered, nodeKey, listScope);
        });
        def('with', (fn: (self: any) => any) => fn(list));
        def('resetScope', () => toNodeList(nodes, nodeKey, null));
        def('scoped', () => {
            const newScope: Record<string, Set<string | number>> = {};
            if (listScope) for (const k of Object.keys(listScope)) newScope[k] = new Set(listScope[k]);
            const ids = new Set<string | number>();
            for (const n of nodes) { const e = n.value(); if (e !== undefined) ids.add(e.id); }
            newScope[nodeKey] = ids;
            return toNodeList(nodes, nodeKey, newScope);
        });
        def('info', (): ListDebugInfo => ({
            type: nodeKey,
            length: nodes.length,
            scope: listScope
                ? Object.fromEntries(Object.entries(listScope).map(([k, s]) => [k, [...s].sort()]))
                : null,
        }));

        const reverseSourceKeys: string[] = [];
        for (const sourceKey in edges) {
            const edge = (edges as any)[sourceKey]?.[nodeKey];
            if (edge?.bidirectional) reverseSourceKeys.push(sourceKey);
        }
        for (const sourceKey of reverseSourceKeys) {
            const refName = `${sourceKey}Nodes`;
            def(refName, (where?: (entity: any) => boolean) => {
                const result: any[] = [];
                for (const node of nodes) {
                    const e = node.value();
                    if (e === undefined || !inScope(e)) continue;
                    const refs = traverse(node, refName, []);
                    if (refs) for (const r of refs) result.push(r);
                }
                const filtered = where
                    ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                    : result;
                return toNodeList(filtered, sourceKey, listScope);
            });
        }

        const forwardEdges = (edges as any)[nodeKey] || {};
        for (const rel in forwardEdges) {
            const refName = `${rel}Nodes`;
            if (list[refName] !== undefined) continue;
            def(refName, (where?: (entity: any) => boolean) => {
                const result: any[] = [];
                for (const node of nodes) {
                    const e = node.value();
                    if (e === undefined || !inScope(e)) continue;
                    result.push(traverse(node, rel, []));
                }
                const filtered = where
                    ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                    : result;
                return toNodeList(filtered, rel, listScope);
            });
        }

        transformList?.(list, nodeKey);
        return list;
    }

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
        entities: Object.keys(entities),
        edges: buildEdgeSummary(),
    });

    const graphInfo = (): GraphDebugInfo => {
        ensureIndexes();
        const missingEntities: { type: string; id: string }[] = [];
        for (const sourceType in edges) {
            const entityEdges = (edges as any)[sourceType];
            if (!entityEdges) continue;
            for (const targetType in entityEdges) {
                const edge = entityEdges[targetType];
                for (const sourceEntity of entities[sourceType] ?? []) {
                    const targetId = edge.resolve(sourceEntity);
                    if (targetId != null && !byId[targetType]?.[targetId]) {
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
                    if (targetId != null) referencedIds[targetType].add(targetId);
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

    return { toNodeList, graphSchema, graphInfo, ensureIndexes, markIndexesDirty, entities, nodeCache, byId, reverseIndex };
}

export function emptyNodeList<G extends GraphDef<any, any>, E extends EntityBase>(): EntityNodeList<G, E> {
    const list = [] as any;
    const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });
    const self = () => proxyList;

    def('entities', () => []);
    def('select', () => []);
    def('ids', () => []);
    def('first', () => undefined);
    def('findEntity', () => undefined);
    def('findNode', () => undefined);
    def('isEmpty', () => true);
    def('isNotEmpty', () => false);
    def('unique', self);
    def('where', self);
    def('whereNode', self);
    def('intersect', self);
    def('with', (fn: (self: any) => any) => fn(proxyList));
    def('scoped', self);
    def('resetScope', self);
    def('info', () => ({ type: 'unknown', length: 0, scope: null }));

    const proxyList = new Proxy(list, {
        get(target, prop: string | symbol) {
            if (typeof prop === 'symbol') return target[prop as keyof typeof target];
            if (prop in target) return target[prop as keyof typeof target];
            if (typeof prop === 'string' && prop.endsWith("Nodes")) return self;
            return undefined;
        }
    });

    return proxyList;
}

export function emptyNode<G extends GraphDef<any, any>, E extends EntityBase>(): EntityNode<G, E> {
    const nodeObj: any = {
        value: () => undefined,
        valueOrThrow: () => { throw new Error("Empty node has no value"); },
        exists: () => false,
        path: () => ["(empty)"],
        info: () => ({ type: "unknown", id: null, exists: false, path: [], value: undefined }),
        delete: () => { },
        deleteCascade: () => { },
        update: () => { }
    };

    const proxyNode = new Proxy(nodeObj, {
        get(target, prop: string | symbol) {
            if (typeof prop === 'symbol') return target[prop];
            if (prop in target) return target[prop as keyof typeof target];

            if (typeof prop === 'string' && prop.endsWith("Nodes")) return () => emptyNodeList();
            return () => proxyNode;
        }
    });

    return proxyNode;
}

export function emptyNodeListNoProxy<G extends GraphDef<any, any>, E extends EntityBase>(): EntityNodeListNoProxy<G, E> {
    const list: any = [];
    const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });
    const self = () => list;

    def('entities', () => []);
    def('select', () => []);
    def('ids', () => []);
    def('first', () => undefined);
    def('findEntity', () => undefined);
    def('findNode', () => undefined);
    def('isEmpty', () => true);
    def('isNotEmpty', () => false);
    def('unique', self);
    def('where', self);
    def('whereNode', self);
    def('intersect', self);
    def('with', (fn: (self: any) => any) => fn(list));
    def('scoped', self);
    def('resetScope', self);
    def('info', () => ({ type: 'unknown', length: 0, scope: null }));

    def('to', (rel: string) => {
        if (!rel.endsWith('Nodes')) throw new Error(
            `[entity-walker] EntityNodeListNoProxy.to() requires a 'Nodes' suffix (e.g. '${rel}Nodes')`
        );
        if (typeof (list as any)[rel] === 'function') return (list as any)[rel]();
        return list;
    });

    return list as any;
}

export function emptyNodeNoProxy<G extends GraphDef<any, any>, E extends EntityBase>(): EntityNodeNoProxy<G, E> {
    const nodeObj: any = {
        value: () => undefined,
        valueOrThrow: () => { throw new Error("Empty node has no value"); },
        exists: () => false,
        path: () => ["(empty)"],
        info: () => ({ type: "unknown", id: null, exists: false, path: [], value: undefined }),
        delete: () => { },
        deleteCascade: () => { },
        update: () => { }
    };

    nodeObj.to = (rel: string) => {
        if (typeof rel === 'string' && rel.endsWith('Nodes')) return emptyNodeListNoProxy();
        return nodeObj;
    };

    return nodeObj as any;
}

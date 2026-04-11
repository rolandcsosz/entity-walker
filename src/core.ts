import { EntityMap, GraphDebugInfo, GraphEdges, GraphSchema } from "./types";

export const NODE_PROP = Symbol('entity-walker:internal');

export interface CoreData<EM extends EntityMap> {
    toNodeList(nodes: any[], nodeKey: string): any;
    graphSchema(): GraphSchema;
    graphInfo(): GraphDebugInfo;
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
                reverseIndex[targetType][sourceType][targetId].push(String(sourceEntity.id));
            }
        }
    }

    const nodeCache = new Map<string, any>();

    const resolveEntities = (nodes: any[]): any[] => {
        const result: any[] = [];
        for (const n of nodes) {
            const e = n.value();
            if (e !== undefined) result.push(e);
        }
        return result;
    };

    function toNodeList(nodes: any[], nodeKey: string): any {
        const list = [...nodes] as any;
        const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });
        const traverse = (node: any, method: string, args: any[]) => {
            const obj = (node[NODE_PROP] as any) ?? node;
            return obj[method]?.(...args);
        };

        def('entities', () => resolveEntities(nodes));
        def('select', (fn: (entity: any) => any) => {
            const result: any[] = [];
            for (const n of nodes) { const e = n.value(); if (e !== undefined) result.push(fn(e)); }
            return result;
        });
        def('ids', () => {
            const result: (string | number)[] = [];
            for (const n of nodes) { const e = n.value(); if (e !== undefined) result.push(e.id); }
            return result;
        });
        def('first', () => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined) return e; }
            return undefined;
        });
        def('findEntity', (predicate: (entity: any) => boolean) => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && predicate(e)) return e; }
            return undefined;
        });
        def('findNode', (predicate: (entity: any) => boolean) => {
            for (const n of nodes) { const e = n.value(); if (e !== undefined && predicate(e)) return n; }
            return undefined;
        });
        def('isEmpty', () => {
            for (const n of nodes) { if (n.value() !== undefined) return false; }
            return true;
        });
        def('isNotEmpty', () => {
            for (const n of nodes) { if (n.value() !== undefined) return true; }
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
            return toNodeList(uniqueNodes, nodeKey);
        });
        def('where', (where?: (entity: any) => boolean) => {
            if (!where) return list;
            const filtered = nodes.filter((n: any) => { const e = n.value(); return e !== undefined && where(e); });
            return toNodeList(filtered, nodeKey);
        });

        const reverseEntries = reverseIndex[nodeKey] || {};
        for (const sourceKey in reverseEntries) {
            const refName = `${sourceKey}Nodes`;
            def(refName, (where?: (entity: any) => boolean) => {
                const result: any[] = [];
                for (const node of nodes) {
                    const refs = traverse(node, refName, []);
                    if (refs) for (const r of refs) result.push(r);
                }
                const filtered = where
                    ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                    : result;
                return toNodeList(filtered, sourceKey);
            });
        }

        const forwardEdges = (edges as any)[nodeKey] || {};
        for (const rel in forwardEdges) {
            const refName = `${rel}Nodes`;
            if (list[refName] !== undefined) continue;
            def(refName, (where?: (entity: any) => boolean) => {
                const result: any[] = [];
                for (const node of nodes) { result.push(traverse(node, rel, [])); }
                const filtered = where
                    ? result.filter(n => { const e = n.value(); return e !== undefined && where(e); })
                    : result;
                return toNodeList(filtered, rel);
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

    return { toNodeList, graphSchema, graphInfo, entities, nodeCache, byId, reverseIndex };
}

import { GraphDef, ApiGraph, ApiGraphOptions, ApiEntityNode, ApiEntityNodeList } from "./types";

export function createApiGraph<D extends GraphDef<any, any>>(
    baseGraph: any,
    options: ApiGraphOptions<D["entityModel"]>,
    queryCache: Map<string, { ids: (string | number)[]; fetchedAt: number }> = new Map()
): ApiGraph<D> {

    function wrapNode(type: string, id: any, activeGraph = baseGraph): any {
        const getBaseNode = () => activeGraph[type](id);

        const apiActions: Record<string, any> = {};
        const entityConfig = options[type];
        if (entityConfig?.actions) {
            for (const [actionName, actionFn] of Object.entries(entityConfig.actions)) {
                apiActions[actionName] = (...args: any[]) => {
                    const txGraph = activeGraph.beginTransaction();
                    const txNode = wrapNode(type, id, txGraph);
                    return actionFn(txNode, ...args)
                        .then((res: any) => {
                            txGraph.commit();
                            return res;
                        })
                        .catch((err: any) => {
                            txGraph.rollback();
                            throw err;
                        });
                };
            }
        }

        const node = {
            value: () => getBaseNode().value(),
            exists: () => getBaseNode().exists(),
            load: async () => {
                if (!entityConfig?.read) {
                    throw new Error(`[entity-walker] read handler is required to load node for '${type}'.`);
                }
                const response = await entityConfig.read(id);
                activeGraph.sync({ [type]: [response] }, { mode: "merge" });
            },
            delete: async () => {
                const txGraph = activeGraph.beginTransaction();
                try {
                    txGraph[type](id).delete();
                    let result: any = undefined;
                    if (entityConfig?.delete) {
                        result = await entityConfig.delete(id);
                    }
                    txGraph.commit();
                    return result;
                } catch (error) {
                    txGraph.rollback();
                    throw error;
                }
            },
            update: async (fn: (entity: any) => any) => {
                const txGraph = activeGraph.beginTransaction();
                try {
                    const txNode = txGraph[type](id);
                    if (!txNode.exists()) {
                        throw new Error(`[entity-walker] Node '${type}' with id '${id}' does not exist for update.`);
                    }
                    const current = txNode.value();
                    const updated = fn(current);
                    txNode.update(() => updated);

                    let result: any = undefined;
                    if (entityConfig?.update) {
                        const response = await entityConfig.update(updated);
                        result = response;
                        if (response && typeof response === "object" && "id" in response) {
                            txGraph.sync({ [type]: [response] }, { mode: "merge" });
                        }
                    }
                    txGraph.commit();
                    return result;
                } catch (error) {
                    txGraph.rollback();
                    throw error;
                }
            },
            graph: () => createApiGraph(activeGraph, options, queryCache),
            api: apiActions,
        };

        return new Proxy(node, {
            get(target, p) {
                if (p === "then" || p === "toJSON") {
                    return undefined;
                }
                if (p in target) {
                    return (target as any)[p];
                }
                const propStr = String(p);
                if (propStr.endsWith("Nodes")) {
                    const relType = propStr.slice(0, -5);
                    return () => {
                        const relList = getBaseNode()[propStr]();
                        return wrapList(relType, relList, activeGraph);
                    };
                }
                if (typeof getBaseNode()[propStr] === "function") {
                    return () => {
                        const relNode = getBaseNode()[propStr]();
                        const info = relNode.info();
                        return wrapNode(info.type || propStr, info.id, activeGraph);
                    };
                }
                return undefined;
            }
        }) as any;
    }

    function wrapList(type: string, baseList: any[], activeGraph = baseGraph): any {
        const wrappedItems = baseList.map((item: any) => {
            const info = item.info();
            return wrapNode(type, info.id, activeGraph);
        });

        const loadFn = async (opts?: { force?: boolean }) => {
            const cacheKey = type;
            if (!opts?.force && queryCache.has(cacheKey)) {
                const cached = queryCache.get(cacheKey)!;
                const allNodes = activeGraph[`${type}Nodes`]();
                const matchingNodes = allNodes.intersect(cached.ids);
                return wrapList(type, matchingNodes, activeGraph);
            }

            const entityConfig = options[type];
            if (!entityConfig?.list) {
                throw new Error(`[entity-walker] list handler is required to load node list for '${type}'.`);
            }

            const response = await entityConfig.list();
            if (!Array.isArray(response)) {
                throw new Error(`[entity-walker] Expected array response for list fetch on '${type}'.`);
            }

            activeGraph.sync({ [type]: response }, { mode: "merge" });

            const ids = response.map((e: any) => e.id);
            queryCache.set(cacheKey, { ids, fetchedAt: Date.now() });

            const allNodes = activeGraph[`${type}Nodes`]();
            const matchingNodes = allNodes.intersect(ids);
            return wrapList(type, matchingNodes, activeGraph);
        };

        const listMethods = {
            entities: () => baseList.map((item: any) => item.value()).filter((v: any) => v !== undefined),
            ids: () => baseList.map((item: any) => item.info().id).filter((id: any) => id !== null),
            isEmpty: () => baseList.length === 0,
            isNotEmpty: () => baseList.length > 0,
            load: loadFn,
        };

        const listProxy = new Proxy(wrappedItems, {
            get(target, p) {
                if (p === "then" || p === "toJSON") {
                    return undefined;
                }
                if (p in listMethods) {
                    return (listMethods as any)[p];
                }
                if (typeof (target as any)[p] !== "undefined") {
                    return (target as any)[p];
                }
                return undefined;
            }
        });

        return listProxy;
    }

    const rootActions: Record<string, any> = {};
    if (options.actions) {
        for (const [actionName, actionFn] of Object.entries(options.actions)) {
            rootActions[actionName] = (...args: any[]) => {
                const apiGraphInstance = createApiGraph(baseGraph, options, queryCache);
                return actionFn(apiGraphInstance, ...args);
            };
        }
    }

    const apiGraph = {
        sync: (fresh: any, opt?: any) => baseGraph.sync(fresh, opt),
        snapshot: () => baseGraph.snapshot(),
        restore: (snap: any) => baseGraph.restore(snap),
        api: rootActions,
    };

    return new Proxy(apiGraph, {
        get(target, p) {
            if (p === "then" || p === "toJSON") {
                return undefined;
            }
            if (p in target) {
                return (target as any)[p];
            }
            const propStr = String(p);
            if (propStr.startsWith("create") && propStr !== "create") {
                const type = propStr[6].toLowerCase() + propStr.slice(7);
                return async (data: any) => {
                    const entityConfig = options[type];
                    if (!entityConfig?.create) {
                        throw new Error(`[entity-walker] create handler is required to create node of type '${type}'.`);
                    }
                    const response = await entityConfig.create(data);
                    baseGraph.sync({ [type]: [response] }, { mode: "merge" });
                    return wrapNode(type, response.id);
                };
            }
            if (propStr.startsWith("update") && propStr !== "update") {
                const type = propStr[6].toLowerCase() + propStr.slice(7);
                return async (data: any) => {
                    if (!data || typeof data !== "object" || !("id" in data)) {
                        throw new Error(`[entity-walker] update requires an entity object with an 'id'.`);
                    }
                    return wrapNode(type, data.id).update(() => data);
                };
            }
            if (propStr.endsWith("Nodes")) {
                const type = propStr.slice(0, -5);
                return () => {
                    const baseList = baseGraph[propStr]();
                    return wrapList(type, baseList);
                };
            }
            return (id: any) => wrapNode(propStr, id);
        }
    }) as any;
}

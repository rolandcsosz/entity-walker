import { GraphDef, ApiGraph, ApiGraphOptions, ApiError, PendingDelta } from "./types";

function generateUUID(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function extractStatusCode(res: any): number | undefined {
    if (!res) return undefined;
    if (typeof res.status === "number") return res.status;
    if (typeof res.statusCode === "number") return res.statusCode;
    if (typeof res.code === "number") return res.code;
    if (res.response && typeof res.response.status === "number") return res.response.status;
    if (res.error && typeof res.error.status === "number") return res.error.status;
    return undefined;
}

function extractErrorCode(res: any): string | number | undefined {
    const status = extractStatusCode(res);
    if (status !== undefined) return status;
    if (res.code !== undefined) return res.code;
    if (res.error && res.error.code !== undefined) return res.error.code;
    return undefined;
}

function isTransientStatusCode(status: number | undefined): boolean | undefined {
    if (status === undefined) return undefined;
    if (status === 0 || status === 408 || status === 429 || status >= 500) {
        return true;
    }
    if (status >= 400 && status < 500) {
        return false;
    }
    return undefined;
}

function isNetworkErrorMessage(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
        lower.includes("network") ||
        lower.includes("offline") ||
        lower.includes("fetch failed") ||
        lower.includes("failed to fetch") ||
        lower.includes("econnrefused") ||
        lower.includes("etimedout") ||
        lower.includes("connection error")
    );
}

function toApiError(res: any, customIsTransient?: (err: ApiError) => boolean): ApiError | null {
    if (!res) return null;

    let message: string | undefined;
    let code: string | number | undefined = extractErrorCode(res);
    let status: number | undefined = extractStatusCode(res);
    let explicitIsTransient: boolean | undefined = res.isTransient;

    if (typeof res === "object") {
        if ("message" in res && typeof res.message === "string") {
            message = res.message;
        } else if (res.error && typeof res.error === "object" && "message" in res.error) {
            message = res.error.message;
        } else if (res.error && typeof res.error === "string") {
            message = res.error;
        }
    }
    if (!message && res instanceof Error) {
        message = res.message;
        if ((res as any).code !== undefined) code = (res as any).code;
        if ((res as any).status !== undefined) status = (res as any).status;
        if ((res as any).isTransient !== undefined) explicitIsTransient = (res as any).isTransient;
    }

    if (!message) {
        return null;
    }

    let isTransient: boolean;
    if (typeof explicitIsTransient === "boolean") {
        isTransient = explicitIsTransient;
    } else if (status !== undefined) {
        const byStatus = isTransientStatusCode(status);
        isTransient = byStatus !== undefined ? byStatus : false;
    } else if (isNetworkErrorMessage(message)) {
        isTransient = true;
    } else if (typeof code === "string" && (code.includes("CONN") || code.includes("TIMEDOUT") || code.includes("NET"))) {
        isTransient = true;
    } else {
        isTransient = true;
    }

    const apiErr: ApiError = {
        message,
        code,
        status,
        isTransient,
        raw: res,
    };

    if (customIsTransient) {
        apiErr.isTransient = customIsTransient(apiErr);
    }

    return apiErr;
}

export function createApiGraph<D extends GraphDef<any, any>>(
    baseGraph: any,
    options: ApiGraphOptions<D["entityModel"]>,
    queryCache: Map<string, { ids: (string | number)[]; fetchedAt: number }> = new Map(),
    pendingDeltas: PendingDelta[] = []
): ApiGraph<D> {

    const parseError = (res: any) => toApiError(res, options.isTransientError);

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
                            const err = parseError(res);
                            if (err) {
                                txGraph.rollback();
                                return err;
                            }
                            txGraph.commit();
                            return res;
                        })
                        .catch((err: any) => {
                            txGraph.rollback();
                            return parseError(err) ?? { message: String(err), raw: err };
                        });
                };
            }
        }

        const node = {
            value: () => getBaseNode().value(),
            exists: () => getBaseNode().exists(),
            load: async () => {
                if (!entityConfig?.read) {
                    return { message: `[entity-walker] read handler is required to load node for '${type}'.` };
                }
                let response: any;
                try {
                    response = await entityConfig.read(id);
                } catch (err) {
                    return parseError(err) ?? { message: String(err), raw: err };
                }
                const error = parseError(response);
                if (error) {
                    return error;
                }
                activeGraph.sync({ [type]: [response] }, { mode: "merge" });
                return wrapNode(type, id, activeGraph);
            },
            delete: async () => {
                const txGraph = activeGraph.beginTransaction();
                txGraph[type](id).delete();

                let error: ApiError | null = null;
                let result: any = undefined;
                if (entityConfig?.delete) {
                    try {
                        result = await entityConfig.delete(id);
                        error = parseError(result);
                    } catch (err) {
                        error = parseError(err) ?? { message: String(err), raw: err };
                    }
                }

                if (error) {
                    if (error.isTransient === false) {
                        txGraph.rollback();
                        return error;
                    } else {
                        txGraph.commit();
                        const delta: PendingDelta = {
                            id: generateUUID(),
                            entityType: type,
                            op: "delete",
                            entityId: id,
                            timestamp: Date.now(),
                            error,
                        };
                        pendingDeltas.push(delta);
                        return error;
                    }
                } else {
                    txGraph.commit();
                    return result;
                }
            },
            update: async (fn: (entity: any) => any) => {
                const txGraph = activeGraph.beginTransaction();
                const txNode = txGraph[type](id);
                if (!txNode.exists()) {
                    return { message: `[entity-walker] Node '${type}' with id '${id}' does not exist for update.` };
                }
                const current = txNode.value();
                const updated = fn(current);
                txNode.update(() => updated);

                let error: ApiError | null = null;
                let result: any = undefined;
                if (entityConfig?.update) {
                    try {
                        const response = await entityConfig.update(updated);
                        result = response;
                        error = parseError(response);
                        if (!error && response && typeof response === "object" && "id" in response) {
                            txGraph.sync({ [type]: [response] }, { mode: "merge" });
                        }
                    } catch (err) {
                        error = parseError(err) ?? { message: String(err), raw: err };
                    }
                }

                if (error) {
                    if (error.isTransient === false) {
                        txGraph.rollback();
                        return error;
                    } else {
                        txGraph.commit();
                        const delta: PendingDelta = {
                            id: generateUUID(),
                            entityType: type,
                            op: "update",
                            entityId: id,
                            data: updated,
                            timestamp: Date.now(),
                            error,
                        };
                        pendingDeltas.push(delta);
                        return error;
                    }
                } else {
                    txGraph.commit();
                    return result;
                }
            },
            graph: () => createApiGraph(activeGraph, options, queryCache, pendingDeltas),
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
                return { message: `[entity-walker] list handler is required to load node list for '${type}'.` };
            }

            let response: any;
            try {
                response = await entityConfig.list();
            } catch (err) {
                return parseError(err) ?? { message: String(err), raw: err };
            }
            const error = parseError(response);
            if (error) {
                return error;
            }

            if (!Array.isArray(response)) {
                return { message: `[entity-walker] Expected array response for list fetch on '${type}'.` };
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

    async function flushPending() {
        const synced: PendingDelta[] = [];
        const failed: { delta: PendingDelta; error: ApiError }[] = [];

        const queue = [...pendingDeltas];
        for (const delta of queue) {
            const entityConfig = options[delta.entityType];
            let error: ApiError | null = null;
            try {
                if (delta.op === "create") {
                    if (entityConfig?.create) {
                        const res = await entityConfig.create(delta.data);
                        error = parseError(res);
                        if (!error && res && typeof res === "object" && "id" in res) {
                            const resObj = res as any;
                            if (delta.entityId && resObj.id !== delta.entityId) {
                                const oldNode = baseGraph[delta.entityType](delta.entityId);
                                if (oldNode && oldNode.exists()) {
                                    oldNode.delete();
                                }
                                baseGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                            } else {
                                baseGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                            }
                        }
                    }
                } else if (delta.op === "update") {
                    if (entityConfig?.update) {
                        const currentNodeVal = baseGraph[delta.entityType](delta.entityId!).value();
                        const payload = currentNodeVal ?? delta.data;
                        const res = await entityConfig.update(payload);
                        error = parseError(res);
                        if (!error && res && typeof res === "object" && "id" in res) {
                            baseGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                        }
                    }
                } else if (delta.op === "delete") {
                    if (entityConfig?.delete) {
                        const res = await entityConfig.delete(delta.entityId);
                        error = parseError(res);
                    }
                }
            } catch (err) {
                error = parseError(err) ?? { message: String(err), raw: err };
            }

            if (error) {
                delta.error = error;
                failed.push({ delta, error });
                break;
            } else {
                synced.push(delta);
                const idx = pendingDeltas.indexOf(delta);
                if (idx !== -1) {
                    pendingDeltas.splice(idx, 1);
                }
            }
        }

        return { synced, failed };
    }

    const rootActions: Record<string, any> = {};
    if (options.actions) {
        for (const [actionName, actionFn] of Object.entries(options.actions)) {
            rootActions[actionName] = (...args: any[]) => {
                const apiGraphInstance = createApiGraph(baseGraph, options, queryCache, pendingDeltas);
                return actionFn(apiGraphInstance, ...args);
            };
        }
    }

    const apiGraph = {
        sync: (fresh: any, opt?: any) => baseGraph.sync(fresh, opt),
        snapshot: () => ({
            entities: baseGraph.snapshot(),
            pendingDeltas: JSON.parse(JSON.stringify(pendingDeltas)),
        }),
        restore: (snap: any) => {
            if (snap && typeof snap === "object" && "entities" in snap) {
                baseGraph.restore(snap.entities);
                if (Array.isArray(snap.pendingDeltas)) {
                    pendingDeltas.length = 0;
                    pendingDeltas.push(...JSON.parse(JSON.stringify(snap.pendingDeltas)));
                }
            } else {
                baseGraph.restore(snap);
            }
        },
        pendingChanges: () => [...pendingDeltas],
        flushPending: () => flushPending(),
        clearPending: () => { pendingDeltas.length = 0; },
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
                        return { message: `[entity-walker] create handler is required to create node of type '${type}'.` };
                    }

                    let response: any;
                    let error: ApiError | null = null;
                    try {
                        response = await entityConfig.create(data);
                        error = parseError(response);
                    } catch (err) {
                        error = parseError(err) ?? { message: String(err), raw: err };
                    }

                    if (error) {
                        if (error.isTransient === false) {
                            return error;
                        }
                        const tempId = data.id ?? generateUUID();
                        const optimisticEntity = { ...data, id: tempId };
                        baseGraph.sync({ [type]: [optimisticEntity] }, { mode: "merge" });

                        const delta: PendingDelta = {
                            id: generateUUID(),
                            entityType: type,
                            op: "create",
                            entityId: tempId,
                            data,
                            timestamp: Date.now(),
                            error,
                        };
                        pendingDeltas.push(delta);
                        return wrapNode(type, tempId);
                    }

                    baseGraph.sync({ [type]: [response] }, { mode: "merge" });
                    return wrapNode(type, (response as any).id);
                };
            }
            if (propStr.startsWith("update") && propStr !== "update") {
                const type = propStr[6].toLowerCase() + propStr.slice(7);
                return async (data: any) => {
                    if (!data || typeof data !== "object" || !("id" in data)) {
                        return { message: `[entity-walker] update requires an entity object with an 'id'.` };
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

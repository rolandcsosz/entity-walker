import { createGraph as createCoreGraph } from "../core/graph";
import { GraphDef, EntityMap, GraphEdges } from "../core/types";
import {
    ApiGraph,
    ApiError,
    PendingDelta,
    ValidApi,
    ApiTransactionGraph,
    ApiGraphEvent,
    ApiGraphSubscriber,
    AutoFlushOptions,
    NewIdFormatter,
} from "./types";

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
        if (status !== undefined && (status >= 400 || status === 0)) {
            message = `API Request failed with status ${status}`;
        } else if (
            typeof res === "object" &&
            (res.error || res.code || res.isTransient !== undefined || explicitIsTransient !== undefined)
        ) {
            message = `API Error: ${code ?? status ?? "Unknown error"}`;
        } else if (typeof res === "string") {
            message = res;
        }
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
    } else if (
        typeof code === "string" &&
        (code.includes("CONN") || code.includes("TIMEDOUT") || code.includes("NET"))
    ) {
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

export function createApiGraph<
    EM extends EntityMap,
    E extends GraphEdges<EM>,
    ApiOpt extends ValidApi<GraphDef<EM, E>> = ValidApi<GraphDef<EM, E>>,
>(config: { entities: { [K in keyof EM]: EM[K][] }; edges: E; api: ApiOpt }): ApiGraph<GraphDef<EM, E>, ApiOpt>;

export function createApiGraph<D extends GraphDef<any, any>, ApiOpt extends ValidApi<D> = ValidApi<D>>(config: {
    entities: { [K in keyof D["entityModel"]]: D["entityModel"][K][] };
    edges: D["edges"];
    api: ApiOpt;
}): ApiGraph<D, ApiOpt>;

export function createApiGraph<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>>(
    baseGraph: any,
    options?: Options,
    queryCache?: Map<string, { ids: (string | number)[]; fetchedAt: number }>,
    pendingDeltas?: PendingDelta[],
    transactionContext?: { txCoreGraph: any; txId: string; stagedDeltas: PendingDelta[] },
    listeners?: Set<ApiGraphSubscriber>,
    idMap?: Map<string | number, string | number>,
    edges?: any,
    idCounters?: Map<string, number>,
    formatterRef?: { fn?: NewIdFormatter },
): ApiGraph<D, Options>;

export function createApiGraph<D extends GraphDef<any, any>>(
    baseGraphOrConfig: any,
    options?: any,
    queryCache: Map<string, { ids: (string | number)[]; fetchedAt: number }> = new Map(),
    pendingDeltas: PendingDelta[] = [],
    transactionContext?: { txCoreGraph: any; txId: string; stagedDeltas: PendingDelta[] },
    listeners: Set<ApiGraphSubscriber> = new Set(),
    idMap: Map<string | number, string | number> = new Map(),
    graphEdges?: any,
    idCounters: Map<string, number> = new Map(),
    formatterRef: { fn?: NewIdFormatter } = { fn: undefined },
): ApiGraph<D> {
    let baseGraph: any;
    let opts: any;
    let edges: any;

    if (
        baseGraphOrConfig &&
        typeof baseGraphOrConfig === "object" &&
        typeof baseGraphOrConfig.sync !== "function" &&
        "entities" in baseGraphOrConfig &&
        "edges" in baseGraphOrConfig
    ) {
        baseGraph = createCoreGraph({ entities: baseGraphOrConfig.entities, edges: baseGraphOrConfig.edges });
        opts = baseGraphOrConfig.api ?? options;
        edges = baseGraphOrConfig.edges;
    } else {
        baseGraph = baseGraphOrConfig;
        opts = options!;
        edges = graphEdges ?? baseGraph?.edges;
    }

    if (opts?.idFormat && !formatterRef.fn) {
        formatterRef.fn = opts.idFormat;
    }

    function generateNewEntityId(type: string, data?: any): string | number {
        const nextIndex = (idCounters.get(type) || 0) + 1;
        idCounters.set(type, nextIndex);
        if (formatterRef.fn) {
            return formatterRef.fn(type, nextIndex, data);
        }
        return generateUUID();
    }

    const isTx = !!transactionContext;

    function resolveId(id: string | number): string | number {
        let current = id;
        while (idMap.has(current)) {
            current = idMap.get(current)!;
        }
        return current;
    }

    function getOriginalId(currentId: string | number): string | number {
        for (const [tempId, serverId] of idMap.entries()) {
            if (serverId === currentId) {
                return tempId;
            }
        }
        return currentId;
    }

    function idMappings(): Record<string | number, string | number> {
        const result: Record<string | number, string | number> = {};
        idMap.forEach((v, k) => {
            result[k] = v;
        });
        return result;
    }

    function remapEntityId(
        activeGraph: any,
        entityType: string,
        oldId: string | number,
        newId: string | number,
        deltas: PendingDelta[] = [],
    ) {
        if (!oldId || !newId || oldId === newId) return;

        idMap.set(oldId, newId);

        const edgeMap = edges ?? activeGraph?.edges;
        const rawSnap = typeof activeGraph.snapshot === "function" ? activeGraph.snapshot() : null;
        const allEntities =
            rawSnap && typeof rawSnap === "object" && "entities" in rawSnap ? rawSnap.entities : rawSnap;

        if (edgeMap && typeof edgeMap === "object" && allEntities) {
            for (const [srcType, fkMapping] of Object.entries(edgeMap)) {
                if (!fkMapping || typeof fkMapping !== "object") continue;
                for (const [edgeProp, targetConfig] of Object.entries(fkMapping as Record<string, any>)) {
                    const targetType =
                        typeof targetConfig === "string"
                            ? targetConfig
                            : ((targetConfig as any)?.target ?? (targetConfig as any)?.type ?? edgeProp);

                    if (targetType === entityType) {
                        const entityList = allEntities[srcType];
                        if (Array.isArray(entityList)) {
                            for (const entity of entityList) {
                                if (!entity) continue;
                                const possibleFkFields = [
                                    (targetConfig as any)?.foreignKey,
                                    (targetConfig as any)?.fk,
                                    edgeProp,
                                    `${edgeProp}Id`,
                                    `${targetType}Id`,
                                ].filter(Boolean);

                                const fkField = possibleFkFields.find((f) => f in entity) ?? possibleFkFields[0];

                                if (fkField && String(entity[fkField]) === String(oldId)) {
                                    const updated = { ...entity, [fkField]: newId };
                                    activeGraph.sync({ [srcType]: [updated] }, { mode: "merge" });
                                }
                            }
                        }
                    }
                }
            }
        }

        const oldNode = activeGraph[entityType]?.(oldId);
        if (oldNode && oldNode.exists()) {
            oldNode.delete();
        }

        for (const delta of deltas) {
            if (delta.entityType === entityType && String(delta.entityId) === String(oldId)) {
                delta.entityId = newId;
            }
            if (delta.data && typeof delta.data === "object") {
                if (edgeMap && edgeMap[delta.entityType]) {
                    for (const [edgeProp, targetConfig] of Object.entries(
                        edgeMap[delta.entityType] as Record<string, any>,
                    )) {
                        const targetType =
                            typeof targetConfig === "string"
                                ? targetConfig
                                : ((targetConfig as any)?.target ?? (targetConfig as any)?.type ?? edgeProp);

                        if (targetType === entityType) {
                            const possibleFkFields = [
                                (targetConfig as any)?.foreignKey,
                                (targetConfig as any)?.fk,
                                edgeProp,
                                `${edgeProp}Id`,
                                `${targetType}Id`,
                            ].filter(Boolean);

                            const fkField = possibleFkFields.find((f) => f in delta.data) ?? possibleFkFields[0];

                            if (fkField && String(delta.data[fkField]) === String(oldId)) {
                                delta.data[fkField] = newId;
                            }
                        }
                    }
                }
            }
        }
    }

    function notifyListeners(event: ApiGraphEvent) {
        listeners.forEach((sub) => {
            try {
                sub(event);
            } catch {
                // Ignore subscriber errors
            }
        });
    }

    const parseError = (
        res: any,
        context?: { op?: string; entityType?: string; entityId?: string | number; data?: any },
    ) => {
        const entityConfig = context?.entityType ? opts?.[context.entityType] : undefined;
        const customIsTransient = entityConfig?.isTransientError ?? opts?.isTransientError;

        const err = toApiError(res, customIsTransient);
        if (err) {
            notifyListeners({ type: "error", error: err, ...context });
            if (err.isTransient) {
                notifyListeners({ type: "offline", error: err, ...context });
            }
        }
        return err;
    };

    function wrapNode(type: string, rawId: any, activeGraph = baseGraph): any {
        const id = resolveId(rawId);
        const getBaseNode = () => activeGraph[type](id);

        const apiActions: Record<string, any> = {};
        const entityConfig = opts?.[type];
        if (entityConfig?.actions) {
            for (const [actionName, actionFn] of Object.entries(entityConfig.actions)) {
                apiActions[actionName] = (...args: any[]) => {
                    const txGraph = activeGraph.beginTransaction();
                    const txNode = wrapNode(type, id, txGraph);
                    return (actionFn as any)(txNode, ...args)
                        .then((res: any) => {
                            const err = parseError(res, { op: actionName, entityType: type, entityId: id });
                            if (err) {
                                txGraph.rollback();
                                notifyListeners({
                                    type: "rollback",
                                    error: err,
                                    op: actionName,
                                    entityType: type,
                                    entityId: id,
                                });
                                return err;
                            }
                            txGraph.commit();
                            notifyListeners({ type: "change", op: actionName, entityType: type, entityId: id });
                            return res;
                        })
                        .catch((err: any) => {
                            txGraph.rollback();
                            const parsedErr = parseError(err, { op: actionName, entityType: type, entityId: id }) ?? {
                                message: String(err),
                                raw: err,
                            };
                            notifyListeners({
                                type: "rollback",
                                error: parsedErr,
                                op: actionName,
                                entityType: type,
                                entityId: id,
                            });
                            return parsedErr;
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
                    return (
                        parseError(err, { op: "read", entityType: type, entityId: id }) ?? {
                            message: String(err),
                            raw: err,
                        }
                    );
                }
                const error = parseError(response, { op: "read", entityType: type, entityId: id });
                if (error) {
                    return error;
                }
                activeGraph.sync({ [type]: [response] }, { mode: "merge" });
                notifyListeners({
                    type: "change",
                    op: "read",
                    entityType: type,
                    entityId: id,
                    data: response,
                    entities: { [type]: [response] },
                });
                return wrapNode(type, id, activeGraph);
            },
            delete: async () => {
                if (isTx) {
                    activeGraph[type](id).delete();
                    transactionContext!.stagedDeltas.push({
                        id: generateUUID(),
                        transactionId: transactionContext!.txId,
                        entityType: type,
                        op: "delete",
                        entityId: id,
                        timestamp: Date.now(),
                    });
                    return undefined;
                }

                const txGraph = activeGraph.beginTransaction();
                txGraph[type](id).delete();

                let error: ApiError | null = null;
                let result: any = undefined;
                if (entityConfig?.delete) {
                    try {
                        result = await entityConfig.delete(id);
                        error = parseError(result, { op: "delete", entityType: type, entityId: id });
                    } catch (err) {
                        error = parseError(err, { op: "delete", entityType: type, entityId: id }) ?? {
                            message: String(err),
                            raw: err,
                        };
                    }
                }

                if (error) {
                    if (error.isTransient === false) {
                        txGraph.rollback();
                        notifyListeners({ type: "rollback", error, op: "delete", entityType: type, entityId: id });
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
                        notifyListeners({ type: "change", op: "delete", entityType: type, entityId: id });
                        return error;
                    }
                } else {
                    txGraph.commit();
                    notifyListeners({ type: "change", op: "delete", entityType: type, entityId: id });
                    return result;
                }
            },
            update: async (fn: (entity: any) => any) => {
                if (isTx) {
                    const txNode = activeGraph[type](id);
                    if (!txNode.exists()) {
                        return { message: `[entity-walker] Node '${type}' with id '${id}' does not exist for update.` };
                    }
                    const current = txNode.value();
                    const updated = fn(current);
                    txNode.update(() => updated);
                    transactionContext!.stagedDeltas.push({
                        id: generateUUID(),
                        transactionId: transactionContext!.txId,
                        entityType: type,
                        op: "update",
                        entityId: id,
                        data: updated,
                        timestamp: Date.now(),
                    });
                    return undefined;
                }

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
                        error = parseError(response, { op: "update", entityType: type, entityId: id, data: updated });
                        if (!error && response && typeof response === "object" && "id" in response) {
                            txGraph.sync({ [type]: [response] }, { mode: "merge" });
                        }
                    } catch (err) {
                        error = parseError(err, { op: "update", entityType: type, entityId: id, data: updated }) ?? {
                            message: String(err),
                            raw: err,
                        };
                    }
                }

                if (error) {
                    if (error.isTransient === false) {
                        txGraph.rollback();
                        notifyListeners({
                            type: "rollback",
                            error,
                            op: "update",
                            entityType: type,
                            entityId: id,
                            data: updated,
                        });
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
                        notifyListeners({
                            type: "change",
                            op: "update",
                            entityType: type,
                            entityId: id,
                            data: updated,
                        });
                        return error;
                    }
                } else {
                    txGraph.commit();
                    notifyListeners({ type: "change", op: "update", entityType: type, entityId: id, data: updated });
                    return result;
                }
            },
            graph: () =>
                createApiGraph(
                    activeGraph,
                    opts,
                    queryCache,
                    pendingDeltas,
                    transactionContext,
                    listeners,
                    idMap,
                    edges,
                    idCounters,
                    formatterRef,
                ),
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
            },
        }) as any;
    }

    function wrapList(type: string, baseList: any[], activeGraph = baseGraph): any {
        const wrappedItems = baseList.map((item: any) => {
            const info = item.info();
            return wrapNode(type, info.id, activeGraph);
        });

        const loadFn = async (options?: { force?: boolean }) => {
            const cacheKey = type;
            if (!options?.force && queryCache.has(cacheKey)) {
                const cached = queryCache.get(cacheKey)!;
                const allNodes = activeGraph[`${type}Nodes`]();
                const matchingNodes = allNodes.intersect(cached.ids);
                return wrapList(type, matchingNodes, activeGraph);
            }

            const entityConfig = opts?.[type];
            if (!entityConfig?.list) {
                return { message: `[entity-walker] list handler is required to load node list for '${type}'.` };
            }

            let response: any;
            try {
                response = await entityConfig.list();
            } catch (err) {
                return parseError(err, { op: "list", entityType: type }) ?? { message: String(err), raw: err };
            }
            const error = parseError(response, { op: "list", entityType: type });
            if (error) {
                return error;
            }

            if (!Array.isArray(response)) {
                return { message: `[entity-walker] Expected array response for list fetch on '${type}'.` };
            }

            activeGraph.sync({ [type]: response }, { mode: "merge" });
            notifyListeners({ type: "change", op: "list", entityType: type, entities: { [type]: response } });

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
            },
        });

        return listProxy;
    }

    async function flushPending() {
        const synced: PendingDelta[] = [];
        const failed: { delta: PendingDelta; error: ApiError }[] = [];

        const queue = [...pendingDeltas];
        for (const delta of queue) {
            const entityConfig = opts?.[delta.entityType];
            let error: ApiError | null = null;
            try {
                if (delta.op === "create") {
                    if (entityConfig?.create) {
                        const res = await entityConfig.create(delta.data);
                        error = parseError(res, {
                            op: "create",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: delta.data,
                        });
                        if (!error && res && typeof res === "object" && "id" in res) {
                            const resObj = res as any;
                            if (delta.entityId && resObj.id !== delta.entityId) {
                                remapEntityId(baseGraph, delta.entityType, delta.entityId, resObj.id, pendingDeltas);
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
                        error = parseError(res, {
                            op: "update",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: payload,
                        });
                        if (!error && res && typeof res === "object" && "id" in res) {
                            baseGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                        }
                    }
                } else if (delta.op === "delete") {
                    if (entityConfig?.delete) {
                        const res = await entityConfig.delete(delta.entityId);
                        error = parseError(res, {
                            op: "delete",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                        });
                    }
                }
            } catch (err) {
                error = parseError(err, {
                    op: delta.op,
                    entityType: delta.entityType,
                    entityId: delta.entityId,
                    data: delta.data,
                }) ?? {
                    message: String(err),
                    raw: err,
                };
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

        notifyListeners({ type: "flush", synced, failed });
        notifyListeners({ type: "change", op: "flush" });
        return { synced, failed };
    }

    const rootActions: Record<string, any> = {};
    if (opts?.actions) {
        for (const [actionName, actionFn] of Object.entries(opts.actions)) {
            rootActions[actionName] = (...args: any[]) => {
                const apiGraphInstance = createApiGraph(
                    baseGraph,
                    opts,
                    queryCache,
                    pendingDeltas,
                    transactionContext,
                    listeners,
                    idMap,
                    edges,
                    idCounters,
                    formatterRef,
                );
                return (actionFn as any)(apiGraphInstance, ...args);
            };
        }
    }

    const apiGraph = {
        sync: (fresh: any, opt?: any) => {
            baseGraph.sync(fresh, opt);
            notifyListeners({ type: "change", op: "sync", entities: fresh });
        },
        snapshot: () => ({
            entities: baseGraph.snapshot(),
            pendingDeltas: JSON.parse(JSON.stringify(pendingDeltas)),
            idMappings: idMappings(),
        }),
        restore: (snap: any) => {
            if (snap && typeof snap === "object" && "entities" in snap) {
                baseGraph.restore(snap.entities);
                if (Array.isArray(snap.pendingDeltas)) {
                    pendingDeltas.length = 0;
                    pendingDeltas.push(...JSON.parse(JSON.stringify(snap.pendingDeltas)));
                }
                if (snap.idMappings && typeof snap.idMappings === "object") {
                    idMap.clear();
                    for (const [k, v] of Object.entries(snap.idMappings)) {
                        idMap.set(k, v as string | number);
                    }
                }
            } else {
                baseGraph.restore(snap);
            }
            notifyListeners({ type: "change", op: "restore" });
        },
        pendingChanges: () => [...pendingDeltas],
        flushPending: () => flushPending(),
        clearPending: () => {
            pendingDeltas.length = 0;
            notifyListeners({ type: "change", op: "clearPending" });
        },
        subscribe: (subscriber: ApiGraphSubscriber): (() => void) => {
            listeners.add(subscriber);
            return () => {
                listeners.delete(subscriber);
            };
        },
        startAutoFlush: (options?: AutoFlushOptions): (() => void) => {
            const intervalMs = options?.intervalMs;
            const onOnline = options?.onOnline ?? true;

            let timer: any = null;
            let onlineHandler: any = null;

            const runFlush = async () => {
                if (pendingDeltas.length > 0) {
                    const res = await flushPending();
                    if (res.synced.length > 0 && res.failed.length === 0) {
                        notifyListeners({ type: "online" });
                    }
                }
            };

            if (intervalMs && intervalMs > 0) {
                timer = setInterval(runFlush, intervalMs);
            }

            if (onOnline && typeof window !== "undefined" && typeof window.addEventListener === "function") {
                onlineHandler = () => {
                    notifyListeners({ type: "online" });
                    runFlush();
                };
                window.addEventListener("online", onlineHandler);
            }

            return () => {
                if (timer) clearInterval(timer);
                if (
                    onlineHandler &&
                    typeof window !== "undefined" &&
                    typeof window.removeEventListener === "function"
                ) {
                    window.removeEventListener("online", onlineHandler);
                }
            };
        },
        resolveId: (id: string | number) => resolveId(id),
        getOriginalId: (id: string | number) => getOriginalId(id),
        setIdFormat: (formatter: NewIdFormatter) => {
            formatterRef.fn = formatter;
        },
        beginTransaction: (): ApiTransactionGraph<D> => {
            const txCoreGraph = baseGraph.beginTransaction();
            const txId = generateUUID();
            const stagedDeltas: PendingDelta[] = [];

            const txApiGraph = createApiGraph(
                txCoreGraph,
                opts,
                queryCache,
                pendingDeltas,
                {
                    txCoreGraph,
                    txId,
                    stagedDeltas,
                },
                listeners,
                idMap,
                edges,
                idCounters,
                formatterRef,
            );

            let committed = false;
            let rolledBack = false;

            const commit = async (): Promise<{ success: boolean; error?: ApiError }> => {
                if (committed || rolledBack) {
                    return { success: !rolledBack };
                }

                if (transactionContext) {
                    committed = true;
                    transactionContext.stagedDeltas.push(...stagedDeltas);
                    txCoreGraph.commit();
                    stagedDeltas.length = 0;
                    return { success: true };
                }

                if (stagedDeltas.length === 0) {
                    committed = true;
                    txCoreGraph.commit();
                    notifyListeners({ type: "change", op: "commit" });
                    return { success: true };
                }

                for (let i = 0; i < stagedDeltas.length; i++) {
                    const delta = stagedDeltas[i];
                    const entityConfig = opts?.[delta.entityType];
                    let error: ApiError | null = null;

                    try {
                        if (delta.op === "create") {
                            if (entityConfig?.create) {
                                const res = await entityConfig.create(delta.data);
                                error = parseError(res, {
                                    op: "create",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                    data: delta.data,
                                });
                                if (!error && res && typeof res === "object" && "id" in res) {
                                    const resObj = res as any;
                                    if (delta.entityId && resObj.id !== delta.entityId) {
                                        remapEntityId(
                                            txCoreGraph,
                                            delta.entityType,
                                            delta.entityId,
                                            resObj.id,
                                            stagedDeltas,
                                        );
                                        remapEntityId(
                                            baseGraph,
                                            delta.entityType,
                                            delta.entityId,
                                            resObj.id,
                                            pendingDeltas,
                                        );
                                    }
                                    txCoreGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                                }
                            }
                        } else if (delta.op === "update") {
                            if (entityConfig?.update) {
                                const res = await entityConfig.update(delta.data);
                                error = parseError(res, {
                                    op: "update",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                    data: delta.data,
                                });
                                if (!error && res && typeof res === "object" && "id" in res) {
                                    txCoreGraph.sync({ [delta.entityType]: [res] }, { mode: "merge" });
                                }
                            }
                        } else if (delta.op === "delete") {
                            if (entityConfig?.delete) {
                                const res = await entityConfig.delete(delta.entityId);
                                error = parseError(res, {
                                    op: "delete",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                });
                            }
                        }
                    } catch (err) {
                        error = parseError(err, {
                            op: delta.op,
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: delta.data,
                        }) ?? {
                            message: String(err),
                            raw: err,
                        };
                    }

                    if (error) {
                        if (error.isTransient === false) {
                            rolledBack = true;
                            txCoreGraph.rollback();
                            stagedDeltas.length = 0;
                            notifyListeners({ type: "rollback", error, op: "commit" });
                            return { success: false, error };
                        } else {
                            committed = true;
                            txCoreGraph.commit();
                            const remaining = stagedDeltas.slice(i).map((d) => ({ ...d, error }));
                            pendingDeltas.push(...remaining);
                            stagedDeltas.length = 0;
                            notifyListeners({ type: "change", op: "commit" });
                            return { success: false, error };
                        }
                    }
                }

                committed = true;
                txCoreGraph.commit();
                stagedDeltas.length = 0;
                notifyListeners({ type: "change", op: "commit" });
                return { success: true };
            };

            const rollback = () => {
                rolledBack = true;
                txCoreGraph.rollback();
                stagedDeltas.length = 0;
                notifyListeners({ type: "rollback", op: "rollback" });
            };

            return new Proxy(txApiGraph, {
                get(target, p) {
                    if (p === "commit") return commit;
                    if (p === "rollback") return rollback;
                    return (target as any)[p];
                },
            }) as any;
        },
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
            if (propStr === "createEntity") {
                return (type: string, data: any) => {
                    const fnName = `create${type[0].toUpperCase()}${type.slice(1)}`;
                    return (apiGraph as any)[fnName](data);
                };
            }
            if (propStr.startsWith("create") && propStr !== "create") {
                const type = propStr[6].toLowerCase() + propStr.slice(7);
                return async (data: any) => {
                    if (isTx) {
                        const tempId = data.id ?? generateNewEntityId(type, data);
                        const optimisticEntity = { ...data, id: tempId };
                        baseGraph.sync({ [type]: [optimisticEntity] }, { mode: "merge" });
                        transactionContext!.stagedDeltas.push({
                            id: generateUUID(),
                            transactionId: transactionContext!.txId,
                            entityType: type,
                            op: "create",
                            entityId: tempId,
                            data,
                            timestamp: Date.now(),
                        });
                        return wrapNode(type, tempId);
                    }

                    const entityConfig = opts?.[type];
                    if (!entityConfig?.create) {
                        return {
                            message: `[entity-walker] create handler is required to create node of type '${type}'.`,
                        };
                    }

                    let response: any;
                    let error: ApiError | null = null;
                    try {
                        response = await entityConfig.create(data);
                        error = parseError(response, { op: "create", entityType: type, data });
                    } catch (err) {
                        error = parseError(err, { op: "create", entityType: type, data }) ?? {
                            message: String(err),
                            raw: err,
                        };
                    }

                    if (error) {
                        if (error.isTransient === false) {
                            return error;
                        }
                        const tempId = data.id ?? generateNewEntityId(type, data);
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
                        notifyListeners({ type: "change", op: "create", entityType: type, entityId: tempId, data });
                        return wrapNode(type, tempId);
                    }

                    const resId = (response as any)?.id;
                    const tempId = data.id;
                    if (tempId && resId && tempId !== resId) {
                        remapEntityId(baseGraph, type, tempId, resId, pendingDeltas);
                    }

                    baseGraph.sync({ [type]: [response] }, { mode: "merge" });
                    notifyListeners({
                        type: "change",
                        op: "create",
                        entityType: type,
                        entityId: resId,
                        data: response,
                    });
                    return wrapNode(type, resId);
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
            return (id: any) => wrapNode(propStr, resolveId(id));
        },
    }) as any;
}

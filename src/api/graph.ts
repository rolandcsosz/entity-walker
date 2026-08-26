import { createGraph as createCoreGraph } from "../core/graph";
import { GraphDef, EntityMap, GraphEdges } from "../core/types";
import { generateUUID } from "../utils";
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
    ApiCallContext,
    BeforeApiCallResult,
    ApiHooks,
    isApiError,
} from "./types";

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

const STANDARD_OPS = new Set<string>(["create", "update", "delete", "read", "list"]);

function toStandardOp(op: string): ApiCallContext["op"] {
    return STANDARD_OPS.has(op) ? (op as ApiCallContext["op"]) : undefined;
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
    D extends GraphDef<any, any>,
    C extends { entities?: any; edges: any; api?: ValidApi<D> },
>(
    config: C & {
        entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
        edges: D["edges"];
    },
): C["api"] extends ValidApi<D> ? ApiGraph<D & { api: C["api"] }> : ApiGraph<D>;

export function createApiGraph<D extends GraphDef<any, any>, ApiOpt extends ValidApi<D> = ValidApi<D>>(config: {
    entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
    edges: D["edges"];
    api?: ApiOpt;
}): ApiGraph<D & { api: ApiOpt }>;

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
    dynamicHooks?: Set<ApiHooks<any>>,
    autoLoadRef?: { enabled: boolean },
    activeUserOpsRef?: { count: number },
    inFlightAutoFetches?: Set<string>,
    attemptedAutoFetches?: Set<string>,
): ApiGraph<D & { api: Options }>;

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
    dynamicHooks: Set<ApiHooks<any>> = new Set(),
    autoLoadRef: { enabled: boolean } = { enabled: false },
    activeUserOpsRef: { count: number } = { count: 0 },
    inFlightAutoFetches: Set<string> = new Set(),
    attemptedAutoFetches: Set<string> = new Set(),
): ApiGraph<D> {
    let baseGraph: any;
    let opts: any;
    let edges: any;

    if (
        baseGraphOrConfig &&
        typeof baseGraphOrConfig === "object" &&
        typeof baseGraphOrConfig.sync !== "function" &&
        ("entities" in baseGraphOrConfig || "edges" in baseGraphOrConfig)
    ) {
        baseGraph = createCoreGraph({ entities: baseGraphOrConfig.entities, edges: baseGraphOrConfig.edges });
        opts = baseGraphOrConfig.api ?? options;
        edges = baseGraphOrConfig.edges;
    } else {
        baseGraph = baseGraphOrConfig;
        opts = options!;
        edges = graphEdges ?? baseGraph?.edges;
    }

    if (opts?.autoLoadReferences !== undefined) {
        autoLoadRef.enabled = !!opts.autoLoadReferences;
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
        const snapFn = activeGraph.meta?.snapshot ?? activeGraph.snapshot;
        const rawSnap = typeof snapFn === "function" ? snapFn.call(activeGraph.meta ?? activeGraph) : null;
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
                                    const syncFn = activeGraph.meta?.sync ?? activeGraph.sync;
                                    syncFn.call(
                                        activeGraph.meta ?? activeGraph,
                                        { [srcType]: [updated] },
                                        { mode: "merge" },
                                    );
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

    async function runFinallyHooks(context: ApiCallContext, payload: any, result?: any, error?: ApiError) {
        const onFinallyHooks: Array<(ctx: ApiCallContext & { result?: any; error?: ApiError }) => any> = [];
        if (context.entityType && opts?.[context.entityType]?.hooks?.onFinally) {
            onFinallyHooks.push(opts[context.entityType].hooks.onFinally);
        }
        if (opts?.hooks?.onFinally) {
            onFinallyHooks.push(opts.hooks.onFinally);
        }
        for (const h of dynamicHooks) {
            if (h.onFinally) {
                onFinallyHooks.push(h.onFinally);
            }
        }

        const finCtx = { ...context, data: payload, result, error };
        for (const hook of onFinallyHooks) {
            try {
                await hook(finCtx);
            } catch {
                // Ignore finally hook errors
            }
        }
    }

    let autoLoadScheduled = false;

    function scheduleAutoLoadReferences() {
        if (isTx) return;
        if (autoLoadScheduled) return;

        autoLoadScheduled = true;
        setTimeout(async () => {
            autoLoadScheduled = false;

            if (activeUserOpsRef.count > 0) {
                return;
            }

            const edgeMap = edges ?? baseGraph?.edges;
            if (!edgeMap || typeof edgeMap !== "object") return;

            const snapFn = baseGraph.meta?.snapshot ?? baseGraph.snapshot;
            const rawSnap = typeof snapFn === "function" ? snapFn.call(baseGraph.meta ?? baseGraph) : null;
            const allEntities =
                rawSnap && typeof rawSnap === "object" && "entities" in rawSnap ? rawSnap.entities : rawSnap;
            if (!allEntities || typeof allEntities !== "object") return;

            const missingToFetch: Array<{ type: string; id: string | number }> = [];

            for (const [sourceType, entityEdges] of Object.entries(edgeMap)) {
                if (!entityEdges || typeof entityEdges !== "object") continue;
                const sourceList = allEntities[sourceType];
                if (!Array.isArray(sourceList) || sourceList.length === 0) continue;

                for (const [edgeProp, targetConfig] of Object.entries(entityEdges as Record<string, any>)) {
                    if (!targetConfig) continue;

                    const targetType =
                        typeof targetConfig === "string"
                            ? targetConfig
                            : (targetConfig.target ?? targetConfig.type ?? edgeProp);

                    const edgeAutoLoad = typeof targetConfig === "object" ? targetConfig.autoLoad : undefined;
                    const isAutoLoadEnabled = edgeAutoLoad !== undefined ? edgeAutoLoad : autoLoadRef.enabled;

                    if (!isAutoLoadEnabled) continue;

                    const targetEntityConfig = opts?.[targetType];
                    if (typeof targetEntityConfig?.read !== "function") continue;

                    for (const sourceEntity of sourceList) {
                        if (!sourceEntity) continue;

                        let targetId: string | number | undefined;
                        if (typeof targetConfig === "object" && typeof targetConfig.resolve === "function") {
                            targetId = targetConfig.resolve(sourceEntity);
                        } else {
                            const possibleFkFields = [
                                targetConfig?.foreignKey,
                                targetConfig?.fk,
                                edgeProp,
                                `${edgeProp}Id`,
                                `${targetType}Id`,
                            ].filter(Boolean);
                            const fkField = possibleFkFields.find((f) => f in sourceEntity);
                            if (fkField) targetId = sourceEntity[fkField];
                        }

                        if (targetId == null) continue;
                        const resolvedTargetId = resolveId(targetId);

                        const targetNode = baseGraph[targetType]?.(resolvedTargetId);
                        const exists = targetNode ? targetNode.exists() : false;

                        if (!exists) {
                            const key = `${targetType}:${resolvedTargetId}`;
                            if (!inFlightAutoFetches.has(key) && !attemptedAutoFetches.has(key)) {
                                missingToFetch.push({ type: targetType, id: resolvedTargetId });
                                attemptedAutoFetches.add(key);
                            }
                        }
                    }
                }
            }

            if (missingToFetch.length === 0) return;

            for (const item of missingToFetch) {
                const key = `${item.type}:${item.id}`;
                inFlightAutoFetches.add(key);
                try {
                    const apiNode = wrapNode(item.type, item.id, baseGraph);
                    await apiNode.load({ isAutoLoad: true });
                } catch {
                    // Ignore auto-load fetch errors
                } finally {
                    inFlightAutoFetches.delete(key);
                }
            }

            scheduleAutoLoadReferences();
        });
    }

    async function executeApiCallWithHooks<T>(
        context: ApiCallContext & { isAutoLoad?: boolean },
        fn: (payload: any) => Promise<T>,
    ): Promise<T | ApiError> {
        const isUserOp = !context.isAutoLoad;
        if (isUserOp) {
            activeUserOpsRef.count++;
        }
        const key =
            context.entityType && context.entityId != null ? `${context.entityType}:${context.entityId}` : undefined;
        if (key) {
            inFlightAutoFetches.add(key);
        }
        try {
            let currentPayload = context.data;

            const beforeCallHooks: Array<(ctx: ApiCallContext) => any> = [];
            if (opts?.hooks?.beforeCall) {
                beforeCallHooks.push(opts.hooks.beforeCall);
            }
            if (context.entityType && opts?.[context.entityType]?.hooks?.beforeCall) {
                beforeCallHooks.push(opts[context.entityType].hooks.beforeCall);
            }
            for (const h of dynamicHooks) {
                if (h.beforeCall) {
                    beforeCallHooks.push(h.beforeCall);
                }
            }

            for (const hook of beforeCallHooks) {
                try {
                    const currentCtx = { ...context, data: currentPayload };
                    const res = await hook(currentCtx);
                    if (res === false) {
                        const cancelError: ApiError = {
                            message: `[entity-walker] API call for operation '${context.op}' canceled by beforeCall hook.`,
                            isTransient: false,
                        };
                        notifyListeners({ type: "error", error: cancelError, ...context });
                        await runFinallyHooks(context, currentPayload, undefined, cancelError);
                        return cancelError;
                    }
                    if (res && typeof res === "object") {
                        if (res.cancel === true) {
                            const cancelError: ApiError = {
                                message: `[entity-walker] API call for operation '${context.op}' canceled by beforeCall hook.`,
                                isTransient: false,
                            };
                            notifyListeners({ type: "error", error: cancelError, ...context });
                            await runFinallyHooks(context, currentPayload, undefined, cancelError);
                            return cancelError;
                        }
                        if ("data" in res) {
                            currentPayload = res.data;
                        }
                    }
                } catch (err) {
                    const parsed = parseError(err, { ...context, data: currentPayload }) ?? {
                        message: err instanceof Error ? err.message : String(err),
                        raw: err,
                        isTransient: false,
                    };
                    await runFinallyHooks(context, currentPayload, undefined, parsed);
                    return parsed;
                }
            }

            let result: any;
            let error: ApiError | null = null;

            try {
                result = await fn(currentPayload);
                const parsed = parseError(result, { ...context, data: currentPayload });
                const isBuiltinOp =
                    context.op === "create" ||
                    context.op === "update" ||
                    context.op === "delete" ||
                    context.op === "read" ||
                    context.op === "list";
                if (parsed && (isBuiltinOp || typeof result !== "string")) {
                    error = parsed;
                }
            } catch (err) {
                error = parseError(err, { ...context, data: currentPayload }) ?? {
                    message: err instanceof Error ? err.message : String(err),
                    raw: err,
                    isTransient: false,
                };
            }

            if (error) {
                const onErrorHooks: Array<(ctx: ApiCallContext & { error: ApiError }) => any> = [];
                if (context.entityType && opts?.[context.entityType]?.hooks?.onError) {
                    onErrorHooks.push(opts[context.entityType].hooks.onError);
                }
                if (opts?.hooks?.onError) {
                    onErrorHooks.push(opts.hooks.onError);
                }
                for (const h of dynamicHooks) {
                    if (h.onError) {
                        onErrorHooks.push(h.onError);
                    }
                }

                const errCtx = { ...context, data: currentPayload, error };
                for (const hook of onErrorHooks) {
                    try {
                        const customErr = await hook(errCtx);
                        if (customErr && typeof customErr === "object" && "message" in customErr) {
                            error = customErr as ApiError;
                        }
                    } catch {
                        // Ignore error in onError hook
                    }
                }

                await runFinallyHooks(context, currentPayload, undefined, error);
                return error;
            }

            const afterCallHooks: Array<(ctx: ApiCallContext & { result: any }) => any> = [];
            if (context.entityType && opts?.[context.entityType]?.hooks?.afterCall) {
                afterCallHooks.push(opts[context.entityType].hooks.afterCall);
            }
            if (opts?.hooks?.afterCall) {
                afterCallHooks.push(opts.hooks.afterCall);
            }
            for (const h of dynamicHooks) {
                if (h.afterCall) {
                    afterCallHooks.push(h.afterCall);
                }
            }

            let currentResult = result;
            for (const hook of afterCallHooks) {
                try {
                    const afterCtx = { ...context, data: currentPayload, result: currentResult };
                    const transformed = await hook(afterCtx);
                    if (transformed !== undefined) {
                        currentResult = transformed;
                    }
                } catch {
                    // Ignore error in afterCall hook
                }
            }

            await runFinallyHooks(context, currentPayload, currentResult, undefined);
            return currentResult;
        } finally {
            if (key) {
                inFlightAutoFetches.delete(key);
            }
            if (isUserOp) {
                activeUserOpsRef.count = Math.max(0, activeUserOpsRef.count - 1);
                if (activeUserOpsRef.count === 0 && autoLoadRef.enabled) {
                    scheduleAutoLoadReferences();
                }
            }
        }
    }

    function wrapNode(type: string, rawId: any, activeGraph = baseGraph): any {
        const id = resolveId(rawId);
        const getBaseNode = () => activeGraph[type](id);

        const apiActions: Record<string, any> = {};
        const entityConfig = opts?.[type];
        if (entityConfig?.actions) {
            for (const [actionName, actionFn] of Object.entries(entityConfig.actions)) {
                apiActions[actionName] = (...args: any[]) => {
                    const txFn = activeGraph.meta?.beginTransaction ?? activeGraph.beginTransaction;
                    const txGraph = txFn.call(activeGraph.meta ?? activeGraph);
                    const txNode = wrapNode(type, id, txGraph);
                    return executeApiCallWithHooks(
                        { op: toStandardOp(actionName), entityType: type, entityId: id, data: args },
                        (payload) => {
                            const actualArgs = Array.isArray(payload) ? payload : [payload];
                            return (actionFn as any)(txNode, ...actualArgs);
                        },
                    ).then((res: any) => {
                        if (isApiError(res)) {
                            txGraph.rollback();
                            notifyListeners({
                                type: "rollback",
                                error: res,
                                op: actionName,
                                entityType: type,
                                entityId: id,
                            });
                            return res;
                        }
                        txGraph.commit();
                        notifyListeners({ type: "change", op: actionName, entityType: type, entityId: id });
                        return res;
                    });
                };
            }
        }

        const apiProxy = new Proxy(apiActions, {
            get(target, prop, receiver) {
                if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") {
                    return undefined;
                }
                if (prop in target) {
                    return target[prop];
                }
                const actionName = String(prop);
                if (entityConfig?.actions?.[actionName]) {
                    const actionFn = entityConfig.actions[actionName];
                    return (...args: any[]) => {
                        const txFn = activeGraph.meta?.beginTransaction ?? activeGraph.beginTransaction;
                        const txGraph = txFn.call(activeGraph.meta ?? activeGraph);
                        const txNode = wrapNode(type, id, txGraph);
                        return executeApiCallWithHooks(
                            { op: toStandardOp(actionName), entityType: type, entityId: id, data: args },
                            (payload) => {
                                const actualArgs = Array.isArray(payload) ? payload : [payload];
                                return (actionFn as any)(txNode, ...actualArgs);
                            },
                        ).then((res: any) => {
                            if (isApiError(res)) {
                                txGraph.rollback();
                                notifyListeners({
                                    type: "rollback",
                                    error: res,
                                    op: actionName,
                                    entityType: type,
                                    entityId: id,
                                });
                                return res;
                            }
                            txGraph.commit();
                            notifyListeners({ type: "change", op: actionName, entityType: type, entityId: id });
                            return res;
                        });
                    };
                }
                return Reflect.get(target, prop, receiver);
            },
        });

        const node = {
            value: () => getBaseNode().value(),
            exists: () => getBaseNode().exists(),
            load: async (loadOpts?: { isAutoLoad?: boolean }) => {
                if (!entityConfig?.read) {
                    return { message: `[entity-walker] read handler is required to load node for '${type}'.` };
                }
                const isAutoLoad = !!loadOpts?.isAutoLoad;
                const res = await executeApiCallWithHooks(
                    { op: "read", entityType: type, entityId: id, data: id, isAutoLoad } as any,
                    (reqId) => entityConfig.read!(reqId, node),
                );
                if (isApiError(res)) {
                    return res;
                }
                const syncFn = activeGraph.meta?.sync ?? activeGraph.sync;
                syncFn.call(activeGraph.meta ?? activeGraph, { [type]: [res] }, { mode: "merge" });
                notifyListeners({
                    type: "change",
                    op: "read",
                    entityType: type,
                    entityId: id,
                    data: res,
                    entities: { [type]: [res] },
                });
                scheduleAutoLoadReferences();
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

                const txFn = activeGraph.meta?.beginTransaction ?? activeGraph.beginTransaction;
                const txGraph = txFn.call(activeGraph.meta ?? activeGraph);
                txGraph[type](id).delete();

                let error: ApiError | null = null;
                let result: any = undefined;
                if (entityConfig?.delete) {
                    const res = await executeApiCallWithHooks(
                        { op: "delete", entityType: type, entityId: id, data: id },
                        (reqId) => entityConfig.delete!(reqId, node),
                    );
                    if (isApiError(res)) {
                        error = res;
                    } else {
                        result = res;
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

                const txFn = activeGraph.meta?.beginTransaction ?? activeGraph.beginTransaction;
                const txGraph = txFn.call(activeGraph.meta ?? activeGraph);
                const txNode = txGraph[type](id);
                if (!txNode.exists()) {
                    return { message: `[entity-walker] Node '${type}' with id '${id}' does not exist for update.` };
                }
                const current = txNode.value();
                const updated = fn(current);
                txNode.update(() => updated);

                let error: ApiError | null = null;
                let result: any = undefined;
                let finalPayload = updated;
                if (entityConfig?.update) {
                    const res = await executeApiCallWithHooks(
                        { op: "update", entityType: type, entityId: id, data: updated },
                        (reqData) => {
                            finalPayload = reqData;
                            return entityConfig.update!(reqData, wrapNode(type, id, txGraph));
                        },
                    );
                    if (isApiError(res)) {
                        error = res;
                    } else {
                        result = res;
                        if (result && typeof result === "object" && "id" in result) {
                            const syncFn = txGraph.meta?.sync ?? txGraph.sync;
                            syncFn.call(txGraph.meta ?? txGraph, { [type]: [result] }, { mode: "merge" });
                        }
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
                            data: finalPayload,
                        });
                        return error;
                    } else {
                        txGraph.commit();
                        const delta: PendingDelta = {
                            id: generateUUID(),
                            entityType: type,
                            op: "update",
                            entityId: id,
                            data: finalPayload,
                            timestamp: Date.now(),
                            error,
                        };
                        pendingDeltas.push(delta);
                        notifyListeners({
                            type: "change",
                            op: "update",
                            entityType: type,
                            entityId: id,
                            data: finalPayload,
                        });
                        return error;
                    }
                } else {
                    txGraph.commit();
                    notifyListeners({
                        type: "change",
                        op: "update",
                        entityType: type,
                        entityId: id,
                        data: finalPayload,
                    });
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
                    dynamicHooks,
                    autoLoadRef,
                    activeUserOpsRef,
                    inFlightAutoFetches,
                    attemptedAutoFetches,
                ),
            api: apiProxy,
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
                if (propStr in apiProxy) {
                    return (apiProxy as any)[propStr];
                }
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

        const loadFn = async (paramsOrOptions?: any, maybeOptions?: { force?: boolean }) => {
            const entityConfig = opts?.[type];
            const handlerExpectsParams = typeof entityConfig?.list === "function" && entityConfig.list.length > 0;
            const firstArgLooksLikeOptions =
                paramsOrOptions && typeof paramsOrOptions === "object" && "force" in paramsOrOptions;
            const firstArgIsOptions = maybeOptions === undefined && firstArgLooksLikeOptions && !handlerExpectsParams;
            const params = firstArgIsOptions ? undefined : paramsOrOptions;
            const options = firstArgIsOptions ? paramsOrOptions : maybeOptions;
            const cacheKey = `${type}:${JSON.stringify(params ?? null)}`;
            if (!options?.force && queryCache.has(cacheKey)) {
                const cached = queryCache.get(cacheKey)!;
                const allNodes = activeGraph[`${type}Nodes`]();
                const matchingNodes = allNodes.intersect(cached.ids);
                return wrapList(type, matchingNodes, activeGraph);
            }

            if (!entityConfig?.list) {
                return { message: `[entity-walker] list handler is required to load node list for '${type}'.` };
            }

            const response = await executeApiCallWithHooks({ op: "list", entityType: type, data: params }, (payload) =>
                entityConfig.list!(payload, listProxy),
            );

            if (isApiError(response)) {
                return response;
            }

            if (!Array.isArray(response)) {
                return { message: `[entity-walker] Expected array response for list fetch on '${type}'.` };
            }

            const syncFn = activeGraph.meta?.sync ?? activeGraph.sync;
            syncFn.call(activeGraph.meta ?? activeGraph, { [type]: response }, { mode: "merge" });
            notifyListeners({ type: "change", op: "list", entityType: type, entities: { [type]: response } });
            scheduleAutoLoadReferences();

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
            if (delta.op === "create") {
                if (entityConfig?.create) {
                    const res = await executeApiCallWithHooks(
                        {
                            op: "create",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: delta.data,
                        },
                        (reqData) =>
                            entityConfig.create!(reqData, wrapNode(delta.entityType, delta.entityId, baseGraph)),
                    );
                    if (isApiError(res)) {
                        error = res;
                    } else if (res && typeof res === "object" && "id" in res) {
                        const resObj = res as any;
                        const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
                        if (delta.entityId && resObj.id !== delta.entityId) {
                            remapEntityId(baseGraph, delta.entityType, delta.entityId, resObj.id, pendingDeltas);
                            syncFn.call(baseGraph.meta ?? baseGraph, { [delta.entityType]: [res] }, { mode: "merge" });
                        } else {
                            syncFn.call(baseGraph.meta ?? baseGraph, { [delta.entityType]: [res] }, { mode: "merge" });
                        }
                    }
                }
            } else if (delta.op === "update") {
                if (entityConfig?.update) {
                    const currentNodeVal = baseGraph[delta.entityType](delta.entityId!).value();
                    const payload = currentNodeVal ?? delta.data;
                    const res = await executeApiCallWithHooks(
                        {
                            op: "update",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: payload,
                        },
                        (reqData) =>
                            entityConfig.update!(reqData, wrapNode(delta.entityType, delta.entityId, baseGraph)),
                    );
                    if (isApiError(res)) {
                        error = res;
                    } else if (res && typeof res === "object" && "id" in res) {
                        const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
                        syncFn.call(baseGraph.meta ?? baseGraph, { [delta.entityType]: [res] }, { mode: "merge" });
                    }
                }
            } else if (delta.op === "delete") {
                if (entityConfig?.delete) {
                    const res = await executeApiCallWithHooks(
                        {
                            op: "delete",
                            entityType: delta.entityType,
                            entityId: delta.entityId,
                            data: delta.entityId,
                        },
                        (reqId) => entityConfig.delete!(reqId, wrapNode(delta.entityType, delta.entityId, baseGraph)),
                    );
                    if (isApiError(res)) {
                        error = res;
                    }
                }
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
                    dynamicHooks,
                    autoLoadRef,
                    activeUserOpsRef,
                    inFlightAutoFetches,
                    attemptedAutoFetches,
                );
                return executeApiCallWithHooks({ op: toStandardOp(actionName), data: args }, (payload) => {
                    const actualArgs = Array.isArray(payload) ? payload : [payload];
                    return (actionFn as any)(apiGraphInstance, ...actualArgs);
                });
            };
        }
    }

    const apiGraphMeta = {
        sync: (fresh: any, opt?: any) => {
            const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
            syncFn.call(baseGraph.meta ?? baseGraph, fresh, opt);
            notifyListeners({ type: "change", op: "sync", entities: fresh });
            scheduleAutoLoadReferences();
        },
        snapshot: () => {
            const snapFn = baseGraph.meta?.snapshot ?? baseGraph.snapshot;
            return {
                entities: snapFn.call(baseGraph.meta ?? baseGraph),
                pendingDeltas: JSON.parse(JSON.stringify(pendingDeltas)),
                idMappings: idMappings(),
            };
        },
        restore: (snap: any) => {
            attemptedAutoFetches.clear();
            inFlightAutoFetches.clear();
            const restoreFn = baseGraph.meta?.restore ?? baseGraph.restore;
            const target = baseGraph.meta ?? baseGraph;
            if (snap && typeof snap === "object" && "entities" in snap) {
                restoreFn.call(target, snap.entities);
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
                restoreFn.call(target, snap);
            }
            notifyListeners({ type: "change", op: "restore" });
            scheduleAutoLoadReferences();
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
        setAutoLoadReferences: (enabled: boolean) => {
            autoLoadRef.enabled = enabled;
            if (enabled) {
                scheduleAutoLoadReferences();
            }
        },
        isAutoLoadReferencesEnabled: () => autoLoadRef.enabled,
        addHook: (hooks: ApiHooks<any>): (() => void) => {
            dynamicHooks.add(hooks);
            return () => {
                dynamicHooks.delete(hooks);
            };
        },
        beginTransaction: (): ApiTransactionGraph<D> => {
            const txFn = baseGraph.meta?.beginTransaction ?? baseGraph.beginTransaction;
            const txCoreGraph = txFn.call(baseGraph.meta ?? baseGraph);
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
                dynamicHooks,
                autoLoadRef,
                activeUserOpsRef,
                inFlightAutoFetches,
                attemptedAutoFetches,
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

                    if (delta.op === "create") {
                        if (entityConfig?.create) {
                            const res = await executeApiCallWithHooks(
                                {
                                    op: "create",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                    data: delta.data,
                                },
                                (reqData) =>
                                    entityConfig.create!(
                                        reqData,
                                        wrapNode(delta.entityType, delta.entityId, txCoreGraph),
                                    ),
                            );
                            if (isApiError(res)) {
                                error = res;
                            } else if (res && typeof res === "object" && "id" in res) {
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
                                const syncFn = txCoreGraph.meta?.sync ?? txCoreGraph.sync;
                                syncFn.call(
                                    txCoreGraph.meta ?? txCoreGraph,
                                    { [delta.entityType]: [res] },
                                    { mode: "merge" },
                                );
                            }
                        }
                    } else if (delta.op === "update") {
                        if (entityConfig?.update) {
                            const res = await executeApiCallWithHooks(
                                {
                                    op: "update",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                    data: delta.data,
                                },
                                (reqData) =>
                                    entityConfig.update!(
                                        reqData,
                                        wrapNode(delta.entityType, delta.entityId, txCoreGraph),
                                    ),
                            );
                            if (isApiError(res)) {
                                error = res;
                            } else if (res && typeof res === "object" && "id" in res) {
                                const syncFn = txCoreGraph.meta?.sync ?? txCoreGraph.sync;
                                syncFn.call(
                                    txCoreGraph.meta ?? txCoreGraph,
                                    { [delta.entityType]: [res] },
                                    { mode: "merge" },
                                );
                            }
                        }
                    } else if (delta.op === "delete") {
                        if (entityConfig?.delete) {
                            const res = await executeApiCallWithHooks(
                                {
                                    op: "delete",
                                    entityType: delta.entityType,
                                    entityId: delta.entityId,
                                    data: delta.entityId,
                                },
                                (reqId) =>
                                    entityConfig.delete!(
                                        reqId,
                                        wrapNode(delta.entityType, delta.entityId, txCoreGraph),
                                    ),
                            );
                            if (isApiError(res)) {
                                error = res;
                            }
                        }
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

    const apiGraph = {
        meta: apiGraphMeta,
    };

    const apiGraphProxy = new Proxy(apiGraph, {
        get(target, p, receiver) {
            if (p === "then" || p === "toJSON") {
                return undefined;
            }
            if (p in target) {
                return (target as any)[p];
            }
            const propStr = String(p);
            if (propStr.startsWith("create") && propStr !== "create" && propStr !== "createEntity") {
                const type = propStr[6].toLowerCase() + propStr.slice(7);
                return async (data: any) => {
                    if (isTx) {
                        const tempId = data?.id ?? generateNewEntityId(type, data);
                        const optimisticEntity = { ...data, id: tempId };
                        const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
                        syncFn.call(baseGraph.meta ?? baseGraph, { [type]: [optimisticEntity] }, { mode: "merge" });
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

                    let finalData = data;
                    const response = await executeApiCallWithHooks(
                        { op: "create", entityType: type, data },
                        (reqData) => {
                            finalData = reqData;
                            const handlerNode = finalData?.id !== undefined ? wrapNode(type, finalData.id) : undefined;
                            return handlerNode
                                ? entityConfig.create!(reqData, handlerNode)
                                : entityConfig.create!(reqData);
                        },
                    );

                    if (isApiError(response)) {
                        if (response.isTransient === false) {
                            return response;
                        }
                        const tempId = finalData?.id ?? generateNewEntityId(type, finalData);
                        const optimisticEntity = { ...finalData, id: tempId };
                        const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
                        syncFn.call(baseGraph.meta ?? baseGraph, { [type]: [optimisticEntity] }, { mode: "merge" });

                        const delta: PendingDelta = {
                            id: generateUUID(),
                            entityType: type,
                            op: "create",
                            entityId: tempId,
                            data: finalData,
                            timestamp: Date.now(),
                            error: response,
                        };
                        pendingDeltas.push(delta);
                        notifyListeners({
                            type: "change",
                            op: "create",
                            entityType: type,
                            entityId: tempId,
                            data: finalData,
                        });
                        return wrapNode(type, tempId);
                    }

                    const resId = (response as any)?.id;
                    const tempId = finalData?.id;
                    if (tempId && resId && tempId !== resId) {
                        remapEntityId(baseGraph, type, tempId, resId, pendingDeltas);
                    }

                    const syncFn = baseGraph.meta?.sync ?? baseGraph.sync;
                    syncFn.call(baseGraph.meta ?? baseGraph, { [type]: [response] }, { mode: "merge" });
                    notifyListeners({
                        type: "change",
                        op: "create",
                        entityType: type,
                        entityId: resId,
                        data: response,
                    });
                    scheduleAutoLoadReferences();
                    return wrapNode(type, resId);
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

    scheduleAutoLoadReferences();
    return apiGraphProxy;
}

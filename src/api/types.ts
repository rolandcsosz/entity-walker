import { GraphDef, EntityBase, Entities, KeyOf, ReverseKeys, EntityMap, GraphEdges } from "../core/types";

export type ApiError = {
    message: string;
    code?: string | number;
    status?: number;
    isTransient?: boolean;
    raw?: any;
};

const API_ERROR_KEYS: ReadonlySet<string> = new Set<keyof ApiError>([
    "message",
    "code",
    "status",
    "isTransient",
    "raw",
]);

export function isApiError(value: unknown): value is ApiError {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj["message"] !== "string") return false;
    return Object.keys(obj).every((k) => API_ERROR_KEYS.has(k));
}

export type PendingDelta = {
    id: string;
    transactionId?: string;
    entityType: string;
    op: "create" | "update" | "delete";
    entityId?: string | number;
    data?: any;
    timestamp: number;
    error?: ApiError;
};

export type ApiGraphEventDetails<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"] & string]: {
        op?:
        | "create"
        | "update"
        | "delete"
        | "read"
        | "list"
        | "sync"
        | "commit"
        | "rollback"
        | "restore"
        | "flush"
        | string;
        entityType?: K;
        entityId?: D["entityModel"][K]["id"];
        data?: D["entityModel"][K];
    };
}[keyof D["entityModel"] & string];

export type ApiGraphEvent<D extends GraphDef<any, any> = GraphDef<any, any>> =
    | ({ type: "change"; entities?: Partial<Entities<D["entityModel"]>> } & Partial<ApiGraphEventDetails<D>>)
    | ({ type: "error"; error: ApiError } & Partial<ApiGraphEventDetails<D>>)
    | ({ type: "rollback"; error?: ApiError } & Partial<ApiGraphEventDetails<D>>)
    | ({ type: "offline"; error: ApiError } & Partial<ApiGraphEventDetails<D>>)
    | { type: "online" }
    | { type: "flush"; synced: PendingDelta[]; failed: { delta: PendingDelta; error: ApiError }[] };

export type ApiGraphSubscriber<D extends GraphDef<any, any> = GraphDef<any, any>> = (event: ApiGraphEvent<D>) => void;

export type AutoFlushOptions = {
    intervalMs?: number;
    onOnline?: boolean;
};

export type IsTransientFn = (error: ApiError) => boolean;

export type ApiHandlerResult<T = void> = Promise<T | void | ApiError> | T | void | ApiError;

export type ApiCallContext<D extends GraphDef<any, any> = GraphDef<any, any>> = {
    op: "create" | "update" | "delete" | "read" | "list" | undefined;
    entityType?: keyof D["entityModel"] & string;
    entityId?: string | number;
    data?: any;
};

export type ApiEntityCallContext<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"] & string = keyof D["entityModel"] & string,
> = {
    op: "create" | "update" | "delete" | "read" | "list" | undefined;
    entityType: K;
    entityId?: string | number;
    data?: any;
};

export type BeforeApiCallResult = void | boolean | { cancel?: boolean; data?: any };

export type ApiHooks<D extends GraphDef<any, any> = GraphDef<any, any>> = {
    beforeCall?: (context: ApiCallContext<D>) => Promise<BeforeApiCallResult> | BeforeApiCallResult;
    afterCall?: (context: ApiCallContext<D> & { result: any }) => Promise<any> | any;
    onError?: (context: ApiCallContext<D> & { error: ApiError }) => Promise<void | ApiError> | void | ApiError;
    onFinally?: (context: ApiCallContext<D> & { result?: any; error?: ApiError }) => Promise<void> | void;
};

export type ApiEntityHooks<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"] & string = keyof D["entityModel"] & string,
> = {
    beforeCall?: (context: ApiEntityCallContext<D, K>) => Promise<BeforeApiCallResult> | BeforeApiCallResult;
    afterCall?: (context: ApiEntityCallContext<D, K> & { result: any }) => Promise<any> | any;
    onError?: (context: ApiEntityCallContext<D, K> & { error: ApiError }) => Promise<void | ApiError> | void | ApiError;
    onFinally?: (context: ApiEntityCallContext<D, K> & { result?: any; error?: ApiError }) => Promise<void> | void;
};

export interface ApiEntityHandlers<E extends EntityBase> {
    create?(data: unknown, node?: any): ApiHandlerResult<E>;
    read?(id: E["id"], node?: any): ApiHandlerResult<E>;
    update?(data: unknown, node?: any): ApiHandlerResult<E>;
    delete?(id: E["id"], node?: any): ApiHandlerResult<void>;
    list?(params: any, nodeList?: any): ApiHandlerResult<E[]>;
}

export interface ApiEntityConfig<E extends EntityBase> extends ApiEntityHandlers<E> {
    isTransientError?: IsTransientFn;
}

export interface ApiEntityGraphConfig<
    D extends GraphDef<any, any>,
    E extends D["entityModel"][keyof D["entityModel"]] = D["entityModel"][keyof D["entityModel"]],
> extends ApiEntityConfig<E> {
    create?(data: unknown, node?: ApiNode<D, E>): ApiHandlerResult<E>;
    read?(id: E["id"], node?: ApiNode<D, E>): ApiHandlerResult<E>;
    update?(data: unknown, node?: ApiNode<D, E>): ApiHandlerResult<E>;
    delete?(id: E["id"], node?: ApiNode<D, E>): ApiHandlerResult<void>;
    list?(params: any, nodeList?: ApiNodeList<D, E>): ApiHandlerResult<E[]>;
    actions?: Record<string, (node: ApiNode<D, E>, ...args: any[]) => Promise<any>>;
    hooks?: ApiEntityHooks<D, KeyOf<D, E> & keyof D["entityModel"] & string>;
}

export type NewIdFormatter = (entity: string, index: number, data?: any) => string | number;

export type ValidApi<D extends GraphDef<any, any>> = {
    isTransientError?: IsTransientFn;
    idFormat?: NewIdFormatter;
    hooks?: ApiHooks<D>;
    actions?: Record<string, (graph: any, ...args: any[]) => Promise<any>>;
} & {
    [K in keyof D["entityModel"]]?: ApiEntityGraphConfig<D, D["entityModel"][K]>;
};

export type ApiGraphOptions<D extends GraphDef<any, any>> = ValidApi<D>;

/** Bundles schema, edges and api into a single definition for use with `createGraph<ApiGraphDef>`. */
export interface ApiGraphDef<
    EM extends EntityMap = EntityMap,
    E extends GraphEdges<EM> = GraphEdges<EM>,
    Api extends ValidApi<GraphDef<EM, E>> = ValidApi<GraphDef<EM, E>>,
> extends GraphDef<EM, E> {
    api: Api;
}

type ApiGraphBase<D extends GraphDef<any, any>> = GraphDef<D["entityModel"], D["edges"]>;

type ApiOptions<D extends GraphDef<any, any>> = D extends { api: infer Api }
    ? Api extends ValidApi<ApiGraphBase<D>>
    ? Api
    : ValidApi<ApiGraphBase<D>>
    : ValidApi<ApiGraphBase<D>>;

type ApiEntityOptions<D extends GraphDef<any, any>, E extends EntityBase> = ApiOptions<D>[KeyOf<D, E> &
    keyof ApiOptions<D>];

type ApiListLoad<D extends GraphDef<any, any>, E extends EntityBase> = ApiEntityOptions<D, E> extends {
    readonly list: (...args: infer P) => any;
}
    ? P extends []
        ? (options?: { force?: boolean }) => Promise<ApiNodeList<D, E>>
        : (params: P[0], options?: { force?: boolean }) => Promise<ApiNodeList<D, E>>
    : (options?: { force?: boolean }) => Promise<ApiNodeList<D, E>>;

export type ApiNode<D extends GraphDef<any, any>, E extends EntityBase> = {
    value(): E | undefined;
    exists(): boolean;
    load(): Promise<ApiNode<D, E>>;
    delete(): Promise<
        ApiEntityOptions<D, E> extends { readonly delete: (...args: any[]) => Promise<infer R> } ? R : void | ApiError
    >;
    update(
        fn: (entity: E) => Partial<E> | E,
    ): Promise<
        ApiEntityOptions<D, E> extends { readonly update: (...args: any[]) => Promise<infer R> } ? R : void | ApiError
    >;
    api: ApiEntityOptions<D, E> extends { readonly actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (node: any, ...args: infer P) => infer R
                  ? (...args: P) => Promise<Awaited<R>>
                  : never;
          }
        : {};
} & {
    [Rel in keyof D["edges"][KeyOf<D, E>]]: () => ApiNode<D, D["entityModel"][Rel & keyof D["entityModel"]]>;
} & {
    [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => ApiNodeList<
        D,
        D["entityModel"][SourceEntity & keyof D["entityModel"]]
    >;
};

export type ApiCustomNode<D extends GraphDef<any, any>, E extends EntityBase> = ApiNode<D, E>;

export type ApiNodeList<D extends GraphDef<any, any>, E extends EntityBase> = ApiNode<D, E>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load: ApiListLoad<D, E>;
};

export type ApiCustomNodeList<D extends GraphDef<any, any>, E extends EntityBase> = ApiNodeList<D, E>;

export type ApiGraphSnapshot<D extends GraphDef<any, any>> = {
    entities: Entities<D["entityModel"]>;
    pendingDeltas: PendingDelta[];
    idMappings?: Record<string | number, string | number>;
};

type WrapApiGraphMeta<D extends GraphDef<any, any>> =
    ApiOptions<D> extends { actions: infer Actions }
        ? [keyof Actions] extends [never]
            ? ApiGraphMeta<D>
            : ApiCustomGraphMeta<D>
        : ApiGraphMeta<D>;

export interface ApiGraphMeta<D extends GraphDef<any, any>> {
    sync(fresh: Partial<Entities<D["entityModel"]>>, options?: { mode?: "merge" | "replace" }): void;
    snapshot(): ApiGraphSnapshot<D>;
    restore(snapshot: ApiGraphSnapshot<D> | Entities<D["entityModel"]>): void;
    pendingChanges(): PendingDelta[];
    flushPending(): Promise<{ synced: PendingDelta[]; failed: { delta: PendingDelta; error: ApiError }[] }>;
    clearPending(): void;
    beginTransaction(): ApiTransactionGraph<D>;
    subscribe(subscriber: ApiGraphSubscriber<D>): () => void;
    startAutoFlush(options?: AutoFlushOptions): () => void;
    resolveId(id: string | number): string | number;
    getOriginalId(id: string | number): string | number;
    setIdFormat(formatter: NewIdFormatter): void;
    addHook(hooks: ApiHooks<D>): () => void;
    api: {};
}

export type ApiCustomGraphMeta<D extends GraphDef<any, any>> = ApiGraphMeta<D> & {
    api: ApiOptions<D> extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (graph: any, ...args: infer P) => infer R
                  ? (...args: P) => Promise<Awaited<R>>
                  : never;
          }
        : {};
};

export type ApiTransactionGraph<D extends GraphDef<any, any>> = ApiGraph<D> & {
    commit(): Promise<{ success: boolean; error?: ApiError }>;
    rollback(): void;
};

export type ApiGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => ApiNode<D, D["entityModel"][K]>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: () => ApiNodeList<D, D["entityModel"][K]>;
} & {
    [K in keyof D["entityModel"] as `create${Capitalize<string & K>}`]: ApiOptions<D>[K] extends {
        create: infer Create;
    }
        ? Create extends (data: infer P) => any
            ? (data: P) => Promise<ApiNode<D, D["entityModel"][K]>>
            : (
                  data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
              ) => Promise<ApiNode<D, D["entityModel"][K]>>
        : (
              data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
          ) => Promise<ApiNode<D, D["entityModel"][K]>>;
} & {
    meta: WrapApiGraphMeta<D>;
};

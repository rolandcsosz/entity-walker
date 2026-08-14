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

export interface ApiEntityConfig<D extends GraphDef<any, any>, E extends EntityBase> {
    create?(data: unknown): ApiHandlerResult<E>;
    read?(data: unknown): ApiHandlerResult<E>;
    update?(data: unknown): ApiHandlerResult<E>;
    delete?(data: unknown): ApiHandlerResult<void>;
    list?(data: unknown): ApiHandlerResult<E[]>;
    actions?: Record<string, (node: ApiNode<D, E>, ...args: any[]) => Promise<any>>;
    isTransientError?: IsTransientFn;
}

export type NewIdFormatter = (entity: string, index: number, data?: any) => string | number;

export type ValidApi<D extends GraphDef<any, any>> = {
    isTransientError?: IsTransientFn;
    idFormat?: NewIdFormatter;
    actions?: Record<string, (graph: any, ...args: any[]) => Promise<any>>;
} & {
    [K in keyof D["entityModel"]]?: ApiEntityConfig<D, D["entityModel"][K]>;
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

export type ApiNode<D extends GraphDef<any, any>, E extends EntityBase> = {
    value(): E | undefined;
    exists(): boolean;
    load(): Promise<ApiNode<D, E>>;
    delete(): Promise<void | ApiError>;
    update(fn: (entity: E) => Partial<E> | E): Promise<void | ApiError>;
    api: {};
} & {
    [Rel in keyof D["edges"][KeyOf<D, E>]]: () => ApiNode<D, D["entityModel"][Rel & keyof D["entityModel"]]>;
} & {
    [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => ApiNodeList<
        D,
        D["entityModel"][SourceEntity & keyof D["entityModel"]]
    >;
};

export type ApiCustomNode<D extends GraphDef<any, any>, E extends EntityBase, Config> = {
    load(): Promise<ApiCustomNode<D, E, Config>>;
    delete(): Promise<Config extends { readonly delete: (...args: any[]) => Promise<infer R> } ? R : void | ApiError>;
    update(
        fn: (entity: E) => Partial<E> | E,
    ): Promise<Config extends { readonly update: (...args: any[]) => Promise<infer R> } ? R : void | ApiError>;
    api: Config extends { readonly actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (node: ApiNode<D, E>) => infer R
                  ? () => Promise<Awaited<R>>
                  : Actions[K] extends (node: ApiNode<D, E>, payload: infer P) => infer R
                    ? (payload: P) => Promise<Awaited<R>>
                    : never;
          }
        : {};
} & ApiNode<D, E>;

export type ApiNodeList<D extends GraphDef<any, any>, E extends EntityBase> = ApiNode<D, E>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load(options?: { force?: boolean }): Promise<ApiNodeList<D, E>>;
};

export type ApiCustomNodeList<D extends GraphDef<any, any>, E extends EntityBase, Config> = ApiCustomNode<
    D,
    E,
    Config
>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load(options?: { force?: boolean }): Promise<ApiCustomNodeList<D, E, Config>>;
};

export type ApiGraphSnapshot<D extends GraphDef<any, any>> = {
    entities: Entities<D["entityModel"]>;
    pendingDeltas: PendingDelta[];
    idMappings?: Record<string | number, string | number>;
};

type WrapApiGraphMeta<D extends GraphDef<any, any>, Opt extends ValidApi<D> = ValidApi<D>> = Opt extends {
    actions: infer Actions;
}
    ? [keyof Actions] extends [never]
        ? ApiGraphMeta<D, Opt>
        : ApiCustomGraphMeta<D, Opt>
    : ApiGraphMeta<D, Opt>;

export type ApiGraphMeta<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = {
    sync(fresh: Partial<Entities<D["entityModel"]>>, options?: { mode?: "merge" | "replace" }): void;
    snapshot(): ApiGraphSnapshot<D>;
    restore(snapshot: ApiGraphSnapshot<D> | Entities<D["entityModel"]>): void;
    pendingChanges(): PendingDelta[];
    flushPending(): Promise<{ synced: PendingDelta[]; failed: { delta: PendingDelta; error: ApiError }[] }>;
    clearPending(): void;
    beginTransaction(): ApiTransactionGraph<D, Options>;
    subscribe(subscriber: ApiGraphSubscriber<D>): () => void;
    startAutoFlush(options?: AutoFlushOptions): () => void;
    resolveId(id: string | number): string | number;
    getOriginalId(id: string | number): string | number;
    setIdFormat(formatter: NewIdFormatter): void;
    api: {};
};

export type ApiCustomGraphMeta<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = ApiGraphMeta<
    D,
    Options
> & {
    beginTransaction(): ApiTransactionGraph<D, Options>;
    api: Options extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (graph: ApiGraph<D, Options>) => infer R
                  ? () => Promise<Awaited<R>>
                  : Actions[K] extends (graph: ApiGraph<D, Options>, payload: infer P) => infer R
                    ? (payload: P) => Promise<Awaited<R>>
                    : never;
          }
        : {};
};

export type ApiTransactionGraph<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = ApiGraph<
    D,
    Options
> & {
    commit(): Promise<{ success: boolean; error?: ApiError }>;
    rollback(): void;
};

type ResolveApiNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"] & string,
    Options extends ValidApi<D>,
> = Options[K] extends { readonly actions: any } | { readonly update: any } | { readonly delete: any }
    ? ApiCustomNode<D, D["entityModel"][K], Options[K]>
    : ApiNode<D, D["entityModel"][K]>;

type ResolveApiNodeList<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"] & string,
    Options extends ValidApi<D>,
> = Options[K] extends { readonly actions: any } | { readonly update: any } | { readonly delete: any }
    ? ApiCustomNodeList<D, D["entityModel"][K], Options[K]>
    : ApiNodeList<D, D["entityModel"][K]>;

export type ApiGraph<
    D extends GraphDef<any, any>,
    Options extends ValidApi<D> = D extends { api: ValidApi<D> } ? D["api"] : ValidApi<D>,
> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => ResolveApiNode<D, K & string, Options>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: () => ResolveApiNodeList<D, K & string, Options>;
} & {
    [K in keyof D["entityModel"] as `create${Capitalize<string & K>}`]: Options[K] extends { create: infer Create }
        ? Create extends (data: infer P) => any
            ? (data: P) => Promise<ResolveApiNode<D, K & string, Options>>
            : (
                  data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
              ) => Promise<ResolveApiNode<D, K & string, Options>>
        : (
              data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
          ) => Promise<ResolveApiNode<D, K & string, Options>>;
} & {
    meta: WrapApiGraphMeta<D, Options>;
};

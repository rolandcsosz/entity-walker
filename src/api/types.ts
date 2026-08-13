import { GraphDef, EntityBase, Entities, KeyOf, ReverseKeys } from "../core/types";

export type ApiError = {
    message: string;
    code?: string | number;
    status?: number;
    isTransient?: boolean;
    raw?: any;
};

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

export interface ApiEntityConfig<D extends GraphDef<any, any>, E extends EntityBase> {
    create?: (data: Omit<E, "id"> & { id?: E["id"] }) => Promise<E | ApiError> | E | ApiError;
    read?: (id: E["id"]) => Promise<E | ApiError> | E | ApiError;
    update?: (data: E) => Promise<E | void | undefined | ApiError> | E | void | undefined | ApiError;
    delete?: (id: E["id"]) => Promise<void | ApiError> | void | ApiError;
    list?: () => Promise<E[] | ApiError> | E[] | ApiError;
    actions?: Record<string, (node: ApiEntityNode<D, E>, ...args: any[]) => Promise<any>>;
    isTransientError?: IsTransientFn;
}

export type NewIdFormatter = (entity: string, index: number, data?: any) => string | number;

export type ValidApi<D extends GraphDef<any, any>> = {
    isTransientError?: IsTransientFn;
    idFormat?: NewIdFormatter;
} & {
    [K in keyof D["entityModel"] | "actions"]?: K extends "actions"
        ? Record<string, (graph: any, ...args: any[]) => Promise<any>>
        : ApiEntityConfig<D, D["entityModel"][K & keyof D["entityModel"]]>;
};

export type ApiGraphOptions<D extends GraphDef<any, any>> = ValidApi<D>;

type WrapApiNode<D extends GraphDef<any, any>, E extends EntityBase, Opt> = Opt extends { actions: infer Actions }
    ? [keyof Actions] extends [never]
        ? ApiEntityNode<D, E>
        : ApiCustomEntityNode<D, E, Opt>
    : ApiEntityNode<D, E>;

type WrapApiNodeList<D extends GraphDef<any, any>, E extends EntityBase, Opt> = Opt extends { actions: infer Actions }
    ? [keyof Actions] extends [never]
        ? ApiEntityNodeList<D, E>
        : ApiCustomEntityNodeList<D, E, Opt>
    : ApiEntityNodeList<D, E>;

export type ApiEntityNode<D extends GraphDef<any, any>, E extends EntityBase> = {
    value(): E | undefined;
    exists(): boolean;
    load(): Promise<ApiEntityNode<D, E>>;
    delete(): Promise<void | ApiError>;
    update(fn: (entity: E) => Partial<E> | E): Promise<void | ApiError>;
    api: Record<string, (...args: any[]) => Promise<any>>;
} & {
    [Rel in keyof D["edges"][KeyOf<D, E>]]: () => ApiEntityNode<D, D["entityModel"][Rel & keyof D["entityModel"]]>;
} & {
    [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => ApiEntityNodeList<
        D,
        D["entityModel"][SourceEntity & keyof D["entityModel"]]
    >;
};

export type ApiCustomEntityNode<D extends GraphDef<any, any>, E extends EntityBase, Config> = ApiEntityNode<D, E> & {
    load(): Promise<ApiCustomEntityNode<D, E, Config>>;
    delete(): Promise<Config extends { delete: (...args: any[]) => Promise<infer R> } ? R : void | ApiError>;
    update(
        fn: (entity: E) => Partial<E> | E,
    ): Promise<Config extends { update: (...args: any[]) => Promise<infer R> } ? R : void | ApiError>;
    api: Config extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (node: any, ...args: infer Args) => Promise<infer R>
                  ? (...args: Args) => Promise<R>
                  : never;
          }
        : {};
};

export type ApiEntityNodeList<D extends GraphDef<any, any>, E extends EntityBase> = ApiEntityNode<D, E>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load(options?: { force?: boolean }): Promise<ApiEntityNodeList<D, E>>;
};

export type ApiCustomEntityNodeList<D extends GraphDef<any, any>, E extends EntityBase, Config> = ApiCustomEntityNode<
    D,
    E,
    Config
>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load(options?: { force?: boolean }): Promise<ApiCustomEntityNodeList<D, E, Config>>;
};

export type ApiNode<D extends GraphDef<any, any>, E extends EntityBase = any> = ApiEntityNode<D, E>;
export type ApiNodeList<D extends GraphDef<any, any>, E extends EntityBase = any> = ApiEntityNodeList<D, E>;

export type ApiGraphSnapshot<D extends GraphDef<any, any>> = {
    entities: Entities<D["entityModel"]>;
    pendingDeltas: PendingDelta[];
    idMappings?: Record<string | number, string | number>;
};

type WrapApiGraphMeta<D extends GraphDef<any, any>, Opt extends ValidApi<D> = ValidApi<D>> = Opt extends {
    actions: infer Actions;
}
    ? [keyof Actions] extends [never]
        ? ApiGraphMeta<D>
        : ApiCustomGraphMeta<D, Opt>
    : ApiGraphMeta<D>;

export type ApiGraphMeta<D extends GraphDef<any, any>> = {
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
    api: Record<string, (...args: any[]) => Promise<any>>;
};

export type ApiCustomGraphMeta<
    D extends GraphDef<any, any>,
    Options extends ValidApi<D> = ValidApi<D>,
> = ApiGraphMeta<D> & {
    beginTransaction(): ApiTransactionGraph<D>;
    api: Options extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (graph: any, ...args: infer Args) => Promise<infer R>
                  ? (...args: Args) => Promise<R>
                  : never;
          }
        : {};
};

export type ApiTransactionGraph<D extends GraphDef<any, any>> = ApiGraph<D> & {
    commit(): Promise<{ success: boolean; error?: ApiError }>;
    rollback(): void;
};

export type ApiGraph<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => WrapApiNode<D, D["entityModel"][K], Options[K]>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: () => WrapApiNodeList<D, D["entityModel"][K], Options[K]>;
} & {
    [K in keyof D["entityModel"] as `create${Capitalize<string & K>}`]: (
        data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
    ) => Promise<WrapApiNode<D, D["entityModel"][K], Options[K]>>;
} & {
    meta: WrapApiGraphMeta<D, Options>;
};

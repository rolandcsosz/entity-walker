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

export interface ApiEntityConfig<D extends GraphDef<any, any>, E extends EntityBase> {
    create?: (data: Omit<E, "id">) => Promise<E | ApiError> | E | ApiError;
    read?: (id: E["id"]) => Promise<E | ApiError> | E | ApiError;
    update?: (data: E) => Promise<E | void | undefined | ApiError> | E | void | undefined | ApiError;
    delete?: (id: E["id"]) => Promise<void | ApiError> | void | ApiError;
    list?: () => Promise<E[] | ApiError> | E[] | ApiError;
    actions?: Record<string, (node: ApiEntityNode<D, E, any>, ...args: any[]) => Promise<any>>;
}

export type ValidApi<D extends GraphDef<any, any>> = {
    isTransientError?: (error: ApiError) => boolean;
} & {
    [K in keyof D["entityModel"] | "actions"]?: K extends "actions"
        ? Record<string, (graph: any, ...args: any[]) => Promise<any>>
        : ApiEntityConfig<D, D["entityModel"][K & keyof D["entityModel"]]>;
};

export type ApiGraphOptions<D extends GraphDef<any, any>> = ValidApi<D>;

export type ApiEntityNode<
    D extends GraphDef<any, any>,
    E extends EntityBase,
    Config extends ApiEntityConfig<D, E> | undefined = undefined,
> = {
    value(): E | undefined;
    exists(): boolean;
    load(): Promise<ApiEntityNode<D, E, Config>>;
    delete(): Promise<Config extends { delete: (...args: any[]) => Promise<infer R> } ? R : void>;
    update(
        fn: (entity: E) => Partial<E> | E,
    ): Promise<Config extends { update: (...args: any[]) => Promise<infer R> } ? R : void>;
    api: Config extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (node: any, ...args: infer Args) => Promise<infer R>
                  ? (...args: Args) => Promise<R>
                  : never;
          }
        : {};
} & {
    [Rel in keyof D["edges"][KeyOf<D, E>]]: () => ApiEntityNode<
        D,
        D["entityModel"][Rel & keyof D["entityModel"]],
        Config
    >;
} & {
    [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => ApiEntityNodeList<
        D,
        D["entityModel"][SourceEntity & keyof D["entityModel"]],
        Config
    >;
};

export type ApiEntityNodeList<
    D extends GraphDef<any, any>,
    E extends EntityBase,
    Config extends ApiEntityConfig<D, E> | undefined = undefined,
> = ApiEntityNode<D, E, Config>[] & {
    entities(): E[];
    ids(): (string | number)[];
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    load(options?: { force?: boolean }): Promise<ApiEntityNodeList<D, E, Config>>;
};

export type ApiGraphSnapshot<D extends GraphDef<any, any>> = {
    entities: Entities<D["entityModel"]>;
    pendingDeltas: PendingDelta[];
};

export type ApiTransactionGraph<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = ApiGraph<
    D,
    Options
> & {
    commit(): Promise<{ success: boolean; error?: ApiError }>;
    rollback(): void;
};

export type ApiGraph<D extends GraphDef<any, any>, Options extends ValidApi<D> = ValidApi<D>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => ApiEntityNode<D, D["entityModel"][K], Options[K]>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: () => ApiEntityNodeList<D, D["entityModel"][K], Options[K]>;
} & {
    createEntity<K extends keyof D["entityModel"] & string>(
        type: K,
        data: Omit<D["entityModel"][K], "id">,
    ): Promise<ApiEntityNode<D, D["entityModel"][K], Options[K]>>;
} & {
    [K in keyof D["entityModel"] as `create${Capitalize<string & K>}`]: (
        data: Omit<D["entityModel"][K], "id">,
    ) => Promise<ApiEntityNode<D, D["entityModel"][K], Options[K]>>;
} & {
    [K in keyof D["entityModel"] as `update${Capitalize<string & K>}`]: (data: D["entityModel"][K]) => Promise<any>;
} & {
    sync(fresh: Partial<Entities<D["entityModel"]>>, options?: { mode?: "merge" | "replace" }): void;
    snapshot(): ApiGraphSnapshot<D>;
    restore(snapshot: ApiGraphSnapshot<D> | Entities<D["entityModel"]>): void;
    pendingChanges(): PendingDelta[];
    flushPending(): Promise<{ synced: PendingDelta[]; failed: { delta: PendingDelta; error: ApiError }[] }>;
    clearPending(): void;
    beginTransaction(): ApiTransactionGraph<D, Options>;
    subscribe(subscriber: ApiGraphSubscriber<D>): () => void;
    startAutoFlush(options?: AutoFlushOptions): () => void;
    api: Options extends { actions: infer Actions }
        ? {
              [K in keyof Actions]: Actions[K] extends (graph: any, ...args: infer Args) => Promise<infer R>
                  ? (...args: Args) => Promise<R>
                  : never;
          }
        : {};
};

export type EntityBase = { id: string | number };

type ForbiddenKeys = "to" | "info" | "schema" | "meta" | `${string}Nodes` | `create${string}`;
type InvalidKeys<T> = {
    [K in keyof T as K extends ForbiddenKeys ? K : never]: never;
};

export type ValidSchema<T extends EntityMap> = keyof InvalidKeys<T> extends never
    ? T
    : "❌ Schema contains forbidden keys";

export type EntityMap = {
    [key: string]: EntityBase;
};

type Where<T> = (entity: T) => boolean;

export type Entities<T> = {
    [K in keyof T]: T[K][];
};

export type EdgeDef<Source> = {
    bidirectional?: boolean;
    resolve: (entity: Source) => string | number | undefined;
};

export type GraphEdges<EM extends EntityMap> = {
    [K in keyof EM]?: {
        [Rel in Exclude<keyof EM, K>]?: EdgeDef<EM[K]>;
    };
};

export interface GraphDef<EM extends EntityMap = EntityMap, E extends GraphEdges<EM> = GraphEdges<EM>> {
    entityModel: EM;
    edges: E;
}

export type ReverseKeys<D extends GraphDef<any, any>, TargetKey extends keyof D["entityModel"]> = {
    [SourceKey in keyof D["edges"]]: {
        [RelName in keyof D["edges"][SourceKey]]: RelName extends TargetKey
            ? D["edges"][SourceKey][RelName] extends { bidirectional: true }
                ? SourceKey
                : never
            : never;
    }[keyof D["edges"][SourceKey]];
}[keyof D["edges"]];

export type AllIncomingSourceKeys<D extends GraphDef<any, any>, TargetKey extends keyof D["entityModel"]> = {
    [SourceKey in keyof D["edges"]]: TargetKey extends keyof D["edges"][SourceKey] ? SourceKey : never;
}[keyof D["edges"]];

export type KeyOf<D extends GraphDef<any, any>, E> = {
    [K in keyof D["entityModel"]]: D["entityModel"][K] extends E ? (E extends D["entityModel"][K] ? K : never) : never;
}[keyof D["entityModel"]];

export type EntityNodeList<D extends GraphDef<any, any>, E extends EntityBase> = EntityNode<D, E>[] & {
    entities(): E[];
    select<R>(fn: (entity: E) => R): R[];
    ids(): (string | number)[];
    first(): E | undefined;
    findEntity(predicate: (entity: E) => boolean): E | undefined;
    findNode(predicate: (entity: E) => boolean): EntityNode<D, E> | undefined;
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    unique(): EntityNodeList<D, E>;
    where(where: Where<E>): EntityNodeList<D, E>;
    whereNode(where: (node: EntityNode<D, E>) => boolean): EntityNodeList<D, E>;
    intersect(other: EntityNodeList<D, E> | E[] | (string | number)[]): EntityNodeList<D, E>;
    with<T>(fn: (self: EntityNodeList<D, E>) => T): T;
    scoped(): EntityNodeList<D, E>;
    resetScope(): EntityNodeList<D, E>;
    info(): ListDebugInfo;
} & {
    [Rel in keyof D["edges"][KeyOf<D, E>] as `${string & Rel}Nodes`]: () => EntityNodeList<
        D,
        D["entityModel"][Rel & keyof D["entityModel"]]
    >;
} & {
    [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => EntityNodeList<
        D,
        D["entityModel"][SourceEntity & keyof D["entityModel"]]
    >;
};

export type GraphEdgeSummary = {
    from: string;
    to: string;
    bidirectional: boolean;
};

export type GraphSchema = {
    entities: string[];
    edges: GraphEdgeSummary[];
};

export type MissingEntityRef = { type: string; id: string | number };

export type GraphDebugInfo = {
    entityCounts: Record<string, number>;
    cache: { nodeCount: number };
    missingEntities: MissingEntityRef[];
    orphanEntities: Record<string, string[]>;
};

export type NodeDebugInfo = {
    type: string;
    id: string | number | null;
    exists: boolean;
    path: string[];
    value: any;
};

export type ListDebugInfo = {
    type: string;
    length: number;
    scope: Record<string, (string | number)[]> | null;
};

export type EntityNode<D extends GraphDef<any, any>, E extends EntityBase> = {
    value(): E | undefined;
    valueOrThrow(): E;
    exists(): boolean;
    path(): string[];
    info(): NodeDebugInfo;
    delete(): void;
    update(fn: (entity: E) => E): void;
} & ([AllIncomingSourceKeys<D, KeyOf<D, E>>] extends [never] ? {} : { deleteCascade(): void }) & {
        [Rel in keyof D["edges"][KeyOf<D, E>]]: () => EntityNode<D, D["entityModel"][Rel & keyof D["entityModel"]]>;
    } & {
        [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string & SourceEntity}Nodes`]: () => EntityNodeList<
            D,
            D["entityModel"][SourceEntity & keyof D["entityModel"]]
        >;
    };

export type EntityGraphMeta<D extends GraphDef<any, any>, Tx = TransactionGraph<D>> = {
    info(): GraphDebugInfo;
    schema(): GraphSchema;
    snapshot(): Entities<D["entityModel"]>;
    restore(snapshot: Entities<D["entityModel"]>): void;
    sync(fresh: Partial<Entities<D["entityModel"]>>, options?: { mode?: "merge" | "replace" }): void;
    beginTransaction(): Tx;
};

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => EntityNode<D, D["entityModel"][K]>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: () => EntityNodeList<D, D["entityModel"][K]>;
} & {
    meta: EntityGraphMeta<D>;
} & {
    [K in keyof D["entityModel"] as `create${Capitalize<string & K>}`]: (
        data: Omit<D["entityModel"][K], "id"> & { id?: D["entityModel"][K]["id"] },
    ) => EntityNode<D, D["entityModel"][K]>;
};

export type TransactionGraph<D extends GraphDef<any, any>> = EntityGraph<D> & {
    commit(): void;
    rollback(): void;
};

export type EntityNodeNoProxy<D extends GraphDef<any, any>, E extends EntityBase> = {
    value(): E | undefined;
    valueOrThrow(): E;
    exists(): boolean;
    path(): string[];
    info(): NodeDebugInfo;
    delete(): void;
    update(fn: (entity: E) => E): void;
} & ([AllIncomingSourceKeys<D, KeyOf<D, E>>] extends [never] ? {} : { deleteCascade(): void }) & {
        to<Target extends EntityBase>(): EntityNodeNoProxy<D, Target>;
        to<Key extends keyof D["entityModel"] & string>(rel: Key): EntityNodeNoProxy<D, D["entityModel"][Key]>;
        to<Nodes extends `${string & ReverseKeys<D, KeyOf<D, E>>}Nodes`>(
            rel: Nodes,
        ): EntityNodeListNoProxy<
            D,
            D["entityModel"][Extract<Nodes, string> extends `${infer U}Nodes` ? U & keyof D["entityModel"] : never]
        >;
    };

export type EntityNodeListNoProxy<D extends GraphDef<any, any>, E extends EntityBase> = EntityNodeNoProxy<D, E>[] & {
    entities(): E[];
    select<R>(fn: (entity: E) => R): R[];
    first(): E | undefined;
    findEntity(predicate: (entity: E) => boolean): E | undefined;
    findNode(predicate: (entity: E) => boolean): EntityNodeNoProxy<D, E> | undefined;
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    ids(): (string | number)[];
    unique(): EntityNodeListNoProxy<D, E>;
    where(where: Where<E>): EntityNodeListNoProxy<D, E>;
    whereNode(where: (node: EntityNodeNoProxy<D, E>) => boolean): EntityNodeListNoProxy<D, E>;
    intersect(other: EntityNodeListNoProxy<D, E> | E[] | (string | number)[]): EntityNodeListNoProxy<D, E>;
    with<T>(fn: (self: EntityNodeListNoProxy<D, E>) => T): T;
    scoped(): EntityNodeListNoProxy<D, E>;
    resetScope(): EntityNodeListNoProxy<D, E>;
    info(): ListDebugInfo;
    to<Target extends EntityBase>(): EntityNodeListNoProxy<D, Target>;
    to<Nodes extends `${string & (keyof D["edges"][KeyOf<D, E>] | ReverseKeys<D, KeyOf<D, E>>)}Nodes`>(
        rel: Nodes,
    ): Nodes extends `${infer Src}Nodes`
        ? EntityNodeListNoProxy<D, D["entityModel"][Src & keyof D["entityModel"]]>
        : never;
};

export type EntityGraphNoProxy<D extends GraphDef<any, any>> = {
    to<Key extends keyof D["entityModel"] & string>(
        type: Key,
        id?: string,
    ): EntityNodeNoProxy<D, D["entityModel"][Key]>;
    to<Nodes extends `${keyof D["entityModel"] & string}Nodes`>(
        type: Nodes,
    ): EntityNodeListNoProxy<
        D,
        D["entityModel"][Extract<Nodes, string> extends `${infer U}Nodes` ? U & keyof D["entityModel"] : never]
    >;
    create<Key extends keyof D["entityModel"] & string>(
        type: Key,
        data: Omit<D["entityModel"][Key], "id"> & { id?: D["entityModel"][Key]["id"] },
    ): EntityNodeNoProxy<D, D["entityModel"][Key]>;
    create<Key extends keyof D["entityModel"] & string>(
        type: Key,
        data: (Omit<D["entityModel"][Key], "id"> & { id?: D["entityModel"][Key]["id"] })[],
    ): EntityNodeListNoProxy<D, D["entityModel"][Key]>;
    meta: EntityGraphMeta<D, TransactionGraphNoProxy<D>>;
};

export type TransactionGraphNoProxy<D extends GraphDef<any, any>> = EntityGraphNoProxy<D> & {
    commit(): void;
    rollback(): void;
};

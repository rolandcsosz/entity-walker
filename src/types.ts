

export type EntityBase = { id: string | number };

type ForbiddenKeys =
    | "to"
    | "info"
    | "schema"
    | `${string}Nodes`
    | `update${string}`;
type InvalidKeys<T> = {
    [K in keyof T as K extends ForbiddenKeys ? K : never]: never;
};

export type ValidSchema<T extends EntityMap> =
    keyof InvalidKeys<T> extends never
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


export interface GraphDef<EM extends EntityMap, E extends GraphEdges<EM>> {
    entityModel: EM;
    edges: E;
}

type ReverseKeys<
    D extends GraphDef<any, any>,
    TargetKey extends keyof D["entityModel"]
> = {
    [SourceKey in keyof D["edges"]]: {
        [RelName in keyof D["edges"][SourceKey]]: RelName extends TargetKey
        ? D["edges"][SourceKey][RelName] extends { bidirectional: true }
        ? SourceKey
        : never
        : never;
    }[keyof D["edges"][SourceKey]];
}[keyof D["edges"]];

type AllIncomingSourceKeys<
    D extends GraphDef<any, any>,
    TargetKey extends keyof D["entityModel"]
> = {
    [SourceKey in keyof D["edges"]]: TargetKey extends keyof D["edges"][SourceKey]
    ? SourceKey
    : never;
}[keyof D["edges"]];

type KeyOf<D extends GraphDef<any, any>, E> = {
    [K in keyof D["entityModel"]]: D["entityModel"][K] extends E
    ? E extends D["entityModel"][K]
    ? K
    : never
    : never;
}[keyof D["entityModel"]];

export type EntityNodeList<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = EntityNode<D, D["entityModel"][K]>[] & {
    entities(): D["entityModel"][K][];
    select<R>(fn: (entity: D["entityModel"][K]) => R): R[];
    ids(): (string | number)[];
    first(): D["entityModel"][K] | undefined;
    findEntity(predicate: (entity: D["entityModel"][K]) => boolean): D["entityModel"][K] | undefined;
    findNode(predicate: (entity: D["entityModel"][K]) => boolean): EntityNode<D, D["entityModel"][K]> | undefined;
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    unique(): EntityNodeList<D, K>;
    where(where: Where<D["entityModel"][K]>): EntityNodeList<D, K>;
    whereNode(where: (node: EntityNode<D, D["entityModel"][K]>) => boolean): EntityNodeList<D, K>;
    intersect(other: EntityNodeList<D, K> | D["entityModel"][K][] | (string | number)[]): EntityNodeList<D, K>;
    with<T>(fn: (self: EntityNodeList<D, K>) => T): T;
} & {
        [Rel in keyof D["edges"][K]as `${string & Rel}Nodes`]: () => EntityNodeList<D, Rel & keyof D["entityModel"]>;
    } & {
        [SourceEntity in ReverseKeys<D, K> as `${string &
        SourceEntity}Nodes`]: () => EntityNodeList<D, SourceEntity>;
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

export type EntityNode<
    D extends GraphDef<any, any>,
    E extends EntityBase
> = {
    value(): E | undefined;
    valueOrThrow(): E;
    exists(): boolean;
    path(): string[];
    info(): NodeDebugInfo;
    delete(): void;
    update(fn: (entity: E) => E): void;
} & ([AllIncomingSourceKeys<D, KeyOf<D, E>>] extends [never] ? {} : { deleteCascade(): void }) & {
        [Rel in keyof D["edges"][KeyOf<D, E>]]: () => EntityNode<
            D,
            D["entityModel"][Rel & keyof D["entityModel"]]
        >;
    } & {
        [SourceEntity in ReverseKeys<D, KeyOf<D, E>> as `${string &
        SourceEntity}Nodes`]: () => EntityNodeList<D, SourceEntity>;
    };

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => EntityNode<D, D["entityModel"][K]>;
} & {
    [K in keyof D["entityModel"]as `${string & K}Nodes`]: () => EntityNodeList<D, K>;
} & {
    info(): GraphDebugInfo;
    schema(): GraphSchema;
} & {
    [K in keyof D["entityModel"]as `update${Capitalize<string & K>}`]: (
        entity: D["entityModel"][K] | D["entityModel"][K][]
    ) => void;
};

export type EntityNodeNoProxy<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = {
    value(): D["entityModel"][K] | undefined;
    valueOrThrow(): D["entityModel"][K];
    exists(): boolean;
    path(): string[];
    info(): NodeDebugInfo;
    delete(): void;
    update(fn: (entity: D["entityModel"][K]) => D["entityModel"][K]): void;
} & ([AllIncomingSourceKeys<D, K>] extends [never] ? {} : { deleteCascade(): void }) & {
    to<R extends (string & keyof D["edges"][K]) | `${string & ReverseKeys<D, K>}Nodes`>(
        rel: R
    ): R extends `${infer Src}Nodes`
        ? EntityNodeListNoProxy<D, Src & keyof D["entityModel"]>
        : EntityNodeNoProxy<D, R & keyof D["entityModel"]>;
};

export type EntityNodeListNoProxy<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = EntityNodeNoProxy<D, K>[] & {
    entities(): D["entityModel"][K][];
    select<R>(fn: (entity: D["entityModel"][K]) => R): R[];
    ids(): string[];
    first(): D["entityModel"][K] | undefined;
    findEntity(predicate: (entity: D["entityModel"][K]) => boolean): D["entityModel"][K] | undefined;
    findNode(predicate: (entity: D["entityModel"][K]) => boolean): EntityNodeNoProxy<D, K> | undefined;
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    ids(): (string | number)[];
    unique(): EntityNodeListNoProxy<D, K>;
    where(where: Where<D["entityModel"][K]>): EntityNodeListNoProxy<D, K>;
    whereNode(where: (node: EntityNodeNoProxy<D, K>) => boolean): EntityNodeListNoProxy<D, K>;
    intersect(other: EntityNodeListNoProxy<D, K> | D["entityModel"][K][] | (string | number)[]): EntityNodeListNoProxy<D, K>;
    with<T>(fn: (self: EntityNodeListNoProxy<D, K>) => T): T;
    to<R extends `${string & (keyof D["edges"][K] | ReverseKeys<D, K>)}Nodes`>(
        rel: R
    ): R extends `${infer Src}Nodes`
        ? EntityNodeListNoProxy<D, Src & keyof D["entityModel"]>
        : never;
};

export type EntityGraphNoProxy<D extends GraphDef<any, any>> = {
    to<R extends (keyof D["entityModel"] & string) | `${keyof D["entityModel"] & string}Nodes`>(
        type: R,
        id?: string
    ): R extends `${infer K}Nodes`
        ? EntityNodeListNoProxy<D, K & keyof D["entityModel"]>
        : EntityNodeNoProxy<D, R & keyof D["entityModel"]>;
    info(): GraphDebugInfo;
    schema(): GraphSchema;
} & {
    [K in keyof D["entityModel"] as `update${Capitalize<string & K>}`]: (
        entity: D["entityModel"][K] | D["entityModel"][K][]
    ) => void;
}



export type EntityBase = { id: string };

type ForbiddenKeys =
  | "info"
  | "schema"
  | `${string}Nodes`;

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
    resolve: (entity: Source) => string | undefined;
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

export type EntityNodeList<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = EntityNode<D, K>[] & {
    entities(): D["entityModel"][K][];
    select<R>(fn: (entity: D["entityModel"][K]) => R): R[];
    ids(): string[];
    first(): D["entityModel"][K] | undefined;
    findEntity(predicate: (entity: D["entityModel"][K]) => boolean): D["entityModel"][K] | undefined;
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    unique(): EntityNodeList<D, K>;
    where(where: Where<D["entityModel"][K]>): EntityNodeList<D, K>;
} & {
    [Rel in keyof D["edges"][K] as `${string & Rel}Nodes`]: (
        where?: Where<D["entityModel"][Rel & keyof D["entityModel"]]>
    ) => EntityNodeList<D, Rel & keyof D["entityModel"]>;
} & {
    [SourceEntity in ReverseKeys<D, K> as `${string &
    SourceEntity}Nodes`]: (
        where?: Where<D["entityModel"][SourceEntity]>
    ) => EntityNodeList<D, SourceEntity>;
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

export type MissingEntityRef = { type: string; id: string };

export type GraphDebugInfo = {
    entityCounts: Record<string, number>;
    cache: { nodeCount: number };
    missingEntities: MissingEntityRef[];
    orphanEntities: Record<string, string[]>;
};

export type NodeDebugInfo = {
    type: string;
    id: string | null;
    exists: boolean;
    path: string[];
    value: any;
};

export type EntityNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = {
    value(): D["entityModel"][K] | undefined;
    valueOrThrow(): D["entityModel"][K];
    exists(): boolean;
    path(): string[];
    info(): NodeDebugInfo;
} & {
    [Rel in keyof D["edges"][K]]: () => EntityNode<
        D,
        Rel & keyof D["entityModel"]
    >;
} & {
    [SourceEntity in ReverseKeys<D, K> as `${string &
    SourceEntity}Nodes`]: (
        where?: Where<D["entityModel"][SourceEntity]>
    ) => EntityNodeList<D, SourceEntity>;
};

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: D["entityModel"][K]["id"]) => EntityNode<D, K>;
} & {
    [K in keyof D["entityModel"] as `${string & K}Nodes`]: (
        where?: Where<D["entityModel"][K]>
    ) => EntityNodeList<D, K>;
} & {
    info(): GraphDebugInfo;
    schema(): GraphSchema;
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
    to<Rel extends string & keyof D["edges"][K]>(rel: Rel): EntityNodeNoProxy<D, Rel & keyof D["entityModel"]>;
    to<Src extends string & ReverseKeys<D, K>>(rel: `${Src}Nodes`, where?: Where<D["entityModel"][Src]>): EntityNodeListNoProxy<D, Src>;
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
    isEmpty(): boolean;
    isNotEmpty(): boolean;
    unique(): EntityNodeListNoProxy<D, K>;
    where(where: Where<D["entityModel"][K]>): EntityNodeListNoProxy<D, K>;
    to<Rel extends string & keyof D["edges"][K]>(rel: `${Rel}Nodes`, where?: Where<D["entityModel"][Rel & keyof D["entityModel"]]>): EntityNodeListNoProxy<D, Rel & keyof D["entityModel"]>;
    to<Src extends string & ReverseKeys<D, K>>(rel: `${Src}Nodes`, where?: Where<D["entityModel"][Src]>): EntityNodeListNoProxy<D, Src>;
};

export interface EntityGraphNoProxy<D extends GraphDef<any, any>> {
    to<K extends keyof D["entityModel"] & string>(type: K, id: D["entityModel"][K]["id"]): EntityNodeNoProxy<D, K>;
    to<K extends keyof D["entityModel"] & string>(type: `${K}Nodes`, where?: Where<D["entityModel"][K]>): EntityNodeListNoProxy<D, K>;
    info(): GraphDebugInfo;
    schema(): GraphSchema;
}

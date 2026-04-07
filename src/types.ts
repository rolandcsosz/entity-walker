

export type EntityBase = { id: string };
export type EntityMap = Record<string, EntityBase>;

export type Entities<T> = {
    [K in keyof T]: T[K][];
};

export type EdgeDef<Source> = {
    bidirectional?: boolean;
    resolve: (entity: Source) => string | undefined | null;
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
    getAll(): D["entityModel"][K][];
    getAllWitoutDuplicates(): D["entityModel"][K][];
} & {
    [Rel in keyof D["edges"][K]]: (
        where?: (entity: D["entityModel"][Rel & keyof D["entityModel"]]) => boolean
    ) => EntityNodeList<
        D,
        Rel & keyof D["entityModel"]
    >;
} & {
    [SourceEntity in ReverseKeys<D, K> as `${string &
    SourceEntity}References`]: (
        where?: (entity: D["entityModel"][SourceEntity]) => boolean
    ) => EntityNodeList<D, SourceEntity>;
};

export type EntityNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = {
    get(): D["entityModel"][K] | undefined;
    getOrThrow(): D["entityModel"][K];
} & {
    [Rel in keyof D["edges"][K]]: () => EntityNode<
        D,
        Rel & keyof D["entityModel"]
    >;
} & {
    [SourceEntity in ReverseKeys<D, K> as `${string &
    SourceEntity}References`]: (
        where?: (entity: D["entityModel"][SourceEntity]) => boolean
    ) => EntityNodeList<D, SourceEntity>;
};

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: string) => EntityNode<D, K>;
} & {
    [K in keyof D["entityModel"] as `${string & K}References`]: (
        where?: (entity: D["entityModel"][K]) => boolean
    ) => EntityNodeList<D, K>;
};

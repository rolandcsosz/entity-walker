export type EntityBase = { id: string };
export type EntityMap = Record<string, EntityBase>;

export type Entities<T> = {
    [K in keyof T]: T[K][];
};

export type EdgeDef<EM extends EntityMap, Source> = {
    to: keyof EM;
    optional?: boolean;
    bidirectional?: boolean;
    resolve: (entity: Source) => string | undefined | null;
};

export type GraphEdges<EM extends EntityMap> = {
    [K in keyof EM]?: Record<string, EdgeDef<EM, EM[K]>>;
};

export interface GraphDef<EM extends EntityMap, E extends GraphEdges<EM>> {
    entityModel: EM;
    edges: E;
}

type Or<A extends boolean, B extends boolean> = A extends true ? true : B extends true ? true : false;

type ReverseKeys<
    D extends GraphDef<any, any>,
    TargetKey extends keyof D["entityModel"]
> = {
    [SourceKey in keyof D["edges"]]: {
        [RelName in keyof D["edges"][SourceKey]]: D["edges"][SourceKey][RelName] extends {
            to: TargetKey;
            bidirectional: true;
        }
        ? SourceKey
        : never;
    }[keyof D["edges"][SourceKey]];
}[keyof D["edges"]];

export type EntityNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"],
    Nullable extends boolean = false
> = {
    tryGet(): D["entityModel"][K] | undefined;
} & (Nullable extends false ? { get(): D["entityModel"][K] } : {})
    & (Nullable extends true ? { exists(): boolean } : {})
    & {
        [Rel in keyof D["edges"][K]]: () => EntityNode<
            D,
            D["edges"][K][Rel]["to"] & keyof D["entityModel"],
            Or<Nullable, D["edges"][K][Rel]["optional"]>
        >;
    }
    & {
        [SourceEntity in ReverseKeys<D, K> as `${string & SourceEntity}References`]: () => EntityNode<D, SourceEntity, false>[];
    };

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: string) => EntityNode<D, K, false>;
};

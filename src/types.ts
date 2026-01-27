
export type EntityBase = { id: string };
export type EntityMap = Record<string, EntityBase>;

export type EdgeDef<EM extends EntityMap, Source> = {
    to: keyof EM;
    optional?: boolean;
    resolve: (entity: Source) => string | undefined | null;
};

export type GraphEdges<EM extends EntityMap> = {
    [K in keyof EM]?: Record<string, EdgeDef<EM, EM[K]>>;
};

export interface GraphDef<EM extends EntityMap, E extends GraphEdges<EM>> {
    entityModel: EM;
    edges: E;
}

type Or<A extends boolean, B extends boolean> = A extends true
    ? true
    : B extends true
    ? true
    : false;

export type EntityNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"],
    Nullable extends boolean = false
> = {
    get(): Nullable extends true
        ? D["entityModel"][K] | undefined
        : D["entityModel"][K];
} & {
        [Rel in keyof D["edges"][K]]: () => EntityNode<
            D,
            D["edges"][K][Rel]["to"] & keyof D["entityModel"],
            Or<Nullable, D["edges"][K][Rel]["optional"]>
        >;
    };

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: string) => EntityNode<D, K, false>;
};
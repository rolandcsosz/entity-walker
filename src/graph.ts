export type EntityMap = Record<string, any>;

export type Relations<EM extends EntityMap> = {
    [K in keyof EM]?: { [relationName: string]: keyof EM };
};

export type ForeignKeyResolver<EM extends EntityMap> = {
    [K in keyof EM]: (
        entity: EM[K],
        relation: string
    ) => { key: keyof EM; id: string } | null;
};

export interface GraphDef<EM extends EntityMap, R extends Relations<EM>> {
    entityModel: EM;
    relationships: R;
}

export type EntityNode<
    D extends GraphDef<any, any>,
    K extends keyof D["entityModel"]
> = {
    get(): D["entityModel"][K];
} & {
        [Rel in keyof D["relationships"][K]]: () => EntityNode<
            D,
            D["relationships"][K][Rel] & keyof D["entityModel"]
        >;
    };

export type EntityGraph<D extends GraphDef<any, any>> = {
    [K in keyof D["entityModel"]]: (id: string) => EntityNode<D, K>;
};

export function createEntityGraph<EM extends EntityMap>() {
    function resolveEntity<K extends keyof EM>(
        key: K,
        id: string,
        byId: { [K in keyof EM]: Record<string, EM[K]> }
    ): EM[K] {
        const entity = byId[key]?.[id];
        if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
        return entity;
    }

    function createNode<EMK extends keyof EM>(
        key: EMK,
        id: string,
        byId: { [K in keyof EM]: Record<string, EM[K]> },
        relations: Relations<EM>,
        foreignKeys: ForeignKeyResolver<EM>
    ): any {
        return new Proxy(
            {},
            {
                get(_, prop: string) {
                    if (prop === "get") return () => resolveEntity(key, id, byId);

                    const entity = resolveEntity(key, id, byId);
                    const nextKey = relations[key]?.[prop];
                    if (!nextKey) throw new Error(`No relation '${prop}'`);

                    const fk = foreignKeys[key](entity, prop);
                    if (!fk) throw new Error(`FK resolution failed`);
                    return () => createNode(fk.key, fk.id, byId, relations, foreignKeys);
                },
            }
        );
    }

    return {
        create: <R extends Relations<EM>>(config: {
            byId: { [K in keyof EM]: Record<string, EM[K]> };
            relations: R;
            foreignKeys: ForeignKeyResolver<EM>;
        }): EntityGraph<GraphDef<EM, R>> => {
            const { byId, relations, foreignKeys } = config;

            return new Proxy(
                {},
                {
                    get(_, prop: string) {
                        return (id: string) => createNode(prop as keyof EM, id, byId, relations, foreignKeys);
                    },
                }
            ) as any;
        },
    };
}

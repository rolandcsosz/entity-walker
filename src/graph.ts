export type EntityBase = { id: string };
export type EntityMap = Record<string, EntityBase>;

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
    return {
        create: <R extends Relations<EM>>(config: {
            entities: { [K in keyof EM]: EM[K][] };
            relations: R;
            foreignKeys: ForeignKeyResolver<EM>;
        }): EntityGraph<GraphDef<EM, R>> => {
            const { entities, relations, foreignKeys } = config;

            const byId: Record<string, Record<string, any>> = {};
            for (const key in entities) {
                byId[key] = {};
                for (const item of entities[key]!) {
                    byId[key][item.id] = item;
                }
            }

            function getEntity(key: keyof EM, id: string) {
                const entity = byId[key as string]?.[id];
                if (!entity) throw new Error(`Entity ${String(key)}(${id}) not found`);
                return entity;
            }

            function createNode(key: keyof EM, id: string): any {
                return new Proxy(
                    {},
                    {
                        get(_, prop: string) {
                            if (prop === "get") return () => getEntity(key, id);

                            const entity = getEntity(key, id);
                            const nextKey = relations[key]?.[prop];
                            if (!nextKey) throw new Error(`No relation '${prop}'`);

                            const fk = foreignKeys[key](entity, prop);
                            if (!fk) throw new Error(`FK resolution failed`);

                            return () => createNode(fk.key, fk.id);
                        },
                    }
                );
            }

            return new Proxy(
                {},
                {
                    get(_, prop: string) {
                        return (id: string) => createNode(prop as keyof EM, id);
                    },
                }
            ) as any;
        },
    };
}

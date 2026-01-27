export type EntityKey = string;

export type EntityMap = Record<EntityKey, { id: string }>;

export type Relations<EM extends EntityMap> = {
    [K in keyof EM]: Record<string, keyof EM>;
};

export type ForeignKeyResolver<
    EM extends EntityMap
> = {
        [K in keyof EM]: (
            entity: EM[K],
            target: EntityKey
        ) => { key: EntityKey; id: string } | null;
    };

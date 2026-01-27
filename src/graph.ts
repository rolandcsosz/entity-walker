import { EntityMap, Relations, ForeignKeyResolver } from "./types";

export type Chain<
    EM extends EntityMap,
    R extends Relations<EM>,
    K extends keyof EM
> = {
    get(): EM[K];
} & {
        [Next in keyof R[K]]: () => Chain<EM, R, R[K][Next]>;
    };


export function createEntityGraph<
    EM extends EntityMap,
    R extends Relations<EM>
>(config: {
    byId: { [K in keyof EM]: Record<string, EM[K]> };
    relations: R;
    foreignKeys: ForeignKeyResolver<EM>;
}) {
    const { byId, relations, foreignKeys } = config;

    function createChain<K extends keyof EM>(
        key: K,
        id: string
    ): Chain<EM, R, K> {
        return new Proxy(
            {},
            {
                get(_, prop) {
                    if (prop === "get") {
                        return () => {
                            const entity = byId[key]?.[id];
                            if (!entity) {
                                throw new Error(`Entity ${String(key)}(${id}) not found`);
                            }
                            return entity;
                        };
                    }

                    if (typeof prop !== "string") return undefined;

                    return () => {
                        const current = byId[key]?.[id];
                        if (!current) {
                            throw new Error(`Entity ${String(key)}(${id}) not found`);
                        }

                        const nextKey = relations[key]?.[prop];
                        if (!nextKey) {
                            throw new Error(`No relation '${prop}' on ${String(key)}`);
                        }

                        const resolver = foreignKeys[key];
                        const resolved = resolver(current, nextKey as string);
                        if (!resolved) {
                            throw new Error(
                                `Cannot resolve FK from ${String(key)} to ${String(nextKey)}`
                            );
                        }

                        return createChain(
                            resolved.key as keyof EM,
                            resolved.id
                        );
                    };
                },
            }
        ) as Chain<EM, R, K>;
    }

    return {
        entity<K extends keyof EM>(key: K, id: string): Chain<EM, R, K> {
            return createChain(key, id);
        },
    };
}

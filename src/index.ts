import { createGraph as createCoreGraph } from "./core/graph";
import { createApiGraph } from "./api/graph";
import { GraphDef, EntityMap, GraphEdges, EntityGraph } from "./core/types";
import { ValidApi, ApiGraph } from "./api/types";

export * from "./core/types";
export * from "./core/graphNoProxy";
export { emptyNode, emptyNodeList, emptyNodeNoProxy, emptyNodeListNoProxy } from "./core/helpers";
export { emptyApiNode, emptyApiNodeList } from "./api/helpers";
export * from "./api/types";

export function createGraph<D extends GraphDef<any, any>>(config: {
    entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
    edges: D["edges"];
}): EntityGraph<D>;

export function createGraph<EM extends EntityMap, E extends GraphEdges<EM>>(config: {
    entities?: Partial<{ [K in keyof EM]: EM[K][] }>;
    edges: E;
}): EntityGraph<GraphDef<EM, E>>;

export function createGraph<D extends GraphDef<any, any>, ApiOpt extends ValidApi<D> = ValidApi<D>>(config: {
    entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
    edges: D["edges"];
    api: ApiOpt;
}): ApiGraph<D, ApiOpt>;

export function createGraph<
    EM extends EntityMap,
    E extends GraphEdges<EM>,
    ApiOpt extends ValidApi<GraphDef<EM, E>> = ValidApi<GraphDef<EM, E>>,
>(config: {
    entities?: Partial<{ [K in keyof EM]: EM[K][] }>;
    edges: E;
    api: ApiOpt;
}): ApiGraph<GraphDef<EM, E>, ApiOpt>;

export function createGraph(config: any): any {
    if (config?.api) {
        return createApiGraph(config);
    }
    return createCoreGraph(config);
}

import { createGraph as createCoreGraph } from "./core/graph";
import { createApiGraph } from "./api/graph";
import { GraphDef, EntityMap, GraphEdges, EntityGraph } from "./core/types";
import { ApiGraph, ApiGraphDef } from "./api/types";

export * from "./core/types";
export * from "./core/graphNoProxy";
export { emptyNode, emptyNodeList, emptyNodeNoProxy, emptyNodeListNoProxy } from "./core/helpers";
export { emptyApiNode, emptyApiNodeList } from "./api/helpers";
export * from "./api/types";

export function createGraph<D extends GraphDef<any, any>>(config: {
    entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
    edges: D["edges"];
}): EntityGraph<D>;

export function createGraph<D extends ApiGraphDef<any, any, any>>(config: {
    entities?: Partial<{ [K in keyof D["entityModel"]]: D["entityModel"][K][] }>;
    edges: D["edges"];
    api: D["api"];
}): ApiGraph<D>;

export function createGraph(config: any): any {
    if (config?.api) {
        return createApiGraph(config);
    }
    return createCoreGraph(config);
}

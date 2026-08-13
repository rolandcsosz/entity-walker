import { GraphDef, EntityBase } from "../core/types";
import { ApiEntityNode, ApiEntityNodeList } from "./types";

export function emptyApiNodeList<G extends GraphDef<any, any>, E extends EntityBase>(): ApiEntityNodeList<G, E> {
    const list = [] as any;
    const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });

    def("entities", () => []);
    def("ids", () => []);
    def("isEmpty", () => true);
    def("isNotEmpty", () => false);
    def("load", (_options?: { force?: boolean }) => Promise.resolve(proxyList));

    const proxyList = new Proxy(list, {
        get(target, prop: string | symbol) {
            if (typeof prop === "symbol") return target[prop as keyof typeof target];
            if (prop in target) return target[prop as keyof typeof target];
            if (typeof prop === "string" && prop.endsWith("Nodes")) return () => proxyList;
            return undefined;
        },
    });

    return proxyList;
}

export function emptyApiNode<G extends GraphDef<any, any>, E extends EntityBase>(): ApiEntityNode<G, E> {
    const nodeObj: any = {
        value: () => undefined,
        exists: () => false,
        load: () => Promise.resolve(proxyNode),
        delete: () => Promise.resolve(undefined),
        update: () => Promise.resolve(undefined),
        api: {},
    };

    const proxyNode = new Proxy(nodeObj, {
        get(target, prop: string | symbol) {
            if (typeof prop === "symbol") return target[prop];
            if (prop === "then") return undefined;
            if (prop in target) return target[prop as keyof typeof target];
            if (typeof prop === "string" && prop.endsWith("Nodes")) return () => emptyApiNodeList<G, any>();
            return () => proxyNode;
        },
    });

    return proxyNode;
}

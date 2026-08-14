import { GraphDef, EntityBase } from "../core/types";
import { ApiNode, ApiNodeList } from "./types";

export function emptyApiNodeList<G extends GraphDef<any, any>, E extends EntityBase>(): ApiNodeList<G, E> {
    const list = [] as any;
    const def = (name: string, val: any) => Object.defineProperty(list, name, { value: val, enumerable: false });
    const self = () => proxyList;

    def("entities", () => []);
    def("select", (_fn: (entity: E) => any) => []);
    def("ids", () => []);
    def("first", () => undefined);
    def("findEntity", (_predicate: (entity: E) => boolean) => undefined);
    def("findNode", (_predicate: (entity: E) => boolean) => undefined);
    def("isEmpty", () => true);
    def("isNotEmpty", () => false);
    def("unique", self);
    def("where", (_where: (entity: E) => boolean) => proxyList);
    def("whereNode", (_where: (node: any) => boolean) => proxyList);
    def("intersect", (_other: any) => proxyList);
    def("with", (fn: (self: any) => any) => fn(proxyList));
    def("scoped", self);
    def("resetScope", self);
    def("info", () => ({ type: "unknown", length: 0, scope: null }));

    const proxyList = new Proxy(list, {
        get(target, prop: string | symbol) {
            if (typeof prop === "symbol") return target[prop as keyof typeof target];
            if (prop === "load") return (_options?: { force?: boolean }) => Promise.resolve(proxyList);
            if (prop in target) return target[prop as keyof typeof target];
            if (typeof prop === "string" && prop.endsWith("Nodes")) return () => proxyList;
            return undefined;
        },
    });

    return proxyList;
}

export function emptyApiNode<G extends GraphDef<any, any>, E extends EntityBase>(): ApiNode<G, E> {
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

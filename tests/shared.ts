import { Entities, createGraph, createNonProxyGraph, GraphDef } from "../src/index";
import { edges, Schema, SchemaNumeric, numericEdges, CustomGraph } from "./types";

export const baseEntities: Entities<Schema> = {
    transaction: [
        { id: "tx1", subcategoryId: "sub1" },
        { id: "tx2", subcategoryId: "sub2" },
        { id: "tx3", subcategoryId: "sub1" },
    ],
    subcategory: [
        { id: "sub1", name: "sub1", mainCategoryId: "cat1" },
        { id: "sub2", name: "sub2", mainCategoryId: "cat1" },
    ],
    mainCategory: [
        { id: "cat1", name: "Food", expenseTypeId: "et1", incomeTypeId: "it1" },
        { id: "cat2", name: "Food", expenseTypeId: "error", incomeTypeId: "error" },
        { id: "cat3", name: "Food" },
    ],
    expenseType: [{ id: "et1", description: "Groceries" }],
    incomeType: [{ id: "it1", description: "Salary" }],
};

export type GraphWrapper<S = Schema> = {
    /** rootNode: single node by type + id */
    rootNode: (type: string, id: string | number) => any;
    /** l: root node list, optionally filtered */
    nodeList: (type: string, where?: (e: any) => boolean) => any;
    /** path: traverse from node/list via relation, optionally filtered */
    path: (nodeOrList: any, rel: string, where?: (e: any) => boolean) => any;
    /** update: updateX on the graph */
    update: (type: string, entityOrEntities: any) => void;
    makeGraph: (entities: Entities<S>) => GraphWrapper<S>;
    graph: any;
};

function cap(s: string) {
    return s[0].toUpperCase() + s.slice(1);
}

export function proxyAdapter(ents: Entities<Schema>): GraphWrapper<Schema> {
    const graph = createGraph<CustomGraph>({ entities: ents, edges }) as any;
    return {
        graph,
        rootNode: (type, id) => graph[type](id),
        nodeList: (type, where?) => {
            const res = graph[`${type}Nodes`]();
            return where ? res.where(where) : res;
        },
        path: (nodeOrList, rel, where?) => {
            const res = nodeOrList[rel]();
            return where && typeof res.where === "function" ? res.where(where) : res;
        },
        update: (type, e) => graph[`create${cap(type)}`](e),
        makeGraph: (e) => proxyAdapter(e),
    };
}

export function nonProxyAdapter(ents: Entities<Schema>): GraphWrapper<Schema> {
    const graph = createNonProxyGraph({ entities: ents, edges }) as any;
    return {
        graph,
        rootNode: (type, id) => graph.to(type, id),
        nodeList: (type, where?) => {
            const res = graph.to(`${type}Nodes`);
            return where ? res.where(where) : res;
        },
        path: (nodeOrList, rel, where?) => {
            const res = nodeOrList.to(rel);
            return where && typeof res.where === "function" ? res.where(where) : res;
        },
        update: (type, e) => graph.create(type, e),
        makeGraph: (e) => nonProxyAdapter(e),
    };
}

export function makeProxy() {
    return proxyAdapter(structuredClone(baseEntities));
}
export function makeNonProxy() {
    return nonProxyAdapter(structuredClone(baseEntities));
}

// --- Numeric ID fixtures ---

export const baseEntitiesNumeric: Entities<SchemaNumeric> = {
    transaction: [
        { id: 1, subcategoryId: 10 },
        { id: 2, subcategoryId: 20 },
    ],
    subcategory: [
        { id: 10, name: "sub1", mainCategoryId: 100 },
        { id: 20, name: "sub2", mainCategoryId: 100 },
    ],
    mainCategory: [{ id: 100, name: "Food", expenseTypeId: 1000, incomeTypeId: 2000 }],
    expenseType: [{ id: 1000, description: "Groceries" }],
    incomeType: [{ id: 2000, description: "Salary" }],
};

export function proxyAdapterN(ents: Entities<SchemaNumeric>): GraphWrapper<SchemaNumeric> {
    const graph = createGraph<GraphDef<SchemaNumeric, typeof numericEdges>>({
        entities: ents,
        edges: numericEdges,
    }) as any;
    return {
        graph,
        rootNode: (type, id) => graph[type](id),
        nodeList: (type, where?) => {
            const res = graph[`${type}Nodes`]();
            return where ? res.where(where) : res;
        },
        path: (nodeOrList, rel, where?) => {
            const res = nodeOrList[rel]();
            return where && typeof res.where === "function" ? res.where(where) : res;
        },
        update: (type, e) => graph[`create${cap(type)}`](e),
        makeGraph: (e) => proxyAdapterN(e),
    };
}

export function nonProxyAdapterN(ents: Entities<SchemaNumeric>): GraphWrapper<SchemaNumeric> {
    const graph = createNonProxyGraph({ entities: ents, edges: numericEdges }) as any;
    return {
        graph,
        rootNode: (type, id) => graph.to(type, id),
        nodeList: (type, where?) => {
            const res = graph.to(`${type}Nodes`);
            return where ? res.where(where) : res;
        },
        path: (nodeOrList, rel, where?) => {
            const res = nodeOrList.to(rel);
            return where && typeof res.where === "function" ? res.where(where) : res;
        },
        update: (type, e) => graph.create(type, e),
        makeGraph: (e) => nonProxyAdapterN(e),
    };
}

export function makeProxyN() {
    return proxyAdapterN(structuredClone(baseEntitiesNumeric));
}
export function makeNonProxyN() {
    return nonProxyAdapterN(structuredClone(baseEntitiesNumeric));
}

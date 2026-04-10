import { Entities, createGraph, createNonProxyGraph } from "../src/index";
import { edges, Schema } from "./types";


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

export type GraphWrapper = {
    /** rootNode: single node by type + id */
    rootNode:   (type: string, id: string) => any;
    /** l: root node list, optionally filtered */
    nodeList:   (type: string, where?: (e: any) => boolean) => any;
    /** path: traverse from node/list via relation, optionally filtered */
    path:  (nodeOrList: any, rel: string, where?: (e: any) => boolean) => any;
    /** ins: insertX on the graph */
    insert: (type: string, entityOrEntities: any) => void;
    /** update: updateX on the graph */
    update: (type: string, entityOrEntities: any) => void;
    makeGraph:  (entities: Entities<Schema>) => GraphWrapper;
    graph: any;
};

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

export function proxyAdapter(ents: Entities<Schema>): GraphWrapper {
    const graph = createGraph({ entities: ents, edges }) as any;
    return {
        graph,
        rootNode:   (type, id)               => graph[type](id),
        nodeList:   (type, where?)           => graph[`${type}Nodes`](where),
        path:  (nodeOrList, rel, where?) => nodeOrList[rel](where),
        insert: (type, e)                => graph[`insert${cap(type)}`](e),
        update: (type, e)                => graph[`update${cap(type)}`](e),
        makeGraph: (e) => proxyAdapter(e),
    };
}

export function nonProxyAdapter(ents: Entities<Schema>): GraphWrapper {
    const graph = createNonProxyGraph({ entities: ents, edges }) as any;
    return {
        graph,
        rootNode:   (type, id)               => graph.to(type, id),
        nodeList:   (type, where?)           => graph.to(`${type}Nodes`, where),
        path:  (nodeOrList, rel, where?) => nodeOrList.to(rel, where),
        insert: (type, e)                => graph[`insert${cap(type)}`](e),
        update: (type, e)                => graph[`update${cap(type)}`](e),
        makeGraph: (e) => nonProxyAdapter(e),
    };
}

export function makeProxy()    { return proxyAdapter(structuredClone(baseEntities)); }
export function makeNonProxy() { return nonProxyAdapter(structuredClone(baseEntities)); }
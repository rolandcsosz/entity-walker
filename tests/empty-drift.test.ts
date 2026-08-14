import { describe, it, expect } from "vitest";
import { createGraph, createNonProxyGraph } from "../src/index";
import { CustomGraph, Transaction, Subcategory, edges } from "./types";
import { baseEntities } from "./shared";
import { emptyNode, emptyNodeList, emptyNodeNoProxy, emptyNodeListNoProxy } from "../src/core/helpers";
import { emptyApiNode, emptyApiNodeList } from "../src/api/helpers";

function relationNames(edgesConfig: typeof edges): Set<string> {
    const names = new Set<string>();
    for (const [fromType, targets] of Object.entries(edgesConfig)) {
        for (const toType of Object.keys(targets)) {
            names.add(toType);
            names.add(`${fromType}Nodes`);
        }
    }
    return names;
}

const RELATIONS = relationNames(edges as any);

function ownMethods(obj: any): string[] {
    return Object.getOwnPropertyNames(obj).filter((k) => typeof obj[k] === "function");
}

const ARRAY_PROTOS = new Set([
    "length",
    "toString",
    "toLocaleString",
    "pop",
    "push",
    "concat",
    "join",
    "reverse",
    "shift",
    "slice",
    "sort",
    "splice",
    "unshift",
    "indexOf",
    "lastIndexOf",
    "every",
    "some",
    "forEach",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "find",
    "findIndex",
    "fill",
    "copyWithin",
    "entries",
    "keys",
    "values",
    "includes",
    "flatMap",
    "flat",
    "at",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
    "findLast",
    "findLastIndex",
]);

function assertNoDrift(realInstance: any, emptyInstance: any, options: { skipKeys?: Set<string> } = {}) {
    const skip = options.skipKeys ?? new Set();

    const realBase = ownMethods(realInstance).filter((k) => !RELATIONS.has(k) && !ARRAY_PROTOS.has(k) && !skip.has(k));
    const emptyBase = ownMethods(emptyInstance).filter(
        (k) => !RELATIONS.has(k) && !ARRAY_PROTOS.has(k) && !skip.has(k),
    );

    const emptySet = new Set(emptyBase);
    const realSet = new Set(realBase);

    for (const key of realBase) {
        expect(emptySet.has(key), `emptyHelper is missing '${key}' that exists on the real instance`).toBe(true);
    }

    for (const key of emptyBase) {
        expect(
            realSet.has(key) || typeof realInstance[key] === "function",
            `emptyHelper has '${key}' but real instance does not expose it`,
        ).toBe(true);
    }
}

function proxyGraph() {
    return createGraph({ entities: structuredClone(baseEntities), edges });
}

function nonProxyGraph() {
    return createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
}

function apiGraph() {
    return createGraph({ entities: structuredClone(baseEntities), edges, api: {} });
}

describe("emptyNode drift detection — EntityNode", () => {
    it("transaction node (no incoming edges, no deleteCascade)", () => {
        const realNode = proxyGraph().transaction("tx1");
        assertNoDrift(realNode, emptyNode<CustomGraph, Transaction>());
    });

    it("subcategory node (has incoming edges → deleteCascade present)", () => {
        const realNode = proxyGraph().subcategory("sub1");
        assertNoDrift(realNode, emptyNode<CustomGraph, Subcategory>());
    });
});

describe("emptyNodeList drift detection — EntityNodeList", () => {
    it("transactionNodes() list", () => {
        const realList = proxyGraph().transactionNodes();
        assertNoDrift(realList, emptyNodeList<CustomGraph, Transaction>());
    });

    it("subcategoryNodes() list (via reverse edge)", () => {
        const realList = proxyGraph().subcategoryNodes();
        assertNoDrift(realList, emptyNodeList<CustomGraph, Transaction>());
    });
});

describe("emptyNodeNoProxy drift detection — EntityNodeNoProxy", () => {
    it("transaction node via .to()", () => {
        const realNode = nonProxyGraph().to("transaction", "tx1");
        assertNoDrift(realNode, emptyNodeNoProxy<CustomGraph, Transaction>());
    });

    it("subcategory node via .to()", () => {
        const realNode = nonProxyGraph().to("subcategory", "sub1");
        assertNoDrift(realNode, emptyNodeNoProxy<CustomGraph, Subcategory>());
    });
});

describe("emptyNodeListNoProxy drift detection — EntityNodeListNoProxy", () => {
    it("transactionNodes list via .to('transactionNodes')", () => {
        const realList = nonProxyGraph().to("transactionNodes");
        assertNoDrift(realList, emptyNodeListNoProxy<CustomGraph, Transaction>());
    });
});

describe("emptyApiNode drift detection — ApiNode", () => {
    it("transaction api node", () => {
        const realNode = apiGraph().transaction("tx1");
        assertNoDrift(realNode, emptyApiNode<CustomGraph, Transaction>(), {
            skipKeys: new Set(["api", "graph"]),
        });
    });

    it("subcategory api node (has reverse edge)", () => {
        const realNode = apiGraph().subcategory("sub1");
        assertNoDrift(realNode, emptyApiNode<CustomGraph, Subcategory>(), {
            skipKeys: new Set(["api", "graph"]),
        });
    });
});

describe("emptyApiNodeList drift detection — ApiNodeList", () => {
    it("transactionNodes() api list", () => {
        const realList = apiGraph().transactionNodes();
        assertNoDrift(realList, emptyApiNodeList<CustomGraph, Transaction>());
    });
});

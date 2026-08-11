import { describe, expect, it } from "vitest";
import { createGraph, createNonProxyGraph, Entities, GraphEdges, ValidSchema } from "../../src";

type Transaction = { id: string; subcategoryId: string };
type Subcategory = { id: string; name: string };

type Schema = ValidSchema<{
    transaction: Transaction;
    subcategory: Subcategory;
}>;

function makeLazyFixture() {
    const counters = { resolveCalls: 0 };

    const entities: Entities<Schema> = {
        transaction: [
            { id: "tx1", subcategoryId: "sub1" },
            { id: "tx2", subcategoryId: "sub2" },
        ],
        subcategory: [
            { id: "sub1", name: "Sub 1" },
            { id: "sub2", name: "Sub 2" },
        ],
    };

    const edges = {
        transaction: {
            subcategory: {
                bidirectional: true,
                resolve: (t: Transaction) => {
                    counters.resolveCalls += 1;
                    return t.subcategoryId;
                },
            },
        },
    } as const satisfies GraphEdges<Schema>;

    return { counters, entities, edges };
}

describe("lazy evaluation [proxy]", () => {
    it("does not resolve edges at graph creation", () => {
        const { counters, entities, edges } = makeLazyFixture();
        createGraph({ entities, edges });
        expect(counters.resolveCalls).toBe(0);
    });

    it("does not resolve edges for node/list/schema access only", () => {
        const { counters, entities, edges } = makeLazyFixture();
        const graph = createGraph({ entities, edges });

        graph.transaction("tx1");
        graph.transactionNodes();
        graph.schema();

        expect(counters.resolveCalls).toBe(0);
    });

    it("builds indexes when value is requested", () => {
        const { counters, entities, edges } = makeLazyFixture();
        const graph = createGraph({ entities, edges });

        const tx = graph.transaction("tx1").value();

        expect(tx?.id).toBe("tx1");
        expect(counters.resolveCalls).toBe(2);

        graph.transaction("tx2").value();
        expect(counters.resolveCalls).toBe(2);
    });

    it("preserves behavior when update happens before first value read", () => {
        const { entities, edges } = makeLazyFixture();
        const graph = createGraph({ entities, edges });

        graph.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        expect(graph.transaction("tx1").subcategory().value()?.id).toBe("sub2");
        expect(graph.subcategory("sub2").transactionNodes().ids()).toContain("tx1");
    });
});

describe("lazy evaluation [non-proxy]", () => {
    it("does not resolve edges at graph creation", () => {
        const { counters, entities, edges } = makeLazyFixture();
        createNonProxyGraph({ entities, edges });
        expect(counters.resolveCalls).toBe(0);
    });

    it("does not resolve edges for node/list/schema access only", () => {
        const { counters, entities, edges } = makeLazyFixture();
        const graph = createNonProxyGraph({ entities, edges });

        graph.to("transaction", "tx1");
        graph.to("transactionNodes");
        graph.schema();

        expect(counters.resolveCalls).toBe(0);
    });

    it("builds indexes when value is requested", () => {
        const { counters, entities, edges } = makeLazyFixture();
        const graph = createNonProxyGraph({ entities, edges });

        const tx = graph.to("transaction", "tx1").value();

        expect(tx?.id).toBe("tx1");
        expect(counters.resolveCalls).toBe(2);

        graph.to("transaction", "tx2").value();
        expect(counters.resolveCalls).toBe(2);
    });

    it("preserves behavior when update happens before first value read", () => {
        const { entities, edges } = makeLazyFixture();
        const graph = createNonProxyGraph({ entities, edges });

        graph.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        expect(graph.to("transaction", "tx1").to("subcategory").value()?.id).toBe("sub2");
        expect(graph.to("subcategory", "sub2").to("transactionNodes").ids()).toContain("tx1");
    });
});

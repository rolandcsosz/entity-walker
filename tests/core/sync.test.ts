import { describe, it, expect, vi } from "vitest";
import { EntityGraph, EntityGraphNoProxy, createGraph, createNonProxyGraph } from "../../src";
import { CustomGraph, edges, Transaction } from "../types";
import { baseEntities } from "../shared";

function proxyGraph(): EntityGraph<CustomGraph> {
    return createGraph<CustomGraph>({ entities: structuredClone(baseEntities), edges });
}

function nonProxyGraph(): EntityGraphNoProxy<CustomGraph> {
    return createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
}

describe("EntityGraph (proxy) - sync", () => {
    it("sync merge inserts and updates while keeping unmentioned entities", () => {
        const g: EntityGraph<CustomGraph> = proxyGraph();

        g.meta.sync(
            {
                transaction: [
                    { id: "tx1", subcategoryId: "sub2" },
                    { id: "tx99", subcategoryId: "sub1" },
                ],
            },
            { mode: "merge" },
        );

        const txIds = g.transactionNodes().ids();
        expect(txIds).toEqual(["tx1", "tx2", "tx3", "tx99"]);
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.transaction("tx2").value()).toBeDefined();

        const mainCategoryCount = g.mainCategoryNodes().ids().length;
        expect(mainCategoryCount).toBe(3);
    });

    it("sync replace inserts and updates while deleting missing entities", () => {
        const g: EntityGraph<CustomGraph> = proxyGraph();

        g.meta.sync(
            {
                transaction: [
                    { id: "tx99", subcategoryId: "sub1" },
                    { id: "tx1", subcategoryId: "sub2" },
                ],
            },
            { mode: "replace" },
        );

        const txIds = g.transactionNodes().ids();
        expect(txIds).toEqual(["tx99", "tx1"]);
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.transaction("tx2").value()).toBeUndefined();

        const subcategoryCount = g.subcategoryNodes().ids().length;
        expect(subcategoryCount).toBe(2);
    });

    it("sync rejects invalid entities (missing id) and keeps current data", () => {
        const g: EntityGraph<CustomGraph> = proxyGraph();

        expect(() =>
            g.meta.sync(
                {
                    transaction: [{ subcategoryId: "sub1" }] as Transaction[],
                },
                { mode: "merge" },
            ),
        ).toThrow("missing a valid 'id'");

        const txIds = g.transactionNodes().ids();
        expect(txIds).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("warns when inserted entity references a missing related key", () => {
        const g: EntityGraph<CustomGraph> = proxyGraph();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        g.createTransaction({ id: "tx99", subcategoryId: "missing-sub" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain("missing 'subcategory' id 'missing-sub'");
        warnSpy.mockRestore();
    });

    it("does not warn for out-of-order sync when dependencies are included", () => {
        const g: EntityGraph<CustomGraph> = proxyGraph();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        g.meta.sync(
            {
                transaction: [{ id: "tx99", subcategoryId: "sub99" }],
                subcategory: [{ id: "sub99", name: "sub99", mainCategoryId: "cat1" }],
            },
            { mode: "merge" },
        );

        expect(warnSpy).not.toHaveBeenCalled();
        expect(g.transaction("tx99").value()?.subcategoryId).toBe("sub99");
        warnSpy.mockRestore();
    });
});

describe("EntityGraphNoProxy - sync", () => {
    it("sync merge inserts and updates while keeping unmentioned entities", () => {
        const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();

        g.meta.sync(
            {
                transaction: [
                    { id: "tx1", subcategoryId: "sub2" },
                    { id: "tx99", subcategoryId: "sub1" },
                ],
            },
            { mode: "merge" },
        );

        const txIds = g.to("transactionNodes").ids();
        expect(txIds).toEqual(["tx1", "tx2", "tx3", "tx99"]);
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.to("transaction", "tx2").value()).toBeDefined();

        const mainCategoryCount = g.to("mainCategoryNodes").ids().length;
        expect(mainCategoryCount).toBe(3);
    });

    it("sync replace inserts and updates while deleting missing entities", () => {
        const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();

        g.meta.sync(
            {
                transaction: [
                    { id: "tx99", subcategoryId: "sub1" },
                    { id: "tx1", subcategoryId: "sub2" },
                ],
            },
            { mode: "replace" },
        );

        const txIds = g.to("transactionNodes").ids();
        expect(txIds).toEqual(["tx99", "tx1"]);
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.to("transaction", "tx2").value()).toBeUndefined();

        const subcategoryCount = g.to("subcategoryNodes").ids().length;
        expect(subcategoryCount).toBe(2);
    });

    it("sync rejects invalid entities (missing id) and keeps current data", () => {
        const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();

        expect(() =>
            g.meta.sync(
                {
                    transaction: [{ subcategoryId: "sub1" }] as Transaction[],
                },
                { mode: "merge" },
            ),
        ).toThrow("missing a valid 'id'");

        const txIds = g.to("transactionNodes").ids();
        expect(txIds).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("warns when inserted entity references a missing related key", () => {
        const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        g.create("transaction", { id: "tx99", subcategoryId: "missing-sub" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain("missing 'subcategory' id 'missing-sub'");
        warnSpy.mockRestore();
    });

    it("does not warn for out-of-order sync when dependencies are included", () => {
        const g: EntityGraphNoProxy<CustomGraph> = nonProxyGraph();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        g.meta.sync(
            {
                transaction: [{ id: "tx99", subcategoryId: "sub99" }],
                subcategory: [{ id: "sub99", name: "sub99", mainCategoryId: "cat1" }],
            },
            { mode: "merge" },
        );

        expect(warnSpy).not.toHaveBeenCalled();
        expect(g.to("transaction", "tx99").value()?.subcategoryId).toBe("sub99");
        warnSpy.mockRestore();
    });
});

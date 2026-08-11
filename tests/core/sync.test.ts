import { describe, it, expect, vi } from "vitest";
import { createGraph, createNonProxyGraph } from "../../src";
import { edges } from "../types";
import { baseEntities } from "../shared";

function proxyGraph() {
    return createGraph({ entities: structuredClone(baseEntities), edges }) as any;
}

function nonProxyGraph() {
    return createNonProxyGraph({ entities: structuredClone(baseEntities), edges }) as any;
}

function runSyncTests(label: string, make: () => any) {
    describe(label, () => {
        it("sync merge inserts and updates while keeping unmentioned entities", () => {
            const g = make();

            g.sync({
                transaction: [
                    { id: "tx1", subcategoryId: "sub2" },
                    { id: "tx99", subcategoryId: "sub1" },
                ],
            }, { mode: "merge" });

            const txIds = (g.transactionNodes?.() ?? g.to("transactionNodes")).ids();
            expect(txIds).toEqual(["tx1", "tx2", "tx3", "tx99"]);
            expect((g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value()?.subcategoryId).toBe("sub2");
            expect((g.transaction?.("tx2") ?? g.to("transaction", "tx2")).value()).toBeDefined();

            const mainCategoryCount = (g.mainCategoryNodes?.() ?? g.to("mainCategoryNodes")).ids().length;
            expect(mainCategoryCount).toBe(3);
        });

        it("sync replace inserts and updates while deleting missing entities", () => {
            const g = make();

            g.sync({
                transaction: [
                    { id: "tx99", subcategoryId: "sub1" },
                    { id: "tx1", subcategoryId: "sub2" },
                ],
            }, { mode: "replace" });

            const txIds = (g.transactionNodes?.() ?? g.to("transactionNodes")).ids();
            expect(txIds).toEqual(["tx99", "tx1"]);
            expect((g.transaction?.("tx1") ?? g.to("transaction", "tx1")).value()?.subcategoryId).toBe("sub2");
            expect((g.transaction?.("tx2") ?? g.to("transaction", "tx2")).value()).toBeUndefined();

            const subcategoryCount = (g.subcategoryNodes?.() ?? g.to("subcategoryNodes")).ids().length;
            expect(subcategoryCount).toBe(2);
        });

        it("sync rejects invalid entities (missing id) and keeps current data", () => {
            const g = make();

            expect(() => g.sync({
                transaction: [{ subcategoryId: "sub1" }],
            }, { mode: "merge" })).toThrow("missing a valid 'id'");

            const txIds = (g.transactionNodes?.() ?? g.to("transactionNodes")).ids();
            expect(txIds).toEqual(["tx1", "tx2", "tx3"]);
        });

        it("warns when inserted entity references a missing related key", () => {
            const g = make();
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            g.updateTransaction({ id: "tx99", subcategoryId: "missing-sub" });

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain("missing 'subcategory' id 'missing-sub'");
            warnSpy.mockRestore();
        });

        it("does not warn for out-of-order sync when dependencies are included", () => {
            const g = make();
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            g.sync({
                transaction: [{ id: "tx99", subcategoryId: "sub99" }],
                subcategory: [{ id: "sub99", name: "sub99", mainCategoryId: "cat1" }],
            }, { mode: "merge" });

            expect(warnSpy).not.toHaveBeenCalled();
            expect((g.transaction?.("tx99") ?? g.to("transaction", "tx99")).value()?.subcategoryId).toBe("sub99");
            warnSpy.mockRestore();
        });
    });
}

runSyncTests("EntityGraph (proxy)    - sync", proxyGraph);
runSyncTests("EntityGraphNoProxy     - sync", nonProxyGraph);

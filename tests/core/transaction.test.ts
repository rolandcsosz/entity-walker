import { describe, it, expect } from "vitest";
import { createGraph, createNonProxyGraph } from "../../src";
import { edges } from "../types";
import { baseEntities } from "../shared";

describe("Transaction Support - Proxy Graph", () => {
    it("isolates modifications from the parent graph", () => {
        const g = createGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        expect(tx.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");
    });

    it("commits modifications back to the parent graph", () => {
        const g = createGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
        tx.transaction("tx2").delete();
        tx.updateMainCategory({ id: "cat9", name: "New Category" });

        tx.commit();

        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.transaction("tx2").exists()).toBe(false);
        expect(g.mainCategory("cat9").exists()).toBe(true);
        expect(g.mainCategory("cat9").value()?.name).toBe("New Category");
    });

    it("reverts/rolls back modifications", () => {
        const g = createGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
        tx.transaction("tx2").delete();

        tx.rollback();

        expect(tx.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        expect(tx.transaction("tx2").exists()).toBe(true);

        tx.commit();
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");
        expect(g.transaction("tx2").exists()).toBe(true);
    });

    it("supports nested transactions with independent commit/rollback", () => {
        const g = createGraph({ entities: structuredClone(baseEntities), edges });
        
        const tx1 = g.beginTransaction();
        tx1.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        const tx2 = tx1.beginTransaction();
        tx2.updateTransaction({ id: "tx1", subcategoryId: "sub3" });

        expect(tx2.transaction("tx1").value()?.subcategoryId).toBe("sub3");
        expect(tx1.transaction("tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");

        tx2.commit();
        expect(tx1.transaction("tx1").value()?.subcategoryId).toBe("sub3");
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");

        tx1.rollback();
        expect(g.transaction("tx1").value()?.subcategoryId).toBe("sub1");
    });

    it("cascades deletes inside a transaction", () => {
        const g = createGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.subcategory("sub1").deleteCascade();

        expect(tx.subcategory("sub1").exists()).toBe(false);
        expect(tx.transaction("tx1").exists()).toBe(false);
        expect(tx.transaction("tx3").exists()).toBe(false);

        expect(g.subcategory("sub1").exists()).toBe(true);
        expect(g.transaction("tx1").exists()).toBe(true);
        expect(g.transaction("tx3").exists()).toBe(true);

        tx.commit();
        expect(g.subcategory("sub1").exists()).toBe(false);
        expect(g.transaction("tx1").exists()).toBe(false);
        expect(g.transaction("tx3").exists()).toBe(false);
    });
});

describe("Transaction Support - Non-Proxy Graph", () => {
    it("isolates modifications from the parent graph", () => {
        const g = createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        expect(tx.to("transaction", "tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub1");
    });

    it("commits modifications back to the parent graph", () => {
        const g = createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
        tx.to("transaction", "tx2").delete();
        tx.updateMainCategory({ id: "cat9", name: "New Category" });

        tx.commit();

        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.to("transaction", "tx2").exists()).toBe(false);
        expect(g.to("mainCategory", "cat9").exists()).toBe(true);
        expect(g.to("mainCategory", "cat9").value()?.name).toBe("New Category");
    });

    it("reverts/rolls back modifications", () => {
        const g = createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
        const tx = g.beginTransaction();

        tx.updateTransaction({ id: "tx1", subcategoryId: "sub2" });
        tx.rollback();

        expect(tx.to("transaction", "tx1").value()?.subcategoryId).toBe("sub1");

        tx.commit();
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub1");
    });

    it("supports nested transactions", () => {
        const g = createNonProxyGraph({ entities: structuredClone(baseEntities), edges });
        
        const tx1 = g.beginTransaction();
        tx1.updateTransaction({ id: "tx1", subcategoryId: "sub2" });

        const tx2 = tx1.beginTransaction();
        tx2.updateTransaction({ id: "tx1", subcategoryId: "sub3" });

        expect(tx2.to("transaction", "tx1").value()?.subcategoryId).toBe("sub3");
        expect(tx1.to("transaction", "tx1").value()?.subcategoryId).toBe("sub2");
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub1");

        tx2.commit();
        expect(tx1.to("transaction", "tx1").value()?.subcategoryId).toBe("sub3");

        tx1.commit();
        expect(g.to("transaction", "tx1").value()?.subcategoryId).toBe("sub3");
    });
});

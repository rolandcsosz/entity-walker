import { describe, it, expect } from "vitest";
import { proxyAdapter, nonProxyAdapter, baseEntities } from "./shared";

function runScopeTests(label: string, wrapper: any) {
    const { nodeList, path } = wrapper;
    describe(label, () => {
        it("scoped() restricts entities() to scope ids", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx1" || t.id === "tx2").scoped();
            const ids = path(path(scoped, "subcategoryNodes"), "transactionNodes").ids();
            expect(ids).toEqual(["tx1", "tx2"]);
        });

        it("scoped() does not affect intermediate traversal nodes", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx1").scoped();
            const subs = path(scoped, "subcategoryNodes");

            expect(subs).toHaveLength(1);
            expect(subs.entities()).toHaveLength(1);
        });

        it("scoped() filters first()", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx2").scoped();
            const first = path(path(scoped, "subcategoryNodes"), "transactionNodes").first();
            expect(first?.id).toBe("tx2");
        });

        it("scoped() filters select()", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx1").scoped();
            const ids = path(path(scoped, "subcategoryNodes"), "transactionNodes").select((t: any) => t.id);
            expect(ids).toEqual(["tx1"]);
        });

        it("scoped() filters findEntity()", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx1").scoped();
            const txs = path(path(scoped, "subcategoryNodes"), "transactionNodes");
            expect(txs.findEntity((t: any) => t.id === "tx3")).toBeUndefined();
            expect(txs.findEntity((t: any) => t.id === "tx1")?.id).toBe("tx1");
        });

        it("scoped() affects isEmpty() and isNotEmpty()", () => {
            const scoped = nodeList("transaction").where((t: any) => t.id === "tx1").scoped();
            const subs = path(scoped, "subcategoryNodes");
            expect(subs.isEmpty()).toBe(false);
            expect(subs.isNotEmpty()).toBe(true);
        });

        it("scoped() carries through where()", () => {
            const scoped = nodeList("transaction").scoped();
            const filtered = path(path(scoped, "subcategoryNodes"), "transactionNodes")
                .where((t: any) => t.id === "tx1").unique();
            expect(filtered.ids()).toEqual(["tx1"]);
        });

        it("scoped() with() traversal and intersect pattern", () => {
            const result = nodeList("transaction").where((t: any) => t.id === "tx1" || t.id === "tx2").scoped()
                .with((self: any) => path(path(self, "subcategoryNodes"), "transactionNodes"));
            expect(result.ids()).toEqual(["tx1", "tx2"]);
        });

        it("scoped() nested scopes AND-compose", () => {
            const first = nodeList("transaction").scoped();
            const second = first.where((t: any) => t.id === "tx1").scoped();
            const result = path(path(second, "subcategoryNodes"), "transactionNodes");
            expect(result.ids()).toEqual(["tx1"]);
        });

        it("scoped() triple nesting narrows progressively", () => {
            const result = nodeList("transaction")
                .scoped()                                              // scope = {tx1, tx2, tx3}
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped()                                              // scope = {tx1, tx2}
                .where((t: any) => t.id === "tx1")
                .scoped();                                             // scope = {tx1}
            const ids = path(path(result, "subcategoryNodes"), "transactionNodes").ids();
            expect(ids).toEqual(["tx1"]);
        });

        it("scoped() across three different entity types", () => {
            // scope transactions to {tx1, tx2}
            const txScoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();

            // traverse to subcategories, scope to {sub1}
            const subScoped = path(txScoped, "subcategoryNodes")
                .where((s: any) => s.id === "sub1")
                .scoped();

            // traverse to mainCategories, scope to {cat1}
            const catScoped = path(subScoped, "mainCategoryNodes")
                .scoped();

            expect(catScoped.ids()).toEqual(["cat1"]);

            const subs = path(catScoped, "subcategoryNodes");
            expect(subs.ids()).toEqual(["sub1"]);

            const txs = path(subs, "transactionNodes");
            expect(txs.ids()).toEqual(["tx1"]);
        });

        it("scoping a derived list does not affect other lists starting from same source", () => {
            const listA = nodeList("transaction");
            const listB = nodeList("transaction");

            expect(listA.ids()).toEqual(listB.ids());
            expect(listA.ids()).toHaveLength(3);

            const narrowed = listA.where((e: any) => e.id === "tx1").scoped();
            expect(narrowed.ids()).toEqual(["tx1"]);

            expect(listB.ids()).toHaveLength(3);
            expect(listB.ids()).toEqual(expect.arrayContaining(["tx1", "tx2", "tx3"]));

            const subsFromNarrowed = path(narrowed, "subcategoryNodes");
            expect(subsFromNarrowed.ids()).toEqual(["sub1"]);

            const subsFromB = path(listB, "subcategoryNodes");
            expect(new Set(subsFromB.ids())).toEqual(new Set(["sub1", "sub2"]));
        });

        it("scoped() round-trip through full graph returns original filtered ids", () => {
            const filtered = nodeList("transaction").where((t: any) => t.id === "tx1" || t.id === "tx2");
            const scoped = filtered.scoped();
            const result = path(
                path(path(path(scoped, "subcategoryNodes"), "mainCategoryNodes"), "subcategoryNodes"),
                "transactionNodes"
            );
            expect(result.unique().ids()).toEqual(filtered.ids());
        });

        it("resetScope() clears list scope without changing node membership", () => {
            const list = nodeList("transaction");
            const narrowed = list.where((e: any) => e.id !== "tx2").scoped();
            expect(narrowed.ids()).toEqual(["tx1", "tx3"]);

            const reset = narrowed.resetScope();
            expect(reset.ids()).toEqual(["tx1", "tx3"]);
            expect(reset).not.toBe(narrowed);
        });

        it("info() shows null scope on unscoped list", () => {
            const list = nodeList("transaction");
            const info = list.info();
            expect(info.type).toBe("transaction");
            expect(info.length).toBe(3);
            expect(info.scope).toBeNull();
        });

        it("info() shows scope after scoped()", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();
            const info = scoped.info();
            expect(info.type).toBe("transaction");
            expect(info.scope).toEqual({ transaction: ["tx1", "tx2"] });
        });

        it("info() scope propagates through traversal", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const subs = path(scoped, "subcategoryNodes");
            const info = subs.info();
            expect(info.type).toBe("subcategory");
            expect(info.scope).toEqual({ transaction: ["tx1"] });
        });

        it("info() scope accumulates after multiple scoped() calls", () => {
            const txScoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const subs = path(txScoped, "subcategoryNodes")
                .scoped();
            const info = subs.info();
            expect(info.scope).toEqual({
                transaction: ["tx1"],
                subcategory: ["sub1"],
            });
        });

        it("info() scope narrows on repeated scoped() of same type", () => {
            const first = nodeList("transaction").scoped();
            expect(first.info().scope).toEqual({ transaction: ["tx1", "tx2", "tx3"] });

            const second = first.where((t: any) => t.id === "tx1" || t.id === "tx2").scoped();
            expect(second.info().scope).toEqual({ transaction: ["tx1", "tx2"] });

            const third = second.where((t: any) => t.id === "tx1").scoped();
            expect(third.info().scope).toEqual({ transaction: ["tx1"] });
        });

        it("info() shows null scope after resetScope()", () => {
            const scoped = nodeList("transaction").scoped();
            expect(scoped.info().scope).not.toBeNull();

            const reset = scoped.resetScope();
            expect(reset.info().scope).toBeNull();
        });

        it("info() scope preserved through where() without scoped()", () => {
            const scoped = nodeList("transaction").scoped();
            const filtered = scoped.where((t: any) => t.id === "tx1");
            expect(filtered.info().scope).toEqual({ transaction: ["tx1", "tx2", "tx3"] });
            expect(filtered.info().length).toBe(1);
        });

        it("info() scope tracks full traversal chain", () => {
            const txScoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();
            const subScoped = path(txScoped, "subcategoryNodes")
                .where((s: any) => s.id === "sub1")
                .scoped();
            const cats = path(subScoped, "mainCategoryNodes").scoped();
            expect(cats.info().scope).toEqual({
                transaction: ["tx1", "tx2"],
                subcategory: ["sub1"],
                mainCategory: ["cat1"],
            });
        });
    });
}

runScopeTests("scoped behavior [proxy]", proxyAdapter(baseEntities));
runScopeTests("scoped behavior [non-proxy]", nonProxyAdapter(baseEntities));


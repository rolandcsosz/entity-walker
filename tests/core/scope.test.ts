import { describe, it, expect } from "vitest";
import { proxyAdapter, nonProxyAdapter, baseEntities, GraphWrapper } from "../shared";

function runScopeTests(label: string, wrapper: GraphWrapper) {
    const { nodeList, path } = wrapper;
    describe(label, () => {
        it("scoped() restricts entities() to scope ids", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();
            const ids = path(path(scoped, "subcategoryNodes"), "transactionNodes").ids();
            expect(ids).toEqual(["tx1", "tx2"]);
        });

        it("scoped() does not affect intermediate traversal nodes", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const subs = path(scoped, "subcategoryNodes");

            expect(subs).toHaveLength(1);
            expect(subs.entities()).toHaveLength(1);
        });

        it("scoped() filters first()", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx2")
                .scoped();
            const first = path(path(scoped, "subcategoryNodes"), "transactionNodes").first();
            expect(first?.id).toBe("tx2");
        });

        it("scoped() filters select()", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const ids = path(path(scoped, "subcategoryNodes"), "transactionNodes").select((t: any) => t.id);
            expect(ids).toEqual(["tx1"]);
        });

        it("scoped() filters findEntity()", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const txs = path(path(scoped, "subcategoryNodes"), "transactionNodes");
            expect(txs.findEntity((t: any) => t.id === "tx3")).toBeUndefined();
            expect(txs.findEntity((t: any) => t.id === "tx1")?.id).toBe("tx1");
        });

        it("scoped() affects isEmpty() and isNotEmpty()", () => {
            const scoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const subs = path(scoped, "subcategoryNodes");
            expect(subs.isEmpty()).toBe(false);
            expect(subs.isNotEmpty()).toBe(true);
        });

        it("scoped() carries through where()", () => {
            const scoped = nodeList("transaction").scoped();
            const filtered = path(path(scoped, "subcategoryNodes"), "transactionNodes")
                .where((t: any) => t.id === "tx1")
                .unique();
            expect(filtered.ids()).toEqual(["tx1"]);
        });

        it("scoped() with() traversal and intersect pattern", () => {
            const result = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped()
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
                .scoped() // scope = {tx1, tx2, tx3}
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped() // scope = {tx1, tx2}
                .where((t: any) => t.id === "tx1")
                .scoped(); // scope = {tx1}
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
            const catScoped = path(subScoped, "mainCategoryNodes").scoped();

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
                "transactionNodes",
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
            const subs = path(txScoped, "subcategoryNodes").scoped();
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

function runComplexTests(label: string, wrapper: GraphWrapper) {
    const { nodeList, path } = wrapper;

    describe(label, () => {
        it("intersect() combined with where() on a scoped() traversal", () => {
            const txs = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();
            const subsList1 = path(txs, "subcategoryNodes").where((s: any) => s.id === "sub1");
            const subsList2 = nodeList("subcategory").where((s: any) => s.id === "sub1" || s.id === "sub2");

            const intersection = subsList1.intersect(subsList2).scoped();

            expect(intersection.ids()).toEqual(["sub1"]);

            const backToTxs = path(intersection, "transactionNodes");
            expect(backToTxs.ids()).toEqual(["tx1"]);
        });

        it("with() allows encapsulating complex scoped and intersect operations", () => {
            const result = nodeList("transaction").with((txList: any) => {
                const scoped1 = txList.where((t: any) => t.id === "tx1").scoped();
                const scoped2 = txList.where((t: any) => t.id === "tx1" || t.id === "tx3").scoped();
                return scoped1.intersect(scoped2).scoped();
            });
            expect(result.ids()).toEqual(["tx1"]);

            const subs = path(result, "subcategoryNodes");
            expect(subs.ids()).toEqual(["sub1"]);
        });

        it("chained complex operations: where().scoped().intersect().whereNode().scoped()", () => {
            const list = nodeList("transaction")
                .where((t: any) => t.subcategoryId === "sub1")
                .scoped()
                .intersect(["tx3", "tx2"])
                .whereNode((node: any) => node.value()?.id !== "tx1")
                .scoped();

            expect(list.ids()).toEqual(["tx3"]);
            expect(list.info().scope?.transaction).toEqual(["tx3"]);
        });

        it("where() filtering after intersect() of two scoped lists", () => {
            const list1 = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped();
            const list2 = nodeList("transaction")
                .where((t: any) => t.id === "tx2" || t.id === "tx3")
                .scoped();

            const intersection = list1.intersect(list2);
            const final = intersection.where((t: any) => t.id === "tx2").scoped();

            expect(final.ids()).toEqual(["tx2"]);
            const subs = path(final, "subcategoryNodes");
            expect(subs.ids()).toEqual(["sub2"]);
        });

        it("scoped() with multiple intersects and where calls", () => {
            const allTxs = nodeList("transaction");
            const part1 = allTxs.where((t: any) => t.id !== "tx1").scoped();
            const part2 = allTxs.where((t: any) => t.id !== "tx2").scoped();

            const both = part1.intersect(part2).scoped();
            expect(both.ids()).toEqual(["tx3"]);

            const noMatch = both.where((t: any) => t.id === "tx1").scoped();
            expect(noMatch.ids()).toEqual([]);
            expect(noMatch.isEmpty()).toBe(true);

            const emptySubs = path(noMatch, "subcategoryNodes");
            expect(emptySubs.ids()).toEqual([]);
        });

        it("intersecting a scoped list with another scoped list from a different traversal path", () => {
            const txScoped = nodeList("transaction")
                .where((t: any) => t.id === "tx1")
                .scoped();
            const subFromTx = path(txScoped, "subcategoryNodes");

            const catScoped = nodeList("mainCategory")
                .where((c: any) => c.id === "cat1")
                .scoped();
            const subFromCat = path(catScoped, "subcategoryNodes");

            const inter = subFromTx.intersect(subFromCat).scoped();
            expect(inter.ids()).toEqual(["sub1"]);

            expect(path(inter, "transactionNodes").ids()).toEqual(["tx1"]);
            expect(path(inter, "mainCategoryNodes").ids()).toEqual(["cat1"]);
        });

        it("combining with() returning a non-node type and where()", () => {
            const count = nodeList("transaction")
                .where((t: any) => t.id === "tx1" || t.id === "tx2")
                .scoped()
                .with((list: any) => list.ids().length);

            expect(count).toBe(2);
        });

        it("deeply nested with() calls within scoped traverses", () => {
            const result = nodeList("transaction")
                .scoped()
                .with((txs: any) => {
                    return path(txs, "subcategoryNodes")
                        .scoped()
                        .with((subs: any) => {
                            return path(subs, "mainCategoryNodes")
                                .scoped()
                                .with((cats: any) => {
                                    return cats.unique().where((c: any) => c.name === "Food");
                                });
                        });
                });
            expect(result.ids()).toEqual(["cat1"]);
        });

        it("whereNode() with scoped traversing and intersects", () => {
            const final = nodeList("transaction")
                .whereNode((node: any) => node.value()?.id !== "tx1")
                .scoped()
                .with((list: any) => {
                    const other = nodeList("transaction").where((t: any) => t.id === "tx2");
                    return list.intersect(other).scoped();
                });
            expect(final.ids()).toEqual(["tx2"]);

            const sub = path(final, "subcategoryNodes");
            expect(sub.ids()).toEqual(["sub2"]);
        });

        it("scoped() behavior when where() returns nothing", () => {
            const nothing = nodeList("transaction")
                .where((t: any) => t.id === "nonexistent")
                .scoped();
            expect(nothing.isEmpty()).toBe(true);

            const sub = path(nothing, "subcategoryNodes");
            expect(sub.isEmpty()).toBe(true);
            expect(sub.ids()).toEqual([]);

            const inter = sub.intersect(["sub1"]);
            expect(inter.isEmpty()).toBe(true);
        });

        it("unique() combined with scoped() and intersect()", () => {
            const txs = nodeList("transaction").scoped();
            const subs = path(txs, "subcategoryNodes").unique().scoped();

            const testSet = nodeList("subcategory")
                .where((s: any) => s.id === "sub2")
                .scoped();

            const inter = subs.intersect(testSet);
            expect(inter.ids()).toEqual(["sub2"]);

            const backToTxs = path(inter, "transactionNodes").unique().scoped();
            expect(backToTxs.ids()).toEqual(["tx2"]);
        });
    });
}

runComplexTests("Complex queries: scoped, intersect, where [proxy]", proxyAdapter(baseEntities));
runComplexTests("Complex queries: scoped, intersect, where [non-proxy]", nonProxyAdapter(baseEntities));

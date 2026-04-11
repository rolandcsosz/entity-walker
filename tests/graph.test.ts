
import { describe, it, expect } from "vitest";
import { Schema } from "./types";
import { Entities } from "../src";
import { baseEntities, baseEntitiesNumeric, GraphWrapper, nonProxyAdapter, nonProxyAdapterN, proxyAdapter, proxyAdapterN } from "./shared";

function runEntityGraphTests(label: string, { rootNode, nodeList, path, makeGraph }: GraphWrapper) {
    describe(label, () => {

    it("access first node object", () => {
        const subcategoryId = rootNode("transaction", "tx1").value()?.subcategoryId;
        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with valueOrThrow()", () => {
        expect(() => {
            rootNode("transaction", "error").valueOrThrow();
        }).toThrow();
    });

    it("access invalid first node object with value()", () => {
        const transaction = rootNode("transaction", "error").value();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with valueOrThrow()", () => {
        expect(() =>
            path(rootNode("transaction", "error"), "subcategory").valueOrThrow()
        ).toThrow();
    });

    it("access invalid related node object with value()", () => {
        const subcategory = path(rootNode("transaction", "error"), "subcategory").value();
        expect(subcategory).toBeUndefined();
    });

    it("walks relations via named functions", () => {
        const name = path(rootNode("transaction", "tx1"), "subcategory").value()?.name;
        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = path(rootNode("transaction", "tx1"), "subcategory").value()?.name;
        const name2 = path(rootNode("transaction", "tx2"), "subcategory").value()?.name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const mainCat    = path(path(rootNode("transaction", "tx1"), "subcategory"), "mainCategory");
        const expenseDesc = path(mainCat, "expenseType").value()?.description || "N/A";
        const incomeDesc  = path(mainCat, "incomeType").value()?.description  || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles relations with invalid FK returning undefined", () => {
        const expenseType = path(rootNode("mainCategory", "cat2"), "expenseType").value();
        expect(expenseType).toBeUndefined();
    });

    it("handles relations with missing property returning undefined", () => {
        const incomeType = path(rootNode("mainCategory", "cat3"), "expenseType").value();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK throwing on valueOrThrow()", () => {
        expect(() =>
            path(rootNode("mainCategory", "cat2"), "incomeType").valueOrThrow()
        ).toThrow();
    });

    it("handles relations with missing property throwing on valueOrThrow()", () => {
        expect(() =>
            path(rootNode("mainCategory", "cat3"), "incomeType").valueOrThrow()
        ).toThrow();
    });

    it("returns defined for valid relation", () => {
        expect(path(rootNode("mainCategory", "cat1"), "expenseType").value()).toBeDefined();
    });

    it("returns undefined for faulty relation", () => {
        expect(path(rootNode("mainCategory", "cat2"), "expenseType").value()).toBeUndefined();
    });

    it("returns undefined for missing relation", () => {
        expect(path(rootNode("mainCategory", "cat3"), "expenseType").value()).toBeUndefined();
    });

    it("throws on invalid relation", () => {
        expect(() =>
            path(rootNode("transaction", "tx1"), "mainCategory").value()
        ).toThrow();
    });

    it("returns undefined for missing entity", () => {
        const tx = rootNode("transaction", "invalid").value();
        expect(tx).toBeUndefined();
    });

    it("traverses reverse", () => {
        const catNode = rootNode("mainCategory", "cat1");
        const subNodes = path(catNode, "subcategoryNodes");

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].value()?.id).toBe("sub1");
        expect(subNodes[1].value()?.id).toBe("sub2");

        const sub1Transactions = path(subNodes[0], "transactionNodes");
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = rootNode("subcategory", "sub1");

        const titles = path(subNode, "transactionNodes")
            .filter((tn: any) => {
                const mainCat = path(path(tn, "subcategory"), "mainCategory").value();
                return mainCat?.name === "Food";
            })
            .map((tn: any) => tn.value()?.id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const transactions = path(
            path(nodeList("mainCategory", (mc: any) => mc.expenseTypeId === "et1"), "subcategoryNodes"),
            "transactionNodes",
        );
        expect(transactions).toHaveLength(3);
        expect(transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode   = rootNode("expenseType", "et1");
        const mainCats = path(exNode, "mainCategoryNodes");
        const subs     = path(mainCats, "subcategoryNodes");
        const allTransactionIds = path(subs, "transactionNodes").map((tn: any) => tn.value()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode   = rootNode("expenseType", "et1");
        const mainCats = path(exNode, "mainCategoryNodes");

        const filteredTransactionIds = path(mainCats, "subcategoryNodes")
            .filter((sc: any) => path(sc, "mainCategory").value()?.expenseTypeId === "et1")
            .flatMap((sc: any) => path(sc, "transactionNodes"))
            .map((tn: any) => tn.value()?.id);

        expect(filteredTransactionIds).toHaveLength(3);
        expect(filteredTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("returns an empty array for references with no matches", () => {
        const emptyG = makeGraph({
            transaction: [],
            subcategory: [],
            mainCategory: [],
            expenseType: [],
            incomeType: [],
        } as Entities<Schema>);

        const results = path(emptyG.rootNode("expenseType", "nonexistent"), "mainCategoryNodes");
        expect(results).toEqual([]);
    });

    it("returns an empty array (safe fallback) when the parent node does not exist", () => {
        const missingMainCategory = rootNode("mainCategory", "nonexistent");
        const result = path(missingMainCategory, "subcategoryNodes");

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it("returns frozen entities from value()", () => {
        const tx = rootNode("transaction", "tx1").value();
        expect(Object.isFrozen(tx)).toBe(true);
    });

    it("returns all entities via base references", () => {
        const allTransactions = nodeList("transaction");
        expect(allTransactions).toHaveLength(3);
        expect(allTransactions.map((t: any) => t.value()?.id)).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("filters entities via base references with where clause", () => {
        const filtered = nodeList("transaction", (t: any) => t.subcategoryId === "sub1");
        expect(filtered).toHaveLength(2);
        expect(filtered.map((t: any) => t.value()?.id)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when where clause matches nothing", () => {
        const filtered = nodeList("transaction", (t: any) => t.subcategoryId === "nonexistent");
        expect(filtered).toHaveLength(0);
    });

    it("base references return walkable nodes", () => {
        const subs  = nodeList("subcategory");
        const names = subs.map((s: any) => path(s, "mainCategory").value()?.name);
        expect(names).toEqual(["Food", "Food"]);
    });

    it("base references with where and chaining", () => {
        const categories  = nodeList("mainCategory", (c: any) => c.name === "Food");
        const expenseDescs = categories.map((c: any) => path(c, "expenseType").value()?.description);
        expect(expenseDescs).toContain("Groceries");
    });

    it("entities() on base references returns plain objects", () => {
        const transactions = nodeList("transaction").entities();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].id).toBe("tx1");
        expect(transactions[0].subcategoryId).toBe("sub1");
    });

    it("entities() with where clause filters and returns plain objects", () => {
        const transactions = nodeList("transaction", (t: any) => t.subcategoryId === "sub1").entities();
        expect(transactions).toHaveLength(2);
        expect(transactions.map((t: any) => t.id)).toEqual(["tx1", "tx3"]);
    });

    it("entities() on node-level reverse references returns plain objects", () => {
        const subs = path(rootNode("mainCategory", "cat1"), "subcategoryNodes").entities();
        expect(subs).toHaveLength(2);
        expect(subs[0].name).toBe("sub1");
    });

    it("entities() filters out undefined entries", () => {
        const results = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").entities();
        expect(results).toEqual([]);
    });

    it("multi-level chained references with filter on intermediate list", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes");
        const ids = path(mainCats, "subcategoryNodes")
            .filter((sc: any) => sc.value()?.name === "sub1")
            .flatMap((sc: any) => path(sc, "transactionNodes"))
            .map((tn: any) => tn.value()?.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("multi-level chained references with filter and entities()", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes");
        const subs = path(mainCats, "subcategoryNodes")
            .filter((sc: any) => sc.value()?.name === "sub2");

        expect(subs).toHaveLength(1);
        expect(subs[0].value()?.id).toBe("sub2");

        const transactions = subs.flatMap((sc: any) => path(sc, "transactionNodes"));
        expect(transactions.map((t: any) => t.value()?.id)).toEqual(["tx2"]);
    });

    it("base references with where into chained traversal", () => {
        const mainCats = nodeList("mainCategory", (c: any) => c.expenseTypeId === "et1");
        const subs     = path(mainCats, "subcategoryNodes");
        const ids      = path(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("base references with where that narrows results through chain", () => {
        const subs = nodeList("subcategory", (s: any) => s.name === "sub1");
        const ids  = path(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained references with multiple filters at different levels", () => {
        const txs      = nodeList("transaction", (t: any) => t.subcategoryId === "sub1");
        const subs     = path(txs, "subcategoryNodes");
        const mainCats = path(subs, "mainCategoryNodes", (c: any) => c.expenseTypeId === "et1");
        const descriptions = path(mainCats, "expenseTypeNodes").entities().map((e: any) => e.description);

        expect(descriptions).toEqual(["Groceries", "Groceries"]);
    });

    it("chained where on reverse references at multiple levels", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes", (c: any) => c.name === "Food");
        const subs     = path(mainCats, "subcategoryNodes", (s: any) => s.name === "sub1");
        const ids      = path(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained where on forward edges at multiple levels", () => {
        const txs     = nodeList("transaction", (t: any) => t.subcategoryId === "sub1");
        const subs    = path(txs, "subcategoryNodes", (s: any) => s.mainCategoryId === "cat1");
        const results = path(subs, "mainCategoryNodes", (c: any) => c.expenseTypeId === "et1").entities();

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Food");
    });

    it("chained where filters out non-matching at each level", () => {
        const mainCats = nodeList("mainCategory", (c: any) => c.expenseTypeId === "et1");
        const subs     = path(mainCats, "subcategoryNodes", (s: any) => s.name === "sub2");
        const ids      = path(subs, "transactionNodes", (t: any) => t.subcategoryId === "sub2")
            .entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx2"]);
    });

    it("chained where that filters everything out", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes", (c: any) => c.name === "NonExistent");
        const ids      = path(mainCats, "subcategoryNodes").entities();

        expect(ids).toHaveLength(0);
    });

    it("unique() removes duplicate entities from chained traversal", () => {
        const categories = path(path(rootNode("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes").entities();

        expect(categories).toHaveLength(2);
        expect(categories[0].id).toBe("cat1");
        expect(categories[1].id).toBe("cat1");

        const unique = path(path(rootNode("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes")
            .unique()
            .entities();

        expect(unique).toHaveLength(1);
        expect(unique[0].id).toBe("cat1");
    });

    it("unique() on base references with no duplicates", () => {
        const subs = nodeList("subcategory").unique().entities();
        expect(subs).toHaveLength(2);
        expect(subs.map((s: any) => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("unique() returns empty for missing entities", () => {
        const result = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").unique();
        expect(result).toHaveLength(0);
    });

    it("unique() on deep chain with duplicates", () => {
        const subs = path(path(rootNode("expenseType", "et1"), "mainCategoryNodes"), "subcategoryNodes");
        const transactions = path(subs, "mainCategoryNodes").unique().entities();

        expect(transactions).toHaveLength(1);
        expect(transactions[0].id).toBe("cat1");
    });

    it("where() filters current list by predicate", () => {
        const subs = nodeList("mainCategory").where((s: any) => s.name === "sub1");
        expect(subs).toHaveLength(0);

        const filtered = nodeList("subcategory").where((s: any) => s.name === "sub1");
        expect(filtered).toHaveLength(1);
        expect(filtered[0].value()?.id).toBe("sub1");
    });

    it("where() returns walkable EntityNodeList", () => {
        const subs  = nodeList("subcategory").where((s: any) => s.name === "sub1");
        const txIds = path(subs, "transactionNodes").entities().map((t: any) => t.id);
        expect(txIds).toEqual(["tx1", "tx3"]);
    });

    it("where() returns empty list when nothing matches", () => {
        const result = nodeList("subcategory").where((s: any) => s.name === "nonexistent");
        expect(result).toHaveLength(0);
    });

    it("where() chained after reverse reference traversal", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes");
        const cats = path(mainCats, "subcategoryNodes")
            .where((s: any) => s.name === "sub2")
            .entities();
        expect(cats).toHaveLength(1);
        expect(cats[0].id).toBe("sub2");
    });

    it("where() can chain further into forward and reverse edges", () => {
        const mainCats = path(rootNode("expenseType", "et1"), "mainCategoryNodes");
        const subs     = path(mainCats, "subcategoryNodes").where((s: any) => s.name === "sub2");
        const txIds    = path(subs, "transactionNodes").entities().map((t: any) => t.id);
        expect(txIds).toEqual(["tx2"]);
    });

    it("select() maps resolved entities", () => {
        const names = nodeList("subcategory").select((s: any) => s.name);
        expect(names).toEqual(["sub1", "sub2"]);
    });

    it("select() skips missing entities", () => {
        const ids = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").select((s: any) => s.id);
        expect(ids).toEqual([]);
    });

    it("select() works after chained traversal", () => {
        const ids = path(path(rootNode("expenseType", "et1"), "mainCategoryNodes"), "subcategoryNodes").select((s: any) => s.id);
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns entity ids", () => {
        const ids = nodeList("subcategory").ids();
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns empty array for missing entities", () => {
        const ids = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").ids();
        expect(ids).toEqual([]);
    });

    it("ids() works after chained traversal with duplicates", () => {
        const ids = path(path(rootNode("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes").ids();
        expect(ids).toEqual(["cat1", "cat1"]);
    });

    it("first() returns first resolved entity", () => {
        const sub = nodeList("subcategory").first();
        expect(sub?.id).toBe("sub1");
    });

    it("first() returns undefined for empty list", () => {
        const result = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").first();
        expect(result).toBeUndefined();
    });

    it("first() returns first after where() filter", () => {
        const sub = nodeList("subcategory").where((s: any) => s.name === "sub2").first();
        expect(sub?.id).toBe("sub2");
    });

    it("isEmpty() returns false when entities exist", () => {
        expect(nodeList("subcategory").isEmpty()).toBe(false);
    });

    it("isEmpty() returns true for empty list", () => {
        expect(path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").isEmpty()).toBe(true);
    });

    it("isEmpty() returns true after where() matches nothing", () => {
        expect(nodeList("subcategory").where((s: any) => s.name === "nonexistent").isEmpty()).toBe(true);
    });

    it("isNotEmpty() returns true when entities exist", () => {
        expect(nodeList("subcategory").isNotEmpty()).toBe(true);
    });

    it("isNotEmpty() returns false for empty list", () => {
        expect(path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").isNotEmpty()).toBe(false);
    });

    it("isNotEmpty() returns false after where() matches nothing", () => {
        expect(nodeList("subcategory").where((s: any) => s.name === "nonexistent").isNotEmpty()).toBe(false);
    });

    it("exists() returns true for a valid entity", () => {
        expect(rootNode("transaction", "tx1").exists()).toBe(true);
    });

    it("exists() returns false for a missing entity", () => {
        expect(rootNode("transaction", "nonexistent").exists()).toBe(false);
    });

    it("exists() returns false when traversal leads to null", () => {
        expect(path(rootNode("transaction", "nonexistent"), "subcategory").exists()).toBe(false);
    });

    it("exists() returns true for a valid chained entity", () => {
        expect(path(rootNode("transaction", "tx1"), "subcategory").exists()).toBe(true);
    });

    it("exists() true — value() returns the entity", () => {
        const node = rootNode("transaction", "tx1");
        expect(node.exists()).toBe(true);
        expect(node.value()?.id).toBe("tx1");
    });

    it("exists() true — valueOrThrow() does not throw", () => {
        const node = rootNode("transaction", "tx1");
        expect(node.exists()).toBe(true);
        expect(() => node.valueOrThrow()).not.toThrow();
        expect(node.valueOrThrow().id).toBe("tx1");
    });

    it("exists() false — value() returns undefined", () => {
        const node = rootNode("transaction", "nonexistent");
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false — valueOrThrow() throws", () => {
        const node = rootNode("transaction", "nonexistent");
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("exists() false on chained traversal — value() returns undefined", () => {
        const node = path(rootNode("transaction", "nonexistent"), "subcategory");
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false on chained traversal — valueOrThrow() throws", () => {
        const node = path(rootNode("transaction", "nonexistent"), "subcategory");
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("findEntity() returns matching entity", () => {
        const sub = nodeList("subcategory").findEntity((s: any) => s.name === "sub2");
        expect(sub?.id).toBe("sub2");
    });

    it("findEntity() returns undefined when nothing matches", () => {
        const sub = nodeList("subcategory").findEntity((s: any) => s.name === "nonexistent");
        expect(sub).toBeUndefined();
    });

    it("findEntity() returns undefined for empty list", () => {
        const sub = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").findEntity(() => true);
        expect(sub).toBeUndefined();
    });

    it("findEntity() works after chained traversal", () => {
        const tx = path(nodeList("subcategory"), "transactionNodes").findEntity((t: any) => t.id === "tx2");
        expect(tx?.id).toBe("tx2");
    });

    it("findNode() returns matching node", () => {
        const node = nodeList("subcategory").findNode((s: any) => s.name === "sub2");
        expect(node).toBeDefined();
        expect(node!.value()?.id).toBe("sub2");
    });

    it("findNode() returns a traversable node", () => {
        const node = nodeList("subcategory").findNode((s: any) => s.name === "sub1");
        const cat = path(node, "mainCategory").value();
        expect(cat?.id).toBe("cat1");
    });

    it("findNode() returns undefined when nothing matches", () => {
        const node = nodeList("subcategory").findNode((s: any) => s.name === "nonexistent");
        expect(node).toBeUndefined();
    });

    it("findNode() returns undefined for empty list", () => {
        const node = path(rootNode("mainCategory", "nonexistent"), "subcategoryNodes").findNode(() => true);
        expect(node).toBeUndefined();
    });

    it("findNode() works after chained traversal", () => {
        const node = path(nodeList("subcategory"), "transactionNodes").findNode((t: any) => t.id === "tx2");
        expect(node).toBeDefined();
        expect(node!.value()?.subcategoryId).toBe("sub2");
    });

    });
}

runEntityGraphTests("entity graph [proxy]",     proxyAdapter(baseEntities));
runEntityGraphTests("entity graph [non-proxy]", nonProxyAdapter(baseEntities));

function runInfoHelperTests(label: string, { graph, rootNode , path, makeGraph }: GraphWrapper) {
    describe(label, () => {

    describe("graph.schema()", () => {
        it("lists all entity types", () => {
            const schema = graph.schema();
            expect(schema.entities).toEqual(expect.arrayContaining([
                "transaction", "subcategory", "mainCategory", "expenseType", "incomeType",
            ]));
        });

        it("lists all edges with correct from/to", () => {
            const schema = graph.schema();
            const edgePairs = schema.edges.map((e: any) => ({ from: e.from, to: e.to }));
            expect(edgePairs).toEqual(expect.arrayContaining([
                { from: "transaction", to: "subcategory" },
                { from: "subcategory", to: "mainCategory" },
                { from: "mainCategory", to: "expenseType" },
                { from: "mainCategory", to: "incomeType" },
            ]));
        });

        it("correctly marks bidirectional edges", () => {
            const schema = graph.schema();
            const txSub = schema.edges.find((e: any) => e.from === "transaction" && e.to === "subcategory");
            expect(txSub?.bidirectional).toBe(true);
        });

        it("correctly marks non-bidirectional edges", () => {
            const schema = graph.schema();
            const catIncome = schema.edges.find((e: any) => e.from === "mainCategory" && e.to === "incomeType");
            expect(catIncome?.bidirectional).toBe(false);
        });
    });

    describe("graph.info()", () => {
        it("returns entity counts", () => {
            const info = graph.info();
            expect(info.entityCounts.transaction).toBe(3);
            expect(info.entityCounts.subcategory).toBe(2);
            expect(info.entityCounts.mainCategory).toBe(3);
            expect(info.entityCounts.expenseType).toBe(1);
            expect(info.entityCounts.incomeType).toBe(1);
        });

        it("returns cache with nodeCount", () => {
            const info = graph.info();
            expect(typeof info.cache.nodeCount).toBe("number");
        });

        it("detects missing FK references", () => {
            const info = graph.info();
            const missingIds = info.missingEntities.map((m: any) => m.id);
            expect(missingIds).toContain("error");
        });

        it("missing entities have correct type", () => {
            const info = graph.info();
            const missingExpense = info.missingEntities.find((m: any) => m.id === "error" && m.type === "expenseType");
            expect(missingExpense).toBeDefined();
        });

        it("returns empty missingEntities when all FKs resolve", () => {
            const clean = makeGraph({
                transaction:  [{ id: "t1", subcategoryId: "s1" }],
                subcategory:  [{ id: "s1", name: "s1", mainCategoryId: "c1" }],
                mainCategory: [{ id: "c1", name: "C", expenseTypeId: "e1", incomeTypeId: "i1" }],
                expenseType:  [{ id: "e1", description: "d" }],
                incomeType:   [{ id: "i1", description: "d" }],
            });
            expect(clean.graph.info().missingEntities).toHaveLength(0);
        });

        it("detects orphan entities not referenced by any edge", () => {
            const info = graph.info();
            expect(info.orphanEntities.transaction).toBeUndefined();
            expect(info.orphanEntities.mainCategory).toEqual(["cat2", "cat3"]);
        });

        it("orphanEntities omits types that are fully referenced", () => {
            const info = graph.info();
            expect(info.orphanEntities.subcategory).toBeUndefined();
        });

        it("cat2 and cat3 are orphans in mainCategory (no subcategory points to them)", () => {
            const info = graph.info();
            expect(info.orphanEntities.mainCategory).toEqual(["cat2", "cat3"]);
        });
    });

    describe("node.path()", () => {
        it("returns single-step path for a root node", () => {
            const path = rootNode("transaction", "tx1").path();
            expect(path).toEqual(["transaction(tx1)"]);
        });

        it("returns multi-step path after traversal", () => {
            const pathToNode = path(rootNode("transaction", "tx1"), "subcategory").path();
            expect(pathToNode).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns path with null marker for missing entity", () => {
            const pathToNode = path(rootNode("transaction", "nonexistent"), "subcategory").path();
            expect(pathToNode).toEqual(["transaction(nonexistent)", "subcategory(null)"]);
        });
    });

    describe("node.info()", () => {
        it("returns correct info for an existing node", () => {
            const info = rootNode("transaction", "tx1").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("tx1");
            expect(info.exists).toBe(true);
            expect(info.value?.id).toBe("tx1");
            expect(info.path).toEqual(["transaction(tx1)"]);
        });

        it("returns correct info for a missing node", () => {
            const info = rootNode("transaction", "nonexistent").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("nonexistent");
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });

        it("returns correct info after chained traversal", () => {
            const info = path(rootNode("transaction", "tx1"), "subcategory").info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBe("sub1");
            expect(info.exists).toBe(true);
            expect(info.path).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns correct info for a null node from missing traversal", () => {
            const info = path(rootNode("transaction", "nonexistent"), "subcategory").info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });
    });

    describe("better error messages", () => {
        it("valueOrThrow on missing entity mentions entity type and id", () => {
            expect(() => rootNode("transaction", "bad").valueOrThrow()).toThrow(/transaction.*bad/);
        });

        it("valueOrThrow on null node mentions null traversal", () => {
            expect(() => path(rootNode("transaction", "nonexistent"), "subcategory").valueOrThrow()).toThrow(/subcategory/);
        });

        it("accessing unknown relation mentions available relations", () => {
            expect(() => path(rootNode("transaction", "tx1"), "unknownRel")).toThrow(/unknownRel/);
        });
    });

    });
}

runInfoHelperTests("info helpers [proxy]",     proxyAdapter(baseEntities));
runInfoHelperTests("info helpers [non-proxy]", nonProxyAdapter(baseEntities));

function runNumericIdTests(label: string, { rootNode, nodeList, path, makeGraph }: GraphWrapper) {
    describe(label, () => {

    it("resolves entity by numeric id", () => {
        expect(rootNode("transaction", 1).value()?.subcategoryId).toBe(10);
    });

    it("returns undefined for missing numeric id", () => {
        expect(rootNode("transaction", 999).value()).toBeUndefined();
    });

    it("exists() returns true for valid numeric id", () => {
        expect(rootNode("transaction", 1).exists()).toBe(true);
    });

    it("exists() returns false for missing numeric id", () => {
        expect(rootNode("transaction", 999).exists()).toBe(false);
    });

    it("valueOrThrow() works for valid numeric id", () => {
        expect(() => rootNode("transaction", 1).valueOrThrow()).not.toThrow();
        expect(rootNode("transaction", 1).valueOrThrow().id).toBe(1);
    });

    it("valueOrThrow() throws for missing numeric id", () => {
        expect(() => rootNode("transaction", 999).valueOrThrow()).toThrow();
    });

    it("traverses forward edge via numeric FK", () => {
        const sub = path(rootNode("transaction", 1), "subcategory").value();
        expect(sub?.id).toBe(10);
        expect(sub?.name).toBe("sub1");
    });

    it("traverses reverse edge via numeric-id entity", () => {
        const txs = path(rootNode("subcategory", 10), "transactionNodes");
        expect(txs).toHaveLength(1);
        expect(txs[0].value()?.id).toBe(1);
    });

    it("chains multiple forward traversals", () => {
        const expType = path(
            path(path(rootNode("transaction", 1), "subcategory"), "mainCategory"),
            "expenseType",
        ).value();
        expect(expType?.description).toBe("Groceries");
    });

    it("nodeList returns all entities with numeric ids", () => {
        const txs = nodeList("transaction");
        expect(txs).toHaveLength(2);
    });

    it("ids() returns numeric ids", () => {
        expect(nodeList("transaction").ids()).toEqual([1, 2]);
    });

    it("ids() on reverse edge result returns numeric ids", () => {
        const txIds = path(rootNode("subcategory", 10), "transactionNodes").ids();
        expect(txIds).toContain(1);
    });

    it("nodeList with where predicate on numeric field", () => {
        const filtered = nodeList("transaction", (t: any) => t.subcategoryId === 10);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].value()?.id).toBe(1);
    });

    it("forward edge to missing entity resolves to null node", () => {
        const ghost = path(rootNode("transaction", 999), "subcategory");
        expect(ghost.exists()).toBe(false);
        expect(ghost.value()).toBeUndefined();
    });

    it("reverse edge from missing entity returns empty array", () => {
        const result = path(rootNode("subcategory", 999), "transactionNodes");
        expect(result).toHaveLength(0);
    });

    it("select() maps resolved entities with numeric ids", () => {
        const ids = nodeList("subcategory").select((s: any) => s.id);
        expect(ids).toEqual([10, 20]);
    });

    it("first() returns first entity with numeric id", () => {
        const tx = nodeList("transaction").first();
        expect(tx?.id).toBe(1);
    });

    it("insert then retrieve by numeric id", () => {
        const { rootNode, update } = makeGraph(structuredClone({ transaction: [], subcategory: [{ id: 10, name: "sub1", mainCategoryId: 100 }], mainCategory: [], expenseType: [], incomeType: [] }) as any);
        update("transaction", { id: 5, subcategoryId: 10 });
        expect(rootNode("transaction", 5).exists()).toBe(true);
        expect(rootNode("transaction", 5).value()?.subcategoryId).toBe(10);
    });

    it("update then retrieve updated value by numeric id", () => {
        const { rootNode, update } = makeGraph(structuredClone({ transaction: [{ id: 1, subcategoryId: 10 }], subcategory: [], mainCategory: [], expenseType: [], incomeType: [] }) as any);
        update("transaction", { id: 1, subcategoryId: 20 });
        expect(rootNode("transaction", 1).value()?.subcategoryId).toBe(20);
    });

    it("delete removes entity with numeric id", () => {
        const { rootNode } = makeGraph(structuredClone({ transaction: [{ id: 1, subcategoryId: 10 }], subcategory: [], mainCategory: [], expenseType: [], incomeType: [] }) as any);
        rootNode("transaction", 1).delete();
        expect(rootNode("transaction", 1).exists()).toBe(false);
    });

    });
}

runNumericIdTests("numeric IDs [proxy]",     proxyAdapterN(structuredClone(baseEntitiesNumeric)));
runNumericIdTests("numeric IDs [non-proxy]", nonProxyAdapterN(structuredClone(baseEntitiesNumeric)));


import { describe, it, expect } from "vitest";
import { Entities, createGraph, createNonProxyGraph } from "../src/index";
import { edges, Schema } from "./types";


const entities: Entities<Schema> = {
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

// ─── Unified adapter type ─────────────────────────────────────────────────────
// n   : root node  → proxy: graph.entity("id")            non-proxy: graph.to("entity", "id")
// l   : root list  → proxy: graph.entityNodes(where?)     non-proxy: graph.to("entityNodes", where?)
// tr  : traverse   → proxy: node.subcategory(where?)      non-proxy: node.to("subcategory", where?)
type G = {
    /** n: retrieves a single node reference for a given type and id */
    n:    (type: string, id: string) => any;
    /** l: retrieves a list of node references for a given type, optionally filtered by a predicate */
    l:    (type: string, where?: (e: any) => boolean) => any;
    /** tr: traverses from a node or list of nodes via a relation, optionally filtered by a predicate */
    tr:   (nodeOrList: any, rel: string, where?: (e: any) => boolean) => any;
    /** graph: the underlying graph instance */
    graph: any;
    /** mkG: creates a new graph instance with the given entities */
    mkG:  (entities: Entities<Schema>) => G;
};

function proxyGraph(ents: Entities<Schema>): G {
    const graph = createGraph({ entities: ents, edges }) as any;
    return {
        graph,
        n:   (type, id)               => graph[type](id),
        l:   (type, where?)           => graph[`${type}Nodes`](where),
        tr:  (nodeOrList, rel, where?) => nodeOrList[rel](where),
        mkG: (e) => proxyGraph(e),
    };
}

function nonProxyGraph(ents: Entities<Schema>): G {
    const graph = createNonProxyGraph({ entities: ents, edges }) as any;
    return {
        graph,
        n:   (type, id)               => graph.to(type, id),
        l:   (type, where?)           => graph.to(`${type}Nodes`, where),
        tr:  (nodeOrList, rel, where?) => nodeOrList.to(rel, where),
        mkG: (e) => nonProxyGraph(e),
    };
}

function runEntityGraphTests(label: string, { n, l, tr, mkG }: G) {
    describe(label, () => {

    it("access first node object", () => {
        const subcategoryId = n("transaction", "tx1").value()?.subcategoryId;
        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with valueOrThrow()", () => {
        expect(() => {
            n("transaction", "error").valueOrThrow();
        }).toThrow();
    });

    it("access invalid first node object with value()", () => {
        const transaction = n("transaction", "error").value();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with valueOrThrow()", () => {
        expect(() =>
            tr(n("transaction", "error"), "subcategory").valueOrThrow()
        ).toThrow();
    });

    it("access invalid related node object with value()", () => {
        const subcategory = tr(n("transaction", "error"), "subcategory").value();
        expect(subcategory).toBeUndefined();
    });

    it("walks relations via named functions", () => {
        const name = tr(n("transaction", "tx1"), "subcategory").value()?.name;
        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = tr(n("transaction", "tx1"), "subcategory").value()?.name;
        const name2 = tr(n("transaction", "tx2"), "subcategory").value()?.name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const mainCat    = tr(tr(n("transaction", "tx1"), "subcategory"), "mainCategory");
        const expenseDesc = tr(mainCat, "expenseType").value()?.description || "N/A";
        const incomeDesc  = tr(mainCat, "incomeType").value()?.description  || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles relations with invalid FK returning undefined", () => {
        const expenseType = tr(n("mainCategory", "cat2"), "expenseType").value();
        expect(expenseType).toBeUndefined();
    });

    it("handles relations with missing property returning undefined", () => {
        const incomeType = tr(n("mainCategory", "cat3"), "expenseType").value();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK throwing on valueOrThrow()", () => {
        expect(() =>
            tr(n("mainCategory", "cat2"), "incomeType").valueOrThrow()
        ).toThrow();
    });

    it("handles relations with missing property throwing on valueOrThrow()", () => {
        expect(() =>
            tr(n("mainCategory", "cat3"), "incomeType").valueOrThrow()
        ).toThrow();
    });

    it("returns defined for valid relation", () => {
        expect(tr(n("mainCategory", "cat1"), "expenseType").value()).toBeDefined();
    });

    it("returns undefined for faulty relation", () => {
        expect(tr(n("mainCategory", "cat2"), "expenseType").value()).toBeUndefined();
    });

    it("returns undefined for missing relation", () => {
        expect(tr(n("mainCategory", "cat3"), "expenseType").value()).toBeUndefined();
    });

    it("throws on invalid relation", () => {
        expect(() =>
            tr(n("transaction", "tx1"), "mainCategory").value()
        ).toThrow();
    });

    it("returns undefined for missing entity", () => {
        const tx = n("transaction", "invalid").value();
        expect(tx).toBeUndefined();
    });

    it("traverses reverse", () => {
        const catNode = n("mainCategory", "cat1");
        const subNodes = tr(catNode, "subcategoryNodes");

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].value()?.id).toBe("sub1");
        expect(subNodes[1].value()?.id).toBe("sub2");

        const sub1Transactions = tr(subNodes[0], "transactionNodes");
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = n("subcategory", "sub1");

        const titles = tr(subNode, "transactionNodes")
            .filter((tn: any) => {
                const mainCat = tr(tr(tn, "subcategory"), "mainCategory").value();
                return mainCat?.name === "Food";
            })
            .map((tn: any) => tn.value()?.id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const transactions = tr(
            tr(l("mainCategory", (mc: any) => mc.expenseTypeId === "et1"), "subcategoryNodes"),
            "transactionNodes",
        );
        expect(transactions).toHaveLength(3);
        expect(transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode   = n("expenseType", "et1");
        const mainCats = tr(exNode, "mainCategoryNodes");
        const subs     = tr(mainCats, "subcategoryNodes");
        const allTransactionIds = tr(subs, "transactionNodes").map((tn: any) => tn.value()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode   = n("expenseType", "et1");
        const mainCats = tr(exNode, "mainCategoryNodes");

        const filteredTransactionIds = tr(mainCats, "subcategoryNodes")
            .filter((sc: any) => tr(sc, "mainCategory").value()?.expenseTypeId === "et1")
            .flatMap((sc: any) => tr(sc, "transactionNodes"))
            .map((tn: any) => tn.value()?.id);

        expect(filteredTransactionIds).toHaveLength(3);
        expect(filteredTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("returns an empty array for references with no matches", () => {
        const emptyG = mkG({
            transaction: [],
            subcategory: [],
            mainCategory: [],
            expenseType: [],
            incomeType: [],
        } as Entities<Schema>);

        const results = tr(emptyG.n("expenseType", "nonexistent"), "mainCategoryNodes");
        expect(results).toEqual([]);
    });

    it("returns an empty array (safe fallback) when the parent node does not exist", () => {
        const missingMainCategory = n("mainCategory", "nonexistent");
        const result = tr(missingMainCategory, "subcategoryNodes");

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it("returns frozen entities from value()", () => {
        const tx = n("transaction", "tx1").value();
        expect(Object.isFrozen(tx)).toBe(true);
    });

    it("returns all entities via base references", () => {
        const allTransactions = l("transaction");
        expect(allTransactions).toHaveLength(3);
        expect(allTransactions.map((t: any) => t.value()?.id)).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("filters entities via base references with where clause", () => {
        const filtered = l("transaction", (t: any) => t.subcategoryId === "sub1");
        expect(filtered).toHaveLength(2);
        expect(filtered.map((t: any) => t.value()?.id)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when where clause matches nothing", () => {
        const filtered = l("transaction", (t: any) => t.subcategoryId === "nonexistent");
        expect(filtered).toHaveLength(0);
    });

    it("base references return walkable nodes", () => {
        const subs  = l("subcategory");
        const names = subs.map((s: any) => tr(s, "mainCategory").value()?.name);
        expect(names).toEqual(["Food", "Food"]);
    });

    it("base references with where and chaining", () => {
        const categories  = l("mainCategory", (c: any) => c.name === "Food");
        const expenseDescs = categories.map((c: any) => tr(c, "expenseType").value()?.description);
        expect(expenseDescs).toContain("Groceries");
    });

    it("entities() on base references returns plain objects", () => {
        const transactions = l("transaction").entities();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].id).toBe("tx1");
        expect(transactions[0].subcategoryId).toBe("sub1");
    });

    it("entities() with where clause filters and returns plain objects", () => {
        const transactions = l("transaction", (t: any) => t.subcategoryId === "sub1").entities();
        expect(transactions).toHaveLength(2);
        expect(transactions.map((t: any) => t.id)).toEqual(["tx1", "tx3"]);
    });

    it("entities() on node-level reverse references returns plain objects", () => {
        const subs = tr(n("mainCategory", "cat1"), "subcategoryNodes").entities();
        expect(subs).toHaveLength(2);
        expect(subs[0].name).toBe("sub1");
    });

    it("entities() filters out undefined entries", () => {
        const results = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").entities();
        expect(results).toEqual([]);
    });

    it("multi-level chained references with filter on intermediate list", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes");
        const ids = tr(mainCats, "subcategoryNodes")
            .filter((sc: any) => sc.value()?.name === "sub1")
            .flatMap((sc: any) => tr(sc, "transactionNodes"))
            .map((tn: any) => tn.value()?.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("multi-level chained references with filter and entities()", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes");
        const subs = tr(mainCats, "subcategoryNodes")
            .filter((sc: any) => sc.value()?.name === "sub2");

        expect(subs).toHaveLength(1);
        expect(subs[0].value()?.id).toBe("sub2");

        const transactions = subs.flatMap((sc: any) => tr(sc, "transactionNodes"));
        expect(transactions.map((t: any) => t.value()?.id)).toEqual(["tx2"]);
    });

    it("base references with where into chained traversal", () => {
        const mainCats = l("mainCategory", (c: any) => c.expenseTypeId === "et1");
        const subs     = tr(mainCats, "subcategoryNodes");
        const ids      = tr(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("base references with where that narrows results through chain", () => {
        const subs = l("subcategory", (s: any) => s.name === "sub1");
        const ids  = tr(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained references with multiple filters at different levels", () => {
        const txs      = l("transaction", (t: any) => t.subcategoryId === "sub1");
        const subs     = tr(txs, "subcategoryNodes");
        const mainCats = tr(subs, "mainCategoryNodes", (c: any) => c.expenseTypeId === "et1");
        const descriptions = tr(mainCats, "expenseTypeNodes").entities().map((e: any) => e.description);

        expect(descriptions).toEqual(["Groceries", "Groceries"]);
    });

    it("chained where on reverse references at multiple levels", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes", (c: any) => c.name === "Food");
        const subs     = tr(mainCats, "subcategoryNodes", (s: any) => s.name === "sub1");
        const ids      = tr(subs, "transactionNodes").entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained where on forward edges at multiple levels", () => {
        const txs     = l("transaction", (t: any) => t.subcategoryId === "sub1");
        const subs    = tr(txs, "subcategoryNodes", (s: any) => s.mainCategoryId === "cat1");
        const results = tr(subs, "mainCategoryNodes", (c: any) => c.expenseTypeId === "et1").entities();

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Food");
    });

    it("chained where filters out non-matching at each level", () => {
        const mainCats = l("mainCategory", (c: any) => c.expenseTypeId === "et1");
        const subs     = tr(mainCats, "subcategoryNodes", (s: any) => s.name === "sub2");
        const ids      = tr(subs, "transactionNodes", (t: any) => t.subcategoryId === "sub2")
            .entities().map((t: any) => t.id);

        expect(ids).toEqual(["tx2"]);
    });

    it("chained where that filters everything out", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes", (c: any) => c.name === "NonExistent");
        const ids      = tr(mainCats, "subcategoryNodes").entities();

        expect(ids).toHaveLength(0);
    });

    it("unique() removes duplicate entities from chained traversal", () => {
        const categories = tr(tr(n("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes").entities();

        expect(categories).toHaveLength(2);
        expect(categories[0].id).toBe("cat1");
        expect(categories[1].id).toBe("cat1");

        const unique = tr(tr(n("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes")
            .unique()
            .entities();

        expect(unique).toHaveLength(1);
        expect(unique[0].id).toBe("cat1");
    });

    it("unique() on base references with no duplicates", () => {
        const subs = l("subcategory").unique().entities();
        expect(subs).toHaveLength(2);
        expect(subs.map((s: any) => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("unique() returns empty for missing entities", () => {
        const result = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").unique();
        expect(result).toHaveLength(0);
    });

    it("unique() on deep chain with duplicates", () => {
        const subs = tr(tr(n("expenseType", "et1"), "mainCategoryNodes"), "subcategoryNodes");
        const transactions = tr(subs, "mainCategoryNodes").unique().entities();

        expect(transactions).toHaveLength(1);
        expect(transactions[0].id).toBe("cat1");
    });

    it("where() filters current list by predicate", () => {
        const subs = l("mainCategory").where((s: any) => s.name === "sub1");
        expect(subs).toHaveLength(0);

        const filtered = l("subcategory").where((s: any) => s.name === "sub1");
        expect(filtered).toHaveLength(1);
        expect(filtered[0].value()?.id).toBe("sub1");
    });

    it("where() returns walkable EntityNodeList", () => {
        const subs  = l("subcategory").where((s: any) => s.name === "sub1");
        const txIds = tr(subs, "transactionNodes").entities().map((t: any) => t.id);
        expect(txIds).toEqual(["tx1", "tx3"]);
    });

    it("where() returns empty list when nothing matches", () => {
        const result = l("subcategory").where((s: any) => s.name === "nonexistent");
        expect(result).toHaveLength(0);
    });

    it("where() chained after reverse reference traversal", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes");
        const cats = tr(mainCats, "subcategoryNodes")
            .where((s: any) => s.name === "sub2")
            .entities();
        expect(cats).toHaveLength(1);
        expect(cats[0].id).toBe("sub2");
    });

    it("where() can chain further into forward and reverse edges", () => {
        const mainCats = tr(n("expenseType", "et1"), "mainCategoryNodes");
        const subs     = tr(mainCats, "subcategoryNodes").where((s: any) => s.name === "sub2");
        const txIds    = tr(subs, "transactionNodes").entities().map((t: any) => t.id);
        expect(txIds).toEqual(["tx2"]);
    });

    it("select() maps resolved entities", () => {
        const names = l("subcategory").select((s: any) => s.name);
        expect(names).toEqual(["sub1", "sub2"]);
    });

    it("select() skips missing entities", () => {
        const ids = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").select((s: any) => s.id);
        expect(ids).toEqual([]);
    });

    it("select() works after chained traversal", () => {
        const ids = tr(tr(n("expenseType", "et1"), "mainCategoryNodes"), "subcategoryNodes").select((s: any) => s.id);
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns entity ids", () => {
        const ids = l("subcategory").ids();
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns empty array for missing entities", () => {
        const ids = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").ids();
        expect(ids).toEqual([]);
    });

    it("ids() works after chained traversal with duplicates", () => {
        const ids = tr(tr(n("mainCategory", "cat1"), "subcategoryNodes"), "mainCategoryNodes").ids();
        expect(ids).toEqual(["cat1", "cat1"]);
    });

    it("first() returns first resolved entity", () => {
        const sub = l("subcategory").first();
        expect(sub?.id).toBe("sub1");
    });

    it("first() returns undefined for empty list", () => {
        const result = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").first();
        expect(result).toBeUndefined();
    });

    it("first() returns first after where() filter", () => {
        const sub = l("subcategory").where((s: any) => s.name === "sub2").first();
        expect(sub?.id).toBe("sub2");
    });

    it("isEmpty() returns false when entities exist", () => {
        expect(l("subcategory").isEmpty()).toBe(false);
    });

    it("isEmpty() returns true for empty list", () => {
        expect(tr(n("mainCategory", "nonexistent"), "subcategoryNodes").isEmpty()).toBe(true);
    });

    it("isEmpty() returns true after where() matches nothing", () => {
        expect(l("subcategory").where((s: any) => s.name === "nonexistent").isEmpty()).toBe(true);
    });

    it("isNotEmpty() returns true when entities exist", () => {
        expect(l("subcategory").isNotEmpty()).toBe(true);
    });

    it("isNotEmpty() returns false for empty list", () => {
        expect(tr(n("mainCategory", "nonexistent"), "subcategoryNodes").isNotEmpty()).toBe(false);
    });

    it("isNotEmpty() returns false after where() matches nothing", () => {
        expect(l("subcategory").where((s: any) => s.name === "nonexistent").isNotEmpty()).toBe(false);
    });

    it("exists() returns true for a valid entity", () => {
        expect(n("transaction", "tx1").exists()).toBe(true);
    });

    it("exists() returns false for a missing entity", () => {
        expect(n("transaction", "nonexistent").exists()).toBe(false);
    });

    it("exists() returns false when traversal leads to null", () => {
        expect(tr(n("transaction", "nonexistent"), "subcategory").exists()).toBe(false);
    });

    it("exists() returns true for a valid chained entity", () => {
        expect(tr(n("transaction", "tx1"), "subcategory").exists()).toBe(true);
    });

    it("exists() true — value() returns the entity", () => {
        const node = n("transaction", "tx1");
        expect(node.exists()).toBe(true);
        expect(node.value()?.id).toBe("tx1");
    });

    it("exists() true — valueOrThrow() does not throw", () => {
        const node = n("transaction", "tx1");
        expect(node.exists()).toBe(true);
        expect(() => node.valueOrThrow()).not.toThrow();
        expect(node.valueOrThrow().id).toBe("tx1");
    });

    it("exists() false — value() returns undefined", () => {
        const node = n("transaction", "nonexistent");
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false — valueOrThrow() throws", () => {
        const node = n("transaction", "nonexistent");
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("exists() false on chained traversal — value() returns undefined", () => {
        const node = tr(n("transaction", "nonexistent"), "subcategory");
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false on chained traversal — valueOrThrow() throws", () => {
        const node = tr(n("transaction", "nonexistent"), "subcategory");
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("findEntity() returns matching entity", () => {
        const sub = l("subcategory").findEntity((s: any) => s.name === "sub2");
        expect(sub?.id).toBe("sub2");
    });

    it("findEntity() returns undefined when nothing matches", () => {
        const sub = l("subcategory").findEntity((s: any) => s.name === "nonexistent");
        expect(sub).toBeUndefined();
    });

    it("findEntity() returns undefined for empty list", () => {
        const sub = tr(n("mainCategory", "nonexistent"), "subcategoryNodes").findEntity(() => true);
        expect(sub).toBeUndefined();
    });

    it("findEntity() works after chained traversal", () => {
        const tx = tr(l("subcategory"), "transactionNodes").findEntity((t: any) => t.id === "tx2");
        expect(tx?.id).toBe("tx2");
    });

    });
}

runEntityGraphTests("entity graph [proxy]",     proxyGraph(entities));
runEntityGraphTests("entity graph [non-proxy]", nonProxyGraph(entities));

function runInfoHelperTests(label: string, { graph, n, tr, mkG }: G) {
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
            const clean = mkG({
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
            const path = n("transaction", "tx1").path();
            expect(path).toEqual(["transaction(tx1)"]);
        });

        it("returns multi-step path after traversal", () => {
            const path = tr(n("transaction", "tx1"), "subcategory").path();
            expect(path).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns path with null marker for missing entity", () => {
            const path = tr(n("transaction", "nonexistent"), "subcategory").path();
            expect(path).toEqual(["transaction(nonexistent)", "subcategory(null)"]);
        });
    });

    describe("node.info()", () => {
        it("returns correct info for an existing node", () => {
            const info = n("transaction", "tx1").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("tx1");
            expect(info.exists).toBe(true);
            expect(info.value?.id).toBe("tx1");
            expect(info.path).toEqual(["transaction(tx1)"]);
        });

        it("returns correct info for a missing node", () => {
            const info = n("transaction", "nonexistent").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("nonexistent");
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });

        it("returns correct info after chained traversal", () => {
            const info = tr(n("transaction", "tx1"), "subcategory").info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBe("sub1");
            expect(info.exists).toBe(true);
            expect(info.path).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns correct info for a null node from missing traversal", () => {
            const info = tr(n("transaction", "nonexistent"), "subcategory").info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });
    });

    describe("better error messages", () => {
        it("valueOrThrow on missing entity mentions entity type and id", () => {
            expect(() => n("transaction", "bad").valueOrThrow()).toThrow(/transaction.*bad/);
        });

        it("valueOrThrow on null node mentions null traversal", () => {
            expect(() => tr(n("transaction", "nonexistent"), "subcategory").valueOrThrow()).toThrow(/subcategory/);
        });

        it("accessing unknown relation mentions available relations", () => {
            expect(() => tr(n("transaction", "tx1"), "unknownRel")).toThrow(/unknownRel/);
        });
    });

    });
}

runInfoHelperTests("info helpers [proxy]",     proxyGraph(entities));
runInfoHelperTests("info helpers [non-proxy]", nonProxyGraph(entities));

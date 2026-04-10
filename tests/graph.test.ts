
import { describe, it, expect } from "vitest";
import { Entities, EntityGraph, createGraph, createNonProxyGraph} from "../src/index";
import { CustomGraph, edges, Schema } from "./types";


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

const graph: EntityGraph<CustomGraph> = createGraph({
    entities,
    edges,
});

describe("entity graph", () => {

    it("access first node object", () => {
        const subcategoryId = graph
            .transaction("tx1").value()
            ?.subcategoryId;

        expect(subcategoryId).toBe("sub1");
    });

    it("access invalid first node object with valueOrThrow()", () => {
        expect(() => {
            graph.transaction("error").valueOrThrow();
        }).toThrow();
    });

    it("access invalid first node object with value()", () => {
        const transaction = graph.transaction("error").value();
        expect(transaction).toBeUndefined();
    });

    it("access invalid related node object with valueOrThrow()", () => {
        expect(() =>
            graph.transaction("error").subcategory().valueOrThrow()
        ).toThrow();
    });

    it("access invalid related node object with value()", () => {
        const subcategory = graph.transaction("error").subcategory().value();
        expect(subcategory).toBeUndefined();
    });


    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .value()?.name;

        expect(name).toBe("sub1");
    });

    it("handles multiple entities correctly", () => {
        const name1 = graph
            .transaction("tx1")
            .subcategory()
            .value()?.name;
        const name2 = graph
            .transaction("tx2")
            .subcategory()
            .value()?.name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
    });

    it("handles multiple nodes from same entity correctly", () => {
        const expenseDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .expenseType()
            .value()?.description || "N/A";
        const incomeDesc = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .incomeType()
            .value()?.description || "N/A";
        expect(expenseDesc).toBe("Groceries");
        expect(incomeDesc).toBe("Salary");
    });

    it("handles relations with invalid FK returning undefined", () => {
        const expenseType = graph
            .mainCategory("cat2")
            .expenseType()
            .value();
        expect(expenseType).toBeUndefined();
    });

    it("handles relations with missing property returning undefined", () => {
        const incomeType = graph
            .mainCategory("cat3")
            .expenseType()
            .value();
        expect(incomeType).toBeUndefined();
    });

    it("handles relations with invalid FK throwing on valueOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat2")
                .incomeType()
                .valueOrThrow()
        ).toThrow();
    });

    it("handles relations with missing property throwing on valueOrThrow()", () => {
        expect(() =>
            graph
                .mainCategory("cat3")
                .incomeType()
                .valueOrThrow()
        ).toThrow();
    });

    it("returns defined for valid relation", () => {
        expect(
            graph
                .mainCategory("cat1")
                .expenseType()
                .value()
        ).toBeDefined();
    });

    it("returns undefined for faulty relation", () => {
        expect(
            graph
                .mainCategory("cat2")
                .expenseType()
                .value()
        ).toBeUndefined();
    });

    it("returns undefined for missing relation", () => {
        expect(
            graph
                .mainCategory("cat3")
                .expenseType()
                .value()
        ).toBeUndefined();
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.transaction("tx1").mainCategory().value()
        ).toThrow();
    });

    it("returns undefined for missing entity", () => {
        const tx = graph.transaction("invalid").value();
        expect(tx).toBeUndefined();
    });

    it("traverses reverse", () => {
        const catNode = graph.mainCategory("cat1");
        const subNodes = catNode.subcategoryNodes();

        expect(subNodes).toHaveLength(2);
        expect(subNodes[0].value()?.id).toBe("sub1");
        expect(subNodes[1].value()?.id).toBe("sub2");

        const sub1Transactions = subNodes[0].transactionNodes();
        expect(sub1Transactions).toHaveLength(2);
        expect(sub1Transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .map() on references to extract data", () => {
        const subNode = graph.subcategory("sub1");

        const titles = subNode.transactionNodes().filter(tn => {
            const mainCat = tn
                .subcategory()
                .mainCategory()
                .value();
            return mainCat?.name === "Food";
        }).map(tn => tn.value()?.id);

        expect(titles).toEqual(["tx1", "tx3"]);
    });

    it("supports .filter() on references to select specific nodes", () => {
        const transactions = graph.mainCategoryNodes((mc) => mc.expenseTypeId === "et1").subcategoryNodes().transactionNodes();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].value()?.id).toBe("tx1");
    });

    it("supports .flatMap() to traverse deeper relationships", () => {
        const exNode = graph.expenseType("et1");

        const allTransactionIds = exNode
            .mainCategoryNodes()
            .subcategoryNodes()
            .transactionNodes()
            .map(tn => tn.value()?.id);

        expect(allTransactionIds).toHaveLength(3);
        expect(allTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("chains filter and map correctly", () => {
        const exNode = graph.expenseType("et1");

        const filteredTransactionIds = exNode
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => {
                const mainCat = sc
                    .mainCategory()
                    .value();
                return mainCat?.expenseTypeId === "et1";
            })
            .flatMap(sc => sc.transactionNodes())
            .map(tn => tn.value()?.id);

        expect(filteredTransactionIds).toHaveLength(3);
        expect(filteredTransactionIds).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("returns an empty array for references with no matches", () => {
        const emptyGraph = createGraph({
            entities: {
                transaction: [],
                subcategory: [],
                mainCategory: [],
                expenseType: [],
                incomeType: [],
            } as Entities<Schema>,
            edges: edges,
        });

        const results = emptyGraph
            .expenseType("nonexistent")
            .mainCategoryNodes();

        expect(results).toEqual([]);
    });

    it("returns an empty array (safe fallback) when the parent node does not exist", () => {
        const missingMainCategory = graph.mainCategory("nonexistent");
        const result = missingMainCategory.subcategoryNodes();

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
    });

    it("returns frozen entities from value()", () => {
        const tx = graph.transaction("tx1").value();
        expect(Object.isFrozen(tx)).toBe(true);
    });

    it("returns all entities via base references", () => {
        const allTransactions = graph.transactionNodes();
        expect(allTransactions).toHaveLength(3);
        expect(allTransactions.map(t => t.value()?.id)).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("filters entities via base references with where clause", () => {
        const filtered = graph.transactionNodes(t => t.subcategoryId === "sub1");
        expect(filtered).toHaveLength(2);
        expect(filtered.map(t => t.value()?.id)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when where clause matches nothing", () => {
        const filtered = graph.transactionNodes(t => t.subcategoryId === "nonexistent");
        expect(filtered).toHaveLength(0);
    });

    it("base references return walkable nodes", () => {
        const subs = graph.subcategoryNodes();
        const names = subs.map(s => s.mainCategory().value()?.name);
        expect(names).toEqual(["Food", "Food"]);
    });

    it("base references with where and chaining", () => {
        const categories = graph.mainCategoryNodes(c => c.name === "Food");
        const expenseDescs = categories.map(c => c.expenseType().value()?.description);
        expect(expenseDescs).toContain("Groceries");
    });

    it("entities() on base references returns plain objects", () => {
        const transactions = graph.transactionNodes().entities();
        expect(transactions).toHaveLength(3);
        expect(transactions[0].id).toBe("tx1");
        expect(transactions[0].subcategoryId).toBe("sub1");
    });

    it("entities() with where clause filters and returns plain objects", () => {
        const transactions = graph.transactionNodes(t => t.subcategoryId === "sub1").entities();
        expect(transactions).toHaveLength(2);
        expect(transactions.map(t => t.id)).toEqual(["tx1", "tx3"]);
    });

    it("entities() on node-level reverse references returns plain objects", () => {
        const subs = graph.mainCategory("cat1").subcategoryNodes().entities();
        expect(subs).toHaveLength(2);
        expect(subs[0].name).toBe("sub1");
    });

    it("entities() filters out undefined entries", () => {
        const results = graph.mainCategory("nonexistent").subcategoryNodes().entities();
        expect(results).toEqual([]);
    });

    it("multi-level chained references with filter on intermediate list", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => sc.value()?.name === "sub1")
            .flatMap(sc => sc.transactionNodes())
            .map(tn => tn.value()?.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("multi-level chained references with filter and entities()", () => {
        const subs = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .filter(sc => sc.value()?.name === "sub2");

        expect(subs).toHaveLength(1);
        expect(subs[0].value()?.id).toBe("sub2");

        const transactions = subs.flatMap(sc => sc.transactionNodes());
        expect(transactions.map(t => t.value()?.id)).toEqual(["tx2"]);
    });

    it("base references with where into chained traversal", () => {
        const ids = graph
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .subcategoryNodes()
            .transactionNodes()
            .entities()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3", "tx2"]);
    });

    it("base references with where that narrows results through chain", () => {
        const ids = graph
            .subcategoryNodes(s => s.name === "sub1")
            .transactionNodes()
            .entities()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained references with multiple filters at different levels", () => {
        const descriptions = graph
            .transactionNodes(t => t.subcategoryId === "sub1")
            .subcategoryNodes()
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .expenseTypeNodes()
            .entities()
            .map(e => e.description);

        expect(descriptions).toEqual(["Groceries", "Groceries"]);
    });

    it("chained where on reverse references at multiple levels", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes(c => c.name === "Food")
            .subcategoryNodes(s => s.name === "sub1")
            .transactionNodes()
            .entities()
            .map(t => t.id);

        expect(ids).toEqual(["tx1", "tx3"]);
    });

    it("chained where on forward edges at multiple levels", () => {
        const results = graph
            .transactionNodes(t => t.subcategoryId === "sub1")
            .subcategoryNodes(s => s.mainCategoryId === "cat1")
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .entities();

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe("Food");
    });

    it("chained where filters out non-matching at each level", () => {
        const ids = graph
            .mainCategoryNodes(c => c.expenseTypeId === "et1")
            .subcategoryNodes(s => s.name === "sub2")
            .transactionNodes(t => t.subcategoryId === "sub2")
            .entities()
            .map(t => t.id);

        expect(ids).toEqual(["tx2"]);
    });

    it("chained where that filters everything out", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes(c => c.name === "NonExistent")
            .subcategoryNodes()
            .entities();

        expect(ids).toHaveLength(0);
    });

    it("unique() removes duplicate entities from chained traversal", () => {
        const categories = graph
            .mainCategory("cat1")
            .subcategoryNodes()
            .mainCategoryNodes()
            .entities();

        expect(categories).toHaveLength(2);
        expect(categories[0].id).toBe("cat1");
        expect(categories[1].id).toBe("cat1");

        const unique = graph
            .mainCategory("cat1")
            .subcategoryNodes()
            .mainCategoryNodes()
            .unique()
            .entities();

        expect(unique).toHaveLength(1);
        expect(unique[0].id).toBe("cat1");
    });

    it("unique() on base references with no duplicates", () => {
        const subs = graph.subcategoryNodes().unique().entities();
        expect(subs).toHaveLength(2);
        expect(subs.map(s => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("unique() returns empty for missing entities", () => {
        const result = graph
            .mainCategory("nonexistent")
            .subcategoryNodes()
            .unique();

        expect(result).toHaveLength(0);
    });

    it("unique() on deep chain with duplicates", () => {
        const transactions = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .mainCategoryNodes()
            .unique()
            .entities();

        expect(transactions).toHaveLength(1);
        expect(transactions[0].id).toBe("cat1");
    });

    it("where() filters current list by predicate", () => {
        const subs = graph
            .mainCategoryNodes()
            .where(s => s.name === "sub1");

        expect(subs).toHaveLength(0);

        const filtered = graph
            .subcategoryNodes()
            .where(s => s.name === "sub1");

        expect(filtered).toHaveLength(1);
        expect(filtered[0].value()?.id).toBe("sub1");
    });

    it("where() returns walkable EntityNodeList", () => {
        const txIds = graph
            .subcategoryNodes()
            .where(s => s.name === "sub1")
            .transactionNodes()
            .entities()
            .map(t => t.id);

        expect(txIds).toEqual(["tx1", "tx3"]);
    });

    it("where() returns empty list when nothing matches", () => {
        const result = graph
            .subcategoryNodes()
            .where(s => s.name === "nonexistent");

        expect(result).toHaveLength(0);
    });

    it("where() chained after reverse reference traversal", () => {
        const cats = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .where(s => s.name === "sub2")
            .entities();

        expect(cats).toHaveLength(1);
        expect(cats[0].id).toBe("sub2");
    });

    it("where() can chain further into forward and reverse edges", () => {
        const txIds = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .where(s => s.name === "sub2")
            .transactionNodes()
            .entities()
            .map(t => t.id);

        expect(txIds).toEqual(["tx2"]);
    });

    it("select() maps resolved entities", () => {
        const names = graph.subcategoryNodes().select(s => s.name);
        expect(names).toEqual(["sub1", "sub2"]);
    });

    it("select() skips missing entities", () => {
        const ids = graph
            .mainCategory("nonexistent")
            .subcategoryNodes()
            .select(s => s.id);
        expect(ids).toEqual([]);
    });

    it("select() works after chained traversal", () => {
        const ids = graph
            .expenseType("et1")
            .mainCategoryNodes()
            .subcategoryNodes()
            .select(s => s.id);
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns entity ids", () => {
        const ids = graph.subcategoryNodes().ids();
        expect(ids).toEqual(["sub1", "sub2"]);
    });

    it("ids() returns empty array for missing entities", () => {
        const ids = graph.mainCategory("nonexistent").subcategoryNodes().ids();
        expect(ids).toEqual([]);
    });

    it("ids() works after chained traversal with duplicates", () => {
        const ids = graph
            .mainCategory("cat1")
            .subcategoryNodes()
            .mainCategoryNodes()
            .ids();
        expect(ids).toEqual(["cat1", "cat1"]);
    });

    it("first() returns first resolved entity", () => {
        const sub = graph.subcategoryNodes().first();
        expect(sub?.id).toBe("sub1");
    });

    it("first() returns undefined for empty list", () => {
        const result = graph.mainCategory("nonexistent").subcategoryNodes().first();
        expect(result).toBeUndefined();
    });

    it("first() returns first after where() filter", () => {
        const sub = graph.subcategoryNodes().where(s => s.name === "sub2").first();
        expect(sub?.id).toBe("sub2");
    });

    it("isEmpty() returns false when entities exist", () => {
        expect(graph.subcategoryNodes().isEmpty()).toBe(false);
    });

    it("isEmpty() returns true for empty list", () => {
        expect(graph.mainCategory("nonexistent").subcategoryNodes().isEmpty()).toBe(true);
    });

    it("isEmpty() returns true after where() matches nothing", () => {
        expect(graph.subcategoryNodes().where(s => s.name === "nonexistent").isEmpty()).toBe(true);
    });

    it("isNotEmpty() returns true when entities exist", () => {
        expect(graph.subcategoryNodes().isNotEmpty()).toBe(true);
    });

    it("isNotEmpty() returns false for empty list", () => {
        expect(graph.mainCategory("nonexistent").subcategoryNodes().isNotEmpty()).toBe(false);
    });

    it("isNotEmpty() returns false after where() matches nothing", () => {
        expect(graph.subcategoryNodes().where(s => s.name === "nonexistent").isNotEmpty()).toBe(false);
    });

    it("exists() returns true for a valid entity", () => {
        expect(graph.transaction("tx1").exists()).toBe(true);
    });

    it("exists() returns false for a missing entity", () => {
        expect(graph.transaction("nonexistent").exists()).toBe(false);
    });

    it("exists() returns false when traversal leads to null", () => {
        expect(graph.transaction("nonexistent").subcategory().exists()).toBe(false);
    });

    it("exists() returns true for a valid chained entity", () => {
        expect(graph.transaction("tx1").subcategory().exists()).toBe(true);
    });

    it("exists() true — value() returns the entity", () => {
        const node = graph.transaction("tx1");
        expect(node.exists()).toBe(true);
        expect(node.value()?.id).toBe("tx1");
    });

    it("exists() true — valueOrThrow() does not throw", () => {
        const node = graph.transaction("tx1");
        expect(node.exists()).toBe(true);
        expect(() => node.valueOrThrow()).not.toThrow();
        expect(node.valueOrThrow().id).toBe("tx1");
    });

    it("exists() false — value() returns undefined", () => {
        const node = graph.transaction("nonexistent");
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false — valueOrThrow() throws", () => {
        const node = graph.transaction("nonexistent");
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("exists() false on chained traversal — value() returns undefined", () => {
        const node = graph.transaction("nonexistent").subcategory();
        expect(node.exists()).toBe(false);
        expect(node.value()).toBeUndefined();
    });

    it("exists() false on chained traversal — valueOrThrow() throws", () => {
        const node = graph.transaction("nonexistent").subcategory();
        expect(node.exists()).toBe(false);
        expect(() => node.valueOrThrow()).toThrow();
    });

    it("findEntity() returns matching entity", () => {
        const sub = graph.subcategoryNodes().findEntity(s => s.name === "sub2");
        expect(sub?.id).toBe("sub2");
    });

    it("findEntity() returns undefined when nothing matches", () => {
        const sub = graph.subcategoryNodes().findEntity(s => s.name === "nonexistent");
        expect(sub).toBeUndefined();
    });

    it("findEntity() returns undefined for empty list", () => {
        const sub = graph.mainCategory("nonexistent").subcategoryNodes().findEntity(() => true);
        expect(sub).toBeUndefined();
    });

    it("findEntity() works after chained traversal", () => {
        const tx = graph.subcategoryNodes().transactionNodes().findEntity(t => t.id === "tx2");
        expect(tx?.id).toBe("tx2");
    });

});

describe("info helpers", () => {

    describe("graph.schema()", () => {
        it("lists all entity types", () => {
            const schema = graph.schema();
            expect(schema.entities).toEqual(expect.arrayContaining([
                "transaction", "subcategory", "mainCategory", "expenseType", "incomeType",
            ]));
        });

        it("lists all edges with correct from/to", () => {
            const schema = graph.schema();
            const edgePairs = schema.edges.map(e => ({ from: e.from, to: e.to }));
            expect(edgePairs).toEqual(expect.arrayContaining([
                { from: "transaction", to: "subcategory" },
                { from: "subcategory", to: "mainCategory" },
                { from: "mainCategory", to: "expenseType" },
                { from: "mainCategory", to: "incomeType" },
            ]));
        });

        it("correctly marks bidirectional edges", () => {
            const schema = graph.schema();
            const txSub = schema.edges.find(e => e.from === "transaction" && e.to === "subcategory");
            expect(txSub?.bidirectional).toBe(true);
        });

        it("correctly marks non-bidirectional edges", () => {
            const schema = graph.schema();
            const catIncome = schema.edges.find(e => e.from === "mainCategory" && e.to === "incomeType");
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
            const missingIds = info.missingEntities.map(m => m.id);
            expect(missingIds).toContain("error");
        });

        it("missing entities have correct type", () => {
            const info = graph.info();
            const missingExpense = info.missingEntities.find(m => m.id === "error" && m.type === "expenseType");
            expect(missingExpense).toBeDefined();
        });

        it("returns empty missingEntities when all FKs resolve", () => {
            const clean = createGraph({
                entities: {
                    transaction: [{ id: "t1", subcategoryId: "s1" }],
                    subcategory: [{ id: "s1", name: "s1", mainCategoryId: "c1" }],
                    mainCategory: [{ id: "c1", name: "C", expenseTypeId: "e1", incomeTypeId: "i1" }],
                    expenseType: [{ id: "e1", description: "d" }],
                    incomeType: [{ id: "i1", description: "d" }],
                },
                edges,
            });
            expect(clean.info().missingEntities).toHaveLength(0);
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
            const path = graph.transaction("tx1").path();
            expect(path).toEqual(["transaction(tx1)"]);
        });

        it("returns multi-step path after traversal", () => {
            const path = graph.transaction("tx1").subcategory().path();
            expect(path).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns path with null marker for missing entity", () => {
            const path = graph.transaction("nonexistent").subcategory().path();
            expect(path).toEqual(["transaction(nonexistent)", "subcategory(null)"]);
        });
    });

    describe("node.info()", () => {
        it("returns correct info for an existing node", () => {
            const info = graph.transaction("tx1").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("tx1");
            expect(info.exists).toBe(true);
            expect(info.value?.id).toBe("tx1");
            expect(info.path).toEqual(["transaction(tx1)"]);
        });

        it("returns correct info for a missing node", () => {
            const info = graph.transaction("nonexistent").info();
            expect(info.type).toBe("transaction");
            expect(info.id).toBe("nonexistent");
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });

        it("returns correct info after chained traversal", () => {
            const info = graph.transaction("tx1").subcategory().info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBe("sub1");
            expect(info.exists).toBe(true);
            expect(info.path).toEqual(["transaction(tx1)", "subcategory(sub1)"]);
        });

        it("returns correct info for a null node from missing traversal", () => {
            const info = graph.transaction("nonexistent").subcategory().info();
            expect(info.type).toBe("subcategory");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.value).toBeUndefined();
        });
    });

    describe("better error messages", () => {
        it("valueOrThrow on missing entity mentions entity type and id", () => {
            expect(() => graph.transaction("bad").valueOrThrow()).toThrow(/transaction.*bad/);
        });

        it("valueOrThrow on null node mentions null traversal", () => {
            expect(() => graph.transaction("nonexistent").subcategory().valueOrThrow()).toThrow(/subcategory/);
        });

        it("accessing unknown relation mentions available relations", () => {
            expect(() => (graph.transaction("tx1") as any).unknownRel()).toThrow(/unknownRel/);
        });
    });

});

describe("useProxy: false — to() API", () => {
    const noProxyGraph = createNonProxyGraph({ entities, edges });

    it("to(type, id) returns an EntityNode", () => {
        const node = noProxyGraph.to("transaction", "tx1");
        expect(node.value()?.id).toBe("tx1");
    });

    it("to(type, id) exists() works", () => {
        expect(noProxyGraph.to("transaction", "tx1").exists()).toBe(true);
        expect(noProxyGraph.to("transaction", "nonexistent").exists()).toBe(false);
    });

    it("to(type, id) valueOrThrow() works", () => {
        expect(noProxyGraph.to("subcategory", "sub1").valueOrThrow().name).toBe("sub1");
    });

    it("to(type, id) valueOrThrow() throws for missing entity", () => {
        expect(() => noProxyGraph.to("transaction", "bad").valueOrThrow()).toThrow();
    });

    it("to(type, id) chained traversal works", () => {
        const name = noProxyGraph.to("transaction", "tx1").to("subcategory").value()?.name;
        expect(name).toBe("sub1");
    });

    it("to(type, id) deep chained traversal works", () => {
        const desc = noProxyGraph.to("transaction", "tx1")
            .to("subcategory")
            .to("mainCategory")
            .to("expenseType")
            .value()?.description;
        expect(desc).toBe("Groceries");
    });

    it("to() on node with reverse edge returns list", () => {
        const txIds = noProxyGraph.to("subcategory", "sub1").to("transactionNodes").ids();
        expect(txIds).toEqual(["tx1", "tx3"]);
    });

    it("relation methods are hidden on noProxy nodes (under NODE_PROP, not on node itself)", () => {
        const node = noProxyGraph.to("transaction", "tx1");
        expect((node as any).subcategory).toBeUndefined();
        expect(typeof node.to).toBe("function");
    });

    it("noProxy lists expose to() but not direct relation methods as user API", () => {
        const list = noProxyGraph.to("subcategoryNodes");
        expect(typeof list.to).toBe("function");
        // transactionNodes exists internally (used by toNodeList), but to() is the user API
        expect(() => list.to("transactionNodes")).not.toThrow();
    });

    it("to('typeNodes') returns an EntityNodeList", () => {
        const list = noProxyGraph.to("subcategoryNodes");
        expect(list.entities().map(s => s.id)).toEqual(["sub1", "sub2"]);
    });

    it("to('typeNodes', where) filters the list", () => {
        const list = noProxyGraph.to("subcategoryNodes", (s: any) => s.name === "sub1");
        expect(list.entities()).toHaveLength(1);
        expect(list.entities()[0].id).toBe("sub1");
    });

    it("to('typeNodes') ids() works", () => {
        expect(noProxyGraph.to("transactionNodes").ids()).toEqual(["tx1", "tx2", "tx3"]);
    });

    it("to('typeNodes') first() works", () => {
        expect(noProxyGraph.to("subcategoryNodes").first()?.id).toBe("sub1");
    });

    it("to('typeNodes') isEmpty() / isNotEmpty() work", () => {
        expect(noProxyGraph.to("subcategoryNodes").isEmpty()).toBe(false);
        expect(noProxyGraph.to("subcategoryNodes").isNotEmpty()).toBe(true);
    });

    it("to('typeNodes') where() works", () => {
        const subs = noProxyGraph.to("subcategoryNodes").where(s => s.name === "sub2");
        expect(subs.entities()[0].id).toBe("sub2");
    });

    it("to('typeNodes') unique() works", () => {
        const nodes = noProxyGraph.to("mainCategoryNodes")
            .to("subcategoryNodes")
            .to("mainCategoryNodes")
            .unique();
        expect(nodes.ids()).toEqual(["cat1"]);
    });

    it("to('typeNodes') chained traversal via reverse edge works", () => {
        const txs = noProxyGraph.to("subcategoryNodes")
            .where(s => s.id === "sub1")
            .to("transactionNodes")
            .ids();
        expect(txs).toEqual(["tx1", "tx3"]);
    });

    it("info() is available on noProxy graph", () => {
        const info = noProxyGraph.info();
        expect(info.entityCounts.transaction).toBe(3);
        expect(typeof info.cache.nodeCount).toBe("number");
    });

    it("schema() is available on noProxy graph", () => {
        const schema = noProxyGraph.schema();
        expect(schema.entities).toContain("transaction");
        expect(schema.edges.length).toBeGreaterThan(0);
    });
});

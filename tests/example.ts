import { Entities, EntityGraph, EntityGraphNoProxy, createGraph, createNonProxyGraph } from "../src/index";
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

const nonProxyGraph: EntityGraphNoProxy<CustomGraph> = createNonProxyGraph({
    entities,
    edges,
});

nonProxyGraph.to("mainCategory", "it1").to("incomeType").value();

const graph: EntityGraph<CustomGraph> = createGraph({
    entities,
    edges,
});

graph.mainCategory("it1").incomeType().value();

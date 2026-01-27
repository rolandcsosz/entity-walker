
import { describe, it, expect } from "vitest";
import { createEntityGraph, EntityGraph, ForeignKeyResolver, GraphDef, Relations } from "../src/graph";


type Transaction = { id: string; subcategoryId: string };
type Subcategory = { id: string; mainCategoryId: string };
type MainCategory = { id: string; name: string };

type Schema = {
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
};

const byId = {
    transaction: {
        tx1: { id: "tx1", subcategoryId: "sub1" },
    },
    subcategory: {
        sub1: { id: "sub1", mainCategoryId: "cat1" },
    },
    mainCategory: {
        cat1: { id: "cat1", name: "Food" },
    },
};

const relations = {
    transaction: { subcategory: "subcategory" },
    subcategory: { mainCategory: "mainCategory" },
    mainCategory: {},
} as const satisfies Relations<Schema>;

const foreignKeys: ForeignKeyResolver<Schema> = {
    transaction: (t) => ({
        key: "subcategory",
        id: t.subcategoryId,
    }),
    subcategory: (s) => ({
        key: "mainCategory",
        id: s.mainCategoryId,
    }),
    mainCategory: () => null,
}

type CustomGraph = GraphDef<Schema, typeof relations>;

const graph = createEntityGraph<Schema>().create({
    byId,
    relations,
    foreignKeys,
}) as EntityGraph<CustomGraph>;

describe("entity graph", () => {
    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .get().name;

        expect(name).toBe("Food");
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.transaction("tx1").mainCategory().get()
        ).toThrow();
    });

    it("throws on missing entity", () => {
        expect(() =>
            graph.transaction("invalid").get()
        ).toThrow();
    });
});

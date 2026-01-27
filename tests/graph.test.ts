
import { describe, it, expect } from "vitest";
import { createEntityGraph, EntityGraph, ForeignKeyResolver, GraphDef, Relations } from "../src/graph";


type Transaction = { id: string; subcategoryId: string };
type Subcategory = { id: string; name: string, mainCategoryId: string };
type MainCategory = { id: string; name: string };

type Schema = {
    transaction: Transaction;
    subcategory: Subcategory;
    mainCategory: MainCategory;
};

const entities = {
    transaction: [
        { id: "tx1", subcategoryId: "sub1" }, { id: "tx2", subcategoryId: "sub2" },
    ],
    subcategory: [
        { id: "sub1", name: "sub1", mainCategoryId: "cat1" }, { id: "sub2", name: "sub2", mainCategoryId: "cat1" },
    ],
    mainCategory: [
        { id: "cat1", name: "Food" },
    ],
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
    entities,
    relations,
    foreignKeys,
}) as EntityGraph<CustomGraph>;

describe("entity graph", () => {

    it("access first node object", () => {
        const subcategoryId = graph
            .transaction("tx1").get()
            .subcategoryId;

        expect(subcategoryId).toBe("sub1");
    });

    it("walks relations via named functions", () => {
        const name = graph
            .transaction("tx1")
            .subcategory()
            .mainCategory()
            .get().name;

        expect(name).toBe("Food");
    });

    it("handles multiple entities correctly", () => {
        const name1 = graph
            .transaction("tx1")
            .subcategory()
            .get().name;
        const name2 = graph
            .transaction("tx2")
            .subcategory()
            .get().name;
        expect(name1).toBe("sub1");
        expect(name2).toBe("sub2");
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

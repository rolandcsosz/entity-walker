import { describe, it, expect } from "vitest";
import { createEntityGraph } from "../src/graph";

type Transaction = {
    id: string;
    subcategoryId: string;
};

type Subcategory = {
    id: string;
    mainCategoryId: string;
};

type MainCategory = {
    id: string;
    name: string;
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

const graph = createEntityGraph({
    byId,
    relations: {
        transaction: { subcategory: "subcategory" },
        subcategory: { mainCategory: "mainCategory" },
        mainCategory: {},
    },
    foreignKeys: {
        transaction: (t) => ({
            key: "subcategory",
            id: t.subcategoryId,
        }),
        subcategory: (s) => ({
            key: "mainCategory",
            id: s.mainCategoryId,
        }),
        mainCategory: () => null,
    },
});

describe("entity graph", () => {
    it("walks relations via named functions", () => {
        const name = graph
            .entity("transaction", "tx1")
            .subcategory()
            .mainCategory()
            .get().name;

        expect(name).toBe("Food");
    });

    it("throws on invalid relation", () => {
        expect(() =>
            // @ts-expect-error
            graph.entity("transaction", "tx1").mainCategory()
        ).toThrow();
    });

    it("throws on missing entity", () => {
        expect(() =>
            graph.entity("transaction", "missing").get()
        ).toThrow();
    });
});

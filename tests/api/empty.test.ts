import { describe, it, expect } from "vitest";
import { CustomGraph, Transaction } from "../types";
import { emptyApiNode, emptyApiNodeList } from "../../src/api/helpers";

type Check<T> = {
    name: string;
    run: (instance: T) => void | Promise<void>;
};

function runChecks<T>(label: string, factory: () => T, checks: Check<T>[]) {
    describe(label, () => {
        for (const { name, run } of checks) {
            it(name, async () => {
                await run(factory());
            });
        }
    });
}

runChecks("emptyApiNodeList()", () => emptyApiNodeList<CustomGraph, Transaction>(), [
    { name: "is an empty array", run: (l) => expect(l).toHaveLength(0) },
    { name: ".entities() → []", run: (l) => expect(l.entities()).toEqual([]) },
    { name: ".ids() → []", run: (l) => expect(l.ids()).toEqual([]) },
    { name: ".isEmpty() → true", run: (l) => expect(l.isEmpty()).toBe(true) },
    { name: ".isNotEmpty() → false", run: (l) => expect(l.isNotEmpty()).toBe(false) },
    {
        name: ".load() resolves with itself",
        run: async (l) => {
            const r = await l.load();
            expect(r).toBe(l);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".load({ force: true }) resolves",
        run: async (l) => {
            const r = await l.load({ force: true });
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".load({ force: false }) resolves",
        run: async (l) => {
            const r = await l.load({ force: false });
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".*Nodes() → empty list via proxy",
        run: (l) => {
            const sub = (l as any).transactionNodes();
            expect(sub).toHaveLength(0);
            expect(sub.isEmpty()).toBe(true);
        },
    },
    {
        name: "chained *Nodes list supports .load()",
        run: async (l) => {
            await expect((l as any).aNodes().load()).resolves.toBeDefined();
        },
    },
    { name: "deep *Nodes() chaining", run: (l) => expect((l as any).aNodes().bNodes().cNodes().isEmpty()).toBe(true) },
]);

runChecks("emptyApiNode()", () => emptyApiNode<CustomGraph, Transaction>(), [
    { name: ".value() → undefined", run: (n) => expect(n.value()).toBeUndefined() },
    { name: ".exists() → false", run: (n) => expect(n.exists()).toBe(false) },
    { name: ".api → {}", run: (n) => expect(n.api).toEqual({}) },
    {
        name: ".load() resolves with itself",
        run: async (n) => {
            const r = await n.load();
            expect(r).toBe(n);
            expect(r.exists()).toBe(false);
        },
    },
    {
        name: ".load() result also supports .load()",
        run: async (n) => {
            const r = await (await n.load()).load();
            expect(r.exists()).toBe(false);
        },
    },
    {
        name: ".delete() resolves to undefined",
        run: async (n) => {
            await expect(n.delete()).resolves.toBeUndefined();
        },
    },
    {
        name: ".update(fn) accepts fn, resolves",
        run: async (n) => {
            await expect(n.update(() => ({ id: "1", subcategoryId: "s1" }))).resolves.toBeUndefined();
        },
    },
    {
        name: "forward rel → empty node",
        run: (n) => {
            const r = (n as any).subcategory();
            expect(r.exists()).toBe(false);
            expect(r.value()).toBeUndefined();
            expect(r.api).toEqual({});
        },
    },
    {
        name: "forward rel result supports .load()",
        run: async (n) => {
            await expect((n as any).subcategory().load()).resolves.toBeDefined();
        },
    },
    {
        name: "forward rel result supports .delete()",
        run: async (n) => {
            await expect((n as any).subcategory().delete()).resolves.toBeUndefined();
        },
    },
    {
        name: "forward rel result supports .update(fn)",
        run: async (n) => {
            await expect(
                (n as any).subcategory().update(() => ({ id: "1", subcategoryId: "s1" })),
            ).resolves.toBeUndefined();
        },
    },
    {
        name: "*Nodes rel → empty api node list",
        run: (n) => {
            const l = (n as any).transactionNodes();
            expect(l).toHaveLength(0);
            expect(l.isEmpty()).toBe(true);
        },
    },
    {
        name: "*Nodes list supports .load()",
        run: async (n) => {
            await expect((n as any).transactionNodes().load()).resolves.toBeDefined();
        },
    },
    {
        name: "*Nodes list supports .entities()",
        run: (n) => {
            expect((n as any).transactionNodes().entities()).toEqual([]);
        },
    },
    {
        name: "*Nodes list supports .ids()",
        run: (n) => {
            expect((n as any).transactionNodes().ids()).toEqual([]);
        },
    },
    { name: "deep forward rel chaining", run: (n) => expect((n as any).a().b().c().exists()).toBe(false) },
    {
        name: "mixed node → *Nodes → isEmpty",
        run: (n) => expect((n as any).subcategory().transactionNodes().isEmpty()).toBe(true),
    },
    {
        name: "mixed node → *Nodes → load()",
        run: async (n) => {
            await expect((n as any).subcategory().transactionNodes().load()).resolves.toBeDefined();
        },
    },
]);

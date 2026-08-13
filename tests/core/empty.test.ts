import { describe, it, expect } from "vitest";
import { CustomGraph, Transaction } from "../types";
import { emptyNode, emptyNodeList, emptyNodeNoProxy, emptyNodeListNoProxy } from "../../src/core/helpers";

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

runChecks("emptyNodeList()", () => emptyNodeList<CustomGraph, Transaction>(), [
    { name: "is an empty array", run: (l) => expect(l).toHaveLength(0) },
    { name: ".entities() → []", run: (l) => expect(l.entities()).toEqual([]) },
    { name: ".select(fn) → []", run: (l) => expect(l.select((t) => t.id)).toEqual([]) },
    { name: ".ids() → []", run: (l) => expect(l.ids()).toEqual([]) },
    { name: ".first() → undefined", run: (l) => expect(l.first()).toBeUndefined() },
    { name: ".findEntity(fn) → undefined", run: (l) => expect(l.findEntity((t) => t.id === "x")).toBeUndefined() },
    { name: ".findNode(fn) → undefined", run: (l) => expect(l.findNode((t) => t.id === "x")).toBeUndefined() },
    { name: ".isEmpty() → true", run: (l) => expect(l.isEmpty()).toBe(true) },
    { name: ".isNotEmpty() → false", run: (l) => expect(l.isNotEmpty()).toBe(false) },
    {
        name: ".unique() → empty list",
        run: (l) => {
            const r = l.unique();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".where(fn) → empty list",
        run: (l) => {
            const r = l.where((t) => t.id === "x");
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".whereNode(fn) → empty list",
        run: (l) => {
            const r = l.whereNode((n) => n.exists());
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".intersect([]) → empty list",
        run: (l) => {
            const r = l.intersect([]);
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".with(fn) → fn result",
        run: (l) => {
            expect(l.with((s) => s.isEmpty())).toBe(true);
            expect(l.with((s) => s.ids())).toEqual([]);
        },
    },
    {
        name: ".scoped() → empty list",
        run: (l) => {
            const r = l.scoped();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".resetScope() → empty list",
        run: (l) => {
            const r = l.resetScope();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".info() → ListDebugInfo shape",
        run: (l) => {
            const info = l.info();
            expect(typeof info.type).toBe("string");
            expect(typeof info.length).toBe("number");
            expect(info.scope).toBeNull();
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
        name: "deep *Nodes() chaining",
        run: (l) => {
            expect((l as any).aNodes().bNodes().cNodes().isEmpty()).toBe(true);
        },
    },
]);

runChecks("emptyNode()", () => emptyNode<CustomGraph, Transaction>(), [
    { name: ".value() → undefined", run: (n) => expect(n.value()).toBeUndefined() },
    { name: ".valueOrThrow() → throws", run: (n) => expect(() => n.valueOrThrow()).toThrow("Empty node has no value") },
    { name: ".exists() → false", run: (n) => expect(n.exists()).toBe(false) },
    { name: ".path() → ['(empty)']", run: (n) => expect(n.path()).toEqual(["(empty)"]) },
    {
        name: ".info() → NodeDebugInfo shape",
        run: (n) => {
            const info = n.info();
            expect(info.type).toBe("unknown");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.path).toEqual([]);
            expect(info.value).toBeUndefined();
        },
    },
    { name: ".delete() → no throw", run: (n) => expect(() => n.delete()).not.toThrow() },
    {
        name: ".update(fn) → no throw",
        run: (n) => expect(() => n.update(() => ({ id: "1", subcategoryId: "s1" }))).not.toThrow(),
    },
    { name: ".deleteCascade() → no throw", run: (n) => expect(() => (n as any).deleteCascade()).not.toThrow() },
    {
        name: "forward rel → empty node",
        run: (n) => {
            const rel = (n as any).subcategory();
            expect(rel.exists()).toBe(false);
            expect(rel.value()).toBeUndefined();
        },
    },
    {
        name: "*Nodes rel → empty list",
        run: (n) => {
            const list = (n as any).transactionNodes();
            expect(list).toHaveLength(0);
            expect(list.isEmpty()).toBe(true);
        },
    },
    { name: "deep forward rel chaining", run: (n) => expect((n as any).a().b().c().exists()).toBe(false) },
    {
        name: "mixed node → list chaining",
        run: (n) => {
            expect(
                (n as any)
                    .subcategory()
                    .transactionNodes()
                    .with((s: any) => s.isEmpty()),
            ).toBe(true);
        },
    },
]);

runChecks("emptyNodeListNoProxy()", () => emptyNodeListNoProxy<CustomGraph, Transaction>(), [
    { name: "is an empty array", run: (l) => expect(l).toHaveLength(0) },
    { name: ".entities() → []", run: (l) => expect(l.entities()).toEqual([]) },
    { name: ".select(fn) → []", run: (l) => expect(l.select((t) => t.id)).toEqual([]) },
    { name: ".ids() → []", run: (l) => expect(l.ids()).toEqual([]) },
    { name: ".first() → undefined", run: (l) => expect(l.first()).toBeUndefined() },
    { name: ".findEntity(fn) → undefined", run: (l) => expect(l.findEntity((t) => t.id === "x")).toBeUndefined() },
    { name: ".findNode(fn) → undefined", run: (l) => expect(l.findNode((t) => t.id === "x")).toBeUndefined() },
    { name: ".isEmpty() → true", run: (l) => expect(l.isEmpty()).toBe(true) },
    { name: ".isNotEmpty() → false", run: (l) => expect(l.isNotEmpty()).toBe(false) },
    {
        name: ".unique() → empty list",
        run: (l) => {
            const r = l.unique();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".where(fn) → empty list",
        run: (l) => {
            const r = l.where((t) => t.id === "x");
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".whereNode(fn) → empty list",
        run: (l) => {
            const r = l.whereNode((n) => n.exists());
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".intersect([]) → empty list",
        run: (l) => {
            const r = l.intersect([]);
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    { name: ".with(fn) → fn result", run: (l) => expect(l.with((s) => s.isEmpty())).toBe(true) },
    {
        name: ".scoped() → empty list",
        run: (l) => {
            const r = l.scoped();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".resetScope() → empty list",
        run: (l) => {
            const r = l.resetScope();
            expect(r).toHaveLength(0);
            expect(r.isEmpty()).toBe(true);
        },
    },
    {
        name: ".info() → ListDebugInfo shape",
        run: (l) => {
            const info = l.info();
            expect(typeof info.type).toBe("string");
            expect(typeof info.length).toBe("number");
            expect(info.scope).toBeNull();
        },
    },
    {
        name: ".to('xNodes') → empty list",
        run: (l) => {
            const sub = (l as any).to("transactionNodes");
            expect(sub).toHaveLength(0);
            expect(sub.isEmpty()).toBe(true);
        },
    },
    {
        name: ".to('rel') → empty node",
        run: (l) => {
            const node = (l as any).to("subcategory");
            expect(node.exists()).toBe(false);
        },
    },
]);

runChecks("emptyNodeNoProxy()", () => emptyNodeNoProxy<CustomGraph, Transaction>(), [
    { name: ".value() → undefined", run: (n) => expect(n.value()).toBeUndefined() },
    { name: ".valueOrThrow() → throws", run: (n) => expect(() => n.valueOrThrow()).toThrow("Empty node has no value") },
    { name: ".exists() → false", run: (n) => expect(n.exists()).toBe(false) },
    { name: ".path() → ['(empty)']", run: (n) => expect(n.path()).toEqual(["(empty)"]) },
    {
        name: ".info() → NodeDebugInfo shape",
        run: (n) => {
            const info = n.info();
            expect(info.type).toBe("unknown");
            expect(info.id).toBeNull();
            expect(info.exists).toBe(false);
            expect(info.path).toEqual([]);
            expect(info.value).toBeUndefined();
        },
    },
    { name: ".delete() → no throw", run: (n) => expect(() => n.delete()).not.toThrow() },
    {
        name: ".update(fn) → no throw",
        run: (n) => expect(() => n.update(() => ({ id: "1", subcategoryId: "s1" }))).not.toThrow(),
    },
    { name: ".deleteCascade() → no throw", run: (n) => expect(() => (n as any).deleteCascade()).not.toThrow() },
    {
        name: ".to('xNodes') → empty list",
        run: (n) => {
            const list = (n as any).to("transactionNodes");
            expect(list).toHaveLength(0);
            expect(list.isEmpty()).toBe(true);
        },
    },
    {
        name: ".to('rel') → empty node",
        run: (n) => {
            const rel = (n as any).to("subcategory");
            expect(rel.exists()).toBe(false);
            expect(rel.value()).toBeUndefined();
        },
    },
    {
        name: "deep .to() chaining",
        run: (n) => {
            expect((n as any).to("a").to("b").to("c").exists()).toBe(false);
        },
    },
]);

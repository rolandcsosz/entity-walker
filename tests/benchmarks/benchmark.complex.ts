import fs from "fs";
import { performance } from "perf_hooks";
import { createGraph as createProxyGraph } from "../../src/core/graph";
import { createNonProxyGraph } from "../../src/core/graphNoProxy";
import { Entities } from "../../src/core/types";
import { CustomGraph, edges, ExpenseType, IncomeType, MainCategory, Schema, Subcategory, Transaction } from "../types";

function generateDataset({
    expenseTypes,
    mainCategoriesPerExpense,
    subcategoriesPerMain,
    transactionsPerSub,
}: {
    expenseTypes: number;
    mainCategoriesPerExpense: number;
    subcategoriesPerMain: number;
    transactionsPerSub: number;
}): Entities<Schema> {
    const expenseType: ExpenseType[] = [];
    const incomeType: IncomeType[] = [];
    const mainCategory: MainCategory[] = [];
    const subcategory: Subcategory[] = [];
    const transaction: Transaction[] = [];

    for (let e = 0; e < expenseTypes; e++) {
        const etId = `et-${e}`;
        const itId = `it-${e}`;
        expenseType.push({ id: etId, description: `Expense Type ${e}` });
        incomeType.push({ id: itId, description: `Income Type ${e}` });

        for (let m = 0; m < mainCategoriesPerExpense; m++) {
            const mcId = `mc-${e}-${m}`;
            mainCategory.push({ id: mcId, name: `Main ${e}-${m}`, expenseTypeId: etId, incomeTypeId: itId });

            for (let s = 0; s < subcategoriesPerMain; s++) {
                const scId = `sc-${e}-${m}-${s}`;
                subcategory.push({ id: scId, name: `Sub ${e}-${m}-${s}`, mainCategoryId: mcId });

                for (let t = 0; t < transactionsPerSub; t++) {
                    transaction.push({ id: `tx-${e}-${m}-${s}-${t}`, subcategoryId: scId });
                }
            }
        }
    }

    return { expenseType, incomeType, mainCategory, subcategory, transaction };
}

function randIdx(len: number) {
    return Math.floor(Math.random() * len);
}

/** Case 1 — deep forward chain: expenseType → mainCategory → subcategory → transaction */
function loop_deepForward(entities: Entities<Schema>, expenseTypeId: string): string[] {
    const mcById: Record<string, MainCategory> = {};
    const scById: Record<string, Subcategory> = {};
    for (const mc of entities.mainCategory) mcById[mc.id] = mc;
    for (const sc of entities.subcategory) scById[sc.id] = sc;

    const result: string[] = [];
    for (const mc of entities.mainCategory) {
        if (mc.expenseTypeId !== expenseTypeId) continue;
        for (const sc of entities.subcategory) {
            if (sc.mainCategoryId !== mc.id) continue;
            for (const tx of entities.transaction) {
                if (tx.subcategoryId !== sc.id) continue;
                result.push(tx.id);
            }
        }
    }
    return result;
}

/** Case 2 — reverse lookup: transaction → subcategory → mainCategory, collect mainCategory names */
function loop_reverseChain(entities: Entities<Schema>, transactionId: string): string[] {
    const tx = entities.transaction.find((t) => t.id === transactionId);
    if (!tx) return [];
    const sc = entities.subcategory.find((s) => s.id === tx.subcategoryId);
    if (!sc) return [];
    const mc = entities.mainCategory.find((m) => m.id === sc.mainCategoryId);
    return mc ? [mc.name] : [];
}

/** Case 3 — bidirectional: expenseType → mainCategory → subcategory (filtered) → transactions */
function loop_filteredReverse(entities: Entities<Schema>, expenseTypeId: string, subNamePrefix: string): string[] {
    const result: string[] = [];
    for (const mc of entities.mainCategory) {
        if (mc.expenseTypeId !== expenseTypeId) continue;
        for (const sc of entities.subcategory) {
            if (sc.mainCategoryId !== mc.id) continue;
            if (!sc.name.startsWith(subNamePrefix)) continue;
            for (const tx of entities.transaction) {
                if (tx.subcategoryId !== sc.id) continue;
                result.push(tx.id);
            }
        }
    }
    return result;
}

/** Case 4 — root list with where: all subcategories matching a name prefix → their transactions */
function loop_rootListWithWhere(entities: Entities<Schema>, subNamePrefix: string): string[] {
    const result: string[] = [];
    for (const sc of entities.subcategory) {
        if (!sc.name.startsWith(subNamePrefix)) continue;
        for (const tx of entities.transaction) {
            if (tx.subcategoryId !== sc.id) continue;
            result.push(tx.id);
        }
    }
    return result;
}

/** Case 5 — unique mainCategories reachable from all transactions of an expenseType */
function loop_uniqueMainCategories(entities: Entities<Schema>, expenseTypeId: string): string[] {
    const seen = new Set<string>();
    for (const mc of entities.mainCategory) {
        if (mc.expenseTypeId !== expenseTypeId) continue;
        for (const sc of entities.subcategory) {
            if (sc.mainCategoryId !== mc.id) continue;
            for (const tx of entities.transaction) {
                if (tx.subcategoryId !== sc.id) continue;
                seen.add(mc.id);
            }
        }
    }
    return [...seen];
}

/** Case 6 — graph rebuild per query (worst-case cost baseline) */
function loop_deepForwardWithRebuildCost(entities: Entities<Schema>, expenseTypeId: string): string[] {
    const scByMain: Record<string, Subcategory[]> = {};
    const txBySub: Record<string, Transaction[]> = {};
    for (const sc of entities.subcategory) {
        (scByMain[sc.mainCategoryId] ??= []).push(sc);
    }
    for (const tx of entities.transaction) {
        (txBySub[tx.subcategoryId] ??= []).push(tx);
    }

    const result: string[] = [];
    for (const mc of entities.mainCategory) {
        if (mc.expenseTypeId !== expenseTypeId) continue;
        for (const sc of scByMain[mc.id] ?? []) {
            for (const tx of txBySub[sc.id] ?? []) {
                result.push(tx.id);
            }
        }
    }
    return result;
}

type AnyGraph = ReturnType<typeof createProxyGraph<any>> | ReturnType<typeof createNonProxyGraph<any>>;

function isProxy(graph: AnyGraph): graph is ReturnType<typeof createProxyGraph<any>> {
    return typeof (graph as any).expenseType === "function";
}

function graph_deepForward(graph: AnyGraph, expenseTypeId: string): (string | undefined)[] {
    if (isProxy(graph)) {
        const g = graph as any;
        return g.expenseType(expenseTypeId).mainCategoryNodes().subcategoryNodes().transactionNodes().ids();
    } else {
        const g = graph as any;
        return g
            .to("expenseType", expenseTypeId)
            .to("mainCategoryNodes")
            .to("subcategoryNodes")
            .to("transactionNodes")
            .ids();
    }
}

function graph_reverseChain(graph: AnyGraph, transactionId: string): (string | undefined)[] {
    if (isProxy(graph)) {
        const g = graph as any;
        const name = g.transaction(transactionId).subcategory().mainCategory().value()?.name;
        return name ? [name] : [];
    } else {
        const g = graph as any;
        const name = g.to("transaction", transactionId).to("subcategory").to("mainCategory").value()?.name;
        return name ? [name] : [];
    }
}

function graph_filteredReverse(graph: AnyGraph, expenseTypeId: string, subNamePrefix: string): (string | undefined)[] {
    if (isProxy(graph)) {
        const g = graph as any;
        return g
            .expenseType(expenseTypeId)
            .mainCategoryNodes()
            .subcategoryNodes((sc: any) => sc.name.startsWith(subNamePrefix))
            .transactionNodes()
            .ids();
    } else {
        const g = graph as any;
        return g
            .to("expenseType", expenseTypeId)
            .to("mainCategoryNodes")
            .to("subcategoryNodes", (sc: any) => sc.name.startsWith(subNamePrefix))
            .to("transactionNodes")
            .ids();
    }
}

function graph_uniqueMainCategories(graph: AnyGraph, expenseTypeId: string): string[] {
    if (isProxy(graph)) {
        const g = graph as any;
        return g.expenseType(expenseTypeId).mainCategoryNodes().unique().ids();
    } else {
        const g = graph as any;
        return g.to("expenseType", expenseTypeId).to("mainCategoryNodes").unique().ids();
    }
}

function graph_rootListWithWhere(graph: AnyGraph, subNamePrefix: string): string[] {
    if (isProxy(graph)) {
        const g = graph as any;
        return g
            .subcategoryNodes((sc: any) => sc.name.startsWith(subNamePrefix))
            .transactionNodes()
            .ids();
    } else {
        const g = graph as any;
        return g
            .to("subcategoryNodes", (sc: any) => sc.name.startsWith(subNamePrefix))
            .to("transactionNodes")
            .ids();
    }
}

type ScenarioResult = {
    size: number;
    loop: number;
    proxy: number;
    nonProxy: number;
};

type ScenarioSummary = {
    name: string;
    results: ScenarioResult[];
};

const DATASET_SIZES = [
    { sub: 2, tx: 2 },
    { sub: 10, tx: 10 },
    { sub: 30, tx: 30 },
    { sub: 70, tx: 70 },
];

const N = 12;

async function runBenchmark() {
    const scenarios: ScenarioSummary[] = [];

    const scenarioDefs: Array<{
        name: string;
        loop: (entities: Entities<Schema>, et: string, sc: string) => any;
        graph: (graph: AnyGraph, et: string, sc: string) => any;
    }> = [
        {
            name: "Deep forward chain (expenseType → mainCategory → subcategory → transaction)",
            loop: (e, et) => loop_deepForward(e, et),
            graph: (g, et) => graph_deepForward(g, et),
        },
        {
            name: "Reverse chain (transaction → subcategory → mainCategory, collect name)",
            loop: (e, _et, sc) => loop_reverseChain(e, sc),
            graph: (g, _et, sc) => graph_reverseChain(g, sc),
        },
        {
            name: "Filtered reverse (expenseType → mainCategory → subcategory[filtered] → transactions)",
            loop: (e, et) => loop_filteredReverse(e, et, "Sub 0"),
            graph: (g, et) => graph_filteredReverse(g, et, "Sub 0"),
        },
        {
            name: "Unique mainCategories reachable from expenseType",
            loop: (e, et) => loop_uniqueMainCategories(e, et),
            graph: (g, et) => graph_uniqueMainCategories(g, et),
        },
        {
            name: "Root list with where + traversal (subcategoryNodes(filter) → transactions)",
            loop: (e) => loop_rootListWithWhere(e, "Sub 0"),
            graph: (g) => graph_rootListWithWhere(g, "Sub 0"),
        },
    ];

    for (const scenario of scenarioDefs) {
        console.log(`\n=== ${scenario.name} ===`);
        const results: ScenarioResult[] = [];

        for (const ds of DATASET_SIZES) {
            const entities = generateDataset({
                expenseTypes: 10,
                mainCategoriesPerExpense: 10,
                subcategoriesPerMain: ds.sub,
                transactionsPerSub: ds.tx,
            });

            // pick random query ids for each iteration
            const queryEtIds = Array.from(
                { length: N },
                () => entities.expenseType[randIdx(entities.expenseType.length)].id,
            );
            const queryTxIds = Array.from(
                { length: N },
                () => entities.transaction[randIdx(entities.transaction.length)].id,
            );

            // ── nested loop ──
            let loopMs = 0;
            for (let i = 0; i < N; i++) {
                const t0 = performance.now();
                scenario.loop(entities, queryEtIds[i], queryTxIds[i]);
                loopMs += performance.now() - t0;
            }

            // ── proxy graph, pre-built ──
            const proxyGraph = createProxyGraph({ entities, edges });
            let proxyMs = 0;
            for (let i = 0; i < N; i++) {
                const t0 = performance.now();
                scenario.graph(proxyGraph as any, queryEtIds[i], queryTxIds[i]);
                proxyMs += performance.now() - t0;
            }

            // ── non-proxy graph, pre-built ──
            const npGraph = createNonProxyGraph({ entities, edges });
            let npMs = 0;
            for (let i = 0; i < N; i++) {
                const t0 = performance.now();
                scenario.graph(npGraph as any, queryEtIds[i], queryTxIds[i]);
                npMs += performance.now() - t0;
            }

            const row: ScenarioResult = {
                size: entities.transaction.length,
                loop: loopMs / N,
                proxy: proxyMs / N,
                nonProxy: npMs / N,
            };
            results.push(row);
            console.log(
                `  tx=${row.size.toLocaleString()}  loop=${row.loop.toFixed(3)}ms  proxy=${row.proxy.toFixed(3)}ms  np=${row.nonProxy.toFixed(3)}ms`,
            );
        }

        scenarios.push({ name: scenario.name, results });
    }

    generatePlot(scenarios);
}

// ─── HTML plot generation ──────────────────────────────────────────────────────

const COLORS = {
    loop: { line: "#f1634c", dash: "solid" },
    proxy: { line: "#37b98b", dash: "solid" },
    nonProxy: { line: "#6b8cff", dash: "solid" },
};

function makeTraces(results: ScenarioResult[]) {
    const xs = results.map((r) => r.size);
    return [
        {
            x: xs,
            y: results.map((r) => r.loop),
            name: "Nested Loop",
            line: { color: COLORS.loop.line, dash: COLORS.loop.dash, width: 3 },
            mode: "lines+markers",
            type: "scatter",
        },
        {
            x: xs,
            y: results.map((r) => r.proxy),
            name: "Proxy Graph",
            line: { color: COLORS.proxy.line, dash: COLORS.proxy.dash, width: 3 },
            mode: "lines+markers",
            type: "scatter",
        },
        {
            x: xs,
            y: results.map((r) => r.nonProxy),
            name: "Non-Proxy Graph",
            line: { color: COLORS.nonProxy.line, dash: COLORS.nonProxy.dash, width: 3 },
            mode: "lines+markers",
            type: "scatter",
        },
    ];
}

function generatePlot(scenarios: ScenarioSummary[]) {
    const numScenarios = scenarios.length;
    const cols = 2;
    const rows = Math.ceil(numScenarios / cols);

    const specs = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
            const idx = r * cols + c;
            return idx < numScenarios ? { type: "scatter" } : {};
        }),
    );

    const annotations: any[] = scenarios.map((s, i) => ({
        text: s.name,
        font: { size: 12, color: "#333" },
        showarrow: false,
        xref: `x${i + 1} domain`,
        yref: `y${i + 1} domain`,
        x: 0.5,
        y: 1.07,
        xanchor: "center",
    }));

    const baseLayout: any = {
        grid: { rows, columns: cols, pattern: "independent", roworder: "top to bottom" },
        font: { size: 13 },
        annotations,
        legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.08 },
        margin: { l: 70, r: 30, t: 80, b: 100 },
        height: 440 * rows,
    };

    const allTraces: any[] = [];
    const addedToLegend = new Set<string>();

    scenarios.forEach((scenario, si) => {
        const axSuffix = si === 0 ? "" : String(si + 1);
        const traces = makeTraces(scenario.results);
        traces.forEach((tr) => {
            const showLegend = !addedToLegend.has(tr.name);
            if (showLegend) addedToLegend.add(tr.name);
            allTraces.push({
                ...tr,
                xaxis: `x${axSuffix}`,
                yaxis: `y${axSuffix}`,
                showlegend: showLegend,
                legendgroup: tr.name,
            });
        });

        baseLayout[`xaxis${axSuffix}`] = { title: "Transactions" };
        baseLayout[`yaxis${axSuffix}`] = { title: "Avg ms", tickformat: ".3f" };
    });

    const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Entity Walker Benchmark</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>body { font-family: sans-serif; padding: 16px; background: #fafafa; }</style>
  </head>
  <body>
    <h2>Entity Walker — Performance Benchmark</h2>
    <p>Nested Loop vs Proxy Graph vs Non-Proxy Graph &mdash; pre-built and per-query rebuild compared across ${numScenarios} use-case scenarios.</p>
    <div id="plot" style="width:100%;"></div>
    <script>
      Plotly.newPlot('plot', ${JSON.stringify(allTraces)}, ${JSON.stringify(baseLayout)});
    </script>
  </body>
</html>`;

    fs.writeFileSync("benchmark.complex.html", html, "utf-8");
    console.log("\nPlot saved as benchmark.complex.html");
}

runBenchmark();

import fs from "fs";
import { performance } from "perf_hooks";
import { createGraph } from "../src/graph";
import { Entities, EntityGraph } from "../src/types";
import { CustomGraph, edges, ExpenseType, IncomeType, MainCategory, Schema, Subcategory, Transaction } from "./types";


function generateLargeDataset({
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
    const mainCategory: MainCategory[] = [];
    const subcategory: Subcategory[] = [];
    const transaction: Transaction[] = [];
    const incomeType: IncomeType[] = [];

    for (let e = 0; e < expenseTypes; e++) {
        const etId = `et-${e}`;
        expenseType.push({ id: etId, description: `Expense Type ${e}` });

        for (let m = 0; m < mainCategoriesPerExpense; m++) {
            const mcId = `mc-${e}-${m}`;
            mainCategory.push({ id: mcId, name: `Main Category ${m}`, expenseTypeId: etId });

            for (let s = 0; s < subcategoriesPerMain; s++) {
                const scId = `sc-${e}-${m}-${s}`;
                subcategory.push({ id: scId, name: `Subcategory ${s}`, mainCategoryId: mcId });

                for (let t = 0; t < transactionsPerSub; t++) {
                    transaction.push({ id: `tx-${e}-${m}-${s}-${t}`, subcategoryId: scId });
                }
            }
        }
    }
    return { expenseType, mainCategory, subcategory, transaction, incomeType };
}

function createRandomIndex(maxLimit: number) {
    return Math.floor(Math.random() * maxLimit);
}

function nestedLoop(entities: Entities<Schema>, expenseTypeId: string) {
    const result: string[] = [];

    for (let i = 0; i < entities.mainCategory.length; i++) {
        const mc = entities.mainCategory[i];
        if (mc.expenseTypeId !== expenseTypeId) continue;

        for (let j = 0; j < entities.subcategory.length; j++) {
            const sc = entities.subcategory[j];
            if (sc.mainCategoryId !== mc.id) continue;

            for (let k = 0; k < entities.transaction.length; k++) {
                const tx = entities.transaction[k];
                if (tx.subcategoryId !== sc.id) continue;
                result.push(tx.id);
            }
        }
    }

    return result;
}


function createGraph(entities: any): EntityGraph<CustomGraph> {
    return createGraph({ entities, edges }) as EntityGraph<CustomGraph>;
}

function graphTraversal(graph: EntityGraph<CustomGraph>, expenseTypeId: string) {
    return graph
        .expenseType(expenseTypeId)
        .mainCategoryNodes()
        .flatMap((mc) => mc.subcategoryNodes())
        .flatMap((sc) => sc.transactionNodes())
        .map((tx) => tx.value()?.id);
}

function graphTraversalWithBuild(entities: Entities<Schema>, expenseTypeId: string) {
    const graph = createGraph(entities);
    return graph
        .expenseType(expenseTypeId)
        .mainCategoryNodes()
        .flatMap((mc) => mc.subcategoryNodes())
        .flatMap((sc) => sc.transactionNodes())
        .map((tx) => tx.value()?.id);
}

type BenchmarkResult = {
    size: number;
    loop: number;
    graph: number;
    graphWithBuild: number;
};

async function runBenchmark() {
    const datasetSizes = [
        { sub: 2, tx: 2 },
        { sub: 20, tx: 20 },
        { sub: 50, tx: 50 },
        { sub: 100, tx: 100 },
    ];

    const results: BenchmarkResult[] = [];

    for (const ds of datasetSizes) {
        console.log(`Running dataset: subcategories=${ds.sub}, transactions=${ds.tx}`);

        const entities = generateLargeDataset({
            expenseTypes: 10,
            mainCategoriesPerExpense: 10,
            subcategoriesPerMain: ds.sub,
            transactionsPerSub: ds.tx,
        });

        const N = 10;

        const lookupExpenseTypeId: string[] = [];
        for (let i = 0; i < N; i++) {
            const idx = createRandomIndex(entities.expenseType.length);
            lookupExpenseTypeId.push(entities.expenseType[idx].id);
        }

        let loopTime = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            const result = nestedLoop(entities, lookupExpenseTypeId[i].toString());
            const t1 = performance.now();
            loopTime += t1 - t0;
        }

        const graph = createGraph(entities);
        let graphTime = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            const result = graphTraversal(graph, lookupExpenseTypeId[i].toString());
            const t1 = performance.now();
            graphTime += t1 - t0;
        }

        let graphWithBuildTime = 0;
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            const result = graphTraversalWithBuild(entities, lookupExpenseTypeId[i].toString());
            const t1 = performance.now();
            graphWithBuildTime += t1 - t0;
        }

        results.push({
            size: entities.transaction.length,
            loop: loopTime / N,
            graph: graphTime / N,
            graphWithBuild: graphWithBuildTime / N,
        });
    }

    console.log(results);
    generatePlot(results);
}

function generatePlot(results: BenchmarkResult[]) {
    const traceLoop = {
        x: results.map((r) => r.size),
        y: results.map((r) => r.loop),
        type: "scatter",
        mode: "lines+markers",
        name: "Nested Loops",
        line: { color: "#f1634c", width: 4 },
        marker: { color: "#f1634c", size: 8, symbol: "circle" }
    };

    const traceGraph = {
        x: results.map((r) => r.size),
        y: results.map((r) => r.graph),
        type: "scatter",
        mode: "lines+markers",
        name: "Entity Graph",
        line: { color: "#37b98b", width: 4 },
        marker: { color: "#37b98b", size: 8, symbol: "circle" }
    };

    const traceGraphWithBuild = {
        x: results.map((r) => r.size),
        y: results.map((r) => r.graphWithBuild),
        type: "scatter",
        mode: "lines+markers",
        name: "Entity Graph with Build",
        line: { color: "#faa318", width: 4 },
        marker: { color: "#faa318", size: 8, symbol: "circle" }
    };

    const layout = {
        xaxis: { title: "Number of Transactions", },
        yaxis: { title: "Average runtime (ms)", tickformat: ".0s" },
        font: { size: 18 },
        legend: {
            orientation: "h",
            x: 0.5,
            xanchor: "center",
            y: 1.1,
        }, margin: { l: 80, r: 40, t: 70, b: 80 }
    };

    const html = `
<html>
  <head>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
  </head>
  <body>
    <div id="plot" style="width:100%;height:600px;"></div>
    <script>
      const data = ${JSON.stringify([traceLoop, traceGraph, traceGraphWithBuild])};
      const layout = ${JSON.stringify(layout)};
      Plotly.newPlot('plot', data, layout);
    </script>
  </body>
</html>
  `;

    fs.writeFileSync("benchmark.html", html, "utf-8");
    console.log("Plot saved as benchmark.html");
}

runBenchmark();

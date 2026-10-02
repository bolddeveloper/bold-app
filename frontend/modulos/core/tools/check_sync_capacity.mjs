import { simulateSyncCapacity } from "../../../testing/sync_capacity.mjs";
const scenarios = [];
for (const units of [1, 13]) for (const clients of [5, 10, 25]) scenarios.push(await simulateSyncCapacity({ clients, units }));
scenarios.push(await simulateSyncCapacity({ clients: 2, units: 1, hiddenTabs: 1 }));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), networkRequests: 0, scenarios }, null, 2));

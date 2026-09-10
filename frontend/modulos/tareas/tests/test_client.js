import { createHttpClient } from "../src/core/http_client.js";
import { createCoreApi } from "../src/core/core_api.js";
import { createTasksApi } from "../src/services/tasks_api.js";
export function createApiClient(options) {
    const http = createHttpClient(options);
    return { ...http, ...createCoreApi(http), ...createTasksApi(http), cancelRequests: http.cancelRequests };
}

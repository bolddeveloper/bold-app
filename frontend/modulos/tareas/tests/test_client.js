import { createHttpClient } from "../../core/http_client.js";
import { createCoreApi } from "../../core/core_api.js";
import { createTasksApi } from "../src/services/tasks_api.js";
export function createApiClient(options) {
    const http = createHttpClient(options);
    return { ...http, ...createCoreApi(http), ...createTasksApi(http), cancelRequests: http.cancelRequests };
}

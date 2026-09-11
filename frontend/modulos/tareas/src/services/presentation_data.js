import * as template from "../data/task_data.js";
import { is_using_real_backend } from "../../../core/http_client.js";
export const starter_tasks = is_using_real_backend() ? [] : template.starter_tasks;
export const notification_items = is_using_real_backend() ? [] : template.notification_items;
export let project_items = is_using_real_backend() ? [] : template.project_items;
export { directory as team_members, activeAssignment as current_user, activeAssignmentId as current_user_id } from "../../../core/core_store.js";
export function setPresentationData(data) { project_items = data?.projects || []; }

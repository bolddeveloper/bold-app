import * as template from "../data/task_data.js";
import { is_using_real_backend } from "./api_client.js";
export const navigation_items = template.navigation_items;
export const starter_tasks = is_using_real_backend() ? [] : template.starter_tasks;
export const notification_items = is_using_real_backend() ? [] : template.notification_items;
export let project_items = is_using_real_backend() ? [] : template.project_items;
export let team_members = is_using_real_backend() ? [] : template.team_members;
export let current_user = is_using_real_backend() ? null : template.team_members[0];
export let current_user_id = current_user?.id;
export function setPresentationData(data, assignmentId) {
    project_items = data?.projects || [];
    team_members = data?.directory || [];
    current_user = team_members.find(item => item.id === assignmentId) || null;
    current_user_id = current_user?.id;
}

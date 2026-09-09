import { starter_tasks } from "../data/task_data.js";
import { create_task_event, task_event_types } from "./task_events.js";
let template_tasks = starter_tasks.map((task_item) => ({
    comments: [],
    ...task_item,
    subtasks: task_item.subtasks.map((subtask_item) => ({ ...subtask_item }))
}));


// Lists tasks from the in-memory template store.
export async function list_tasks() {
    return template_tasks.map((task_item) => ({ ...task_item }));
}


// Adds a task to the in-memory template store.
export async function create_task(task_payload) {
    const new_task = {
        comments: [],
        subtasks: [],
        ...task_payload
    };

    template_tasks = [...template_tasks, new_task];

    return { ...new_task };
}


// Merges the given fields into a task already in the template store.
export async function update_task(task_id, task_payload) {
    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id ? { ...task_item, ...task_payload } : task_item
    ));

    return { ok: true };
}


// Moves a task to a different board column in the template store.
export async function move_task(task_id, section) {
    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id ? { ...task_item, section } : task_item
    ));

    return { ok: true };
}


// Removes a task from the template store.
export async function delete_task(task_id) {
    template_tasks = template_tasks.filter((task_item) => task_item.id !== task_id);

    return { ok: true, deleted: true };
}


// Adds a comment to a task in the template store.
export async function add_comment(task_id, comment_body, author_name) {
    const new_comment = {
        id: `comment_${Date.now()}`,
        author_name,
        body: comment_body,
        created_at: new Date().toISOString()
    };

    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id
            ? { ...task_item, comments: [...task_item.comments, new_comment] }
            : task_item
    ));

    create_task_event(task_event_types.comment_created, task_id, new_comment);

    return new_comment;
}


// Toggles one subtask's completed state on a task in the template store.
export async function toggle_subtask(task_id, subtask_id) {
    template_tasks = template_tasks.map((task_item) => {
        if (task_item.id !== task_id) {
            return task_item;
        }

        return {
            ...task_item,
            subtasks: task_item.subtasks.map((subtask_item) => (
                subtask_item.id === subtask_id
                    ? { ...subtask_item, completed: !subtask_item.completed }
                    : subtask_item
            ))
        };
    });

    return { ok: true };
}



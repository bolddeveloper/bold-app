import test from "node:test";
import assert from "node:assert/strict";
import {taskSyncOptions} from "./task_sync_options.js";

test("production defaults to incremental sync and lazy histories with explicit rollback switches", () => {
    const real = {VITE_USE_REAL_BACKEND:"true"};
    assert.deepEqual(taskSyncOptions(real), {incremental:true,pagedComments:true,pagedAttachments:true});
    assert.deepEqual(taskSyncOptions({...real,VITE_TASK_INCREMENTAL_SYNC:"false"}), {incremental:false,pagedComments:false,pagedAttachments:false});
    assert.deepEqual(taskSyncOptions({...real,VITE_TASK_PAGED_COMMENTS:"false",VITE_TASK_PAGED_ATTACHMENTS:"false"}), {incremental:true,pagedComments:false,pagedAttachments:false});
    assert.equal(taskSyncOptions().pagedComments,false);
});

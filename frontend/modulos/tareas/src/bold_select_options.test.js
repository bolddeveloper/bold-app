import test from "node:test";
import assert from "node:assert/strict";

import { filterSelectOptions } from "../../core/shared/bold_select_options.js";

const options = [
    { value: "owner", label: "Propietario" },
    { value: "management", label: "Alta Gerencia" },
];

test("shared selects expose all options until searchable filtering is requested", () => {
    assert.equal(filterSelectOptions(options, "prop", false), options);
    assert.equal(filterSelectOptions(options, "", true), options);
    assert.deepEqual(filterSelectOptions(options, "  GERENCIA ", true), [options[1]]);
    assert.deepEqual(filterSelectOptions(options, "owner", true), [options[0]]);
    assert.deepEqual(filterSelectOptions(options, "inexistente", true), []);
});

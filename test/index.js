const app = require("../index.js");
require("colors");

// exports.htmlTableToArray = function(test) {
//     test.done();
// };

// exports.debugLog = function(test) {
//     test.done();
// };

exports.tag = function(test) {
    const TAG = "test";
    const meta = {
        meta: {
            tag: [
                {
                    system: "https://smarthealthit.org/tags",
                    code: TAG
                }
            ]
        }
    };
    let json;

    // Not a resource ----------------------------------------------------------
    json = { a: 2 }
    test.deepEqual(app.tag(json, TAG), json);

    // Resource & no meta ------------------------------------------------------
    json = { resourceType: "test" }
    test.deepEqual(app.tag(json, TAG), Object.assign({}, json, meta));

    // Resource & empty meta ---------------------------------------------------
    json = { resourceType: "test", meta: {} }
    test.deepEqual(app.tag(json, TAG), Object.assign({}, json, meta));

    // Resource & empty meta.tag -----------------------------------------------
    json = { resourceType: "test", meta: { tag: [] } }
    test.deepEqual(app.tag(json, TAG), Object.assign({}, json, meta));

    // Resource & other tags ---------------------------------------------------
    json = { resourceType: "test", meta: { tag: [ { system: "x", code: "y" } ] } }
    test.deepEqual(app.tag(json, TAG), {
        resourceType: "test",
        meta: {
            tag: [
                { system: "x", code: "y" },
                meta.meta.tag[0]
            ]
        }
    });

    // Resource & other tag from the same system -------------------------------
    json = {
        resourceType: "test",
        meta: {
            tag: [
                {
                    system: "https://smarthealthit.org/tags",
                    code: "y"
                }
            ]
        }
    };
    test.deepEqual(app.tag(json, TAG), Object.assign({resourceType: "test"}, meta));

    // Bundle ------------------------------------------------------------------
    json = {
        resourceType: "Bundle",
        entry: [
            { request: {}, resource: { resourceType: "test" }},
            { request: {}, resource: { resourceType: "test" }}
        ]
    }
    test.deepEqual(app.tag(json, TAG), {
        resourceType: "Bundle",
        entry: [
            {
                request: {},
                resource: Object.assign({ resourceType: "test" }, meta)
            },
            {
                request: {},
                resource: Object.assign({ resourceType: "test" }, meta)
            }
        ]
    });

    test.done();
};

// exports.addEntryFullURLs = function(test) {
//     test.done();
// };

// exports.upload = function(test) {
//     test.done();
// };

// exports.validate = function(test) {
//     test.done();
// };

// exports.validateResource = function(test) {
//     test.done();
// };

// exports.readFile = function(test) {
//     test.done();
// };

exports.parseJSON = function(test) {
    app.parseJSON('{"a":2}')
    .then(j => test.deepEqual(j, { a: 2 }))
    .then(() => app.parseJSON('b'))
    .catch(e => {
        test.equal(e.message, "Unexpected token b in JSON at position 0");
    })
    .then(() => test.done())
};

exports.generateProgress = function(test) {
    test.equal(
        app.generateProgress(),
        "\r\033[2K" +
        "0% ".bold +
        "▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".grey +
        " "
    )
    test.equal(
        app.generateProgress(50),
        "\r\033[2K" +
        "50% ".bold +
        "▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".bold +
        "▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".grey +
        " "
    )
    test.equal(
        app.generateProgress(100),
        "\r\033[2K" +
        "100% ".bold +
        "▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".bold +
        " "
    )
    test.equal(
        app.generateProgress(300),
        "\r\033[2K" +
        "300% ".bold +
        "▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".bold +
        " "
    )
    test.done();
};

// exports.countResources = function(test) {
//     test.done();
// };

// exports.walk = function(test) {
//     test.done();
// };

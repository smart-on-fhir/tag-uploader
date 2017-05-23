const app = require("../index.js");
require("colors");

// exports.htmlTableToArray = function(test) {
//     test.done();
// };

// exports.debugLog = function(test) {
//     test.done();
// };

// exports.tag = function(test) {
//     test.done();
// };

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

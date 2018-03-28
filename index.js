#!/usr/bin/env node

require('colors');
const FS       = require('fs');
const Path     = require('path');
const APP      = require('commander');
const Walk     = require('walk');
const PCG      = require('./package.json');
const request  = require("request");
const duration = require('humanize-duration');
const Table    = require("table");
const moment   = require("moment");

const RE_WHITE_SPACES  = /\s+/g;
const RE_TABLE_ROWS    = /<tr.*?>.*?<\/tr>/gi;
const RE_TABLE_CELLS   = /<(td|th).*?>(.*?)<\/\1>/gi;
const RE_ANY_TAGS      = /<.*?>/g;
const PROGRESS_LENGTH  = 60;
const VALIDATE_NONE    = 0;
const VALIDATE_INFO    = 1;
const VALIDATE_WARNING = 2;
const VALIDATE_ERROR   = 3;

let COUNT_FILES        = 0;
let COUNT_RESOURCES    = 0;
let COUNT_UPLOADED     = 0;
let COUNT_NOT_UPLOADED = 0;

APP.version(PCG.version);
APP.option('-d, --input-dir <dir>'    , 'The directory to walk and search for JSON bundles');
APP.option('-t, --tag <tag>'          , 'The tag to add to every resource');
APP.option('-s, --system <string>'    , 'The tag to add to every resource', "https://smarthealthit.org/tags");
APP.option('-w, --overwrite'          , 'Overwrite the source files', false);
APP.option('-S, --server <url>'       , 'The remote server to send the bundles to', "");
APP.option('-v, --verbose'            , 'Show detailed output', false);
APP.option('-V, --validate [logLevel]', 'Validate the bundles', VALIDATE_NONE);
APP.option('-e, --exit-on-invalid'    , 'Exit on validation errors', false);
APP.option('-p, --proxy <url>'        , 'HTTP proxy url');
APP.option('--silent'                 , 'Don\'t produce any output.');
APP.option('--skip-until <filename>'  , 'Skip everything before this file (useful for debugging)');
APP.option('-u, --user <username>'    , 'Basic auth username (unless -a is used)');
APP.option('-P, --password <password>', 'Basic auth password (unless -a is used)');
APP.option('-a, --auth <auth>'        , 'Authorization header');

/**
 * Parses the provided HTML string, extracts all <TR> tags and then extracts
 * the contents of their TD/TH children. Returns the cell data as
 * two-dimensional array
 * @param {String} html The html string to parse
 * @returns {Array}
 */
function htmlTableToArray(html) {
    let rows = html.replace(RE_WHITE_SPACES, " ").match(RE_TABLE_ROWS);
    return (rows || []).map(row => {
        return row.match(RE_TABLE_CELLS).map((cell, i) => {
            let out = cell.replace(RE_ANY_TAGS, "");
            if (i === 0) {
                if (out == "WARNING") {
                    out = out.yellow;
                }
                else if (out == "ERROR") {
                    out = out.red;
                }
                else if (out == "INFORMATION") {
                    out = out.cyan;
                }
            }
            return out;
        });
    });
}

function log(...args) {
    if (!APP.silent) {
        process.stdout.write(args.map(String).join(" "));
    }
}

function logError(error) {
    if (!APP.silent) {
        process.stderr.write(String(error) + "\n");
    }
}

/**
 * This is somewhat similar to the debug module mut it writes directly to STDOUT
 * and does NOT append new line at the end which allows us to do funky stuff.
 * @param {String} msg The message to log
 * @returns {void}
 */
function debugLog(msg) {
    if (APP.verbose) {
        log(msg);
    }
}

/**
 * Apply the APP.tag to the given JSON object. Note that this function is
 * designed to replace the old tag if it has the same system property. The
 * default system is "urn:oid:tag-bundler" but another one can be specified
 * using the "-s, --system <string>" command line argument
 * @param {Object} json
 * @return {Object} json Returns the same JSON object decorated with the new tag
 */
function tag(json={}, tagString="") {

    tagString = tagString || APP.tag

    // Not a resource - ignore it
    if (!json.resourceType) {
        debugLog(`  Not a valid FHIR resource\n`.red);
        return json;
    }

    // FHIR Bundle - loop entries and add tags
    if (json.resourceType == "Bundle") {
        if (Array.isArray(json.entry)) {
            json.entry.forEach(entry => {
                if (entry.resource && entry.resource.resourceType) {
                    entry.resource = tag(entry.resource, tagString);
                }
            });
        }
        return json;
    }

    // FHIR Resource -----------------------------------------------------------

    COUNT_RESOURCES +=1;

    // No tag specified - continue
    if (!tagString) {
        return json;
    }

    // No meta - add one and exit
    if (!json.meta) {
        json.meta = {
            tag: [
                {
                    system: APP.system,
                    code  : tagString
                }
            ]
        };
        return json;
    }

    // No meta.tag - add one and exit
    if (!Array.isArray(json.meta.tag) || !json.meta.tag.length) {
        json.meta.tag = [
            {
                system: APP.system,
                code  : tagString
            }
        ];
        return json;
    }

    // Look for existing tag with the same system. If found - update it
    if (json.meta.tag.some(t => {
        if (t.system == APP.system) {
            t.code = tagString;
            return true;
        }
        return false;
    })) {
        return json;
    }

    // Have meta but no tag - add one and exit
    json.meta.tag.push({
        system: APP.system,
        code  : tagString
    });

    return json;
}

/**
 * The bundle will have to be submitted to the provided server URL. This means
 * that the "fullUrl" property of the bundle entries will have to be set
 * accordingly.
 * @param {Object} bundle
 * @return {Object} bundle
 */
function addEntryFullURLs(bundle) {
    if (Array.isArray(bundle.entry)) {
        bundle.entry = bundle.entry.map(entry => {
            if (!entry.fullUrl && entry.resource.id /*&& APP.server*/) {
                entry.fullUrl = "/" + //APP.server.replace(/\/?$/, "/") +
                    entry.resource.resourceType + "/" +
                    entry.resource.id;
            }
            return entry;
        });
    }
    return bundle;
}

/**
 * Uploads the JSON bundle to the specified server
 * @param {Object} json
 * @returns {Promise<response>}
 */
function upload(json) {
    return new Promise((resolve, reject) => {

        if (json.type == "collection") { // synthea
            json.type = "transaction"
            json.entry.forEach(e => {
                let method = e.fullUrl && e.resource.id.indexOf("urn:uuid:") !== 0 ? "PUT" : "POST"
                e.request = {
                    method,
                    url: method == "PUT" ? `${e.resource.resourceType}/${e.resource.id}` : `${e.resource.resourceType}`
                };
            })
        }

        json.entry.forEach(entry => {
            if (!entry.request) {
                entry.request = {};
            }
            if (entry.resource.id) {
                entry.request.method = "PUT";
                entry.request.url = `${entry.resource.resourceType}/${entry.resource.id}`;
            }
            else {
                entry.request.method = "POST";
                entry.request.url = `${entry.resource.resourceType}`;
            }
        })

        debugLog("Executing transaction... ");
        let start = Date.now();

        let options = {
            method: "POST",
            uri   : APP.server,
            json  : true,
            body  : json,
            proxy : APP.proxy,
            headers: {
                accept: "application/json+fhir"
            }
        };

        if (APP.auth) {
            options.headers.Authorization = APP.auth;
        }

        else if (APP.user && APP.password) {
            options.auth = {
                user: APP.user,
                pass: APP.password,
                sendImmediately: true
            };
        }

        request(options, (error, response, body) => {
            if (error) {
                debugLog("Failed!\n".bold.red);
                COUNT_NOT_UPLOADED += 1;
                return reject(error);
            }
            if (response.statusCode >= 400) {
                debugLog("Failed!\n".bold.red);
                debugLog(JSON.stringify(body, null, 4));
                let err = new Error(response.statusMessage);
                err.details = body;
                err.payload = json;
                COUNT_NOT_UPLOADED += 1;
                return reject(err);
            }
            COUNT_UPLOADED += 1;
            debugLog(`OK (${duration(Date.now() - start)})\n`.bold.green);
            resolve(body);
        })
    })
}

/**
 * Validates the given resource JSON. If the argument is a bundle or a set
 * iterates over every contained resource and calls a validation service
 * to validate it.
 * @param {Object} json
 * @returns {Promise<object>}
 */
function validate(json) {
    if (json.resourceType == "Bundle" || json.resourceType == "Set") {
        if (Array.isArray(json.entry)) {
            let job = Promise.resolve();
            json.entry.forEach(trx => {
                job = job.then(() => validateResource(trx.resource));
            });
            return job;
        }
    }
    return validateResource(json);
}

/**
 * Calls a validation service to validate the given FHIR resource
 * @param {Object} resource
 * @returns {Promise<object>}
 */
function validateResource(resource) {
    return new Promise((resolve, reject) => {

        // Cannot validate resource without id
        if (!resource.id) {
            return resolve()
        }

        let url = APP.server.replace(/\/?$/, "/") +
            `${resource.resourceType}/${resource.id}/$validate`;

        let options = {
            method: "POST",
            uri   : url,
            json  : true,
            body  : resource,
            proxy : APP.proxy,
            headers: {
                accept: "application/json+fhir"
            }
        };

        if (APP.auth) {
            options.headers.Authorization = APP.auth;
        }

        else if (APP.user && APP.password) {
            options.auth = {
                user: APP.user,
                pass: APP.password,
                sendImmediately: true
            };
        }

        request(options, (error, response, body) => {
            if (error) {
                return reject(error);
            }
            if (body &&
                body.resourceType == "OperationOutcome" &&
                body.text &&
                body.text.div &&
                body.text.div.indexOf("No issues detected during validation") == -1)
            {
                let hasError   = body.text.div.indexOf("ERROR") > -1;
                let hasWarning = body.text.div.indexOf("WARNING") > -1;
                let hasInfo    = body.text.div.indexOf("INFORMATION") > -1;

                if ((APP.validate >= VALIDATE_ERROR && hasError) ||
                    (APP.validate >= VALIDATE_WARNING && (hasError || hasWarning)) ||
                    (APP.validate >= VALIDATE_INFO && (hasError || hasWarning || hasInfo)))
                {
                    let msg = "\n" + ` Validation errors in ${url}: `.bold.redBG + "\n";
                    msg += Table.table(htmlTableToArray(body.text.div), {
                        columns: {
                            0: {
                                alignment: 'right',
                                width: 12
                            },
                            1: {
                                alignment: 'left',
                                width: 60,
                                wrapWord: true
                            },
                            2: {
                                alignment: 'left',
                                width: 80,
                                wrapWord: true
                            }
                        }
                    });

                    if (hasError) {
                        log("\n" + msg + "\n");
                        if (APP.exitOnInvalid) {
                            return reject(msg);
                        }
                    }
                }
            }

            setTimeout(() => resolve(resource), 0);
        });
    })
}

/**
 * Promisified version of fs.readFile. It also assumes that the file is encoded
 * in utf8 and the output is a string
 * @param {String} src
 * @returns {String}
 */
function readFile(src) {
    return new Promise((resolve, reject) => {
        FS.readFile(src, "utf8", function(err, str) {
            if (err) {
                return reject(err);
            }
            resolve(str);
        });
    });
}

/**
 * Promisified version of JSON.parse
 * @param {String} str The JSON string to parse
 * @returns {Object}
 */
function parseJSON(str) {
    let json;
    try {
        json = JSON.parse(str);
    }
    catch (ex) {
        return Promise.reject(ex);
    }
    return Promise.resolve(json);
}

/**
 * Generates a progress indicator
 * @param {Number} pct The percentage
 * @returns {String}
 */
function generateProgress(pct=0) {
    if (APP.verbose) {
        return `${pct}% `.bold;
    }

    let spinner = "", bold = [], grey = [];
    for (let i = 0; i < PROGRESS_LENGTH; i++) {
        if (i / PROGRESS_LENGTH * 100 >= pct) {
            grey.push("▉");
        }
        else {
            bold.push("▉");
        }
    }

    if (bold.length) {
        spinner += bold.join("").bold;
    }

    if (grey.length) {
        spinner += grey.join("").grey;
    }

    return "\r\033[2K" + `${pct}% `.bold + `${spinner} `;
}

/**
 * Walk the files first an count the resources contained within them. This is
 * needed to compute the progress later.
 * @param {Function} cb A callback function to be called with the total count
 *                      once the task is complete.
 * @returns {void}
 */
function countResources(cb) {
    let resources = 0, fileFound = false;
    let counter = Walk.walk(APP.inputDir, {
        followLinks: false,
        filters    : ["Temp", "_Temp"]
    });

    counter.on("errors", function (root, nodeStatsArray, next) {
        log(("Error: " + nodeStatsArray.error).red + root + " - ", nodeStatsArray, "\n");
        next();
    });

    counter.on("end", function () {
        cb(resources);
    });

    counter.on("file", function (root, fileStats, next) {
        if (fileStats.type != "file") {
            return next();
        }

        if (!fileStats.size || !fileStats.name) {
            return next();
        }

        if (!String(fileStats.name).toLowerCase().endsWith(".json")) {
            return next();
        }

        if (APP.skipUntil && fileStats.name == APP.skipUntil) {
            fileFound = true
        }

        if (APP.skipUntil && !fileFound) {
            return next();
        }

        let src = Path.join(root, fileStats.name)
        readFile(src)
        .then(parseJSON)
        .then(json => {
            if (json.resourceType) {
                if (json.resourceType == "Bundle" && Array.isArray(json.entry)) {
                    resources += json.entry.length
                }
                else {
                    resources += 1
                }
            }
            next()
        })
    })
}

const SETTINGS = {};
/**
 * Looks for settings file named ".settings.js" in the given directory. If that
 * file is found, loads it and does some basic processing to evaluate moment
 * .format strings... If no file is found returns an empty settings object.
 * @param {String} dir The directory that might contain a config file
 * @return {Object} The settings (might be an empty object)
 */
function lookUpConfig(dir) {
    if (!SETTINGS[dir]) {
        let cfg = {};
        let path = Path.join(dir, ".settings.js");
        if (FS.existsSync(path)) {
            cfg = require(path);
            if (cfg.tag) {
                cfg.tag = String(cfg.tag).replace(
                    /\$moment\{(.*?)\}/g,
                    (all, match) => moment().format(match)
                );
            }
        }
        SETTINGS[dir] = cfg;
    }
    return SETTINGS[dir];
}

/**
 * The actual worker
 * @param {Number} total The number of resources (used to compute the progress)
 * @returns {void}
 */
function walk(total) {
    let fileFound = false;
    let walker = Walk.walk(APP.inputDir, {
        followLinks: false
    });

    log("\n");

    walker.on("errors", function (root, nodeStatsArray, next) {
        log(("Error: " + nodeStatsArray.error).red + root + " - ", nodeStatsArray, "\n");
        next();
    });

    walker.on("end", function () {
        log(generateProgress(100));
        log(
            "\n" +
            " Done ".bold.bgGreen + " " +
            COUNT_FILES        + " files processed, " +
            COUNT_RESOURCES    + " resources tagged, " +
            COUNT_UPLOADED     + " resources uploaded, " +
            COUNT_NOT_UPLOADED + " resources failed to upload\n\n"
        );
    });

    walker.on("file", function (root, fileStats, next) {

        if (fileStats.type != "file") {
            return next();
        }

        if (!fileStats.size || !fileStats.name) {
            return next();
        }

        if (!String(fileStats.name).toLowerCase().endsWith(".json")) {
            return next();
        }

        if (APP.skipUntil && fileStats.name == APP.skipUntil) {
            fileFound = true
        }

        if (APP.skipUntil && !fileFound) {
            return next();
        }

        // debugLog(`Processing file "${fileStats.name}": `.bold);
        log(generateProgress(Math.floor(COUNT_RESOURCES/total * 100)));
        log(`Processing file "${fileStats.name}`.bold);
        log(" ... ");

        let cfg = lookUpConfig(root);
        let src = Path.join(root, fileStats.name);

        readFile(src)
        .then(parseJSON)
        .then(json => tag(json, cfg.tag))
        .then(json => addEntryFullURLs(json))
        .then(json => {
            if (APP.overwrite) {
                FS.writeFileSync(src, JSON.stringify(json, null, 4), "utf8");
            }
            return json;
        })
        // .then(json => addEntryFullURLs(json))
        .then(json => {
            if (APP.server && APP.validate) {
                return validate(json);
            }
            return json;
        })
        .then(json => {
            if (APP.server && !APP.validate) {
                return upload(json);
            }
            return json;
        })
        .then(() => {
            COUNT_FILES += 1;
            next();
        })
        .catch(error => {
            logError(error);
            if (!APP.validate) {
                next();
            }
        });
    });
}

// =============================================================================
//                                 EXECUTE
// =============================================================================
if (require.main === module) {

    APP.parse(process.argv);

    // Require input directory!
    if (!APP.inputDir) {
        logError('No input directory given'.red);
        APP.help();
        process.exit(1);
    }

    countResources(walk);
}
else {

    // export functions for testing
    module.exports = {
        parseJSON,
        generateProgress,
        walk,
        tag
    };
}

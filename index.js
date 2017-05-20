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

let COUNT_FILES        = 0;
let COUNT_RESOURCES    = 0;
let COUNT_UPLOADED     = 0;
let COUNT_NOT_UPLOADED = 0;

APP.version(PCG.version);
APP.option('-d, --input-dir <dir>', 'The directory to walk and search for JSON bundles');
APP.option('-t, --tag <tag>'      , 'The tag to add to every resource');
APP.option('-s, --system <string>', 'The tag to add to every resource', "urn:oid:tag-bundler");
APP.option('-w, --overwrite'      , 'Overwrite the source files', false);
APP.option('-S, --server <url>'   , 'The remote server to send the bundles to', "");
APP.option('-v, --verbose'        , 'Show detailed output', false);
APP.option('-V, --validate'       , 'Validate the bundles', false);
APP.option('-p, --proxy <url>'    , 'HTTP proxy url');
APP.option('--skip-until <filename>', 'Skip everything before this file (useful for debugging')

/**
 * Parses the provided HTML string, extracts all <TR> tags and then extracts
 * the contents of their TD/TH children. Returns the cell data as
 * two-dimensional array
 * @param {String} html The html string to parse
 * @returns {Array}
 */
function htmlTableToArray(html) {
    let rows = html.replace(/\s+/g, " ").match(/<tr.*?>.*?<\/tr>/gi)
    // html.match(/<td.*?>(.*?)<\/td>/gi)
    // console.log(rows)
    return (rows || []).map(row => {
        return row.match(/<(td|th).*?>(.*?)<\/\1>/gi).map((cell, i) => {
            let out = cell.replace(/<.*?>/gi, "")
            if (i === 0) {
                if (out == "WARNING") {
                    out = out.yellow
                }
                else if (out == "ERROR") {
                    out = out.red
                }
                else if (out == "INFORMATION") {
                    out = out.cyan
                }
            }
            // else if (i === 1) {
            //     out = out.bold
            // }
            return out
        })
    })
}

/**
 * This is somewhat similar to the debug module mut it writes directly to STDOUT
 * and does NOT append new line at the end which allows us to do funky stuff.
 * @param {String} msg The message to log
 * @returns {void}
 */
function debugLog(msg) {
    if (APP.verbose) {
        process.stdout.write(msg);
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
function tag(json={}) {

    // Not a resource - ignore it
    if (!json.resourceType) {
        debugLog(`  Not a valid FHIR resource\n`.red);
        return json
    }

    // FHIR Bundle - loop entries and add tags
    if (json.resourceType == "Bundle") {
        // debugLog(`  Found a bundle\n`.green);
        if (Array.isArray(json.entry)) {
            json.entry.forEach(entry => {
                if (entry.request && entry.resource && entry.resource.resourceType) {
                    // debugLog(`  Patching bundle entry...\n`.green);
                    entry.resource = tag(entry.resource)
                }
            })
        }
        return json
    }

    // FHIR Resource -----------------------------------------------------------

    COUNT_RESOURCES +=1

    // No meta - add one and exit
    if (!json.meta) {
        // debugLog(`  No meta found. Adding new meta branch\n`.green);
        json.meta = {
            tag: [
                {
                    system: APP.system,
                    code  : APP.tag
                }
            ]
        };
        return json
    }

    // No meta tag - add one and exit
    if (!Array.isArray(json.meta.tag) || !json.meta.tag.length) {
        // debugLog(`  No tags found. Adding new tag\n`.green);
        json.meta.tag = [
            {
                system: APP.system,
                code  : APP.tag
            }
        ];
        return json
    }

    // Look for existing tag with the same system. If found - update it
    if (json.meta.tag.some(t => {
        if (t.system == APP.system) {
            // debugLog(`  Tag found. Updating the code to "${APP.tag}".\n`.green);
            t.code = APP.tag
            return true
        }
        return false
    })) {
        return json
    }

    // Have meta but no tag - add one and exit
    // debugLog(`  No tags found. Adding new tag\n`.green);
    json.meta.tag.push({
        system: APP.system,
        code  : APP.tag
    })

    return json
}

/**
 * The bundle will have to be submitted to the provided server URL. This means
 * that the "fullUrl" property of the bundle entries will have to be set accordingly.
 * @param {Object} bundle
 * @return {Object} bundle
 */
function addEntryFullURLs(bundle) {
    if (Array.isArray(bundle.entry)) {
        bundle.entry = bundle.entry.map(entry => {
            entry.fullUrl = APP.server + "/" + entry.request.url
            return entry
        })
    }
    return bundle
}

/**
 * Uploads the JSON bundle to the specified server
 * @param {Object} json
 * @returns {Promise<response>}
 */
function upload(json) {
    return new Promise((resolve, reject) => {
        debugLog(`Executing transaction ${json.entry[0].request.url} ... `);
        let start = Date.now();
        request({
            method: "POST",
            uri   : APP.server,
            json  : true,
            body  : json,
            proxy : APP.proxy,
            headers: {
                accept: "application/json+fhir"
            }
        }, (error, response, body) => {
            if (error) {
                debugLog("Failed!\n".bold.red, "http")
                COUNT_NOT_UPLOADED += 1
                return reject(error);
            }
            if (response.statusCode >= 400) {
                debugLog("Failed!\n".bold.red, "http")
                let err = new Error(response.statusMessage)
                err.details = body
                err.payload = json
                COUNT_NOT_UPLOADED += 1
                return reject(err);
            }
            COUNT_UPLOADED += 1;
            debugLog(`OK (${duration(Date.now() - start)})\n`.bold.green, "http");
            resolve(body);
        })
    })
}

/**
 * Iterates over every resource in every bundle and calls a validation service
 * to validate the resource
 * @param {Object} json
 * @returns {Promise<object>}
 */
function validate(json) {
    let job = Promise.resolve()
    json.entry.forEach(trx => {
        job = job.then(() => new Promise((resolve, reject) => {
            request({
                method: "POST",
                uri   : APP.server.replace(/\/?$/, "/") + trx.request.url + "/$validate",
                json  : true,
                body  : json,
                proxy : APP.proxy,
                headers: {
                    accept: "application/json+fhir"
                }
            }, (error, response, body) => {
                if (error) {
                    return reject(error);
                }
                if (body &&
                    body.resourceType == "OperationOutcome" &&
                    body.text &&
                    body.text.div &&
                    body.text.div.indexOf("No issues detected during validation") == -1)
                {
                    let msg = "\n" + ` Validation errors in ${trx.request.url}: `.bold.redBG + "\n"
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
                    return reject(msg);
                }

                setTimeout(() => resolve(json), 0);
            })
        }));
    })

    return job
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
                return reject(err)
            }
            resolve(str)
        })
    })
}

/**
 * Promisified version of JSON.parse
 * @param {String} str The JSON string to parse
 * @returns {Object}
 */
function parseJSON(str) {
    let json;
    try {
        json = JSON.parse(str)
    }
    catch (ex) {
        return Promise.reject(ex)
    }
    return Promise.resolve(json)
}


APP.parse(process.argv);

// Require input directory!
if (!APP.inputDir) {
    console.error('No input directory given'.red);
    APP.help()
    process.exit(1)
}

// Require a tag!
if (!APP.tag) {
    console.error('No tag given'.red);
    APP.help()
    process.exit(1)
}

function countResources(cb) {
    let resources = 0,
        fileFound = false;
    let counter = Walk.walk(APP.inputDir, {
        followLinks: false,
        filters    : ["Temp", "_Temp"]
    });

    counter.on("errors", function (root, nodeStatsArray, next) {
        console.log(("Error: " + nodeStatsArray.error).red + root + " - ", nodeStatsArray)
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

function walk(total) {
    let fileFound = false;

    let walker = Walk.walk(APP.inputDir, {
        followLinks: false,
        filters    : ["Temp", "_Temp"]
    });

    walker.on("errors", function (root, nodeStatsArray, next) {
        console.log(("Error: " + nodeStatsArray.error).red + root + " - ", nodeStatsArray)
        next();
    });

    walker.on("end", function () {
        console.log("\r\033[2K100% ▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉▉".bold)
        console.log(
            "\n" +
            " Done ".bold.bgGreen + " " +
            COUNT_FILES + " files processed, " +
            COUNT_RESOURCES + " resources tagged, " +
            COUNT_UPLOADED + " resources uploaded, " +
            COUNT_NOT_UPLOADED + " resources failed to upload"
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

        debugLog(`Processing file "${fileStats.name}": `.bold);
        let pct = Math.floor(COUNT_RESOURCES/total * 100)
        let spinner = "", l = 60
        for (let i = 0; i < l; i++) {
            if (i /l * 100 >= pct) spinner += "▉".grey
            else spinner += "▉".bold
        }
        process.stdout.write("\r\033[2K")
        process.stdout.write(`${pct}% `.bold)
        process.stdout.write(`${spinner} `)
        process.stdout.write(`Processing file "${fileStats.name}`.bold)
        process.stdout.write(" ... ")

        let src = Path.join(root, fileStats.name)
        readFile(src)
        .then(parseJSON)
        .then(json => tag(json))
        .then(json => addEntryFullURLs(json))
        .then(json => {
            if (APP.overwrite) {
                FS.writeFileSync(src, JSON.stringify(json, null, 4), "utf8")
            }
            return json
        })
        .then(json => {
            if (APP.server && APP.validate) {
                return validate(json)
            }
            return json
        })
        .then(json => {
            if (APP.server && !APP.validate) {
                return upload(json)
            }
            return json
        })
        .then(() => {
            COUNT_FILES += 1;
            next()
        })
        .catch(error => {
            console.error(error);
            if (!APP.validate)
                next()
        });
    });
}

countResources(walk)
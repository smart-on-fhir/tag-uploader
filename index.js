#!/usr/bin/env node

require('colors');
const FS       = require('fs');
const Path     = require('path');
const APP      = require('commander');
const Walk     = require('walk');
const PCG      = require('./package.json');
const request  = require("request");
const duration = require('humanize-duration')

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
APP.option('-p, --proxy <url>'    , 'HTTP proxy url');

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

function upload(json, cb) {
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
            return cb(error);
        }
        if (response.statusCode >= 400) {
            debugLog("Failed!\n".bold.red, "http")
            let err = new Error(response.statusMessage)
            err.details = body
            err.payload = json
            COUNT_NOT_UPLOADED += 1
            return cb(err);
        }
        COUNT_UPLOADED += 1;
        debugLog(`OK (${duration(Date.now() - start)})\n`.bold.green, "http");
        setTimeout(() => cb(null, body), 20);
    })
}

APP.parse(process.argv);

if (!APP.inputDir) {
    console.error('No input directory given'.red);
    APP.help()
    process.exit(1)
}

if (!APP.tag) {
    console.error('No tag given'.red);
    APP.help()
    process.exit(1)
}

let walker = Walk.walk(APP.inputDir, {
    followLinks: false,
    filters    : ["Temp", "_Temp"]
});

walker.on("errors", function (root, nodeStatsArray, next) {
    console.log(("Error: " + nodeStatsArray.error).red + root + " - ", nodeStatsArray)
    next();
});

walker.on("end", function () {
    console.log(
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

    debugLog(`Processing file "${fileStats.name}": `.bold);

    let src = Path.join(root, fileStats.name)
    FS.readFile(src, "utf8", function(err, json) {
        try {
            json = JSON.parse(json)
            json = tag(json)
            if (APP.overwrite) {
                FS.writeFileSync(src, JSON.stringify(json, null, 4), "utf8")
            }
            COUNT_FILES += 1;
            if (APP.server) {
                upload(json, error => {
                    if (error) {
                        console.error(error);
                    }
                    next();
                })
            }
            else {
                next();
            }
        }
        catch(ex) {
            console.error(ex)
            next();
        }
    });
});






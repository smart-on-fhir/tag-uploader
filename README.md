# tag-uploader
Adds tags to FHIR bundles and resources and uploads them to specified servers

## Installation
```sh
git clone https://github.com/smart-on-fhir/tag-uploader.git
cd tag-uploader
npm i
```

## Usage

To add a tag to every JSON bundle found (deep) within the specified directory:
```sh
node tag-uploader -d {SOURCE_DIR} -t "Some tag" -w
```

To upload JSON bundle found (deep) within the specified directory:
```sh
node tag-uploader -d {SOURCE_DIR} -t "Some tag" -S {SOME_FHIR_SERVER}
```

## All Options
```
Usage: tag-uploader [options]

  Options:

    -h, --help                 output usage information
    -V, --version              output the version number
    -d, --input-dir <dir>      The directory to walk and search for JSON bundles
    -t, --tag <tag>            The tag to add to every resource
    -s, --system <string>      The tag system
    -w, --overwrite            Overwrite the source files
    -S, --server <url>         The remote server to send the bundles to
    -v, --verbose              Show detailed output
    -V, --validate [logLevel]  Validate the bundles
    -e, --exit-on-invalid      Exit on validation errors
    -p, --proxy <url>          HTTP proxy url
    --silent                   Don't produce any output.
    --skip-until <filename>    Skip everything before this file (useful for debugging)
```

## Important Options Explained
-----
`-d, --input-dir <dir>`

This can be a relative or absolute path to the directory that will be searched
for json fhir bundles. Please make sure you `cd` into the app directory before
running the script. Otherwise the relative paths might not work. The given
directory will be walked recursively and any json file that appears to be fhir
resource (represents an object with `resourceType` property) will be processed.

-----
`-t, --tag <tag>`

Note that the tag will be written to the files if you also
provide the `-w` flag. Otherwise, the tagging is done "in-memory" and the original
json files are not modified.

------
`-s, --system <string>`

If only the `--tag` option is used, the tag that is added will look like so:
```js
{
    system: "https://smarthealthit.org/tags",
    code  : "${The tag}"
}
```
If you want to use something different for the `system` property of the tag,
than you ca use the `-s` or `--system` parameter.

------
`-w, --overwrite`

If provided, the changes (added tags and bundle.entry[x].fulUrl(s)) will be
written to the files.

-------
`-S, --server <url>`

The API server base URL. If set, the app will try to upload the resources there
(unless --validate is set)

--------
`-V, --validate [logLevel]`
If set, the script will validate all the resources using the $validate ser vice.
Note, that those resources must already be uploaded on the server in order to be
validated (otherwise references can't be resolved). If validate is set, the
server must also be set! Resources without `id` cannot be validated and will be
skipped. The logLevel is an integer between 0 and 3 and acts like so:

    0 - No validation (same as if you didn't use the `validate` option)
    1 - Will show info, warning and error messages
    2 - Will show warning and error messages
    3 - Will show error messages only

Note that if the validator reports an error and the `-e` flag is set the script
will not continue processing other bundles.

-------
`--skip-until <filename>`

If you have a big number of files to validate it might be very slow process.
Then, if an error is discovered the validator will stop there (use the -e flag
for that) so that you can fix it and try again. The next time you try, you will
want to add `--skip-until filename.json` to the command and jump to that file.
Otherwise, you will be re-validating all those (already valid) files that were
processed before the "bad one". NOTE: When the validator reports a problem you
will see the file name printed at the top so that you can use ir in the
`--skip-until` parameter.

## Examples

### Validate resources or bundles
Assuming that you have a local folder with FHIR resources or bundles, you can use this tool to validate them. Please note that often you might have to upload those resources on the same server you use for validating them before the actual validation. Otherwise, the validator might complain about invalid references.

To validate all resources in a given folder you need to point this script to that folder, tell it which FHIR server to use and tell it to validate:
```sh
node . -d ../path/to/fhir/resources/ -t whatever-tag -S http://fhirtest.uhn.ca/baseDstu3 --validate
```

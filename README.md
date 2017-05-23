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

    -h, --help              output usage information
    -V, --version           output the version number
    -d, --input-dir <dir>   The directory to walk and search for JSON bundles
    -t, --tag <tag>         The tag to add to every resource
    -s, --system <string>   The tag to add to every resource
    -w, --overwrite         Overwrite the source files
    -S, --server <url>      The remote server to send the bundles to
    -v, --verbose           Show detailed output
    -p, --proxy <url>       HTTP proxy url
    --skip-until <filename> Skip everything before this file (useful for debugging)
```

## Examples

### Validate resources or bundles
Assuming that you have a local folder with FHIR resources or bundles, you can use this tool to validate them. Please note that often you might have to upload those resources on the same server you use for validating them before the actual validation. Otherwise, the validator might complain about invalid references.

To validate all resources in a given folder you need to point this script to that folder, tell it which FHIR server to use and tell it to validate:
```sh
node . -d ../path/to/fhir/resources/ -t whatever-tag -S http://fhirtest.uhn.ca/baseDstu3 --validate
```
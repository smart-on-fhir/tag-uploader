# tag-uploader
Adds tags to FHIR bundles and resources and uploads them to specified servers

##installation
```sh
git clone https://github.com/smart-on-fhir/tag-uploader.git
cd tag-uploader
npm i
```

##usage

To add a tag to every JSON bundle found (deep) within the specified directory:
```sh
node tag-uploader -d {SOURCE_DIR} -t "Some tag" -w
```

To upload JSON bundle found (deep) within the specified directory:
```sh
node tag-uploader -d {SOURCE_DIR} -t "Some tag" -S {SOME_FHIR_SERVER}
```

##All Options
```
Usage: tag-uploader [options]

  Options:

    -h, --help             output usage information
    -V, --version          output the version number
    -d, --input-dir <dir>  The directory to walk and search for JSON bundles
    -t, --tag <tag>        The tag to add to every resource
    -s, --system <string>  The tag to add to every resource
    -w, --overwrite        Overwrite the source files
    -S, --server <url>     The remote server to send the bundles to
    -v, --verbose          Show detailed output
    -p, --proxy <url>      HTTP proxy url
```
Export Headless CMS content models, content model groups and content entires into a local file, or copy them directly to another Webiny Headless CMS system.

## How to setup?
1) Run `yarn`
2) Copy `config.example.js` to `config.js` then update the file: 
   - `export` key should contain endpoint and API key of the source system
   - `import` key should contain endpoint and API key of the target system
    - optionally, set a `TO_PATH` and `FROM_PATH` if you want to export/import to/from a file
3) Run `node index.js`

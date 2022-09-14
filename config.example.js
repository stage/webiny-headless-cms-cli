const environments = {
    staging : 
    {
        MANAGE_ENDPOINT: "https://xyz.cloudfront.net/cms/manage/en-US",
        API_KEY: "YOUR_API_KEY",
    },
    production: {
        MANAGE_ENDPOINT: "https://xyz.cloudfront.net/cms/manage/en-US",
        API_KEY: "YOUR_API_KEY",
    }
}
module.exports = {
    export: {
        MANAGE_ENDPOINT: environments.staging.MANAGE_ENDPOINT,
        API_KEY: environments.staging.API_KEY,
        TO_PATH: "./tmp/",
    },
    import: {
        MANAGE_ENDPOINT: environments.production.MANAGE_ENDPOINT,
        API_KEY: environments.production.API_KEY,
        FROM_PATH: "./tmp/",
    },
    concurrency: 5
};


const path = require("path");
const omit = require("lodash/omit");
const pick = require("lodash/pick");
const { GraphQLClient } = require("graphql-request");
const writeJsonFile = require("write-json-file");
const loadJsonFile = require("load-json-file");
const Listr = require("listr");
const inquirer = require("inquirer");
const config = require("./config");
const GQL = require("./queries");


const getModelDataFromRemote = async () => {
    const exportClient = new GraphQLClient(config.export.MANAGE_ENDPOINT, {
        headers: { Authorization: config.export.API_KEY },
    });

    return await exportClient.request(GQL.LIST_CONTENT_MODELS_WITH_GROUPS);
};

const importModelData = async (data) => {
    const importClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
    });

    // 2. Import content model groups
    const tasks = new Listr([
        {
            // Creates root package.json.
            title: "Import content model groups",
            task: async (ctx, task) => {
                // In case a group exists in the target system, we want to get the group ID.
                task.output = `Fetching content model groups from target system...`;
                const targetSystemData = await importClient.request(
                    GQL.LIST_CONTENT_MODELS_WITH_GROUPS
                );

                const targetSystemGroups = targetSystemData.listContentModelGroups.data;
                const groupsToImport = data.listContentModelGroups.data;

                ctx.groups = {};

                for (let i = 0; i < groupsToImport.length; i++) {
                    const group = groupsToImport[i];
                    task.output = `Creating "${group.name}"...`;

                    const existingGroup = targetSystemGroups.find((grp) => grp.slug === group.slug);
                    if (existingGroup) {
                        ctx.groups[group.id] = existingGroup.id;
                    } else {
                        const response = await importClient.request(
                            GQL.CREATE_CONTENT_MODEL_GROUP,
                            {
                                data: omit(group, ["id"]),
                            }
                        );

                        const { data, error } = response.createContentModelGroup;
                        if (data) {
                            ctx.groups[group.id] = data.id;
                        } else {
                            ctx.errors.push(error);
                        }
                    }
                }
            },
        },
        {
            title: "Import content models",
            task: async (ctx, task) => {
                const modelsToImport = data.listContentModels.data;
                for (let i = 0; i < modelsToImport.length; i++) {
                    // Create the model
                    const model = pick(modelsToImport[i], [
                        "name",
                        "modelId",
                        "group",
                        "description",
                    ]);

                    task.output = `Creating "${model.name}"...`;

                    model.group = ctx.groups[model.group.id];
                    const { createContentModel: create } = await importClient.request(
                        GQL.CREATE_CONTENT_MODEL,
                        {
                            data: model,
                        }
                    );

                    if (create.error) {
                        ctx.errors.push(create.error);
                        continue;
                    }

                    // Update with the rest of the model data
                    task.output = `Updating "${model.name}"...`;
                    const { updateContentModel: update } = await importClient.request(
                        GQL.UPDATE_CONTENT_MODEL,
                        {
                            modelId: model.modelId,
                            data: pick(modelsToImport[i], ["fields", "layout", "titleFieldId"]),
                        }
                    );

                    if (update.error) {
                        ctx.errors.push(update.error);
                    }
                }
            },
        },
    ]);

    const context = { errors: [] };
    const output = await tasks.run(context);
    if (output.errors.length) {
        console.error(output.errors);
    }
};

const getEntriesDataFromRemote = async (model) => {
    const exportClient = new GraphQLClient(config.export.MANAGE_ENDPOINT, {
        headers: { Authorization: config.export.API_KEY },
    });
    let counter = 0;
    let cmsList;
    let entries = [];

    while (counter == 0 || cmsList.content.meta.hasMoreItems == true) {
        counter ++;
        cmsList = await exportClient.request(GQL.createListQuery(model), {after: cmsList?.content?.meta?.cursor});
        for(const entry of cmsList.content.data) {
            let entryResponse = await exportClient.request(GQL.createReadQuery(model),{revision: entry.id});
            entries.push(entryResponse.content.data);
            console.log(`Retrieved ${model.modelId} '${entry.id}' (${entryResponse.content.data?.name})`)
        }
    }

    return entries;
};

const importEntriesData = async (data) => {
    const importClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
    });

    // 2. Import content model groups
    const tasks = new Listr([
        {
            // Creates root package.json.
            title: "Import content model groups",
            task: async (ctx, task) => {
                // In case a group exists in the target system, we want to get the group ID.
                task.output = `Fetching content model groups from target system...`;
                const targetSystemData = await importClient.request(
                    GQL.LIST_CONTENT_MODELS_WITH_GROUPS
                );

                const targetSystemGroups = targetSystemData.listContentModelGroups.data;
                const groupsToImport = data.listContentModelGroups.data;

                ctx.groups = {};

                for (let i = 0; i < groupsToImport.length; i++) {
                    const group = groupsToImport[i];
                    task.output = `Creating "${group.name}"...`;

                    const existingGroup = targetSystemGroups.find((grp) => grp.slug === group.slug);
                    if (existingGroup) {
                        ctx.groups[group.id] = existingGroup.id;
                    } else {
                        const response = await importClient.request(
                            GQL.CREATE_CONTENT_MODEL_GROUP,
                            {
                                data: omit(group, ["id"]),
                            }
                        );

                        const { data, error } = response.createContentModelGroup;
                        if (data) {
                            ctx.groups[group.id] = data.id;
                        } else {
                            ctx.errors.push(error);
                        }
                    }
                }
            },
        },
        {
            title: "Import content models",
            task: async (ctx, task) => {
                const modelsToImport = data.listContentModels.data;
                for (let i = 0; i < modelsToImport.length; i++) {
                    // Create the model
                    const model = pick(modelsToImport[i], [
                        "name",
                        "modelId",
                        "group",
                        "description",
                    ]);

                    task.output = `Creating "${model.name}"...`;

                    model.group = ctx.groups[model.group.id];
                    const { createContentModel: create } = await importClient.request(
                        GQL.CREATE_CONTENT_MODEL,
                        {
                            data: model,
                        }
                    );

                    if (create.error) {
                        ctx.errors.push(create.error);
                        continue;
                    }

                    // Update with the rest of the model data
                    task.output = `Updating "${model.name}"...`;
                    const { updateContentModel: update } = await importClient.request(
                        GQL.UPDATE_CONTENT_MODEL,
                        {
                            modelId: model.modelId,
                            data: pick(modelsToImport[i], ["fields", "layout", "titleFieldId"]),
                        }
                    );

                    if (update.error) {
                        ctx.errors.push(update.error);
                    }
                }
            },
        },
    ]);

    const context = { errors: [] };
    const output = await tasks.run(context);
    if (output.errors.length) {
        console.error(output.errors);
    }
};

(async () => {
    inquirer
        .prompt([
            {
                message: "What do you want to do?",
                name: "mode",
                type: "list",
                choices: [
                    { name: "Copy models data from one system to another", value: "copy-models" },
                    { name: "Export models to local file", value: "export-models-to-file" },
                    { name: "Import models from local file", value: "import-models-from-file" },
                    { name: "Copy entries data from one system to another", value: "copy-entries" },
                    { name: "Export entries to local file", value: "export-entries-to-file" },
                    { name: "Import entries from local file", value: "import-entries-from-file" },
                ],
            },
        ])
        .then(async ({ mode }) => {
            switch (mode) {
                case "copy-models":
                    await importModelData(await getModelDataFromRemote());
                    break;
                case "export-models-to-file":
                    const modelDataFromRemote = await getModelDataFromRemote();
                    await writeJsonFile(path.resolve(config.export.TO_PATH + "/export-models.json"), modelDataFromRemote);
                    break;
                case "import-models-from-file":
                    try {
                        const modelDataFromFile = await loadJsonFile(config.import.FROM_PATH + "/export-models.json");
                        await importModelData(modelDataFromFile);
                    } catch (err) {
                        if (err.code === "ENOENT") {
                            console.log(
                                `ERROR: source file not found at "${config.import.FROM_PATH}!"`
                            );
                            process.exit(1);
                        }
                    }
                    break;
                case "copy-entries":
                    await importEntriesData(await getEntriesDataFromRemote());
                    break;
                case "export-entries-to-file":
                    let modalData = await getModelDataFromRemote();
                    console.log(modalData.listContentModels.data);

                    for(const model of modalData.listContentModels.data) {
                        const entriesDataFromRemote = await getEntriesDataFromRemote(model);
                        await writeJsonFile(path.resolve(config.export.TO_PATH + "/export-entries-" + model.modelId + ".json"), entriesDataFromRemote);
                    }
                    break;
                case "import-entries-from-file":
                    try {
                        const entriesDataFromFile = await loadJsonFile(config.import.FROM_PATH + "/export-entries.json");
                        await importEntriesData(entriesDataFromFile);
                    } catch (err) {
                        if (err.code === "ENOENT") {
                            console.log(
                                `ERROR: source file not found at "${config.import.FROM_PATH}!"`
                            );
                            process.exit(1);
                        }
                    }
                    break;
                default:
                    break;
            }

            console.log("Done!");
        })
        .catch((err) => {
            console.error(err);
        });
})();

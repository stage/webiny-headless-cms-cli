const path = require("path");
const fs = require('fs');
const omit = require("lodash/omit");
const pick = require("lodash/pick");
const { GraphQLClient } = require("graphql-request");
const writeJsonFile = require("write-json-file");
const loadJsonFile = require("load-json-file");
const Listr = require("listr");
const inquirer = require("inquirer");
const config = require("./config");
const GQL = require("./queries");
const { filter } = require("lodash");
const { count } = require("console");


const getModelDataFromRemoteExport = async () => {
    const exportClient = new GraphQLClient(config.export.MANAGE_ENDPOINT, {
        headers: { Authorization: config.export.API_KEY },
    });

    return await exportClient.request(GQL.LIST_CONTENT_MODELS_WITH_GROUPS);
};

const getModelDataFromRemoteImport = async () => {
    const exportClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
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

const getEntriesDataFromRemoteExport = async (model, filter = null) => {
    const exportClient = new GraphQLClient(config.export.MANAGE_ENDPOINT, {
        headers: { Authorization: config.export.API_KEY },
    });
    return getEntriesDataFromRemoteBase(exportClient, model, filter)
}

const getEntriesDataFromRemoteImport = async (model, filter = null) => {
    const importClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
    });
    return getEntriesDataFromRemoteBase(importClient, model, filter)
}

const getEntriesDataFromRemoteBase = async (client, model, filter = null) => {

    const tasks = new Listr([
        {
            title: `Export content entries for model '${model.modelId}'`,
            task: async (ctx, task) => {
                let counter = 0;
                let cmsList;
                let entries = [];

                while (counter == 0 || cmsList.content.meta.hasMoreItems == true) {
                    counter++;
                    cmsList = await client.request(GQL.createListQuery(model), { where: filter, after: cmsList?.content?.meta?.cursor, limit: 1000 });
                    entries = entries.concat(cmsList.content.data)
                    task.output = `Retrieved ${model.modelId} Batch ${counter} | Items: ${cmsList.content.data.length} of ${cmsList.content.meta.totalCount}`;
                }
                ctx.data = entries;
            }
        }]);

    const context = { errors: [], data: [] };
    const output = await tasks.run(context);
    if (output.errors.length) {
        console.error(output.errors);
        return;
    }
    return output.data;
};

const importEntriesData = async (data, model) => {
    const importClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
    });

    //TODO: Make this optional. It's used to determine if the import should update rather than create a new space. This won't scale well with a large number of entries.
    let remoteEntries = await getEntriesDataFromRemoteImport(model);

    //Import content entries 
    const tasks = new Listr([
        {
            title: `Import content entries for model '${model.modelId}'`,
            task: async (ctx, task) => {
                const entriesToImport = data;

                let funcs = [];
                for (let i = 0; i < entriesToImport.length; i++) {
                    funcs.push(async () => {

                        const entry = entriesToImport[i];
                        let publishEntry = (entry.meta.status == "published")

                        //Check if and entry already exists for this entryId.
                        let existingEntry = entry?.id ? remoteEntries.find(re => re.entryId == entry.id.substring(0, entry.id.indexOf("#"))) : null;
                        let newRevisionId;

                        if (existingEntry) {
                            //console.log("Entry already exists, creating a revision");

                            //Remove Properties that can't be when creating a new entry.
                            entry.id = undefined;
                            entry.entryId = undefined;
                            entry.createdBy = undefined;
                            entry.savedOn = undefined;
                            entry.meta = undefined;

                            //Creating a revision
                            let query = GQL.createCreateFromMutation(model);
                            try {
                                const createRevisionResponse = await importClient.request(
                                    query,
                                    {
                                        revision: existingEntry.id,
                                        data: entry,
                                    }
                                );

                                if (!createRevisionResponse) {
                                    ctx.errors.push(`Failed to create revision ${entry.name}`);
                                    anyErrors = true;
                                    return;
                                }
                                else if (createRevisionResponse.content.error) {
                                    ctx.errors.push(createRevisionResponse.content.error);
                                    anyErrors = true;
                                    return;
                                }

                                newRevisionId = createRevisionResponse.content.data.id;
                            }
                            catch (ex) {
                                ctx.errors.push(ex);
                                console.log(`Failed to create revision for '${existingEntry.id}'`)
                            }
                        } else {

                            // Create the Entry

                            //Remove Properties that can't be when creating a new entry.
                            entry.id = undefined;
                            entry.entryId = undefined;
                            entry.createdBy = undefined;
                            entry.savedOn = undefined;
                            entry.meta = undefined;

                            task.output = `Creating "${entry.name}"...`;
                            let query = GQL.createCreateMutation(model.modelId);
                            try {
                                const response = await importClient.request(
                                    query,
                                    {
                                        data: entry,
                                    }
                                );

                                if (!response) {
                                    ctx.errors.push(`Failed to create new entry ${entry.name}`);
                                    anyErrors = true;
                                    return;
                                }
                                else if (response.content.error) {
                                    ctx.errors.push(response.content.error);
                                    anyErrors = true;
                                    return;
                                }

                                newRevisionId = response.content.data.id;
                            }
                            catch (ex) {
                                ctx.errors.push(ex);
                                console.log(`Failed to create new entry '${entry.name}'`)
                            }
                        }

                        if (publishEntry && newRevisionId) {
                            // Publish the model if needed
                            task.output = `Publish "${entry.name}"... `;
                            let publishQuery = GQL.createPublishMutation(model.modelId);
                            const publishResponse = await importClient.request(
                                publishQuery,
                                {
                                    revision: newRevisionId,
                                }
                            );

                            if (publishResponse.content.error) {
                                ctx.errors.push(publishResponse.content.error);
                            }
                        }
                    });
                }
                while (funcs.length) {
                    // Run the functions in batches.
                    await Promise.all(funcs.splice(0, config.concurrency).map(f => f()))
                }
                task.output = `Importing done`;
            },
        },
    ]);

    const context = { errors: [] };
    const output = await tasks.run(context);
    if (output.errors.length) {
        console.error(output.errors);
    }
};

const deleteEntries = async (data, model) => {
    const importClient = new GraphQLClient(config.import.MANAGE_ENDPOINT, {
        headers: { Authorization: config.import.API_KEY },
    });


    //Delete content entries 
    const tasks = new Listr([
        {
            title: `Delete content entries for model '${model.modelId}'`,
            task: async (ctx, task) => {
                const entriesToDelete = data.filter(d => d.id != null)?.map(d => d.id);

                let funcs = [];
                for (let i = 0; i < entriesToDelete?.length; i++) {

                    funcs.push(async () => {
                        const id = entriesToDelete[i];
                        // Delete Entry
                        task.output = `Deleting "${id}"... `;
                        let publishQuery = GQL.createDeleteMutation(model);
                        try {
                            const deleteResponse = await importClient.request(
                                publishQuery,
                                {
                                    revision: id.substring(0, id.indexOf("#")),
                                }
                            );

                            if (deleteResponse.content.error) {
                                ctx.errors.push(deleteResponse.content.error);
                            }
                        }
                        catch (ex) {
                            ctx.errors.push(ex);
                            console.log(`Failed to delete '${id}'`)
                        }
                    });

                }

                while (funcs.length) {
                    // Run the functions in batches.
                    await Promise.all(funcs.splice(0, config.concurrency).map(f => f()))
                }
                task.output = `Deleting done`;
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
    try {
        const { mode } = await inquirer
            .prompt([
                {
                    message: "What do you want to do?",
                    name: "mode",
                    type: "list",
                    choices: [
                        { name: "Copy models data from one system to another", value: "copy-models" },
                        { name: "Export models to local file", value: "export-models-to-file" },
                        { name: "Import models from local file", value: "import-models-from-file" },
                        //{ name: "Copy entries data from one system to another", value: "copy-entries" },
                        { name: "Export entries to local file", value: "export-entries-to-file" },
                        { name: "Import entries from a local file", value: "import-entries-from-file" },
                        { name: "Delete entries specified in a local file", value: "delete-entries-from-file" },
                    ],
                },
            ]);

        switch (mode) {
            case "copy-models":
                await importModelData(await getModelDataFromRemoteExport());
                break;
            case "export-models-to-file":
                const modelDataFromRemote = await getModelDataFromRemoteExport();
                await writeJsonFile(path.resolve(config.export.TO_PATH + "/exported-models.json"), modelDataFromRemote);
                break;
            case "import-models-from-file":
                try {
                    const modelDataFromFile = await loadJsonFile(config.import.FROM_PATH + "/exported-models.json");
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
                let modalData = await getModelDataFromRemoteExport();
                const { entryTypeToExport } = await inquirer
                    .prompt([
                        {
                            message: "Which entries would you like to export?",
                            name: "entryTypeToExport",
                            type: "list",
                            choices: modalData.listContentModels.data.map(m => ({ name: m.name, value: m.modelId }))
                        },
                    ]);

                //Select Filter
                const filterDir = "filters";
                let tmpFiles = fs.readdirSync(filterDir);
                let filterChoices = [{ name: "None", value: null }];
                filterChoices = filterChoices.concat(tmpFiles.map(f => ({ name: f, value: f })));
                const { filterFile } = await inquirer
                    .prompt([
                        {
                            message: "Which filter would you like to apply?",
                            name: "filterFile",
                            type: "list",
                            choices: filterChoices
                        },
                    ]);

                let filter = null;
                if (filterFile) {
                    filter = await loadJsonFile(filterDir + "\\" + filterFile);
                }

                const model = modalData.listContentModels.data.find(m => m.modelId == entryTypeToExport);
                const entriesDataFromRemote = await getEntriesDataFromRemoteExport(model, filter);
                await writeJsonFile(path.resolve(config.export.TO_PATH + "/exported-entries." + model.modelId + ".json"), entriesDataFromRemote);

                break;
            case "import-entries-from-file":
                try {
                    let tmpFiles = fs.readdirSync(config.import.FROM_PATH)
                    const { fileToImport } = await inquirer
                        .prompt([
                            {
                                message: "Which file would you like to import?",
                                name: "fileToImport",
                                type: "list",
                                choices: tmpFiles.map(f => ({ name: f, value: f }))
                            },
                        ]);
                    let modalData = await getModelDataFromRemoteImport();
                    const { model } = await inquirer
                        .prompt([
                            {
                                message: "Which model?",
                                name: "model",
                                type: "list",
                                choices: modalData.listContentModels.data.map(m => ({ name: m.name, value: m }))
                            },
                        ]);

                    try {
                        const entriesDataFromFile = await loadJsonFile(config.export.TO_PATH + "/" + fileToImport);
                        await importEntriesData(entriesDataFromFile, model);
                    }
                    catch (ex) {
                        //console.log(`ERROR: model id does not exist on import CMS - ${ex.toString()}`)
                    }
                } catch (err) {
                    if (err.code === "ENOENT") {
                        console.log(
                            `ERROR: source file not found at "${config.import.FROM_PATH}!"`
                        );
                        process.exit(1);
                    }
                }
                break;
            case "delete-entries-from-file":
                {
                    let tmpFiles = fs.readdirSync(config.import.FROM_PATH)
                    const { fileToDelete } = await inquirer
                        .prompt([
                            {
                                message: "Which file has the id's of the entries you want to delete?",
                                name: "fileToDelete",
                                type: "list",
                                choices: tmpFiles.map(f => ({ name: f, value: f }))
                            },
                        ]);

                    let modalData = await getModelDataFromRemoteImport();
                    const { model } = await inquirer
                        .prompt([
                            {
                                message: "Which model?",
                                name: "model",
                                type: "list",
                                choices: modalData.listContentModels.data.map(m => ({ name: m.name, value: m }))
                            },
                        ]);

                    const entriesDataFromFile = await loadJsonFile(config.export.TO_PATH + "/" + fileToDelete);
                    await deleteEntries(entriesDataFromFile, model);
                }
            default:
                break;
        }

        console.log("Done!");
    } catch (err) {
        console.error(err);
    };
})();

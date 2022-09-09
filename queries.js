const gql = require("graphql-tag");
const upperFirst = require('lodash/upperFirst');
const pluralize = require('pluralize');

const LIST_CONTENT_MODELS_WITH_GROUPS = gql`
    {
        listContentModelGroups {
            data {
                id
                name
                icon
                slug
                description
            }
        }
        listContentModels {
            data {
                name
                modelId
                description
                group {
                    id
                }
                fields {
                    id
                    fieldId
                    label
                    helpText
                    placeholderText
                    type
                    multipleValues
                    predefinedValues {
                        enabled
                        values {
                            label
                            value
                        }
                    }
                    renderer {
                        name
                    }
                    validation {
                        name
                        message
                        settings
                    }
                    listValidation {
                        name
                        message
                        settings
                    }
                    settings
                }
                layout
                titleFieldId
            }
        }
    }
`;

const CREATE_CONTENT_MODEL_GROUP = gql`
    mutation CmsCreateContentModelGroup($data: CmsContentModelGroupInput!) {
        createContentModelGroup(data: $data) {
            data {
                id
            }
            error {
                code
                message
                data
            }
        }
    }
`;

const CREATE_CONTENT_MODEL = gql`
    mutation CmsCreateContentModel($data: CmsContentModelCreateInput!) {
        createContentModel(data: $data) {
            data {
                modelId
            }
            error {
                code
                message
                data
            }
        }
    }
`;

const UPDATE_CONTENT_MODEL = gql`
    mutation CmsUpdateContentModel($modelId: ID!, $data: CmsContentModelUpdateInput!) {
        updateContentModel(modelId: $modelId, data: $data) {
            data {
                modelId
            }
            error {
                code
                message
                data
            }
        }
    }
`;

const DELETE_CONTENT_MODEL = gql`
    mutation CmsDeleteContentModel($modelId: ID!) {
        deleteContentModel(modelId: $modelId) {
            data
            error {
                code
                message
                data
            }
        }
    }
`;

const ERROR_FIELD = /* GraphQL */ `
    {
        message
        code
        data
    }
`;

const CONTENT_META_FIELDS = /* GraphQL */ `
    title
    publishedOn
    version
    locked
    status
`;

const createReadQuery = (model) => {
    const ucFirstModelId = upperFirst(model.modelId);

    return gql`
        query CmsEntriesGet${ucFirstModelId}($revision: ID!) {
            content: get${ucFirstModelId}(revision: $revision) {
                data {
                    id
                    createdBy {
                        id
                    }
                    ${createFieldsList(model.fields)}
                    savedOn
                    meta {
                        ${CONTENT_META_FIELDS}
                    }
                }
                error ${ERROR_FIELD}
            }
        }
    `;
};

const createListQuery = (model) => {
    const ucFirstPluralizedModelId = upperFirst(pluralize(model.modelId));
    const ucFirstModelId = upperFirst(model.modelId);

    return gql`
        query CmsEntriesList${ucFirstPluralizedModelId}($where: ${ucFirstModelId}ListWhereInput, $sort: [${ucFirstModelId}ListSorter], $limit: Int, $after: String) {
            content: list${ucFirstPluralizedModelId}(
                where: $where
                sort: $sort
                limit: $limit
                after: $after
            ) {
                data {
                    id
                    entryId
                    createdBy {
                        id
                    }
                    savedOn
                    meta {
                        ${CONTENT_META_FIELDS}
                    }
                    ${createFieldsList(model.fields)}
                }
                meta {
                    cursor
                    hasMoreItems
                    totalCount
                }            
                error ${ERROR_FIELD}
            }
        }
    `;
};

const createCreateMutation = (modelId) => {
    const ucFirstModelId = upperFirst(modelId);

    return gql`
        mutation CmsEntriesCreate${ucFirstModelId}($data: ${ucFirstModelId}Input!) {
            content: create${ucFirstModelId}(data: $data) {
                data {
                    id
                    savedOn
                    meta {
                        ${CONTENT_META_FIELDS}
                    }
                }
                error ${ERROR_FIELD}
            }
        }
    `;
};

const createPublishMutation = (modelId) => {
    const ucFirstModelId = upperFirst(modelId);

    return gql`
        mutation CmsPublish${ucFirstModelId}($revision: ID!) {
            content: publish${ucFirstModelId}(revision: $revision) {
                data {
                    id
                    meta {
                        ${CONTENT_META_FIELDS}
                    }
                }
                error ${ERROR_FIELD}
            }
        }`;
};

function createFieldsList(fields) {
    return fields.map(field => {
        if (field.type == "ref") {
            return `${field.fieldId} {
                        id
                        modelId
                    }`;
        } else {
            return field.fieldId;
        }
    }).join("\n")

}

function createUpdateMutation(model) {
    const ucFirstModelId = upperFirst(model.modelId);

    return gql`
        mutation CmsUpdate${ucFirstModelId}($revision: ID!, $data: ${ucFirstModelId}Input!) {
            content: update${ucFirstModelId}(revision: $revision, data: $data) {
                data {
                    id
                    ${createFieldsList(model.fields)}
                    savedOn
                    meta { 
                        ${CONTENT_META_FIELDS} 
                    }
                }
                error ${ERROR_FIELD}
            }
        }
    `;
};

function createCreateFromMutation(model) {
    const ucFirstModelId = upperFirst(model.modelId);

    return gql`
        mutation CmsCreate${ucFirstModelId}From($revision: ID!, $data: ${ucFirstModelId}Input) {
            content: create${ucFirstModelId}From(revision: $revision, data: $data) {
                data {
                    id
                    savedOn
                    ${createFieldsList(model.fields)}
                    meta {
                        ${CONTENT_META_FIELDS}
                    }
                }
                error ${ERROR_FIELD}
            }
        }`;
};

function createDeleteMutation(model) {
    const ucFirstModelId = upperFirst(model.modelId);

    return gql`
        mutation CmsEntriesDelete${ucFirstModelId}($revision: ID!) {
            content: delete${ucFirstModelId}(revision: $revision) {
                data
                error ${ERROR_FIELD}
            }
        }
    `;
};

function getModelTitleFieldId(model) {
    if (!model.titleFieldId || model.titleFieldId === "id") {
        return "";
    }
    return model.titleFieldId;
};

module.exports = {
    CREATE_CONTENT_MODEL_GROUP,
    CREATE_CONTENT_MODEL,
    UPDATE_CONTENT_MODEL,
    DELETE_CONTENT_MODEL,
    LIST_CONTENT_MODELS_WITH_GROUPS,
    createListQuery,
    createReadQuery,
    createCreateMutation,
    createPublishMutation,
    createCreateFromMutation,
    createDeleteMutation,
    createUpdateMutation
};

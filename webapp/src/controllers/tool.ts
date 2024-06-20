'use strict';

import { dynamicResponse } from '@dr';
import { io } from '@socketio';
import { removeAgentsTool } from 'db/agent';
import { getAssetById } from 'db/asset';
import { getDatasourceById, getDatasourcesByTeam } from 'db/datasource';
import { addNotification } from 'db/notification';
import { addTool, deleteToolById, editTool, editToolUnsafe,getToolById, getToolsByTeam } from 'db/tool';
import debug from 'debug';
import FunctionProviderFactory from 'lib/function';
import getDotProp from 'lib/misc/getdotprop';
import * as redisClient from 'lib/redis/redis';
import toObjectId from 'misc/toobjectid';
import toSnakeCase from 'misc/tosnakecase';
import { ObjectId } from 'mongodb';
import { DatasourceStatus } from 'struct/datasource';
import { CollectionName } from 'struct/db';
import { runtimeValues } from 'struct/function';
import { NotificationDetails,NotificationType,WebhookType } from 'struct/notification';
import { Retriever, ToolState,ToolType, ToolTypes } from 'struct/tool';
import { chainValidations } from 'utils/validationUtils';
import { v4 as uuidv4 } from 'uuid';

const log = debug('webapp:controllers:tool');

export async function toolsData(req, res, _next) {
	const [tools, datasources] = await Promise.all([
		getToolsByTeam(req.params.resourceSlug),
		getDatasourcesByTeam(req.params.resourceSlug),
	]);
	return {
		csrf: req.csrfToken(),
		tools,
		datasources,
	};
}

/**
 * GET /[resourceSlug]/tools
 * tool page html
 */
export async function toolsPage(app, req, res, next) {
	const data = await toolsData(req, res, next);
	res.locals.data = { ...data, account: res.locals.account };
	return app.render(req, res, `/${req.params.resourceSlug}/tools`);
}

/**
 * GET /[resourceSlug]/tools.json
 * team tools json data
 */
export async function toolsJson(req, res, next) {
	const data = await toolsData(req, res, next);
	return res.json({ ...data, account: res.locals.account });
}

export async function toolData(req, res, _next) {
	const [tool, datasources] = await Promise.all([
		getToolById(req.params.resourceSlug, req.params.toolId),
		getDatasourcesByTeam(req.params.resourceSlug),
	]);
	return {
		csrf: req.csrfToken(),
		tool,
		datasources,
	};
}

/**
 * GET /[resourceSlug]/tool/:toolId.json
 * tool json data
 */
export async function toolJson(req, res, next) {
	const data = await toolsData(req, res, next);
	return res.json({ ...data, account: res.locals.account });
}

/**
 * GET /[resourceSlug]/tool/:toolId/edit
 * tool json data
 */
export async function toolEditPage(app, req, res, next) {
	const data = await toolData(req, res, next);
	res.locals.data = { ...data, account: res.locals.account };
	return app.render(req, res, `/${req.params.resourceSlug}/tool/${data.tool._id}/edit`);
}

/**
 * GET /[resourceSlug]/tool/add
 * tool json data
 */
export async function toolAddPage(app, req, res, next) {
	const data = await toolData(req, res, next);
	res.locals.data = { ...data, account: res.locals.account };
	return app.render(req, res, `/${req.params.resourceSlug}/tool/add`);
}

function validateTool(tool) {
	return chainValidations(tool, [
		{ field: 'name', validation: { notEmpty: true }},
		{ field: 'type', validation: { notEmpty: true, inSet: new Set(Object.values(ToolTypes))}},
		{ field: 'retriever', validation: { notEmpty: true, inSet: new Set(Object.values(Retriever))}},
		{ field: 'description', validation: { notEmpty: true, lengthMin: 2 }, validateIf: { field: 'type', condition: (value) => value === ToolType.RAG_TOOL }},
		{ field: 'datasourceId', validation: { notEmpty: true, hasLength: 24, customError: 'Invalid data sources' }, validateIf: { field: 'type', condition: (value) => value == ToolType.RAG_TOOL }},
		{ field: 'data.description', validation: { notEmpty: true }, validateIf: { field: 'type', condition: (value) => value !== ToolType.RAG_TOOL }},
		{ field: 'data.parameters', validation: { notEmpty: true }, validateIf: { field: 'type', condition: (value) => value !== ToolType.RAG_TOOL }},
		{ field: 'data.environmentVariables', validation: { notEmpty: true }, validateIf: { field: 'type', condition: (value) => value !== ToolType.RAG_TOOL }},
		{ field: 'schema', validation: { notEmpty: true }, validateIf: { field: 'type', condition: (value) => value == ToolType.API_TOOL }},
		{ field: 'naame', validation: { regexMatch: new RegExp('^[\\w_][A-Za-z0-9_]*$','gm'),
			customError: 'Name must not contain spaces or start with a number. Only alphanumeric and underscore characters allowed' },
		validateIf: { field: 'type', condition: (value) => value == ToolType.API_TOOL }},
		{ field: 'data.parameters.properties', validation: { objectHasKeys: true }, validateIf: { field: 'type', condition: (value) => value == ToolType.API_TOOL }},
		{ field: 'data.parameters.code', validation: { objectHasKeys: true }, validateIf: { field: 'type', condition: (value) => value == ToolType.FUNCTION_TOOL }},
	], {
		name: 'Name',
		retriever_type: 'Retrieval Strategy',
		type: 'Type',
		'data.builtin': 'Is built-in',
		'data.description': 'Description',
		'data.parameters': 'Parameters',
		'data.parameters.properties': '',
		'data.parameters.code': ''
	});
}

export async function addToolApi(req, res, next) {

	const { name, type, data, schema, datasourceId, description, iconId, retriever, retriever_config, runtime } = req.body;

	const validationError = validateTool(req.body); //TODO: reject if function tool type
	if (validationError) {
		return dynamicResponse(req, res, 400, { error: validationError });
	}

	if (datasourceId && (typeof datasourceId !== 'string' || datasourceId.length !== 24)) {
		const foundDatasource = await getDatasourceById(req.params.resourceSlug, datasourceId);
		if (!foundDatasource) {
			return dynamicResponse(req, res, 400, { error: 'Invalid datasource IDs' });
		}
	}

	if (runtime && (typeof runtime !== 'string' || !runtimeValues.includes(runtime))) {
		return dynamicResponse(req, res, 400, { error: 'Invalid runtime' });
	}

	const isFunctionTool = type as ToolType === ToolType.FUNCTION_TOOL;
	const foundIcon = await getAssetById(iconId);

	const toolData = {
		...data,
		builtin: false,
		name: (type as ToolType) === ToolType.API_TOOL
			? 'openapi_request'
			: ((type as ToolType) === ToolType.FUNCTION_TOOL
				? toSnakeCase(name)
				: name),
	};

	const functionId = isFunctionTool ? uuidv4() : null;
	const addedTool = await addTool({
		orgId: toObjectId(res.locals.matchingOrg.id),
		teamId: toObjectId(req.params.resourceSlug),
	    name,
	    description,
	 	type: type as ToolType,
		datasourceId: toObjectId(datasourceId),
	 	retriever_type: retriever || null,
	 	retriever_config: retriever_config || {}, //TODO: validation
	 	schema: schema,
		data: toolData,
		icon: foundIcon ? {
			id: foundIcon._id,
			filename: foundIcon.filename,
		} : null,
		state: isFunctionTool ? ToolState.PENDING : ToolState.READY, //other tool types are always "ready" (for now)
		functionId,
	});

	if (!addedTool?.insertedId) {
		return dynamicResponse(req, res, 400, { error: 'Error inserting tool into database' });
	}

	if (isFunctionTool) {
		const functionProvider = FunctionProviderFactory.getFunctionProvider();
		try {
			functionProvider.deployFunction({
				code: toolData?.code,
				requirements: toolData?.requirements,
				environmentVariables: toolData?.environmentVariables,
				id: functionId,
				runtime,
			}).then(() => {
				/* Waits for the function to be active (asynchronously)
				 * TODO: turn this into a job thats sent to bull and handled elsewhere
				 * to prevent issues of ephemeral webapp pods leaving functions in "pending" state
				 */
				functionProvider.waitForFunctionToBeActive(functionId)
					.then(async isActive => {
						log('addToolApi functionId %s isActive %O', functionId, isActive);
						const logs = await functionProvider.getFunctionLogs(functionId).catch(e => { log(e); });
						const editedRes = await editToolUnsafe({
							_id: toObjectId(addedTool?.insertedId),
							teamId: toObjectId(req.params.resourceSlug),
							functionId,
							type: ToolType.FUNCTION_TOOL,
						}, {
							state: isActive ? ToolState.READY : ToolState.ERROR,
							...(!isActive && logs ? { functionLogs: logs } : {}),
						});
						if (editedRes.modifiedCount === 0) {
							/* If there were multiple current depoyments and this one happened out of order (late)
							  delete the function to not leave it orphaned*/
							log('Deleting and returning to prevent orphan functionId %s', functionId);
							return functionProvider.deleteFunction(functionId);
						} else if (!isActive) {
							// Delete the broken function
							log('Deleting broken functionId %s', functionId);
							functionProvider.deleteFunction(functionId);
						}
						const notification = {
						    orgId: toObjectId(res.locals.matchingOrg.id),
						    teamId: toObjectId(req.params.resourceSlug),
						    target: {
								id: addedTool?.insertedId.toString(),
								collection: CollectionName.Tools,
								property: '_id',
								objectId: true,
						    },
						    title: 'Tool Deployment',
						    date: new Date(),
						    seen: false,
							// stuff specific to notification type
						    description: `Custom code tool "${name}" ${isActive ? 'deployed successfully' : 'failed to deploy'}.`,
							type: NotificationType.Tool,
							details: {
								// TODO: if possible in future include the failure reason/error logs in here, and attach to the tool as well
							} as NotificationDetails,
						};
						await addNotification(notification);
						io.to(req.params.resourceSlug).emit('notification', notification);
					}).catch(e => {
						log('An error occurred while async deplopying function %s, %O', functionId, e);
					});
			});
		} catch (e) {
			console.error(e);
			// logging warnings only
			functionProvider.deleteFunction(functionId).catch(e => console.warn(e));
			editTool(req.params.resourceSlug, addedTool?.insertedId, { state: ToolState.ERROR }).catch(e => console.warn(e));
			return dynamicResponse(req, res, 400, { error: 'Error deploying or testing function' });
		}
	}

	return dynamicResponse(req, res, 302, { _id: addedTool.insertedId, redirect: `/${req.params.resourceSlug}/tools` });

}

export async function editToolApi(req, res, next) {

	const { name, type, data, toolId, schema, description, datasourceId, retriever, retriever_config, runtime }  = req.body;

	const validationError = validateTool(req.body); //TODO: reject if function tool type
	if (validationError) {
		return dynamicResponse(req, res, 400, { error: validationError });
	}

	if (datasourceId && (typeof datasourceId !== 'string' || datasourceId.length !== 24)) {
		const foundDatasource = await getDatasourceById(req.params.resourceSlug, datasourceId);
		if (!foundDatasource) {
			return dynamicResponse(req, res, 400, { error: 'Invalid datasource IDs' });
		}
	}

	const existingTool = await getToolById(req.params.resourceSlug, toolId);
	if (!existingTool) {
		return dynamicResponse(req, res, 400, { error: 'Invalid toolId' });
	}
	
	const isFunctionTool = type as ToolType === ToolType.FUNCTION_TOOL;

	//Check if any keys that are used by the cloud function have changed
	const functionNeedsUpdate = [
		'data.environmentVariables',
		'data.code',
		'data.requirements',
		'runtime'
	].some(k => getDotProp(req.body, k) !== getDotProp(existingTool, k));
	
	const toolData = {
		...data,
		builtin: false,
		name: (type as ToolType) === ToolType.API_TOOL
			? 'openapi_request'
			: ((type as ToolType) === ToolType.FUNCTION_TOOL
				? toSnakeCase(name)
				: name),
	};
	await editTool(req.params.resourceSlug, toolId, {
	    name,
	 	type: type as ToolType,
	    description,
	 	schema: schema,
	 	datasourceId: toObjectId(datasourceId),
	 	retriever_type: retriever || null,
	 	retriever_config: retriever_config || {}, //TODO: validation
		data: toolData,
		state: isFunctionTool
			? ToolState.PENDING
			: ToolState.READY,
	});

	//TODO: only run these checks if changes were made that affect the deployed function
	let functionProvider;
	if (existingTool.type as ToolType === ToolType.FUNCTION_TOOL && type as ToolType !== ToolType.FUNCTION_TOOL) {
		functionProvider = FunctionProviderFactory.getFunctionProvider();
		await functionProvider.deleteFunction(existingTool.functionId);
	} else if (type as ToolType === ToolType.FUNCTION_TOOL && functionNeedsUpdate) {
		!functionProvider && (functionProvider = FunctionProviderFactory.getFunctionProvider());
		const functionId = uuidv4();
		try {
			functionProvider.deployFunction({
				code: toolData?.code,
				requirements: toolData?.requirements,
				environmentVariables: toolData?.environmentVariables,
				id: functionId,
				runtime,
			}).then(() => {
				/* Waits for the function to be active (asynchronously)
				 * TODO: turn this into a job thats sent to bull and handled elsewhere
				 * to prevent issues of ephemeral webapp pods leaving functions in "pending" state
				 */
				functionProvider.waitForFunctionToBeActive(functionId)
					.then(async isActive => {
						log('editToolApi functionId %s isActive %O', functionId, isActive);
						const logs = await functionProvider.getFunctionLogs(functionId).catch(e => { log(e); });
						const editedRes = await editToolUnsafe({
							_id: toObjectId(toolId),
							teamId: toObjectId(req.params.resourceSlug),
							state: ToolState.PENDING,
							//functionId: ...
							type: ToolType.FUNCTION_TOOL, // Note: filter to only function tool so if they change the TYPE while its deploying we discard and delete the function to prevent orphan
						}, {
							state: isActive ? ToolState.READY : ToolState.ERROR,
							...(isActive ? { functionId } : {}), //overwrite functionId to new ID if it was successful
							...(!isActive && logs ? { functionLogs: logs } : {}),
						});
						if (editedRes.modifiedCount === 0) {
							/* If there were multiple current depoyments and this one happened out of order (late)
							  delete the function to not leave it orphaned*/
							log('Deleting and returning to prevent orphan functionId %s', functionId);
							return functionProvider.deleteFunction(functionId);
						}
						const notification = {
						    orgId: toObjectId(existingTool.orgId.toString()),
						    teamId: toObjectId(existingTool.teamId.toString()),
						    target: {
								id: existingTool._id.toString(),
								collection: CollectionName.Tools,
								property: '_id',
								objectId: true,
						    },
						    title: 'Tool Deployment',
						    date: new Date(),
						    seen: false,
							// stuff specific to notification type
						    description: `Custom code tool "${name}" ${isActive ? 'deployed successfully' : 'failed to deploy'}.`,
							type: NotificationType.Tool,
							details: {
								// TODO: if possible in future include the failure reason/error logs in here, and attach to the tool as well
							} as NotificationDetails,
						};
						await addNotification(notification);
						io.to(req.params.resourceSlug).emit('notification', notification);
						if (!isActive) {
							// Delete the new broken function
							functionProvider.deleteFunction(functionId);
							log('Deleting new broken functionId %s', functionId);
						}
						if (isActive && existingTool?.functionId) {
							//Delete the old function with old functionid
							log('Deleting function with old functionId %s', functionId);
							functionProvider.deleteFunction(existingTool.functionId);
						}
					}).catch(e => {
						log('An error occurred while async deplopying function %s, %O', functionId, e);
					});
			});
		} catch (e) {
			console.error(e);
			// logging warnings only
			functionProvider.deleteFunction(functionId).catch(e => console.warn(e));
			editTool(req.params.resourceSlug, toolId, { state: ToolState.ERROR }).catch(e => console.warn(e));
			return dynamicResponse(req, res, 400, { error: 'Error deploying or testing function' });
		}
	}

	return dynamicResponse(req, res, 302, { redirect: `/${req.params.resourceSlug}/tools` });

}

/**
 * @api {delete} /forms/tool/[toolId] Delete a tool
 * @apiName delete
 * @apiGroup Tool
 *
 * @apiParam {String} toolID tool id
 */
export async function deleteToolApi(req, res, next) {
	const { toolId } = req.body;

	if (!toolId || typeof toolId !== 'string' || toolId.length !== 24) {
		return dynamicResponse(req, res, 400, { error: 'Invalid inputs' });
	}

	const existingTool = await getToolById(req.params.resourceSlug, toolId);

	if (!existingTool) {
		return dynamicResponse(req, res, 404, { error: 'Tool not found' });
	}

	if (existingTool.type as ToolType === ToolType.FUNCTION_TOOL) {
		const functionProvider = FunctionProviderFactory.getFunctionProvider();
		await functionProvider.deleteFunction(existingTool?.functionId);
	}

	await Promise.all([
		deleteToolById(req.params.resourceSlug, toolId),
		removeAgentsTool(req.params.resourceSlug, toolId),
	]);

	return dynamicResponse(req, res, 302, { /*redirect: `/${req.params.resourceSlug}/agents`*/ });
}

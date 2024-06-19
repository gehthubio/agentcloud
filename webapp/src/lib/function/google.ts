import { Storage } from '@google-cloud/storage';
import archiver from 'archiver';
import debug from 'debug';
import { StandardRequirements,WrapToolCode } from 'function/base';
import StorageProviderFactory from 'lib/storage';
import { Readable } from 'stream';
import { DeployFunctionArgs } from 'struct/function';

import FunctionProvider from './provider';

const log = debug('webapp:function:google');

class GoogleFunctionProvider extends FunctionProvider {
	#storageProvider: any;
	#functionsClient: any;
	#projectId: string;
	#location: string;
	#bucket: string;

	constructor() {
		super();
		this.#storageProvider = StorageProviderFactory.getStorageProvider('google');
	}

	async init() {
		await this.#storageProvider.init();
		const { FunctionServiceClient } = require('@google-cloud/functions').v2;
		this.#functionsClient = new FunctionServiceClient();
		this.#projectId = process.env.PROJECT_ID;
		this.#location = process.env.GOOGLE_FUNCTION_LOCATION;
		this.#bucket = process.env.NEXT_PUBLIC_GCS_BUCKET_NAME;
		log('Google Function Provider initialized.');
	}

	async deployFunction({ id, code, requirements, runtime = 'python310', environmentVariables = {} }: DeployFunctionArgs): Promise<string> {
		const functionPath = `functions/${id}`;
		const codeBuffer = Buffer.from(WrapToolCode(code));
		const requirementsBuffer = Buffer.from(`${requirements}\n${StandardRequirements.join('\n')}`);

		// Create a ZIP file
		const archive = archiver('zip', { zlib: { level: 9 } });
		const zipChunks: Buffer[] = [];
		archive.on('data', chunk => zipChunks.push(chunk));

		archive.append(Readable.from(codeBuffer), { name: 'main.py' });
		archive.append(Readable.from(requirementsBuffer), { name: 'requirements.txt' });
		await archive.finalize();

		const zipBuffer = Buffer.concat(zipChunks);

		// Upload the ZIP file to GCS
		await this.#storageProvider.uploadBuffer(`${functionPath}/function.zip`, zipBuffer, 'application/zip');

		// Construct the fully qualified location
		const location = `projects/${this.#projectId}/locations/${this.#location}`;
		const functionName = `${location}/functions/function-${id}`;

		// Check if the function exists
		let functionExists = false;
		try {
			await this.#functionsClient.getFunction({ name: functionName });
			functionExists = true;
		} catch (err) {
			if (err.code !== 5) { // 5 means NOT_FOUND
				log(err);
				throw err;
			}
		}

		// Deploy the function
		const request: any = {
			function: {
				name: functionName,
				buildConfig: {
					runtime, // TODO: allow user to select
					entryPoint: 'hello_http', // Note: see functions/base.ts to understand why this is hello_http
					source: {
						storageSource: {
							bucket: this.#bucket,
							object: `${functionPath}/function.zip`,
						},
					},
					...(Object.keys(environmentVariables).length > 0 ? { environmentVariables } : {}),
				},
				serviceConfig: {
					availableMemory: '256M', // TODO: allow user to configure
					timeoutSeconds: 60, // TODO: allow user to configure
					// ingressSettings: 'ALLOW_ALL',
					...(Object.keys(environmentVariables).length > 0 ? { environmentVariables } : {}),
				},
				environment: 'GEN_2',
			},
			parent: `projects/${this.#projectId}/locations/${this.#location}`,	
			functionId: `function-${id}`,
		};

		try {
			let response;
			if (functionExists) {
				[response] = await this.#functionsClient.updateFunction(request);
				log(`Function updated successfully: ${functionName}`);
			} else {
				request.location = location;
				[response] = await this.#functionsClient.createFunction(request);
				log(`Function created successfully: ${functionName}`);
			}
		} catch (e) {
			log(JSON.stringify(e, null, 2));
			throw e;
		}

		return functionName;
	}

	async deleteFunction(functionId: string) {
		const functionName = `projects/${this.#projectId}/locations/${this.#location}/functions/function-${functionId}`;
		try {
			await this.#functionsClient.deleteFunction({ name: functionName });
			log(`Function deleted successfully: ${functionName}`);
		} catch (err) {
			log(err);
			throw err;
		}
	}

	async getFunctionState(functionId: string): Promise<string> {
		const functionName = `projects/${this.#projectId}/locations/${this.#location}/functions/function-${functionId}`;
		try {
			const [response] = await this.#functionsClient.getFunction({ name: functionName });
			return response.state;
		} catch (err) {
			log(err);
			return 'ERROR';
		}
	}

	async waitForFunctionToBeActive(functionId: string, maxWaitTime = 180000): Promise<boolean> {
		log('In waitForFunctionToBeActive loop for ID: %s', functionId);
		const startTime = Date.now();
		let waitTime = 5000; // Start with 5 seconds
	
		while (Date.now() - startTime < maxWaitTime) {
			const functionState = await this.getFunctionState(functionId);
			if (functionState === 'ACTIVE') {
				return true;
			} else if (functionState !== 'DEPLOYING') {
				return false; //Short circuit if it enters a state other than pending and isnt active
			}
			log('In waitForFunctionToBeActive loop for ID: %s, waiting %dms', functionId, waitTime);
			await new Promise(resolve => setTimeout(resolve, waitTime));
			waitTime = Math.min(waitTime * 2, 60000); // Exponential backoff up to 1 minute
		}
	
		return false;
	}

	async callFunction(functionName: string, body: object) {
		const url = `https://${this.#location}-${this.#projectId}.cloudfunctions.net/${functionName}`;
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body)
			});
			const responseData = await response.json();
			return responseData;
		} catch (error) {
			log(error);
			throw error;
		}
	}

}

export default new GoogleFunctionProvider();


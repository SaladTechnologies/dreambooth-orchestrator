import { Env, UploadDownloadParams } from './types';
import { error } from './utils/error';

export async function validateAuth(req: Request, env: Env) {
	const auth = req.headers.get(env.API_HEADER);
	if (!auth) {
		return error(401, { error: 'Unauthorized', message: 'API Key required'});
	}
	let token = await env.USER_TOKENS.get(auth)
	if (!token) {
		return error(403, { error: 'Forbidden', message: 'Invalid API Key' });
	}
	/**
	 * TODO: Implement any further access controls here
	 */

	return;
}

export async function validateUploadToken(req: Request & UploadDownloadParams, env: Env, ctx: any) {
	const token = req.headers.get('X-Upload-Token');
	if (!token) {
		return error(401, { error: 'Unauthorized', message: 'Upload Token required' });
	}
	const { bucket: bucketName, key } = req;
	if (!key || !bucketName) {
		return error(400, { error: 'Bad Request, bucket and key are required' });
	}
	const valid = await env.UPLOAD_TOKENS.get(token);
	if (!valid) {
		return error(401, { error: 'Unauthorized', message: 'Invalid Upload Token'});
	}
	const [bucket, expectedKey] = valid.split(':');
	if (bucket !== bucketName || expectedKey !== key) {
		return error(403, { error: 'Forbidden', message: 'Invalid Upload Token' });
	}
	return;
}

export async function validateDownloadToken(req: Request & UploadDownloadParams, env: Env, ctx: any) {
	const token = req.headers.get('X-Download-Token');
	if (!token) {
		return error(401, { error: 'Unauthorized', message: 'Download Token required'});
	}
	const { bucket: bucketName, key } = req;
	if (!key || !bucketName) {
		return error(400, { error: 'Bad Request', message: 'Bucket and key are required'});
	}
	const valid = await env.DOWNLOAD_TOKENS.get(token);
	if (!valid) {
		return error(401, { error: 'Unauthorized', message: 'Invalid Download Token'});
	}
	const [bucket, expectedKey] = valid.split(':');
	if (bucket !== bucketName || expectedKey !== key) {
		return error(403, { error: 'Forbidden', message: 'Invalid Download Token'});
	}
	await env.DOWNLOAD_TOKENS.delete(token);
	return;
}

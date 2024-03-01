import {  OpenAPIRoute, Query, Path, Str, } from '@cloudflare/itty-router-openapi';
import { Env } from '../types';
import { getBucket } from '../utils/buckets';
import { error } from '../utils/error';

export class GetDownloadToken extends OpenAPIRoute {
	static schema = {
		summary: 'Get Download Token',
		description: 'Get a token to download a file',
		parameters: {
			key: Query(String, { description: 'Object Key', required: true }),
			bucket: Query(String, { description: 'Bucket Name', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: { token: String }
			},
			'400': {
				description: 'Bad Request',
				schema: {
					error: String
				}
			},
		},
	};

	async handle(request: Request, env: Env, context: any, data: any) {
		const { key, bucket } = data.query;
		const token = crypto.randomUUID();
		await env.DOWNLOAD_TOKENS.put(token, `${bucket}:${key}`, { expirationTtl: 60 * 5 });
		return { token };
	}
}

export class DownloadFile extends OpenAPIRoute {
	static schema = {
		summary: 'Download File',
		description: 'Download a file',
		parameters: {
			key: Path(String, { description: 'Object Key', required: true }),
			bucket: Path(String, { description: 'Bucket Name', required: true }),
		},
		responses: {
			'200': {
				description: 'File Contents',
				contentType: 'application/octet-stream',
				schema: new Str({format: 'binary'})
			},
			'404': {
				description: 'Not Found',
				schema: {
					error: String
				}
			},
		},
	};

	async handle(request: Request, env: Env, context: any, data: any) {
		const { bucket: bucketName, key } = data.params;
		const bucket = getBucket(env, bucketName);
		if (bucket === null) {
			return error(404, { error: 'Bucket Not Found' })
		}
		const object = await bucket.get(key);
		if (!object) {
			return error(404, { error: 'Object Not Found' });
		}
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		return new Response(object.body, { headers });
	}
}

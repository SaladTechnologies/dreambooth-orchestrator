import { OpenAPIRoute, Query, Path, Enumeration, Int } from '@cloudflare/itty-router-openapi';

import { Env} from '../types';
import crypto from 'node:crypto';
import { getBucket } from '../utils/buckets';
import { error } from '../utils/error';

export class GetUploadToken extends OpenAPIRoute {
	static schema = {
		summary: 'Get Upload Token',
		description: 'Get a token to upload a file',
		parameters: {
			key: Query(String, { description: 'Object Key', required: true }),
			bucket: Query(String, { description: 'Bucket Name', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: { token: String },
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
		await env.UPLOAD_TOKENS.put(token, `${bucket}:${key}`, { expirationTtl: 60 * 15 });
		return { token };
	}
}

export class CreateOrCompleteUpload extends OpenAPIRoute {
	static schema = {
		summary: 'Create or Complete Upload',
		description: 'Create or complete a multipart upload',
		parameters: {
			key: Path(String, { description: 'Object Key', required: true }),
			bucket: Path(String, { description: 'Bucket Name', required: true }),
			action: Query(
				new Enumeration({
					description: 'Upload Action',
					values: ['mpu-create', 'mpu-complete'],
					enumCaseSensitive: false,
					required: true,
				})
			),
			uploadId: Query(String, { description: 'Upload ID', required: false }),
		},
		responses: {
			'200': {
				description: 'OK',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								key: {
									type: 'string',
								},
								uploadId: {
									type: 'string',
								},
							},
						},
					},
				},
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
		const { bucket, key } = data.params;
		const { action } = data.query;
		const bucketObj = getBucket(env, bucket);
		if (bucketObj === null) {
			return error(400, { error: 'Invalid bucket' });
		}

		switch (action) {
			case 'mpu-create': {
				try {
					const multipartUpload = await bucketObj.createMultipartUpload(key);
					return {
						key: multipartUpload.key,
						uploadId: multipartUpload.uploadId,
					};
				} catch (e: any) {
					return error(400, { error: e.message });
				}
			}
			case 'mpu-complete': {
				const uploadId = data.query.uploadId;
				if (uploadId === undefined) {
					return error(400, { error: 'Missing uploadId' });
				}
				try {
					const multipartUpload = bucketObj.resumeMultipartUpload(key, uploadId);
					const body = (await request.json()) as { parts: R2UploadedPart[] } | null;
					if (body === null) {
						return error(400, { error: 'Missing request body' });
					}
					const object = await multipartUpload.complete(body.parts);
					return new Response(null, {
						headers: {
							etag: object.httpEtag,
						},
					});
				} catch (e: any) {
					return error(400, { error: e.message });
				}
			}
			default:
				return error(400, { error: 'Invalid action type' });
		}
	}
}

export class UploadPart extends OpenAPIRoute {
	static schema = {
		summary: 'Upload Part',
		description: 'Upload a part of a multipart upload',
		parameters: {
			key: Path(String, { description: 'Object Key', required: true }),
			bucket: Path(String, { description: 'Bucket Name', required: true }),
			uploadId: Query(String, { description: 'Upload ID', required: true }),
			partNumber: Query(Int, { description: 'Part Number', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: {
					etag: String,
					partNumber: new Int(),
				}
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
		const { bucket, key } = data.params;
		const { uploadId, partNumber } = data.query;
		const bucketObj = getBucket(env, bucket);
		if (bucketObj === null) {
			return error(400, { error: 'Invalid bucket' });
		}
		if (request.body === null) {
			return error(400, { error: 'Missing request body' });
		}

		try {
			const multipartUpload = bucketObj.resumeMultipartUpload(key, uploadId);
			const uploadedPart: R2UploadedPart = await multipartUpload.uploadPart(partNumber, request.body);
			return uploadedPart;
		} catch (e: any) {
			return error(400, { error: e.message });
		}
	}
}

export class AbortOrDeleteUpload extends OpenAPIRoute {
	static schema = {
		summary: 'Abort or Delete Upload',
		description: 'Abort or delete a multipart upload',
		parameters: {
			key: Path(String, { description: 'Object Key', required: true }),
			bucket: Path(String, { description: 'Bucket Name', required: true }),
			action: Query(
				new Enumeration({
					description: 'Upload Action',
					values: ['mpu-abort', 'delete'],
					enumCaseSensitive: false,
					required: true,
				})
			),
			uploadId: Query(String, { description: 'Upload ID', required: false }),
		},
		responses: {
			'204': {
				description: 'No Content',
			},
			'400': {
				description: 'Bad Request',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								error: {
									type: 'string',
								},
							},
						},
					},
				},
			},
		},
	};

	async handle(request: Request, env: Env, context: any, data: any) {
		const { bucket, key } = data.params;
		const { action, uploadId } = data.query;
		const bucketObj = getBucket(env, bucket);
		if (bucketObj === null) {
			return error(400, { error: 'Invalid bucket' });
		}

		switch (action) {
			case 'mpu-abort': {
				if (!uploadId) {
					return error(400, { error: 'Missing uploadId' });
				}
				try {
					const multipartUpload = bucketObj.resumeMultipartUpload(key, uploadId);
					await multipartUpload.abort();
					return new Response(null, { status: 204 });
				} catch (e: any) {
					return error(400, { error: e.message });
				}
			}
			case 'delete': {
				await bucketObj.delete(key);
				return new Response(null, { status: 204 });
			}
			default:
				return error(400, { error: 'Invalid action type' });
		}
	}
}

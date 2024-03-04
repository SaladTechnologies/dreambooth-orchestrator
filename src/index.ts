import { OpenAPIRouter, OpenAPIRoute } from '@cloudflare/itty-router-openapi';
import { CreateJob, GetJobById, GetWork, JobHeartbeat, JobCompleteHandler, JobFailedHandler, JobProgressHandler, StopJobById } from './routes/jobs';
import { GetUploadToken, CreateOrCompleteUpload, UploadPart, AbortOrDeleteUpload } from './routes/uploads';
import { GetDownloadToken, DownloadFile } from './routes/downloads';
import { ListEventsForJob } from './routes/events';
import { validateAuth, validateDownloadToken, validateUploadToken } from './middleware';
import { Env } from './types';
import { withParams } from 'itty-router'

const router = OpenAPIRouter({
	schema: {
		info: {
			title: 'SDXL Dreambooth LoRA API',
			description: 'API for running SDXL Dreambooth LoRA training jobs.',
			version: '0.1.0',
		}
	}
});

router.all('*', validateAuth);
router.all('*', withParams);

router.post('/job', CreateJob);
router.get('/job/:id', GetJobById);
router.post('/job/:id/stop', StopJobById);
router.get('/job/:id/events', ListEventsForJob);

router.get('/work', GetWork);

router.post('/heartbeat/:id', JobHeartbeat);
router.post('/progress', JobProgressHandler);
router.post('/complete', JobCompleteHandler);
router.post('/fail', JobFailedHandler);

router.get('/upload/token', GetUploadToken);
router.post('/upload/:bucket/:key+', validateUploadToken, CreateOrCompleteUpload);
router.put('/upload/:bucket/:key+', validateUploadToken, UploadPart);
router.delete('/upload/:bucket/:key+', validateUploadToken, AbortOrDeleteUpload);

router.get('/download/token', GetDownloadToken);
router.get('/download/:bucket/:key+', validateDownloadToken, DownloadFile);


class CatchAll extends OpenAPIRoute {
	static schema = {
		summary: 'Catch All',
		description: 'Catch all for unmatched routes',
		responses: {
			'404': {
				description: 'Not Found',
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

	async handle(request: Request, env: Env) {
		return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
	}
}

router.all('*', CatchAll);

export default {
	fetch: router.handle,
};

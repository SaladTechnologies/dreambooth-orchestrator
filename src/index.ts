import { OpenAPIRouter, OpenAPIRoute } from '@cloudflare/itty-router-openapi';
import {
	CreateJob,
	GetJobById,
	GetWork,
	JobHeartbeat,
	JobCompleteHandler,
	JobFailedHandler,
	JobProgressHandler,
	StopJobById,
	ListJobs,
	PeekWork,
} from './routes/jobs';
import { GetUploadToken, CreateOrCompleteUpload, UploadPart, AbortOrDeleteUpload } from './routes/uploads';
import { GetDownloadToken, DownloadFile } from './routes/downloads';
import { ListEventsForJob } from './routes/events';
import { validateAuth, validateDownloadToken, validateUploadToken } from './middleware';
import { Env } from './types';
import { withParams, createCors } from 'itty-router';

const router = OpenAPIRouter({
	schema: {
		info: {
			title: 'SDXL Dreambooth LoRA API',
			description: 'API for running SDXL Dreambooth LoRA training jobs.',
			version: '0.2.0',
		},
	},
});
const { preflight, corsify } = createCors({
	methods: ['GET', 'POST', 'PUT', 'DELETE'],
})

router.all('*', preflight);
router.all('*', validateAuth);
router.all('*', withParams);

router.post('/job', CreateJob);
router.get('/jobs', ListJobs);
router.get('/job/:id', GetJobById);
router.post('/job/:id/stop', StopJobById);
router.get('/job/:id/events', ListEventsForJob);

router.get('/work', GetWork);
router.get('/work/peek', PeekWork);

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
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env) {
		return new Response(JSON.stringify({ error: 'Route Not Found' }), { status: 404 });
	}
}

router.all('*', CatchAll);

export default {
	fetch: async (request: Request, env: Env, ctx: any) => {
		return router.handle(request, env, ctx).then(corsify);
	}
};

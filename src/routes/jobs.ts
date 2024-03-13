import { OpenAPIRoute, Str, Int, Num, Bool, Enumeration, Uuid, DateTime, Path, Query } from '@cloudflare/itty-router-openapi';
import { Env, TrainingStatusWebhook } from '../types';
import {
	createNewJob,
	getJob,
	getHighestPriorityJob,
	updateJobStatus,
	updateJobHeartbeat,
	markJobComplete,
	listAllJobs,
	listJobsWithStatus,
	incrementFailedAttempts,
	getFailedAttempts,
} from '../utils/db';
import { sortBucketObjectsByDateDesc } from '../utils/buckets';
import { error } from '../utils/error';

const CreateJobSchema = {
	instance_prompt: new Str({ description: 'Instance Prompt', required: true }),
	class_prompt: new Str({ description: 'Class Prompt', required: false }),
	max_train_steps: new Int({ description: 'Max Training Steps', default: 500, required: false }),
	train_batch_size: new Int({ description: 'Train Batch Size', default: 1, required: false }),
	learning_rate: new Num({ description: 'Learning Rate', default: 0.000002, required: false }),
	use_8bit_adam: new Bool({ description: 'Use 8bit Adam', default: false, required: false }),
	mixed_precision: new Enumeration({
		description: 'Mixed Precision',
		values: ['no', 'fp16', 'bf16'],
		default: 'fp16',
		enumCaseSensitive: false,
		required: false,
	}),
	resolution: new Int({ description: 'Training Image Resolution', default: 1024, required: false }),
	gradient_accumulation_steps: new Int({ description: 'Gradient Accumulation Steps', default: 4, required: false }),
	lr_scheduler: new Enumeration({
		description: 'Learning Rate Scheduler',
		values: ['linear', 'cosine', 'cosine_with_restarts', 'polynomial', 'constant', 'constant_with_warmup'],
		default: 'constant',
		enumCaseSensitive: false,
		required: false,
	}),
	lr_warmup_steps: new Int({ description: 'Learning Rate Warmup Steps', default: 0, required: false }),
	train_text_encoder: new Bool({ description: 'Train Text Encoder', default: true, required: false }),
	gradient_checkpointing: new Bool({ description: 'Gradient Checkpointing', default: false, required: false }),
	with_prior_preservation: new Bool({ description: 'With Prior Preservation', default: false, required: false }),
	prior_loss_weight: new Num({ description: 'Prior Loss Weight', default: 1.0, required: false }),
	validation_prompt: new Str({ description: 'Validation Prompt', required: false }),
	validation_epochs: new Int({ description: 'Validation Epochs', default: 50, required: false }),
	checkpointing_steps: new Int({ description: 'Checkpointing Steps', default: 100, required: false }),
	instance_data_prefix: new Str({ description: 'Data Prefix for instance training images', required: true }),
	num_class_images: new Int({
		description:
			'Number of class images for prior preservation loss. If there are not enough ' +
			'images already present in class_data_dir, additional images will be sampled ' +
			'with class_prompt.',
		default: 100,
		required: false,
	}),
	center_crop: new Bool({
		description:
			'Whether to center crop the input images to the resolution. If not set, the images ' +
			'will be randomly cropped. The images will be resized to the resolution first before cropping.',
		default: false,
		required: false,
	}),
	random_flip: new Bool({
		description: 'Whether to randomly flip the input images horizontally.',
		default: false,
		required: false,
	}),
	sample_batch_size: new Int({
		description: 'Batch size for sampling images',
		default: 4,
		required: false,
	}),
	num_train_epochs: new Int({
		description: 'Number of training epochs',
		default: 1,
		required: false,
	}),
	text_encoder_lr: new Num({
		description: 'Learning rate for the text encoder',
		default: 0.000005,
		required: false,
	}),
	class_data_prefix: new Str({ description: 'Data Prefix for class training images', required: false }),
};

const JobSchema = {
	id: new Uuid({ description: 'Job ID' }),
	status: new Enumeration({
		description: 'Status',
		values: ['pending', 'running', 'complete', 'failed', 'canceled'],
		enumCaseSensitive: false,
	}),
	created_at: new DateTime({ description: 'Created At' }),
	started_at: new DateTime({ description: 'Started At', required: false }),
	completed_at: new DateTime({ description: 'Completed At', required: false }),
	canceled_at: new DateTime({ description: 'Cancelled At', required: false }),
	failed_at: new DateTime({ description: 'Failed At', required: false }),
	last_heartbeat: new DateTime({ description: 'Last Heartbeat', required: false }),
	checkpoint_bucket: new Str({ description: 'Checkpoint Bucket' }),
	checkpoint_prefix: new Str({ description: 'Checkpoint Prefix' }),
	model_bucket: new Str({ description: 'Model Bucket', required: false }),
	model_key: new Str({ description: 'Model Key', required: false }),
	data_bucket: new Str({ description: 'Data Bucket' }),
	resume_from: new Str({ description: 'Checkpoint Key to Resume From', required: false }),
	pretrained_model_name_or_path: new Enumeration({
		description: 'Model Name',
		values: ['stabilityai/stable-diffusion-xl-base-1.0'],
		enumCaseSensitive: false,
	}),
	pretrained_vae_model_name_or_path: new Enumeration({
		description: 'VAE Model Name',
		values: ['madebyollin/sdxl-vae-fp16-fix'],
		enumCaseSensitive: false,
	}),
	training_script: new Enumeration({
		description: 'Training Script',
		values: ['train_dreambooth_lora_sdxl.py'],
		enumCaseSensitive: false,
	}),
	...CreateJobSchema,
};

const WorkSchema = {
	...JobSchema,
	instance_data_keys: [String],
};

export const SaladDataSchema = {
	organization_name: new Str({ description: 'Salad Organization Name', required: false }),
	project_name: new Str({ description: 'Salad Project Name', required: false }),
	container_group_name: new Str({ description: 'Salad Container Group Name', required: false }),
	machine_id: new Str({ description: 'Salad Machine ID', required: false }),
	container_group_id: new Str({ description: 'Salad Container Group ID', required: false }),
};

const JobStatusWebhookSchema = {
	job_id: new Uuid({ description: 'Job ID', required: true }),
	...SaladDataSchema,
	bucket_name: new Str({ description: 'Checkpoint Bucket Name', required: true }),
	key: new Str({ description: 'Checkpoint Key', required: true }),
};

export class CreateJob extends OpenAPIRoute {
	static schema = {
		summary: 'Create Job',
		description: 'Create a new training job',
		requestBody: CreateJobSchema,
		responses: {
			'200': {
				description: 'OK',
				schema: JobSchema,
			},
			'400': {
				description: 'Bad Request',
				schema: {
					error: String,
				},
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const content = data.body;
		content.id = crypto.randomUUID();
		content.data_bucket = env.TRAINING_BUCKET_NAME;
		content.checkpoint_bucket = env.CHECKPOINT_BUCKET_NAME;
		content.checkpoint_prefix = `loras/${content.id}/`;

		if (content.class_prompt && !content.class_data_prefix) {
			content.class_data_prefix = `loras/${content.id}-class/`;
		}

		try {
			const job = await createNewJob(content, env);
			if (!job) {
				return error(500, { error: 'Internal Server Error' });
			}
			return job;
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
	}
}

export class GetJobById extends OpenAPIRoute {
	static schema = {
		summary: 'Get Job by ID',
		description: 'Get a job by its ID',
		parameters: {
			id: Path(Str, { description: 'Job ID', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: JobSchema,
			},
			'404': {
				description: 'Not Found',
				schema: {
					error: String,
				},
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const { id } = data.params;
		try {
			const job = await getJob(id, env);
			if (!job) {
				return error(404, { error: 'Job Not Found' });
			}
			return job;
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
	}
}

export class StopJobById extends OpenAPIRoute {
	static schema = {
		summary: 'Stop Job by ID',
		description: 'Stop a job by its ID',
		parameters: {
			id: Path(Str, { description: 'Job ID', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: {
					status: String,
				},
			},
			'404': {
				description: 'Not Found',
				schema: {
					error: String,
				},
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const { id } = data.params;
		try {
			await updateJobStatus(id, 'canceled', env, {});
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
		return { status: 'ok' };
	}
}

const cleanupOldCheckpoints = async (content: TrainingStatusWebhook, env: Env) => {
	// Cleanup old checkpoints
	const job = await getJob(content.job_id, env);
	if (!job) {
		return false;
	}
	const { objects } = await env.CHECKPOINT_BUCKET.list({ prefix: job.checkpoint_prefix });

	// Sort by .uploaded, newest first
	const sorted = sortBucketObjectsByDateDesc(objects);

	// Keep the last env.MAX_STORED_CHECKPOINTS keys
	const maxCheckpoints = parseInt(env.MAX_STORED_CHECKPOINTS);
	if (sorted.length <= maxCheckpoints) {
		return true;
	}
	const toDelete = sorted.slice(maxCheckpoints);
	await Promise.all(toDelete.map((obj) => env.CHECKPOINT_BUCKET.delete(obj.key)));
	return true;
};

const StatusWebhookResponse = {
	'200': {
		description: 'OK',
		schema: {
			status: String,
		},
	},
	'500': {
		description: 'Internal Server Error',
		schema: {
			error: String,
		},
	},
};

export class JobCompleteHandler extends OpenAPIRoute {
	static schema = {
		summary: 'Job Complete',
		description: 'Mark a job as complete',
		requestBody: JobStatusWebhookSchema,
		responses: StatusWebhookResponse,
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const content = data.body;
		try {
			await markJobComplete(content, env);
			await cleanupOldCheckpoints(content, env);
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}

		return { status: 'ok' };
	}
}

export class JobProgressHandler extends OpenAPIRoute {
	static schema = {
		summary: 'Job Progress',
		description: 'Handle job progress webhooks',
		requestBody: JobStatusWebhookSchema,
		responses: StatusWebhookResponse,
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const content = data.body;
		try {
			// Cleanup old checkpoints
			await cleanupOldCheckpoints(content, env);
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}

		return { status: 'ok' };
	}
}

export class JobFailedHandler extends OpenAPIRoute {
	static schema = {
		summary: 'Job Failed',
		description: 'Mark a job as failed',
		requestBody: JobStatusWebhookSchema,
		responses: StatusWebhookResponse,
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const content = data.body;
		try {
			await Promise.all([
				env.BANNED_WORKERS.put(`${content.machine_id}:${content.job_id}`, 'banned'),
				incrementFailedAttempts(content.job_id, env),
			]);
			const failedAttempts = await getFailedAttempts(content.job_id, env);
			if (failedAttempts >= parseInt(env.MAX_FAILED_ATTEMPTS)) {
				await updateJobStatus(content.job_id, 'failed', env, content);
			}
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}

		return { status: 'ok' };
	}
}

async function hydrateDataFiles(job: any, env: Env): Promise<any> {
	const { objects: checkpoints } = await env.CHECKPOINT_BUCKET.list({ prefix: job.checkpoint_prefix });
	const checkpointsSorted = sortBucketObjectsByDateDesc(checkpoints);
	if (checkpointsSorted.length) {
		job.resume_from = checkpointsSorted[0].key;
	}
	const { objects: trainingData } = await env.TRAINING_BUCKET.list({ prefix: job.instance_data_prefix });
	job.instance_data_keys = trainingData.map((obj) => obj.key);

	if (job.class_data_prefix) {
		const { objects: classData } = await env.TRAINING_BUCKET.list({ prefix: job.class_data_prefix });
		job.class_data_keys = classData.map((obj) => obj.key);
	}

	return job;
}

export class GetWork extends OpenAPIRoute {
	static schema = {
		summary: 'Get Work',
		description: 'Get work to do',
		parameters: {
			machine_id: Query(Str, { description: 'Salad Machine ID', required: false }),
			container_group_id: Query(Str, { description: 'Salad Container Group ID', required: false }),
			container_group_name: Query(Str, { description: 'Salad Container Group Name', required: false }),
			project_name: Query(Str, { description: 'Salad Project Name', required: false }),
			organization_name: Query(Str, { description: 'Salad Organization Name', required: false }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: [WorkSchema],
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const { machine_id } = data.query;
		try {
			let attempts = 0;
			let maxAttempts = parseInt(env.MAX_FAILURES_PER_WORKER);
			let job;
			while (attempts < maxAttempts && !job) {
				attempts++;
				job = await getHighestPriorityJob(env, attempts);
				if (!job) {
					break;
				}
				const banned = await env.BANNED_WORKERS.get(`${machine_id}:${job.id}`);
				if (banned) {
					job = null;
				}
			}
			if (!job) {
				return [];
			}
			if (job.status === 'pending') {
				await updateJobStatus(job.id, 'running', env, data.query);
			} else {
				await updateJobHeartbeat(job.id, data.query, env);
			}
			job = await hydrateDataFiles(job, env);

			return [job];
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
	}
}

export class PeekWork extends OpenAPIRoute {
	static schema = {
		summary: 'Peek Work',
		description: 'Get the next job to do without marking it as running',
		parameters: {
			machine_id: Query(Str, { description: 'Salad Machine ID', required: false }),
			container_group_id: Query(Str, { description: 'Salad Container Group ID', required: false }),
			container_group_name: Query(Str, { description: 'Salad Container Group Name', required: false }),
			project_name: Query(Str, { description: 'Salad Project Name', required: false }),
			organization_name: Query(Str, { description: 'Salad Organization Name', required: false }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: [WorkSchema],
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		try {
			let job = await getHighestPriorityJob(env);
			if (!job) {
				return [];
			}

			job = await hydrateDataFiles(job, env);

			return [job];
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
	}
}

export class JobHeartbeat extends OpenAPIRoute {
	static schema = {
		summary: 'Job Heartbeat',
		description: 'Update the last heartbeat for a job',
		parameters: {
			id: Path(Str, { description: 'Job ID', required: true }),
		},
		requestBody: SaladDataSchema,
		responses: {
			'200': {
				description: 'OK',
				schema: {
					status: String,
				},
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		const { id } = data.params;
		try {
			await updateJobHeartbeat(id, data.body, env);
		} catch (e: any) {
			if (e.status === 400) {
				return error(400, { error: 'Bad Request', message: e.message });
			}
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
		return { status: 'ok' };
	}
}

export class ListJobs extends OpenAPIRoute {
	static schema = {
		summary: 'List Jobs',
		description: 'List jobs',
		parameters: {
			status: Query(Enumeration, {
				description: 'Status',
				required: false,
				values: ['pending', 'running', 'complete', 'failed', 'canceled'],
			}),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: [JobSchema],
			},
			'500': {
				description: 'Internal Server Error',
				schema: {
					error: String,
				},
			},
		},
	};

	async handle(request: Request, env: Env, ctx: any, data: any) {
		try {
			if (data.query.status) {
				const jobs = await listJobsWithStatus(data.query.status, env);
				return jobs;
			}
			const jobs = await listAllJobs(env);
			return jobs;
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}
	}
}

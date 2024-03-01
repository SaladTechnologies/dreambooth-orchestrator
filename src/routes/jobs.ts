import { OpenAPIRoute, Str, Int, Num, Bool, Enumeration, Uuid, DateTime, Path } from '@cloudflare/itty-router-openapi';
import { Env, TrainingStatusWebhook } from '../types';
import { createNewJob, getJob, getHighestPriorityJob, updateJobStatus, updateJobHeartbeat, markJobComplete } from '../utils/db';
import { sortBucketObjectsByDateDesc } from '../utils/buckets';
import crypto from 'node:crypto';
import { error } from '../utils/error';

const CreateJobSchema = {
	instance_prompt: new Str({ description: 'Prompt', required: true }),
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
			await updateJobStatus(id, 'canceled', env);
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

const JobStatusWebhookSchema = {
	job_id: new Uuid({ description: 'Job ID', required: true }),
	organization_name: new Str({ description: 'Salad Organization Name', required: false,  }),
	project_name: new Str({ description: 'Salad Project Name', required: false}),
	container_group_name: new Str({ description: 'Salad Container Group Name', required: false}),
	machine_id: new Str({ description: 'Salad Machine ID', required: false}),
	container_group_id: new Str({ description: 'Salad Container Group ID', required: false}),
	bucket_name: new Str({ description: 'Checkpoint Bucket Name', required: true }),
	key: new Str({ description: 'Checkpoint Key', required: true }),
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
			await updateJobStatus(content.job_id, 'failed', env);
		} catch (e) {
			console.error(e);
			return error(500, { error: 'Internal Server Error' });
		}

		return { status: 'ok' };
	}
}

export class GetWork extends OpenAPIRoute {
	static schema = {
		summary: 'Get Work',
		description: 'Get work to do',
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

	async handle(request: Request, env: Env, ctx: any) {
		try {
			const job = await getHighestPriorityJob(env);
			if (!job) {
				return [];
			}
			if (job.status === 'pending') {
				await updateJobStatus(job.id!, 'running', env);
			} else {
				await updateJobHeartbeat(job.id!, env);
			}
			const { objects: checkpoints } = await env.CHECKPOINT_BUCKET.list({ prefix: job.checkpoint_prefix });
			const checkpointsSorted = sortBucketObjectsByDateDesc(checkpoints);
			if (checkpointsSorted.length) {
				job.resume_from = checkpointsSorted[0].key;
			}
			const { objects: trainingData } = await env.TRAINING_BUCKET.list({ prefix: job.instance_data_prefix });
			job.instance_data_keys = trainingData.map((obj) => obj.key);

			
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
			await updateJobHeartbeat(id, env);
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

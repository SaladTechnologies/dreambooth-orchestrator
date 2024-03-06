import { Env, SaladData, TrainingStatusWebhook } from '../types';

function generateInsertStatement(job: any): string {
	const keys = Object.keys(job);
	keys.push('created_at');
	const columns = keys.join(', ');
	const placeholders = keys.map((k) => (k === 'created_at' ? 'datetime("now")' : '?')).join(', ');

	const sql = `INSERT INTO TrainingJobs (${columns}) VALUES (${placeholders})`;

	return sql;
}

export async function createNewJob(job: any, env: Env): Promise<any | null> {
	await Promise.all([
		env.DB.prepare(generateInsertStatement(job))
			.bind(...Object.values(job).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)))
			.all(),
		logTrainingEvent(job.id, 'created', {}, env),
	]);
	return getJob(job.id!, env);
}

const coerceBools = (job: any) => {
	const boolKeys = ['use_8bit_adam', 'train_text_encoder', 'gradient_checkpointing', 'with_prior_preservation', 'center_crop', 'random_flip'];
	boolKeys.forEach((k) => {
		job[k] = !!job[k];
	});
};

export async function getJob(id: string, env: Env): Promise<any | null> {
	const { results } = await env.DB.prepare('SELECT * FROM TrainingJobs WHERE id = ?').bind(id).all();
	if (!results.length) {
		return null;
	}
	const job = results[0];
	coerceBools(job);
	return job;
}

export async function getHighestPriorityJob(env: Env): Promise<any | null> {
	const { results: runningResults } = await env.DB.prepare(
		`
	SELECT *
	FROM TrainingJobs
	WHERE status = 'running' AND (
		  last_heartbeat < datetime('now', '-' || ? || ' seconds')
		  OR
		  (last_heartbeat IS NULL AND created_at < datetime('now', '-' || ? || ' seconds'))
	)
	ORDER BY last_heartbeat
	LIMIT 1;`
	)
		.bind(env.MAX_HEARTBEAT_AGE, env.MAX_HEARTBEAT_AGE)
		.all();
	if (runningResults.length) {
		const job = runningResults[0];
		coerceBools(job);
		return job;
	}
	const { results: pendingResults } = await env.DB.prepare(
		`
	SELECT *
    FROM TrainingJobs
    WHERE status = 'pending'
    ORDER BY last_heartbeat
    LIMIT 1;`
	).all();
	if (pendingResults.length) {
		const job = pendingResults[0];
		coerceBools(job);
		return job;
	}
	return null;
}

export async function updateJobStatus(id: string, status: string, env: Env, saladData: SaladData): Promise<void> {
	let timeStatement = '';
	let eventName;
	switch (status) {
		case 'running':
			timeStatement = ', started_at = datetime("now")';
			eventName = 'started';
			break;
		case 'failed':
			timeStatement = ', failed_at = datetime("now")';
			eventName = status;
			break;
		case 'canceled':
			timeStatement = ', canceled_at = datetime("now")';
			eventName = status;
			break;
		default:
			throw new Error(`Invalid status: ${status}`);
	}
	const promises: Promise<any>[] = [
		env.DB.prepare(`UPDATE TrainingJobs SET status = ?${timeStatement}, last_heartbeat = datetime("now") WHERE id = ?`)
			.bind(status, id)
			.run(),
		logTrainingEvent(id, eventName, getSaladDataFromWebhookData(saladData), env),
	];
	await Promise.all(promises);
}

export async function getJobStatus(id: string, env: Env): Promise<string | null> {
	const { results } = await env.DB.prepare('SELECT status FROM TrainingJobs WHERE id = ?').bind(id).all();
	if (!results.length) {
		return null;
	}
	return results[0].status as string;
}

export async function updateJobHeartbeat(id: string, saladData: SaladData, env: Env): Promise<void> {
	const currentStatus = await getJobStatus(id, env);
	if (currentStatus !== 'running') {
		const err = new Error('Job not running');
		(err as any).status = 400;
		throw err;
	}

	await Promise.all([
		env.DB.prepare("UPDATE TrainingJobs SET last_heartbeat = datetime('now') WHERE id = ? AND status = 'running'").bind(id).run(),
		logTrainingEvent(id, 'heartbeat', saladData, env),
	]);
}

const getSaladDataFromWebhookData = (webhookData: SaladData): SaladData => {
	const saladData: SaladData = {};
	if (webhookData.organization_name) {
		saladData.organization_name = webhookData.organization_name;
	}
	if (webhookData.project_name) {
		saladData.project_name = webhookData.project_name;
	}
	if (webhookData.container_group_name) {
		saladData.container_group_name = webhookData.container_group_name;
	}
	if (webhookData.machine_id) {
		saladData.machine_id = webhookData.machine_id;
	}
	if (webhookData.container_group_id) {
		saladData.container_group_id = webhookData.container_group_id;
	}
	return saladData;
};

export async function markJobComplete(webhookData: TrainingStatusWebhook, env: Env): Promise<void> {
	await Promise.all([
		env.DB.prepare(
			`UPDATE TrainingJobs
  SET status = 'complete', model_key = ?, model_bucket = ?, completed_at = datetime('now')
  WHERE id = ?;`
		)
			.bind(webhookData.key, webhookData.bucket_name, webhookData.job_id)
			.run(),
		logTrainingEvent(webhookData.job_id, 'complete', getSaladDataFromWebhookData(webhookData), env),
	]);
}

export async function logTrainingEvent(jobId: string, eventType: string, eventData: SaladData, env: Env): Promise<void> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		'INSERT INTO TrainingJobEvents (id, job_id, event_type, event_data, timestamp) VALUES (?, ?, ?, ?, datetime("now"))'
	)
		.bind(id, jobId, eventType, JSON.stringify(eventData))
		.run();
}

export async function listAllJobs(env: Env): Promise<any[]> {
	const { results } = await env.DB.prepare('SELECT * FROM TrainingJobs ORDER BY created_at ASC').all();
	results.forEach(coerceBools);
	return results;
}

export async function listJobsWithStatus(status: string, env: Env): Promise<any[]> {
	const { results } = await env.DB.prepare('SELECT * FROM TrainingJobs WHERE status = ? ORDER BY created_at ASC').bind(status).all();
	results.forEach(coerceBools);
	return results;
}
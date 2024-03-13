export interface Env {
	CHECKPOINT_BUCKET: R2Bucket;
	DB: D1Database;
	API_KEY: string;
	API_HEADER: string;
	MAX_STORED_CHECKPOINTS: string;
	MAX_HEARTBEAT_AGE: string;
	MAX_FAILED_ATTEMPTS: string;
	MAX_FAILURES_PER_WORKER: string;
	TRAINING_BUCKET: R2Bucket;
	UPLOAD_TOKENS: KVNamespace;
	DOWNLOAD_TOKENS: KVNamespace;
	USER_TOKENS: KVNamespace;
	BANNED_WORKERS: KVNamespace;
	CHECKPOINT_BUCKET_NAME: string;
	TRAINING_BUCKET_NAME: string;
}

export interface SaladData {
	organization_name?: string;
	project_name?: string;
	container_group_name?: string;
	machine_id?: string;
	container_group_id?: string;
}

export interface TrainingStatusWebhook extends SaladData {
	bucket_name: string;
	key: string;
	job_id: string;
}

export interface UploadDownloadParams {
	key: string;
	bucket: string;
}

export interface Env {
	CHECKPOINT_BUCKET: R2Bucket;
	DB: D1Database;
	API_KEY: string;
	API_HEADER: string;
	MAX_STORED_CHECKPOINTS: string;
	MAX_HEARTBEAT_AGE: string;
	TRAINING_BUCKET: R2Bucket;
	UPLOAD_TOKENS: KVNamespace;
	DOWNLOAD_TOKENS: KVNamespace;
	CHECKPOINT_BUCKET_NAME: string;
	TRAINING_BUCKET_NAME: string;
}


export type TrainingStatusWebhook = {
	organization_name: string;
	project_name: string;
	container_group_name: string;
	machine_id: string;
	container_group_id: string;
	bucket_name: string;
	key: string;
	job_id: string;
};

export type UploadDownloadParams = { key: string; bucket: string };

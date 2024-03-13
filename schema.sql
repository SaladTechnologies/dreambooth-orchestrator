DROP TABLE IF EXISTS TrainingJobs;

CREATE TABLE IF NOT EXISTS TrainingJobs (
  id UNIQUEIDENTIFIER PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  canceled_at TIMESTAMP,
  failed_at TIMESTAMP,
  instance_prompt TEXT NOT NULL,
  class_prompt TEXT,
  pretrained_model_name_or_path TEXT NOT NULL DEFAULT 'stabilityai/stable-diffusion-xl-base-1.0',
  pretrained_vae_model_name_or_path TEXT NOT NULL DEFAULT 'madebyollin/sdxl-vae-fp16-fix',
  training_script TEXT NOT NULL DEFAULT 'train_dreambooth_lora_sdxl.py',
  max_train_steps INT NOT NULL DEFAULT 500,
  train_batch_size INT NOT NULL DEFAULT 1,
  learning_rate FLOAT NOT NULL DEFAULT 0.000002,
  use_8bit_adam BOOLEAN NOT NULL DEFAULT FALSE,
  mixed_precision TEXT DEFAULT 'fp16',
  resolution INT NOT NULL DEFAULT 1024,
  gradient_accumulation_steps INT NOT NULL DEFAULT 4,
  lr_scheduler TEXT NOT NULL DEFAULT 'constant',
  lr_warmup_steps INT NOT NULL DEFAULT 0,
  train_text_encoder BOOLEAN NOT NULL DEFAULT TRUE,
  gradient_checkpointing BOOLEAN NOT NULL DEFAULT FALSE,
  with_prior_preservation BOOLEAN NOT NULL DEFAULT FALSE,
  prior_loss_weight FLOAT DEFAULT 1.0,
  validation_prompt TEXT,
  validation_epochs INT DEFAULT 50,
  checkpointing_steps INT NOT NULL DEFAULT 100,
  checkpoint_bucket TEXT NOT NULL,
  checkpoint_prefix TEXT NOT NULL,
  resume_from TEXT,
  model_bucket TEXT,
  model_key TEXT,
  data_bucket TEXT NOT NULL,
  instance_data_prefix TEXT NOT NULL,
  class_data_prefix TEXT,
  last_heartbeat TIMESTAMP,
  num_class_images INT NOT NULL DEFAULT 100,
  center_crop BOOLEAN NOT NULL DEFAULT FALSE,
  random_flip BOOLEAN NOT NULL DEFAULT FALSE,
  sample_batch_size INT NOT NULL DEFAULT 4,
  num_train_epochs INT,
  text_encoder_lr FLOAT NOT NULL DEFAULT 0.000005,
  num_failures INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_running_jobs ON TrainingJobs (status, last_heartbeat, created_at)
WHERE
  status = 'running';

CREATE INDEX idx_pending_jobs ON TrainingJobs (status, created_at)
WHERE
  status = 'pending';

DROP TABLE IF EXISTS TrainingJobEvents;

CREATE TABLE IF NOT EXISTS TrainingJobEvents (
  id UNIQUEIDENTIFIER PRIMARY KEY NOT NULL,
  job_id UNIQUEIDENTIFIER NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_job_events ON TrainingJobEvents (job_id, event_type, timestamp);
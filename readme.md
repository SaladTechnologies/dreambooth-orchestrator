# Dreambooth Training Orchestrator

This project uses cloudflare workers, kv, r2, and d1 to provide an orchestration layer for running interuptible dreambooth training jobs on Salad.

## Client Workflow

Client Applications should follow the following workflow when interacting with this service.

### Authentication

All requests should include the header `x-api-key`, with the appropriate value stored in cloudflare secrets.

### Secure Downloads

In order to download files such as training images or saved checkpoints, client applications must first request a one-time-use token.
To do this:
1. Make an authenticated request to `GET /download/token?key=${key}&bucket=${bucket}`. You will recieve a response like `{ "token": "abcdefg" }`. This token can be used once to download the specific file requested.
2. Make an authenticated request to `GET /download/:bucket/:key`, including an additional header, `x-download-token` that includes the token from step 1.

### Secure Uploads

Similar to downloading files, in order to securely upload files, client applications must first request a token. To facilitate multipart uploads, these tokens are short lived, rather than one-time-use. Like download tokens, they can only be used for a specific bucket and key.

1. Make an authenticated request to `GET /upload/token?key=${key}&bucket=${bucket}`. You will recieve a response like `{ "token": "abcdefg" }`. This token can be used for a few minutes to upload the specific file.
2. Perform a multipart upload to `POST /upload/:bucket/:key` as documented [here](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/#perform-a-multipart-upload-with-your-worker-optional), including both the authentication header, and also a header `x-upload-token` that includes the token from step 1.

### `GET /work`

You'll recieve a response body like:

```json
[
  {
    "id": "146683a1-cb76-4702-9fef-fcccd32594f1",
    "status": "pending",
	"started_at": null,
    "created_at": "2024-02-27 18:31:14",
    "completed_at": null,
    "canceled_at": null,
    "failed_at": null,
    "instance_prompt": "timberdog",
    "class_prompt": null,
    "pretrained_model_name_or_path": "stabilityai/stable-diffusion-xl-base-1.0",
    "pretrained_vae_model_name_or_path": "madebyollin/sdxl-vae-fp16-fix",
    "training_script": "train_dreambooth_lora_sdxl.py",
    "max_train_steps": 1400,
    "train_batch_size": 1,
    "learning_rate": 0.000001,
    "use_8bit_adam": false,
    "mixed_precision": "fp16",
    "resolution": 1024,
    "gradient_accumulation_steps": 4,
    "lr_scheduler": "constant",
    "lr_warmup_steps": 0,
    "train_text_encoder": true,
    "gradient_checkpointing": false,
    "with_prior_preservation": true,
    "prior_loss_weight": 1,
    "validation_prompt": "timberdog as an ace space pilot, detailed illustration",
    "validation_epochs": 10,
    "checkpointing_steps": 50,
    "checkpoint_bucket": "training-checkpoints",
    "checkpoint_prefix": "loras/146683a1-cb76-4702-9fef-fcccd32594f1/",
    "resume_from": null,
    "model_bucket": null,
    "model_key": null,
    "data_bucket": "training-data",
    "instance_data_prefix": "timber/",
    "last_heartbeat": null,
    "instance_data_keys": [
      "timber/00000IMG_00000_BURST20190101102301073_COVER.jpg",
      "timber/00100lPORTRAIT_00100_BURST20181230094336904_COVER.jpg",
      "timber/00100lPORTRAIT_00100_BURST20190505125527565_COVER.jpg",
      "timber/00100lrPORTRAIT_00100_BURST20200322130559846_COVER~2.jpg",
      "timber/65730110388__36AE7CE9-EFD0-4EE8-BCAB-FB6BB1528699.jpg",
      "timber/65768313201__36D94C7C-18DC-4D03-BA28-588726D396D3.jpg",
      "timber/66874197373__F70CD1BC-CB76-41C8-B537-2513631B09A3.jpg",
      "timber/IMG_0003.jpg",
      "timber/IMG_0219.jpg",
      "timber/IMG_0239.jpg",
      "timber/IMG_0242.jpg",
      "timber/IMG_0244.jpg",
      "timber/IMG_0554.jpg",
      "timber/IMG_0655.JPG",
      "timber/IMG_0658.JPG",
      "timber/IMG_1113.jpg",
      "timber/IMG_1178.jpg",
      "timber/IMG_1191.jpg",
      "timber/IMG_1195.jpg",
      "timber/IMG_1204.jpg",
      "timber/IMG_1263.jpg",
      "timber/IMG_1274.jpg",
      "timber/IMG_1275.jpg",
      "timber/IMG_1276.jpg",
      "timber/IMG_1277.jpg",
      "timber/IMG_1278.jpg",
      "timber/IMG_1300.jpg",
      "timber/IMG_1376.JPG",
      "timber/IMG_1953.JPG",
      "timber/IMG_20200124_181205.jpg",
      "timber/IMG_2234.JPG",
      "timber/IMG_2235.JPG",
      "timber/IMG_2259.JPG",
      "timber/IMG_2919.JPG",
      "timber/IMG_3200.JPG",
      "timber/IMG_3571.jpg"
    ]
  }
]
```

or, if there is no work to do:

```json
[]
```

### Download Required Data

From this work definition, there's several values you need to act on.

- If `.resume_from` is not null, it will contain the key for the latest saved checkpoint. Download the file as documented above, using `job.checkpoint_bucket` as the bucket, and `job.resume_from` as the key.
- Download each file in `job.data_keys`, using `job.data_bucket` as the bucket.

### Start/resume the training job

Kick off the accelerate process with the correct arguments taken from the job payload.

### Start a heartbeat process

Client applications should make an empty request to `POST /heartbeat/:job_id` at a time interval no more than 50% of the value defined in `wrangler.toml`. e.g. If the maximum age of the heartbeat is set to 60 seconds, submit a heartbeat at least every 30 seconds. If the node gets interrupted, the heartbeat will stop, and the orchestrator will know to hand the job out again for another worker to resume.

### Monitor the filesystem for checkpoint creation

Client applications should monitor for the creation of checkpoint directories, and upload them as zipped files named `${job.checkpoint_prefix}${checkpoint_dir_name}`. Upload the file as documented above, using `job.checkpoint_bucket` as the bucket. Once a checkpoint has been successfully uploaded, make a request to the progress endpoint:

`POST /progress`

JSON payload:
```js
{
	organization_name: string;
	project_name: string;
	container_group_name: string;
	machine_id: string;
	container_group_id: string;
	bucket_name: string;
	key: string;
	job_id: string;
}
```

This will trigger a cleanup of older checkpoints, with the maximum saved number configured in environment variables in `wrangler.toml`. This endpoint is also a good place to customize any other system behavior you want to trigger on training progress. For instance, maybe you want to queue an inference job to validate the state of the training at that checkpoint. Maybe you want to update a user dashboard.

### Wait for the accelerate process to complete

Once the accelerate process has exited successfully, there will be a file in the output directory named `pytorch_lora_weights.safetensors`. Upload this file following the secure upload directions above. Once the file has been uploaded, make a request to the complete endpoint:

`POST /complete`

JSON payload:
```js
{
	organization_name: string;
	project_name: string;
	container_group_name: string;
	machine_id: string;
	container_group_id: string;
	bucket_name: string;
	key: string;
	job_id: string;
}
```

This will mark the job complete, preventing it from being handed out to other workers. This endpoint is a good place to customize any other system behavior you want to trigger when the training is complete.

#### If accelerate fails

In the event the training job fails, make a request to the fail endpoint:

`POST /fail`

JSON payload:
```js
{
	organization_name: string;
	project_name: string;
	container_group_name: string;
	machine_id: string;
	container_group_id: string;
	bucket_name: string;
	key: string;
	job_id: string;
}
```

### Cleanup and Go Again

Once a training job is completed or failed, client applications should purge the local file system of training data, checkpoints, and model weights. Once this is complete, make a new request to the `GET /work` endpoint, and begin the cycle again.

## Running a training job

To start a training job, submit a request to the job endpoint:

`POST /job`

JSON Payload:

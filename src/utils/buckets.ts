import { Env } from '../types';

export const getBucket = (env: Env, bucketName: string) => {
	const allowedBuckets = [env.CHECKPOINT_BUCKET_NAME, env.TRAINING_BUCKET_NAME];
	if (!allowedBuckets.includes(bucketName.toLocaleLowerCase())) {
		return null;
	}
	switch (bucketName.toLocaleLowerCase()) {
		case env.CHECKPOINT_BUCKET_NAME:
			return env.CHECKPOINT_BUCKET;
		case env.TRAINING_BUCKET_NAME:
			return env.TRAINING_BUCKET;
		default:
			return null;
	}
}

export const sortBucketObjectsByDateDesc = (objects: R2Object[]) => {
    // Sort by .uploaded, newest first
    const sorted = objects.sort((a, b) => {
        if (a.uploaded === b.uploaded) {
            return 0;
        }
        return a.uploaded > b.uploaded ? -1 : 1;
    });
    return sorted;
}
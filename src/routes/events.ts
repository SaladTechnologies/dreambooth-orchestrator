import { OpenAPIRoute, Str, Enumeration, Path } from '@cloudflare/itty-router-openapi';
import { Env } from '../types';
import { SaladDataSchema } from './jobs';

const EventSchema = {
	id: new Str({ description: 'Event ID' }),
	job_id: new Str({ description: 'Job ID' }),
	event_type: new Enumeration({ values: ['created', 'started', 'failed', 'heartbeat', 'complete', 'canceled'], description: 'Event Type' }),
    event_data: SaladDataSchema,
    created_at: new Str({ description: 'Created At' }),
};

export class ListEventsForJob extends OpenAPIRoute {
	static schema = {
		summary: 'List Events for Job',
		description: 'List all events for a job',
		parameters: {
			id: Path(Str, { description: 'Job ID', required: true }),
		},
		responses: {
			'200': {
				description: 'OK',
				schema: [EventSchema],
			},
			'404': {
				description: 'Not Found',
				schema: {
					error: { type: 'string' },
				},
			},
		},
	};

	async handle(request: Request, env: Env, context: any, data: any) {
		const { id } = data.params;
		const { results } = await env.DB.prepare('SELECT * FROM TrainingJobEvents WHERE job_id = ? ORDER BY timestamp ASC').bind(id).all();
		return results.map((event: any) => {
            event.event_data = JSON.parse(event.event_data);
            return event;
        });
	}
}

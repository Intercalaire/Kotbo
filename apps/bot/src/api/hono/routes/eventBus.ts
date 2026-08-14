import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { kotboEventBus } from '@kotbo/core';

export const eventBusRouter = new OpenAPIHono();

const subscriptionSchema = z.object({
  module: z.string(),
  event: z.string(),
});

const diagnosticRoute = createRoute({
  method: 'get',
  path: '/api/event-bus/diagnostics',
  summary: 'Event Bus diagnostic - liste les modules et subscriptions actifs',
  tags: ['System'],
  responses: {
    200: {
      description: 'Diagnostic du bus d\'events',
      content: {
        'application/json': {
          schema: z.object({
            distributed: z.boolean(),
            subscriptions: z.array(subscriptionSchema),
            summary: z.record(z.string(), z.array(z.string())),
          }),
        },
      },
    },
  },
});

eventBusRouter.openapi(diagnosticRoute, (c) => {
  const subscriptions = kotboEventBus.getSubscriptions();

  const summary: Record<string, string[]> = {};
  for (const sub of subscriptions) {
    if (!summary[sub.module]) {
      summary[sub.module] = [];
    }
    if (!summary[sub.module].includes(sub.event)) {
      summary[sub.module].push(sub.event);
    }
  }

  return c.json({
    distributed: kotboEventBus.isDistributed(),
    subscriptions: subscriptions as { module: string; event: string }[],
    summary,
  });
});

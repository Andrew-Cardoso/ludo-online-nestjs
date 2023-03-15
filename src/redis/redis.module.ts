import { Global, Logger, Module } from '@nestjs/common';
import { createClient } from 'redis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: async () => {
        const logger = new Logger('Redis');
        const client = createClient({ url: process.env.REDIS_URL });

        client.on('error', (err) => logger.error(err));
        client.on('connect', () => logger.log('Connected to Redis'));
        client.on('reconnecting', () => logger.warn('Redis is reconnecting'));
        client.on('ready', () => logger.log('Redis is ready'));

        await client.connect();

        return client;
      },
    },
  ],
  exports: ['REDIS'],
})
export class RedisModule {}

import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [RedisModule, GameModule],
})
export class AppModule {}

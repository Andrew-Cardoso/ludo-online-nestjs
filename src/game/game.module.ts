import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { BoardGeneratorService } from './board.generator.service';
import { GameValidatorService } from './game.validator.service';

@Module({
  providers: [BoardGeneratorService, GameValidatorService, GameGateway],
})
export class GameModule {}

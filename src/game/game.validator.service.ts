import { Inject, Injectable } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { SubscribeEventsEnum } from './game.events.enum';
import { ColorEnum, colors } from './types/colors';
import { Game } from './types/game';

type ValidGameResult =
  | { game: Game; error: null }
  | { error: string; game: null };

@Injectable()
export class GameValidatorService {
  constructor(@Inject('REDIS') private readonly redis: RedisClientType) {}

  async validateGame(id: string): Promise<ValidGameResult> {
    const gameId = await this.redis.get(id);
    if (!gameId) return { error: 'Not in game', game: null };

    const gameJson = await this.redis.get(gameId);
    if (!gameJson) return { error: 'Invalid game id', game: null };

    const game: Game = JSON.parse(gameJson);

    const player = game.players.find((p) => p.socketId === id);
    if (!player) return { error: 'Not in game', game: null };

    const gameWinners = Object.values(game.winners);

    if (gameWinners.every((winner) => winner !== null))
      return { game: null, error: 'Game is already finished' };

    if (player.color && gameWinners.includes(player.color))
      return {
        error: `You are already the top ${Object.keys(game.winners).find(
          (key) => game.winners[key] === player.color,
        )}`,
        game: null,
      };

    return { game, error: null };
  }

  async validateChoosenColor(
    id: string,
    color: ColorEnum,
  ): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;
    if (!colors.includes(color)) return { error: 'Invalid color', game: null };
    if (validation.game.players.some((p) => p.color === color))
      return { error: 'Color already taken', game: null };

    return validation;
  }

  async validateDiceRoll(id: string): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;

    if (validation.game.current !== id)
      return { error: 'Not your turn', game: null };

    if (!validation.game.dice.ableToRoll)
      return { error: 'Dice cannot be rolled right now', game: null };

    if (validation.game.players.length !== 4)
      return { error: 'Not enough players', game: null };

    return validation;
  }

  async validateDiceResult(id: string): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;

    if (validation.game.current !== id)
      return { error: 'Not your turn', game: null };

    if (validation.game.players.length !== 4)
      return { error: 'Not enough players', game: null };

    return validation;
  }

  async validateInitialMove(
    id: string,
    pawnIndex: number,
  ): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;

    const moveError = this.validateMove(
      validation.game,
      SubscribeEventsEnum.MOVE_INITIAL,
      id,
      pawnIndex,
    );

    if (moveError) return moveError;

    if (![1, 6].includes(validation.game.dice.result))
      return { error: 'Dice roll is neither 1 nor 6', game: null };

    return validation;
  }

  async validateFinalMove(
    id: string,
    pawnIndex: number,
  ): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;

    const moveError = this.validateMove(
      validation.game,
      SubscribeEventsEnum.MOVE_FINAL,
      id,
      pawnIndex,
    );
    if (moveError) return moveError;

    const player = validation.game.players.find((p) => p.socketId === id);
    const pawn = validation.game.board.pawns[player.color].find(
      (p) => p.index === pawnIndex,
    );

    const squaresToFinish = 5 - parseInt(pawn.squareId.split('-')[2]);

    if (validation.game.dice.result > squaresToFinish)
      return { error: 'Dice result is too high', game: null };

    return validation;
  }

  async validateRoadMove(
    id: string,
    pawnIndex: number,
  ): Promise<ValidGameResult> {
    const validation = await this.validateGame(id);
    if (validation.error) return validation;

    const moveError = this.validateMove(
      validation.game,
      SubscribeEventsEnum.MOVE_ROAD,
      id,
      pawnIndex,
    );
    return moveError || validation;
  }

  async validateMovedPawn(id: string) {
    return await this.validateGame(id);
  }

  private validateMove(
    game: Game,
    move: SubscribeEventsEnum,
    id: string,
    pawnIndex: number,
  ): ValidGameResult | void {
    const player = game.players.find((p) => p.socketId === id);

    if (player.socketId !== game.current)
      return { error: 'Not your turn', game: null };

    if (game.players.length !== 4)
      return { error: 'Not enough players', game: null };

    const pawn = game.board.pawns[player.color].find(
      (p) => p.index === pawnIndex,
    );

    if (!pawn) return { error: 'Invalid pawn index', game: null };
    if (pawn.action?.[0] !== move)
      return { error: 'Pawn cannot be moved', game: null };
  }
}

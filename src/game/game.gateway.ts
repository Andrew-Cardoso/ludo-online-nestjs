import { Inject, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { RedisClientType } from 'redis';
import { Server, Socket } from 'socket.io';
import { BoardGeneratorService } from './board.generator.service';
import { PublishEventsEnum, SubscribeEventsEnum } from './game.events.enum';
import { GameValidatorService } from './game.validator.service';
import { AnimationTypeEnum } from './types/animation-type';
import { ColorEnum, colors } from './types/colors';
import { DiceResult } from './types/dice';
import { FinalSquare } from './types/final-square';
import { Game } from './types/game';
import { MitosisIdentifier } from './types/mitosis-identifier';
import { Pawn, SquareId } from './types/pawn';
import { PawnSquarePositionEnum } from './types/pawn-square-position';
import { Player } from './types/player';
import { Square } from './types/square';
import { Winners } from './types/winners';

@WebSocketGateway(+process.env.PORT, {
  cors: { origin: process.env.CORS_ORIGIN },
})
export class GameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  private server: Server;

  constructor(
    @Inject('REDIS') private readonly redis: RedisClientType,
    private readonly boardGenerator: BoardGeneratorService,
    private readonly gameValidator: GameValidatorService,
  ) {}

  handleConnection() {
    console.log('new connection established');
    return;
  }

  @SubscribeMessage(SubscribeEventsEnum.CREATE_GAME)
  async createGame(client: Socket) {
    const id = randomUUID();
    const game: Game = {
      id,
      players: [
        {
          socketId: client.id,
          color: null,
        },
      ],
      board: this.boardGenerator.createBoard(),
      current: client.id,
      dice: {
        count: 0,
        result: 1,
        ableToRoll: false,
        rollAnimation: false,
      },
      winners: {
        1: null,
        2: null,
        3: null,
      },
    };

    this.gameUpdated(game);
    await Promise.all([this.saveGame(game), this.redis.set(client.id, id)]);
  }

  @SubscribeMessage(SubscribeEventsEnum.JOIN_GAME)
  async joinGame({ id }: Socket, gameId: string) {
    const [gameJson, oldGameId] = await Promise.all([
      this.redis.get(gameId),
      this.redis.get(id),
    ]);
    if (!gameJson) return { error: 'Invalid game id' };

    const game: Game = JSON.parse(gameJson);
    if (game.players.length >= 4) return { error: 'Game is full' };

    if (game.players.some((p) => p.socketId === id))
      return { error: 'Already in game' };

    game.players.push({
      socketId: id,
      color: null,
    });

    const promises = [];

    if (oldGameId) {
      const oldGameJson = await this.redis.get(oldGameId);
      if (oldGameJson) {
        const oldGame: Game = JSON.parse(oldGameJson);
        oldGame.players = oldGame.players.filter((p) => p.socketId !== id);

        promises.push(
          oldGame.players.length
            ? this.saveGame(oldGame)
            : this.redis.del(oldGameId),
        );

        this.gameUpdated(oldGame);
      }
    }

    promises.push(this.redis.set(id, gameId), this.saveGame(game));

    this.gameUpdated(game);

    await Promise.all(promises);
  }

  @SubscribeMessage(SubscribeEventsEnum.CHOOSE_COLOR)
  async chooseColor({ id }: Socket, color?: ColorEnum) {
    const { game, error } = await this.gameValidator.validateChoosenColor(
      id,
      color,
    );
    if (error) return { error };

    game.players.find((p) => p.socketId === id).color = color;
    game.dice.ableToRoll = game.players.length === 4;

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.ROLL_DICE)
  async rollDice({ id }: Socket) {
    const { game, error } = await this.gameValidator.validateDiceRoll(id);
    if (error) return { error };

    game.dice.ableToRoll = false;
    game.dice.rollAnimation = true;
    game.dice.result = this.getRoll();
    game.dice.count++;

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.ROLL_RESULT)
  async rollResult({ id }: Socket) {
    const { game, error } = await this.gameValidator.validateDiceResult(id);
    if (error) return { error };

    const player = game.players.find((p) => p.socketId === id);
    const pawns = game.board.pawns[player.color];

    for (const pawn of pawns) {
      if (pawn.squareId.includes('initial')) {
        if ([1, 6].includes(game.dice.result))
          pawn.action = [SubscribeEventsEnum.MOVE_INITIAL, pawn.index];
        continue;
      }

      const squarePositionIndex = this.getSquareIndex(pawn);

      if (pawn.squareId.includes('final')) {
        if (squarePositionIndex === 5) continue;
        if (game.dice.result <= 5 - squarePositionIndex)
          pawn.action = [SubscribeEventsEnum.MOVE_FINAL, pawn.index];
        continue;
      }

      pawn.action = [SubscribeEventsEnum.MOVE_ROAD, pawn.index];
    }

    game.dice.rollAnimation = false;
    if (pawns.every((p) => !p.action)) {
      game.dice.count = 0;
      game.dice.ableToRoll = true;
      game.current = this.getNextPlayer(
        game.current,
        game.players,
        game.winners,
      );
    }

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.MOVE_INITIAL)
  async moveInitial({ id }: Socket, pawnIndex: number) {
    const { game, error } = await this.gameValidator.validateInitialMove(
      id,
      pawnIndex,
    );
    if (error) return { error };

    const player = game.players.find((p) => p.socketId === id);
    const pawns = game.board.pawns[player.color];
    const pawn = pawns[pawnIndex];
    const startingSquareId = pawn.squareId;
    pawns.forEach((p) => (p.action = undefined));

    const road = game.board.road.find(
      (r) => r.color === pawn.color && r.entrance,
    );
    pawn.squareId = road.id;

    game.board.movePawn = {
      color: pawn.color,
      index: pawn.index,
      startingSquareId,
      squaresIds: [pawn.squareId],
    };

    this.addMitosisIfNeeded(game, pawn);
    this.addKaryogamyIfNeeded(game, pawn);

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.MOVE_FINAL)
  async moveFinal({ id }: Socket, pawnIndex: number) {
    const { game, error } = await this.gameValidator.validateFinalMove(
      id,
      pawnIndex,
    );
    if (error) return { error };

    const player = game.players.find((p) => p.socketId === id);
    const pawns = game.board.pawns[player.color];
    const pawn = pawns[pawnIndex];
    const startingSquareId = pawn.squareId;

    this.removeKaryogamyIfNeeded(game, pawn);

    const currentSquareIndex = this.getSquareIndex(pawn);

    pawns.forEach((p) => (p.action = undefined));
    pawn.squareId = `final-${pawn.color}-${
      currentSquareIndex + game.dice.result
    }`;

    const squaresIds = [
      ...new Array(this.getSquareIndex(pawn) - currentSquareIndex),
    ].map(
      (_, i) => `final-${pawn.color}-${currentSquareIndex + i + 1}` as SquareId,
    );

    game.board.movePawn = {
      color: pawn.color,
      index: pawn.index,
      squaresIds,
      startingSquareId,
    };
    pawn.endReached = pawn.squareId.includes('5');

    this.addKaryogamyIfNeeded(game, pawn);

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.MOVE_ROAD)
  async moveRoad({ id }: Socket, pawnIndex: number) {
    const { game, error } = await this.gameValidator.validateRoadMove(
      id,
      pawnIndex,
    );
    if (error) return { error };

    const player = game.players.find((p) => p.socketId === id);
    const pawns = game.board.pawns[player.color];
    const pawn = pawns[pawnIndex];

    const startingSquareId = pawn.squareId;

    this.removeMitosisIfNeeded(game, pawn);
    this.removeKaryogamyIfNeeded(game, pawn);

    const roadIndex = this.getSquareIndex(pawn);
    const lastRoadIndex = game.board.road.length - 1;
    const targetIndex = roadIndex + game.dice.result;

    const squaresIds: SquareId[] = [];

    let finalIndex = game.board.road.some(
      ({ id, exit, color }) =>
        id === pawn.squareId && color === pawn.color && exit,
    )
      ? -1
      : -2;
    for (
      let i = roadIndex + 1;
      i <= Math.min(targetIndex, lastRoadIndex);
      i++
    ) {
      const road = game.board.road[i];

      if (finalIndex > -2 || (road.color === pawn.color && road.exit)) {
        finalIndex++;
      }
      squaresIds.push(
        finalIndex >= 0 ? `final-${pawn.color}-${finalIndex}` : road.id,
      );
    }

    const overlay =
      targetIndex > lastRoadIndex ? targetIndex - lastRoadIndex : 0;

    for (let i = 0; i < overlay; i++) {
      const road = game.board.road[i];
      if (finalIndex > -2 || (road.color === pawn.color && road.exit)) {
        finalIndex++;
      }
      squaresIds.push(
        finalIndex >= 0 ? `final-${pawn.color}-${finalIndex}` : road.id,
      );
    }

    const road =
      game.board.road.find((r) => r.id === squaresIds.at(-1)) ??
      game.board.finalZone[pawn.color].find((r) => r.id === squaresIds.at(-1));

    pawn.squareId = road.id;
    pawn.endReached = pawn.squareId === `final-${pawn.color}-5`;
    pawns.forEach((p) => (p.action = undefined));
    game.board.movePawn = {
      color: pawn.color,
      index: pawn.index,
      squaresIds,
      startingSquareId,
    };

    const pawnToSmash = this.smashPawn(game, road, pawn);
    if (pawnToSmash) {
      pawnToSmash.squareId = `initial-${pawnToSmash.color}-${pawnToSmash.index}`;
      game.board.movePawn.smash = {
        color: pawnToSmash.color,
        index: pawnToSmash.index,
      };
    }

    this.addMitosisIfNeeded(game, pawn);
    this.addKaryogamyIfNeeded(game, pawn);

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  @SubscribeMessage(SubscribeEventsEnum.MOVED_PAWN)
  async movedPawn({ id }: Socket) {
    const { game, error } = await this.gameValidator.validateMovedPawn(id);
    if (id !== game?.current) return;
    if (error) return { error };

    this.clearMutations(game, 'mitosis');
    this.clearMutations(game, 'karyogamy');

    game.board.movePawn = null;
    game.dice.ableToRoll = true;

    const player = game.players.find((p) => p.socketId === id);
    const pawns = game.board.pawns[player.color];

    if (pawns.every((p) => p.endReached))
      game.winners[this.getWinnerPosition(game.winners)] = player.color;

    if (Object.values(game.winners).every((w) => w !== null)) {
      this.gameUpdated(game);
      await Promise.all([
        this.redis.del(game.id),
        ...game.players.map((p) => this.redis.del(p.socketId)),
      ]);
      return;
    }

    if (game.dice.result !== 6 || game.dice.count > 2) {
      game.dice.count = 0;
      game.current = this.getNextPlayer(
        game.current,
        game.players,
        game.winners,
      );
    }

    this.gameUpdated(game);
    await this.saveGame(game);
  }

  private gameUpdated(game: Game) {
    return this.server
      .to(game.players.map((p) => p.socketId))
      .emit(PublishEventsEnum.GAME_UPDATED, game);
  }

  private getSquareIndex(pawn: Pawn) {
    const splitId = pawn.squareId.split('-');
    return parseInt(splitId[2] ?? splitId[1]);
  }

  private getNextPlayer(current: string, players: Player[], winners: Winners) {
    const playerIndex = players.findIndex((p) => p.socketId === current);
    const nextIndex = playerIndex < 3 ? playerIndex + 1 : 0;
    const nextPlayer = players[nextIndex];
    return Object.values(winners).includes(nextPlayer.color)
      ? this.getNextPlayer(nextPlayer.socketId, players, winners)
      : nextPlayer.socketId;
  }

  private getRoll() {
    return (Math.floor(Math.random() * 6) + 1) as DiceResult;
  }

  private getWinnerPosition(winners: Winners) {
    return Object.values(winners).filter((w) => w).length + 1;
  }

  private smashPawn(game: Game, road: Square | FinalSquare, pawn: Pawn) {
    if (road.id.includes('final')) return;
    if ((<Square>road).safeZone) return false;
    if (this.getPawnsOnRoad(game, road.id).length !== 2) return false;

    const otherColors = colors.filter((c) => c !== pawn.color);
    for (const color of otherColors) {
      for (const pawnToSmash of game.board.pawns[color]) {
        if (pawnToSmash.squareId === road.id) return pawnToSmash;
      }
    }

    return false;
  }

  private getPawnsOnRoad(game: Game, roadId: SquareId) {
    const pawns: Pawn[] = [];
    for (const color of colors) {
      for (const pawn of game.board.pawns[color]) {
        if (pawn.squareId === roadId) pawns.push(pawn);
      }
    }
    return pawns;
  }

  private addMitosisIfNeeded(game: Game, movingPawn: Pawn) {
    const pawnsOnRoad = this.getPawnsOnRoad(game, movingPawn.squareId);

    if (pawnsOnRoad.length < 2) return;
    if (pawnsOnRoad.every(({ color }) => color === pawnsOnRoad[0].color))
      return;

    game.board.mitosis[movingPawn.squareId] ??= [];
    const mitosis = game.board.mitosis[movingPawn.squareId];

    for (const color of colors) {
      const pawns = pawnsOnRoad.filter((p) => p.color === color);
      if (!pawns.length) continue;

      const mitosisPawns = mitosis.filter((m) => m.color === color);

      const pawnsToAdd = pawns.filter(
        (p) => !mitosisPawns.some((m) => m.index === p.index),
      );

      const position = this.getNextPosition(mitosis, color);
      mitosis.push(
        ...pawnsToAdd.map(({ color, index }) => ({
          color,
          index,
          position,
          type: AnimationTypeEnum.ADDED,
        })),
      );
    }
  }

  private removeMitosisIfNeeded(game: Game, pawn: Pawn) {
    const pawnsOnRoad = this.getPawnsOnRoad(game, pawn.squareId);
    if (!pawnsOnRoad.length) return;

    const mitosis = game.board.mitosis[pawn.squareId];
    if (!mitosis) return;

    const pawnMitosis = mitosis.find(
      (m) => m.color === pawn.color && m.index === pawn.index,
    );

    if (!pawnMitosis) return;

    pawnMitosis.type = AnimationTypeEnum.REMOVED;
  }

  private addKaryogamyIfNeeded(game: Game, movingPawn: Pawn) {
    const pawnsOnRoad = this.getPawnsOnRoad(game, movingPawn.squareId);
    if (pawnsOnRoad.length < 2) return;

    const pawnsOnRoadColors = pawnsOnRoad.map((p) => p.color);
    const pawnsOnRoadWithSameColor = new Set(
      pawnsOnRoadColors.filter(
        (color) => pawnsOnRoadColors.filter((c) => c === color).length > 1,
      ),
    );
    if (!pawnsOnRoadWithSameColor.size) return;

    game.board.karyogamy[movingPawn.squareId] ??= [];
    const karyogamy = game.board.karyogamy[movingPawn.squareId];

    for (const color of pawnsOnRoadWithSameColor) {
      const pawns = pawnsOnRoad.filter(
        (p) =>
          p.color === color &&
          !karyogamy.some((k) => k.id === p.index && k.color === color),
      );
      if (!pawns.length) continue;

      karyogamy.push(
        ...pawns.map(({ color, index }) => ({
          color,
          id: index,
          type: AnimationTypeEnum.ADDED,
          isMain: false,
        })),
      );
      const karyogamyPawns = karyogamy.filter((k) => k.color === color);
      if (!karyogamyPawns.some((p) => p.isMain))
        karyogamyPawns[0].isMain = true;
    }
  }

  private removeKaryogamyIfNeeded(game: Game, pawn: Pawn) {
    const pawnsOnRoad = this.getPawnsOnRoad(game, pawn.squareId);
    if (!pawnsOnRoad.length) return;

    const karyogamy = game.board.karyogamy[pawn.squareId];
    if (!karyogamy) return;

    const pawnKaryogamy = karyogamy.find(
      ({ color, id }) => color === pawn.color && id === pawn.index,
    );

    if (!pawnKaryogamy) return;
    pawnKaryogamy.type = AnimationTypeEnum.REMOVED;
    pawnKaryogamy.isMain = false;

    const karyogamyPawns = karyogamy.filter(
      (k) => k.color === pawn.color && k.type !== AnimationTypeEnum.REMOVED,
    );
    if (karyogamyPawns.length && !karyogamyPawns.some((p) => p.isMain))
      karyogamyPawns[0].isMain = true;
  }

  private clearMutations(game: Game, mutation: 'karyogamy' | 'mitosis') {
    if (!game.board.movePawn) return;
    const { movePawn } = game.board;

    const removedPawn = game.board.pawns[movePawn.color].find(
      (p) => p.index === movePawn.index,
    );
    const oldSquareId = movePawn.squaresIds.shift();

    for (const squareId of [oldSquareId, removedPawn.squareId]) {
      const squareMutation = game.board[mutation][squareId];
      if (!squareMutation) continue;

      game.board[mutation][squareId] = (squareMutation as any[])
        .filter((m) => m.type !== AnimationTypeEnum.REMOVED)
        .map((m) => ({ ...m, type: AnimationTypeEnum.ANIMATED }));
    }
  }

  private getNextPosition(mitosis: MitosisIdentifier[], color: ColorEnum) {
    const currentColorPositions = mitosis.find(
      (m) => m.color === color,
    )?.position;

    return (
      currentColorPositions ??
      [
        PawnSquarePositionEnum.TOP_LEFT,
        PawnSquarePositionEnum.TOP_RIGHT,
        PawnSquarePositionEnum.BOTTOM_LEFT,
        PawnSquarePositionEnum.BOTTOM_RIGHT,
      ].find((p) => !mitosis.some((m) => m.position === p))
    );
  }

  private async saveGame(game: Game) {
    return await (this.redis as any).set(
      game.id,
      JSON.stringify(game),
      'EX',
      process.env.REDIS_EXPIRATION_TIME,
    );
  }

  async handleDisconnect({ id }: Socket) {
    const gameId = await this.redis.get(id);
    if (!gameId) return;

    const promises: Promise<unknown>[] = [this.redis.del(id)];

    const gameJson = await this.redis.get(gameId);
    if (!gameJson) return await Promise.all(promises);

    const game: Game = JSON.parse(gameJson);
    if (game.players.length === 1) {
      promises.push(this.redis.del(gameId));
      return await Promise.all(promises);
    }

    game.players = game.players.filter((p) => p.socketId !== id);

    promises.push(this.saveGame(game));

    this.gameUpdated(game);
    return await Promise.all(promises);
  }

  async onModuleDestroy() {
    await this.redis.flushAll();
  }
}

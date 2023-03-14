import { SubscribeEventsEnum } from '../game.events.enum';
import { ColorEnum } from './colors';

type ZoneColor = `${'initial' | 'final'}-${ColorEnum}`;
export type ActionTuple = [SubscribeEventsEnum, number];
export type SquareId = `${'road' | ZoneColor}-${number}`;
export interface Pawn {
  color: ColorEnum;
  index: number;
  squareId: SquareId;
  endReached?: boolean;
  action?: ActionTuple;
}

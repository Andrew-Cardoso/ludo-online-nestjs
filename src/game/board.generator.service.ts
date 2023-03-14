import { Injectable } from '@nestjs/common';
import { Board } from './types/board';
import { ColorSquare } from './types/color-square';
import { colors, ColorEnum } from './types/colors';
import { FinalSquare } from './types/final-square';
import { InitialSquare } from './types/initial-square';
import { Pawn } from './types/pawn';
import { Square } from './types/square';

@Injectable()
export class BoardGeneratorService {
  createBoard(): Board {
    return {
      finalZone: this.generateFinalZone(),
      initialZone: this.generateInitialZone(),
      road: this.generateRoad(),
      pawns: this.generatePawns(),
      movePawn: null,
      karyogamy: {},
      mitosis: {},
    };
  }

  private generateInitialZone() {
    const colorSquares: Partial<ColorSquare<InitialSquare>> = {};

    for (const color of colors) {
      colorSquares[color] = [];
      for (let i = 0; i < 4; i++)
        colorSquares[color].push({ id: `initial-${color}-${i}` });
    }

    return colorSquares as ColorSquare<InitialSquare>;
  }

  private generateFinalZone() {
    const colorSquares: Partial<ColorSquare<FinalSquare>> = {};

    for (const color of colors) {
      colorSquares[color] = [];
      for (let i = 0; i < 6; i++)
        colorSquares[color].push({
          id: `final-${color}-${i}`,
        });
    }

    return colorSquares as ColorSquare<FinalSquare>;
  }

  private generateRoad() {
    return colors.flatMap((color, i) => this.generateColorRoad(color, i));
  }

  private generateColorRoad(color: ColorEnum, colorIndex: number) {
    const initialIndex = colorIndex * 13;
    const colorRoad: Square[] = [];
    for (let i = 0; i < 13; i++) {
      const square: Square = {
        id: `road-${initialIndex + i}`,
        color,
      };

      if (i === 3) square.safeZone = true;
      if (i === 6) square.exit = true;
      if (i === 8) {
        square.entrance = true;
        square.safeZone = true;
      }

      colorRoad.push(square);
    }

    return colorRoad;
  }

  private generatePawns() {
    const colorPawns: Partial<ColorSquare<Pawn>> = {};
    for (const color of colors) {
      colorPawns[color] = [];
      for (let i = 0; i < 4; i++)
        colorPawns[color].push({
          color,
          index: i,
          squareId: `initial-${color}-${i}`,
        });
    }

    return colorPawns as ColorSquare<Pawn>;
  }
}

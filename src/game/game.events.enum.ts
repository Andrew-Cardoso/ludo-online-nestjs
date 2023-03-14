export enum SubscribeEventsEnum {
  CREATE_GAME = 'game:create',
  JOIN_GAME = 'game:join',
  CHOOSE_COLOR = 'game:color',
  ROLL_DICE = 'game:roll',
  ROLL_RESULT = 'game:roll-result',
  MOVED_PAWN = 'game:moved',
  MOVE_INITIAL = 'game:move-initial',
  MOVE_ROAD = 'game:move-road',
  MOVE_FINAL = 'game:move-final',
}

export enum PublishEventsEnum {
  GAME_UPDATED = 'game:updated',
}

// Событийная шина — слабосвязанная коммуникация систем
type Handler = (payload?: unknown) => void;

export class EventBus {
  private map = new Map<string, Set<Handler>>();

  on(type: string, fn: Handler): () => void {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
    return () => this.map.get(type)?.delete(fn);
  }

  emit(type: string, payload?: unknown) {
    const set = this.map.get(type);
    if (set) for (const fn of set) fn(payload);
  }

  clear() {
    this.map.clear();
  }
}

export const GameEvents = {
  CANNON_FIRED: 'cannon:fired',
  PROJECTILE_HIT: 'projectile:hit',
  PROJECTILE_SPLASH: 'projectile:splash',
  SHIP_DAMAGED: 'ship:damaged',
  SHIP_SURRENDER: 'ship:surrender',
  SHIP_SUNK: 'ship:sunk',
  PLAYER_DOCKED: 'player:docked',
  PLAYER_UNDOCKED: 'player:undocked',
  PRIZE_TAKEN: 'prize:taken',
  ANCHOR_TOGGLED: 'anchor:toggled',
  AMMO_SWITCHED: 'ammo:switched',
  AIM_TOGGLED: 'aim:toggled',
  CAMERA_MODE: 'camera:mode',
  REPAIR_TICK: 'repair:tick',
  FIRE_STARTED: 'fire:started',
  FIRE_OUT: 'fire:out',
  MESSAGE: 'ui:message',
} as const;

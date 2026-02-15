// data/monsters.ts — NPC monster templates

export interface MonsterTemplate {
  templateId: string;
  name: string;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  patrolRadius: number;
  goldDropMin: number;
  goldDropMax: number;
}

export const MONSTER_TEMPLATES: Record<string, MonsterTemplate> = {
  weak_goblin: {
    templateId: 'weak_goblin',
    name: 'Weak Goblin',
    health: 30,
    maxHealth: 30,
    attack: 5,
    defense: 3,
    speed: 3,
    patrolRadius: 30,
    goldDropMin: 5,
    goldDropMax: 15,
  },
  medium_wolf: {
    templateId: 'medium_wolf',
    name: 'Medium Wolf',
    health: 60,
    maxHealth: 60,
    attack: 10,
    defense: 5,
    speed: 4,
    patrolRadius: 40,
    goldDropMin: 15,
    goldDropMax: 40,
  },
  strong_troll: {
    templateId: 'strong_troll',
    name: 'Strong Troll',
    health: 120,
    maxHealth: 120,
    attack: 18,
    defense: 12,
    speed: 2,
    patrolRadius: 25,
    goldDropMin: 40,
    goldDropMax: 100,
  },
};

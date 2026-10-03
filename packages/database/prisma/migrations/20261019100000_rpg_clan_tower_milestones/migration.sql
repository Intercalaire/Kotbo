-- Tour de clan : paliers collectifs, atteints au total des étages gravis par le clan.
ALTER TABLE "rpg_clan_tower_configs" ADD COLUMN "milestones" INTEGER[] DEFAULT ARRAY[10, 25, 50]::INTEGER[];

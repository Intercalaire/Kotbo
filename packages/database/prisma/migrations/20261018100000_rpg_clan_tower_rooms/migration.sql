-- Tour de clan : salles conquises, qui restent vaincues pour tout le clan pendant l'événement.
CREATE TABLE "rpg_clan_tower_rooms" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clanId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "layoutKey" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conqueredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_clan_tower_rooms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_clan_tower_rooms_eventId_clanId_floor_layoutKey_roomId_key" ON "rpg_clan_tower_rooms"("eventId", "clanId", "floor", "layoutKey", "roomId");
CREATE INDEX "rpg_clan_tower_rooms_eventId_clanId_floor_idx" ON "rpg_clan_tower_rooms"("eventId", "clanId", "floor");

ALTER TABLE "rpg_clan_tower_rooms" ADD CONSTRAINT "rpg_clan_tower_rooms_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "rpg_clan_tower_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

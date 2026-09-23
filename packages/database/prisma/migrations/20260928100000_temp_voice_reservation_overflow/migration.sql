-- Salons vocaux temporaires : les roles proposes a la reservation, et le sort
-- des personnes deja presentes qui n'ont pas ce role.
--
-- `reservableRoleIds` vide = le menu laisse choisir n'importe quel role, soit le
-- comportement livre. `reservationOverflow` vaut ASK : la question n'est posee
-- que lorsqu'il y a quelqu'un a qui elle s'applique, et aucune action n'est
-- prise sans reponse.
ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "reservableRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "reservationOverflow" TEXT NOT NULL DEFAULT 'ASK';

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "reservationFallbackChannelId" TEXT;

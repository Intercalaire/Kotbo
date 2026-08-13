-- Le règlement ne notifie plus les membres en MP : la publication est annoncée
-- uniquement dans le salon d'annonces staff.
UPDATE "dashboard_feature_configs"
SET "notifyViaDM" = false,
    "notifyOnlyStaffRoles" = false
WHERE "featureKey" = 'regulation'
  AND ("notifyViaDM" = true OR "notifyOnlyStaffRoles" = true);

-- Add deacon_school_principal to the roles enum
ALTER TYPE "public"."roles" ADD VALUE IF NOT EXISTS 'deacon_school_principal';

-- Ensure role metadata exists for UI/API role lookups
INSERT INTO "public"."roles_table" ("role_id", "role_name", "priority")
SELECT
	'deacon_school_principal'::"public"."roles",
	'Deacons School Principal',
	1
WHERE NOT EXISTS (
	SELECT 1
	FROM "public"."roles_table"
	WHERE "role_id" = 'deacon_school_principal'::"public"."roles"
);

-- Assign role to user by email
WITH target_user AS (
	SELECT p.portal_id
	FROM "public"."profiles" p
	WHERE lower(p.email) = lower('kyro25@gmail.com')
	LIMIT 1
),
target_service AS (
	SELECT s.service_id
	FROM "public"."services_table" s
	WHERE lower(s.service_id) = 'deacons'

	UNION ALL

	SELECT s.service_id
	FROM "public"."services_table" s
	WHERE lower(s.service_id) LIKE '%deacon%'
		 OR lower(s.service_title) LIKE '%deacon%'

	UNION ALL

	SELECT 'deacons'::text
	LIMIT 1
)
INSERT INTO "public"."user_service_roles" ("portal_id", "role_id", "service_id")
SELECT
	tu.portal_id,
	'deacon_school_principal'::"public"."roles",
	ts.service_id
FROM target_user tu
CROSS JOIN target_service ts
WHERE NOT EXISTS (
	SELECT 1
	FROM "public"."user_service_roles" usr
	WHERE usr.portal_id = tu.portal_id
		AND usr.role_id = 'deacon_school_principal'::"public"."roles"
		AND usr.service_id = ts.service_id
);

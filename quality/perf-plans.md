# SQLite query plans

Catalog statements run against the in-memory fixture schema (`tests/catalog-fixture.ts`) — no catalog file is installed on this machine.

## Statements

### src/lib/server/catalog/foods.ts — foodsByBarcode

```sql
select f.food_id, f.name, f.brand, f.kind, f.category, f.gtin14, f.license,
	f.serving_label, f.serving_g, f.kcal, f.protein, f.fat, f.carbs, f.sugar, f.fiber,
	f.sodium, f.saturated_fat, f.potassium, f.iron, f.calcium, f.magnesium, f.zinc,
	f.vitamin_a, f.vitamin_c, f.vitamin_d, f.vitamin_b12, f.quality, f.n_sources from food f where f.gtin14 = ? order by f.quality desc
```

Plan:

- SEARCH f USING INDEX idx_food_gtin (gtin14=?)
- USE TEMP B-TREE FOR ORDER BY

### src/lib/server/catalog/foods.ts — searchFoods (built at run time)

```sql
with matched as (
	select rowid as food_id from food_fts where food_fts match :match
),
named as (
	select
		m.food_id as food_id,
		f.name as name,
		f.quality as row_quality,
		-- LIKE and lower() fold ASCII only, so a name whose leading word carries
		-- an accent would lose the name terms below. Three of the catalog's
		-- 426,456 names hold any non-ASCII character and none of them is a
		-- letter, so the cost of that today is nothing and the saved lower()
		-- call is real.
		(f.name like :prefix) as name_leads,
		2 * min(1.0, (length(:text) * 1.0) / max(length(f.name), 1))
			+ 1.5 * (case when f.kind = 'generic' then 1.0 else 0.0 end)
			+ 0.75 * (case when f.kind = 'generic' and f.quality >= 91
				then 1.0 else 0.0 end)
			+ 1.5 * min(1.0,
				ln(1.0 + f.n_sources) / ln(1.0 + 250.0))
			+ 0.5 * max(0.0, (f.quality - 87) / 13.0)
			as row_score
	from matched m
	join food f on f.food_id = m.food_id
),
scored as (
	select food_id, name, row_quality, row_score + case when name_leads = 0 then 0.0 else (
				with parts(full_name, head_name) as (values (lower(trim(name)), case when instr(name, ',') > 0
					then lower(trim(substr(name, 1, instr(name, ',') - 1)))
					else lower(trim(name)) end))
				select 2 * (case when case when length(full_name) > 3 and substr(full_name, -1) = 's'
				then substr(full_name, 1, length(full_name) - 1) else full_name end = :singular
						then 1.0 else 0.0 end)
					+ 2 * (case when case when length(head_name) > 3 and substr(head_name, -1) = 's'
				then substr(head_name, 1, length(head_name) - 1) else head_name end = :singular
						then 1.0 else 0.0 end)
					+ 0.75 * (case when head_name like :text || '%' then 1.0 else 0.0 end)
				from parts
			) end as score
	from named
	order by score desc, row_quality desc
	limit 2000
),
-- The collapse, before anything is cut to a page. The key is the name with one
-- trailing "s" dropped, so "Milk" and "Milks" are one food; the ordering inside
-- a name is what makes the survivor the best-scoring row of that name and, on a
-- tie, the highest-quality one.
deduplicated as (
	select
		food_id, name, row_quality, score,
		row_number() over (partition by case when length(lower(trim(name))) > 3 and substr(lower(trim(name)), -1) = 's'
				then substr(lower(trim(name)), 1, length(lower(trim(name))) - 1) else lower(trim(name)) end
			order by score desc, row_quality desc) as position
	from scored
),
shortlist as (
	select food_id, name, row_quality, score
	from deduplicated
	where position = 1
	order by score desc, row_quality desc
	limit 500
),
-- MATERIALIZED, and measured: the byproduct test names this CTE's column 33
-- times, and without the hint SQLite flattens the CTE and rebuilds the parts
-- string once per mention. That cost 21 ms a query on the live catalog, against
-- 5 ms with the hint.
segmented as materialized (
	select food_id, name, row_quality, score, ',' || replace(replace(lower(trim(name)), ' ,', ','), ', ', ',') || ',' as name_parts
	from shortlist
),
ranked as (
	select
		food_id,
		score - 1 * case when instr(lower(name), 'dried') > 0 or instr(lower(name), 'dehydrated') > 0 or instr(lower(name), 'powder') > 0 or instr(lower(name), 'frozen') > 0 or instr(lower(name), 'canned') > 0 or instr(lower(name), 'concentrate') > 0 or instr(lower(name), 'imitation') > 0 or instr(lower(name), 'meatless') > 0 or (instr(name_parts, ',beans,') = 0 and instr(name_parts, ',peanut butter,') = 0) and ((instr(' ' || :text || ' ', ' blood ') = 0 and instr(' ' || :text || ' ', ' bloods ') = 0 and instr(name_parts, ',blood,') > 0) or (instr(' ' || :text || ' ', ' bone marrow ') = 0 and instr(' ' || :text || ' ', ' bone marrows ') = 0 and instr(name_parts, ',bone marrow,') > 0) or (instr(' ' || :text || ' ', ' bones ') = 0 and instr(' ' || :text || ' ', ' bone ') = 0 and instr(name_parts, ',bones,') > 0) or (instr(' ' || :text || ' ', ' brain ') = 0 and instr(' ' || :text || ' ', ' brains ') = 0 and instr(name_parts, ',brain,') > 0) or (instr(' ' || :text || ' ', ' brains ') = 0 and instr(' ' || :text || ' ', ' brain ') = 0 and instr(name_parts, ',brains,') > 0) or (instr(' ' || :text || ' ', ' chitterlings ') = 0 and instr(' ' || :text || ' ', ' chitterling ') = 0 and instr(name_parts, ',chitterlings,') > 0) or (instr(' ' || :text || ' ', ' ears ') = 0 and instr(' ' || :text || ' ', ' ear ') = 0 and instr(name_parts, ',ears,') > 0) or (instr(' ' || :text || ' ', ' fat ') = 0 and instr(' ' || :text || ' ', ' fats ') = 0 and instr(name_parts, ',fat,') > 0) or (instr(' ' || :text || ' ', ' feet ') = 0 and instr(' ' || :text || ' ', ' feets ') = 0 and instr(name_parts, ',feet,') > 0) or (instr(' ' || :text || ' ', ' giblets ') = 0 and instr(' ' || :text || ' ', ' giblet ') = 0 and instr(name_parts, ',giblets,') > 0) or (instr(' ' || :text || ' ', ' gizzard ') = 0 and instr(' ' || :text || ' ', ' gizzards ') = 0 and instr(name_parts, ',gizzard,') > 0) or (instr(' ' || :text || ' ', ' heart ') = 0 and instr(' ' || :text || ' ', ' hearts ') = 0 and instr(name_parts, ',heart,') > 0) or (instr(' ' || :text || ' ', ' jowl ') = 0 and instr(' ' || :text || ' ', ' jowls ') = 0 and instr(name_parts, ',jowl,') > 0) or (instr(' ' || :text || ' ', ' kidney ') = 0 and instr(' ' || :text || ' ', ' kidneys ') = 0 and instr(name_parts, ',kidney,') > 0) or (instr(' ' || :text || ' ', ' kidneys ') = 0 and instr(' ' || :text || ' ', ' kidney ') = 0 and instr(name_parts, ',kidneys,') > 0) or (instr(' ' || :text || ' ', ' leaves ') = 0 and instr(' ' || :text || ' ', ' leave ') = 0 and instr(name_parts, ',leaves,') > 0) or (instr(' ' || :text || ' ', ' leaf fat ') = 0 and instr(' ' || :text || ' ', ' leaf fats ') = 0 and instr(name_parts, ',leaf fat,') > 0) or (instr(' ' || :text || ' ', ' liver ') = 0 and instr(' ' || :text || ' ', ' livers ') = 0 and instr(name_parts, ',liver,') > 0) or (instr(' ' || :text || ' ', ' livers ') = 0 and instr(' ' || :text || ' ', ' liver ') = 0 and instr(name_parts, ',livers,') > 0) or (instr(' ' || :text || ' ', ' lung ') = 0 and instr(' ' || :text || ' ', ' lungs ') = 0 and instr(name_parts, ',lung,') > 0) or (instr(' ' || :text || ' ', ' lungs ') = 0 and instr(' ' || :text || ' ', ' lung ') = 0 and instr(name_parts, ',lungs,') > 0) or (instr(' ' || :text || ' ', ' neck ') = 0 and instr(' ' || :text || ' ', ' necks ') = 0 and instr(name_parts, ',neck,') > 0) or (instr(' ' || :text || ' ', ' pancreas ') = 0 and instr(' ' || :text || ' ', ' pancrea ') = 0 and instr(name_parts, ',pancreas,') > 0) or (instr(' ' || :text || ' ', ' skin ') = 0 and instr(' ' || :text || ' ', ' skins ') = 0 and instr(name_parts, ',skin,') > 0) or (instr(' ' || :text || ' ', ' spleen ') = 0 and instr(' ' || :text || ' ', ' spleens ') = 0 and instr(name_parts, ',spleen,') > 0) or (instr(' ' || :text || ' ', ' stalks ') = 0 and instr(' ' || :text || ' ', ' stalk ') = 0 and instr(name_parts, ',stalks,') > 0) or (instr(' ' || :text || ' ', ' stomach ') = 0 and instr(' ' || :text || ' ', ' stomachs ') = 0 and instr(name_parts, ',stomach,') > 0) or (instr(' ' || :text || ' ', ' suet ') = 0 and instr(' ' || :text || ' ', ' suets ') = 0 and instr(name_parts, ',suet,') > 0) or (instr(' ' || :text || ' ', ' sweetbread ') = 0 and instr(' ' || :text || ' ', ' sweetbreads ') = 0 and instr(name_parts, ',sweetbread,') > 0) or (instr(' ' || :text || ' ', ' sweetbreads ') = 0 and instr(' ' || :text || ' ', ' sweetbread ') = 0 and instr(name_parts, ',sweetbreads,') > 0) or (instr(' ' || :text || ' ', ' tail ') = 0 and instr(' ' || :text || ' ', ' tails ') = 0 and instr(name_parts, ',tail,') > 0) or (instr(' ' || :text || ' ', ' testes ') = 0 and instr(' ' || :text || ' ', ' teste ') = 0 and instr(name_parts, ',testes,') > 0) or (instr(' ' || :text || ' ', ' thymus ') = 0 and instr(' ' || :text || ' ', ' thymu ') = 0 and instr(name_parts, ',thymus,') > 0) or (instr(' ' || :text || ' ', ' tongue ') = 0 and instr(' ' || :text || ' ', ' tongues ') = 0 and instr(name_parts, ',tongue,') > 0) or (instr(' ' || :text || ' ', ' tripe ') = 0 and instr(' ' || :text || ' ', ' tripes ') = 0 and instr(name_parts, ',tripe,') > 0)) then 1.0 else 0.0 end as score,
		row_quality
	from segmented
)
select f.food_id, f.name, f.brand, f.kind, f.category, f.gtin14, f.license,
	f.serving_label, f.serving_g, f.kcal, f.protein, f.fat, f.carbs, f.sugar, f.fiber,
	f.sodium, f.saturated_fat, f.potassium, f.iron, f.calcium, f.magnesium, f.zinc,
	f.vitamin_a, f.vitamin_c, f.vitamin_d, f.vitamin_b12, f.quality, f.n_sources
from ranked d
join food f on f.food_id = d.food_id
order by d.score desc, f.quality desc
limit :limit
```

Plan:

- MATERIALIZE segmented
- CO-ROUTINE shortlist
- CO-ROUTINE deduplicated
- CO-ROUTINE (subquery-11)
- CO-ROUTINE scored
- SCAN food_fts VIRTUAL TABLE INDEX 0:M3
- SEARCH f USING INDEX idx_food_id (food_id=?)
- CORRELATED SCALAR SUBQUERY 4
- MATERIALIZE parts
- SCAN CONSTANT ROW
- SCAN parts
- USE TEMP B-TREE FOR ORDER BY
- SCAN scored
- USE TEMP B-TREE FOR ORDER BY
- SCAN (subquery-11)
- SCAN deduplicated
- USE TEMP B-TREE FOR ORDER BY
- SCAN shortlist
- SCAN segmented
- SEARCH f USING INDEX idx_food_id (food_id=?)
- USE TEMP B-TREE FOR ORDER BY

### src/lib/server/catalog/serving-rows.ts — servingRowsByFood (built at run time)

```sql
select food_id, label, grams from food_serving
		where food_id in (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			and typeof(label) = 'text' and typeof(grams) in ('real', 'integer')
		order by food_id, is_default desc, label
```

Plan:

- SEARCH food_serving USING INDEX idx_serving_food (food_id=?)
- USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY

### src/lib/server/state/document.ts — readDocument

```sql
select format, body, version, updated_at from household_state where household_id = ?
```

Plan:

- SEARCH household_state USING INDEX sqlite_autoindex_household_state_1 (household_id=?)

### src/lib/server/state/document.ts — writeDocument

```sql
insert into household_state (household_id, format, body, version, updated_at, updated_by)
				 values (?, ?, ?, ?, ?, ?)
```

Plan:

### src/lib/server/state/document.ts — writeDocument (2)

```sql
update household_state
				 set format = ?, body = ?, version = ?, updated_at = ?, updated_by = ?
				 where household_id = ? and version = ?
```

Plan:

- SEARCH household_state USING INDEX sqlite_autoindex_household_state_1 (household_id=?)

### src/lib/server/users/accounts.ts — insertAccount

```sql
insert into account (id, username, display_name, password_hash, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?)
```

Plan:

### src/lib/server/users/accounts.ts — insertAccount (2)

```sql
insert into household (id, name, created_at) values (?, ?, ?)
```

Plan:

### src/lib/server/users/accounts.ts — insertAccount (3)

```sql
insert into membership (household_id, account_id, role, created_at) values (?, ?, ?, ?)
```

Plan:

### src/lib/server/users/accounts.ts — insertAccount (4)

```sql
insert into profile (id, household_id, account_id, name, created_at) values (?, ?, ?, ?, ?)
```

Plan:

### src/lib/server/users/accounts.ts — authenticate

```sql
select id, username, display_name, password_hash, created_at from account where username = ?
```

Plan:

- SEARCH account USING INDEX sqlite_autoindex_account_2 (username=?)

### src/lib/server/users/accounts.ts — authenticate (2)

```sql
update account set password_hash = ?, updated_at = ? where id = ? and password_hash = ?
```

Plan:

- SEARCH account USING INDEX sqlite_autoindex_account_1 (id=?)

### src/lib/server/users/accounts.ts — membershipsFor

```sql
select h.id as household_id, h.name, m.role
			 from membership m
			 join household h on h.id = m.household_id
			 where m.account_id = ?
			 order by h.created_at
```

Plan:

- SCAN m
- SEARCH h USING INDEX sqlite_autoindex_household_1 (id=?)
- USE TEMP B-TREE FOR ORDER BY

### src/lib/server/users/sessions.ts — createSession

```sql
insert into session (id, account_id, token_hash, device_label, created_at, last_seen_at, expires_at)
		 values (?, ?, ?, ?, ?, ?, ?)
```

Plan:

### src/lib/server/users/sessions.ts — resolveSession

```sql
select s.id as session_id, s.expires_at, s.last_seen_at,
			        a.id as account_id, a.username,
			        a.display_name, a.created_at
			 from session s
			 join account a on a.id = s.account_id
			 where s.token_hash = ?
```

Plan:

- SEARCH s USING INDEX sqlite_autoindex_session_2 (token_hash=?)
- SEARCH a USING INDEX sqlite_autoindex_account_1 (id=?)

### src/lib/server/users/sessions.ts — resolveSession (2)

```sql
delete from session where token_hash = ?
```

Plan:

- SEARCH session USING INDEX sqlite_autoindex_session_2 (token_hash=?)

### src/lib/server/users/sessions.ts — resolveSession (3)

```sql
update session set last_seen_at = ? where token_hash = ? and last_seen_at <= ?
```

Plan:

- SEARCH session USING INDEX sqlite_autoindex_session_2 (token_hash=?)

### src/lib/server/users/sessions.ts — endSession

```sql
delete from session where token_hash = ?
```

Plan:

- SEARCH session USING INDEX sqlite_autoindex_session_2 (token_hash=?)

### src/lib/server/users/sessions.ts — endAllSessions

```sql
delete from session where account_id = ?
```

Plan:

- SEARCH session USING COVERING INDEX session_by_account (account_id=?)

### src/lib/server/users/throttle.ts — readState

```sql
select failures, window_ends_at, locked_until
			 from sign_in_throttle
			 where scope = ? and key_hash = ?
```

Plan:

- SEARCH sign_in_throttle USING INDEX sqlite_autoindex_sign_in_throttle_1 (scope=? AND key_hash=?)

### src/lib/server/users/throttle.ts — writeState

```sql
insert into sign_in_throttle (scope, key_hash, failures, window_ends_at, locked_until)
		 values (?, ?, ?, ?, ?)
		 on conflict (scope, key_hash) do update set
		   failures = excluded.failures,
		   window_ends_at = excluded.window_ends_at,
		   locked_until = excluded.locked_until
```

Plan:

### src/lib/server/users/throttle.ts — clearSignInFailures

```sql
delete from sign_in_throttle where scope = ? and key_hash = ?
```

Plan:

- SEARCH sign_in_throttle USING INDEX sqlite_autoindex_sign_in_throttle_1 (scope=? AND key_hash=?)

### src/lib/server/users/throttle.ts — pruneSignInThrottle

```sql
delete from sign_in_throttle
			 where window_ends_at <= ? and (locked_until is null or locked_until <= ?)
```

Plan:

- SEARCH sign_in_throttle USING INDEX sign_in_throttle_expiry (window_ends_at<?)
